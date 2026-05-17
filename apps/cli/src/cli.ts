import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { defineCommand, runMain } from "citty";
import * as p from "@clack/prompts";
import {
  applyProjectEnvironment,
  createJsonReporter,
  createNullReporter,
  DemoDevError,
  ERROR_CODES,
  emitRunResult,
  failFromError,
  getProjectConfigField,
  loadProjectConfig,
  type ProgressReporter,
  type RunSummary,
  writeJson,
} from "@demo-dev/core";
import {
  capturePlanContinuous,
  bootstrapAuth,
} from "@demo-dev/browser";
import {
  buildVoiceScript,
  synthesizeVoice,
} from "@demo-dev/voice";
import {
  composeVideo,
  buildVisualPlan,
  listVideoQualities,
  type BrowserFrameOptions,
  type BackgroundPresetName,
} from "@demo-dev/render";
import { buildDirectorPlan } from "@demo-dev/director";
import { listExportAspectRatios, resolveExportProfile } from "@demo-dev/exporter";
import { evaluateDemoQuality } from "@demo-dev/quality";
import { listDemoStyles, DEFAULT_DEMO_STYLE } from "@demo-dev/style-presets";
import { listAvailableProviders } from "@demo-dev/ai";
import {
  planFromPrompt,
  runPipeline,
  runPipelineWithPlan,
  type RunPipelineOptions,
} from "@demo-dev/agent";
import { demoPlanSchema } from "@demo-dev/planner";
import type { DemoPlan } from "@demo-dev/types";
import { initProject } from "./setup/init.js";
import { runDoctor } from "./setup/doctor.js";
import { buildSheetShowcasePlan } from "./showcase/sheet.js";
import { formatToolsSchema } from "./setup/tools-schema.js";

// ---------------------------------------------------------------------------
// Shared args & helpers
// ---------------------------------------------------------------------------

const sharedArgs = {
  "base-url": { type: "string" as const, description: "Base URL of the web app" },
  "output-dir": { type: "string" as const, description: "Output directory", default: "artifacts" },
  config: { type: "string" as const, description: "Path to demo.dev.config.json" },
  json: { type: "boolean" as const, description: "Emit NDJSON progress events and a final structured result on stdout" },
} as const;

const frameArgs = {
  frame: { type: "boolean" as const, description: "Wrap the video in a Screen Studio–style browser frame" },
  "frame-chrome": { type: "string" as const, description: "Chrome style: macos | minimal | none" },
  "frame-radius": { type: "string" as const, description: "Window corner radius in px (default 14)" },
  "frame-shadow": { type: "string" as const, description: "Shadow intensity: none | soft | medium | strong (default medium)" },
  "frame-padding": { type: "string" as const, description: "Padding around the window in px (default 64)" },
  "background-image": { type: "string" as const, description: "Path to a background image (absolute or relative to CWD)" },
  "background-color": { type: "string" as const, description: "Solid background color (hex, e.g. #0a0a0a)" },
  "background-preset": {
    type: "string" as const,
    description: "Built-in background preset: sunset | ocean | forest | mesh-purple | mesh-pink | midnight | paper",
  },
  "display-url": { type: "string" as const, description: "URL label shown in the address bar (only for chrome=macos)" },
} as const;

const isJsonMode = (args: Record<string, unknown>) => args.json === true;

const resolveConfig = async (args: Record<string, unknown>) => {
  const { path: configPath, config: projectConfig } = await loadProjectConfig(args.config as string | undefined);
  applyProjectEnvironment(projectConfig);
  return {
    configPath,
    projectConfig,
    outputDir: (args["output-dir"] as string) ?? projectConfig.outputDir ?? "artifacts",
    baseUrl: (args["base-url"] as string) ?? projectConfig.baseUrl,
  };
};

const requireBaseUrl = (baseUrl: string | undefined, command: string): string => {
  if (!baseUrl) {
    throw new DemoDevError(
      "CONFIG_MISSING_BASE_URL",
      `${command} requires --base-url or baseUrl in demo.dev.config.json`,
    );
  }
  return baseUrl;
};

const buildReporter = (json: boolean): ProgressReporter =>
  json ? createJsonReporter() : createNullReporter();

const parseList = (raw: string | undefined) =>
  raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];

const parseFrameOptions = (args: Record<string, unknown>): BrowserFrameOptions | boolean | undefined => {
  const chrome = args["frame-chrome"] as string | undefined;
  const radius = args["frame-radius"] as string | undefined;
  const shadow = args["frame-shadow"] as string | undefined;
  const padding = args["frame-padding"] as string | undefined;
  const bgImage = args["background-image"] as string | undefined;
  const bgColor = args["background-color"] as string | undefined;
  const bgPreset = args["background-preset"] as string | undefined;
  const displayUrl = args["display-url"] as string | undefined;

  const hasCustom = chrome || radius || shadow || padding || bgImage || bgColor || bgPreset || displayUrl;

  if (!args.frame && !hasCustom) return undefined;
  if (!hasCustom) return true;

  const opts: BrowserFrameOptions = {};
  if (chrome === "macos" || chrome === "minimal" || chrome === "none") opts.chrome = chrome;
  if (radius) opts.windowRadius = Number(radius);
  if (shadow === "none" || shadow === "soft" || shadow === "medium" || shadow === "strong") opts.shadow = shadow;
  if (padding) opts.padding = Number(padding);
  if (bgImage) opts.backgroundImage = resolve(process.cwd(), bgImage);
  if (bgColor) opts.backgroundColor = bgColor;
  if (bgPreset) opts.backgroundPreset = bgPreset as BackgroundPresetName;
  if (displayUrl) opts.displayUrl = displayUrl;
  return opts;
};

/**
 * Wrap a command handler so:
 *  - Errors become a structured RunFailure (JSON or text)
 *  - SIGINT/SIGTERM is captured and reported as INTERRUPTED with partial artifacts
 *  - process.exit code reflects success/failure
 */
const wrapCommand = (
  commandName: string,
  handler: (ctx: {
    args: Record<string, unknown>;
    json: boolean;
    reporter: ProgressReporter;
    startedAt: number;
  }) => Promise<RunSummary | void>,
) => {
  return async ({ args }: { args: Record<string, unknown> }) => {
    const json = isJsonMode(args);
    const reporter = buildReporter(json);
    const startedAt = Date.now();
    let interrupted = false;

    const onSignal = (signal: NodeJS.Signals) => {
      if (interrupted) return;
      interrupted = true;
      const failure = failFromError(
        commandName,
        new DemoDevError("INTERRUPTED", `Received ${signal}; aborting after partial work`),
        { startedAt, reporter },
      );
      emitRunResult(failure, { json });
      process.stdout.write("");
      setTimeout(() => process.exit(130), 50);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    try {
      const summary = await handler({ args, json, reporter, startedAt });
      if (summary && summary.ok) emitRunResult(summary, { json });
    } catch (error) {
      const failure = failFromError(commandName, error, { startedAt, reporter });
      emitRunResult(failure, { json });
      if (!json) p.log.error(`${failure.error.code}: ${failure.error.message}`);
      process.exitCode = 1;
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  };
};

const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;

// ---------------------------------------------------------------------------
// Setup commands
// ---------------------------------------------------------------------------

const init = defineCommand({
  meta: { name: "init", description: "Create a demo.dev.config.json in the current directory" },
  args: { ...sharedArgs, force: { type: "boolean", description: "Overwrite existing config" } },
  run: wrapCommand("init", async ({ args, json, startedAt }) => {
    const { projectConfig, baseUrl, outputDir } = await resolveConfig(args);
    if (!json) p.log.info("Creating config");
    const result = await initProject({
      force: Boolean(args.force),
      existingConfig: { ...projectConfig, baseUrl, outputDir },
    });
    if (!json) p.log.success(`Config → ${result.configPath}`);
    return {
      ok: true,
      command: "init",
      durationMs: Date.now() - startedAt,
      outputDir,
      artifacts: { configPath: result.configPath },
      warnings: [],
    };
  }),
});

const doctor = defineCommand({
  meta: { name: "doctor", description: "Check environment, config, and session validity" },
  args: {
    ...sharedArgs,
    "check-session": { type: "boolean", description: "Only check storage-state validity" },
  },
  async run({ args }) {
    const json = isJsonMode(args);
    const { configPath, projectConfig, baseUrl, outputDir } = await resolveConfig(args);
    const result = await runDoctor({
      configPath,
      config: { ...projectConfig, baseUrl, outputDir },
      json,
      checkSessionOnly: Boolean(args["check-session"]),
    });
    if (!result.ok) process.exitCode = 1;
  },
});

const config = defineCommand({
  meta: { name: "config", description: "Show resolved project config" },
  args: { ...sharedArgs, field: { type: "string", description: "Get a single config field" } },
  async run({ args }) {
    const { configPath, projectConfig } = await resolveConfig(args);
    if (args.field) {
      console.log(getProjectConfigField(projectConfig, args.field as string) ?? "");
      return;
    }
    console.log(JSON.stringify({
      path: configPath,
      ...projectConfig,
      readyUrl: projectConfig.readyUrl ?? projectConfig.baseUrl,
    }, null, 2));
  },
});

const providers = defineCommand({
  meta: { name: "providers", description: "List available AI / TTS providers" },
  async run() {
    const list = await listAvailableProviders();
    console.log(JSON.stringify(list, null, 2));
  },
});

const toolsSchema = defineCommand({
  meta: { name: "tools-schema", description: "Emit OpenAI function-calling schema for the public commands" },
  args: { format: { type: "string", description: "openai | json", default: "openai" } },
  async run({ args }) {
    console.log(formatToolsSchema((args.format as "openai" | "json") ?? "openai"));
  },
});

// ---------------------------------------------------------------------------
// Info commands (list everything an agent might need to know)
// ---------------------------------------------------------------------------

const styles = defineCommand({
  meta: { name: "styles", description: "List available visual direction style presets" },
  async run() {
    console.log(JSON.stringify({ default: DEFAULT_DEMO_STYLE, styles: listDemoStyles() }, null, 2));
  },
});

const exports = defineCommand({
  meta: { name: "exports", description: "List available aspect ratios and quality presets" },
  async run() {
    console.log(JSON.stringify({
      aspectRatios: listExportAspectRatios(),
      qualities: listVideoQualities(),
    }, null, 2));
  },
});

const errorsCmd = defineCommand({
  meta: { name: "errors", description: "List structured error codes the CLI may emit" },
  async run() {
    console.log(JSON.stringify({ codes: Object.values(ERROR_CODES) }, null, 2));
  },
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const auth = defineCommand({
  meta: { name: "auth", description: "Log into the target app and persist a Playwright storage-state" },
  args: {
    ...sharedArgs,
    email: { type: "string", description: "Login email" },
    password: { type: "string", description: "Login password (discouraged — prefer --credentials-file)" },
    "credentials-file": { type: "string", description: "Path to a JSON file containing {email, password}" },
    "storage-state": { type: "string", description: "Path to save storage state" },
  },
  run: wrapCommand("auth", async ({ args, json, startedAt }) => {
    const { projectConfig, baseUrl, outputDir } = await resolveConfig(args);
    const resolvedUrl = requireBaseUrl(baseUrl, "auth");

    let email = (args.email as string | undefined) ?? process.env.DEMO_LOGIN_EMAIL;
    let password = (args.password as string | undefined) ?? process.env.DEMO_LOGIN_PASSWORD;

    if (args["credentials-file"]) {
      try {
        const raw = await readFile(resolve(process.cwd(), args["credentials-file"] as string), "utf8");
        const parsed = JSON.parse(raw) as { email?: string; password?: string };
        email = email ?? parsed.email;
        password = password ?? parsed.password;
      } catch (cause) {
        throw new DemoDevError("AUTH_CREDENTIALS_FILE_INVALID", "Could not read credentials file", { cause });
      }
    }

    const storageStatePath =
      (args["storage-state"] as string | undefined)
      ?? projectConfig.saveStorageStatePath
      ?? process.env.DEMO_SAVE_STORAGE_STATE
      ?? join(outputDir, "storage-state.json");

    if (!email || !password) {
      throw new DemoDevError(
        "AUTH_CREDENTIALS_MISSING",
        "Missing credentials. Provide --credentials-file, DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD env vars, or (discouraged) --email/--password.",
      );
    }
    if (args.password && !json) {
      p.log.warn("--password is logged into shell history. Prefer --credentials-file or env vars.");
    }

    if (!json) p.log.info("Logging in");
    const result = await bootstrapAuth({
      baseUrl: resolvedUrl, email, password,
      outputPath: storageStatePath,
      auth: projectConfig.auth,
    });
    if (!json) p.log.success(`Session → ${result.storageStatePath}`);
    return {
      ok: true,
      command: "auth",
      durationMs: Date.now() - startedAt,
      outputDir,
      artifacts: { storageStatePath: result.storageStatePath },
      warnings: args.password ? [{ message: "--password used; prefer --credentials-file" }] : [],
    };
  }),
});

// ---------------------------------------------------------------------------
// Pipeline building blocks (every step is a first-class CLI)
// ---------------------------------------------------------------------------

const plan = defineCommand({
  meta: { name: "plan", description: "Build a demo plan from a natural-language prompt. No recording." },
  args: {
    ...sharedArgs,
    prompt: { type: "string", description: "Natural-language brief", required: true },
    seed: { type: "string", description: "Deterministic seed (OpenAI only)" },
    probe: { type: "boolean", description: "Also probe pages to refine selectors" },
  },
  run: wrapCommand("plan", async ({ args, json, reporter, startedAt }) => {
    const { projectConfig, outputDir, baseUrl } = await resolveConfig(args);
    const resolvedUrl = requireBaseUrl(baseUrl, "plan");
    const result = await planFromPrompt({
      prompt: args.prompt as string,
      baseUrl: resolvedUrl,
      outputDir,
      projectConfig,
      seed: args.seed ? Number(args.seed) : undefined,
      probe: Boolean(args.probe),
      reporter,
    });
    const planPath = join(outputDir, "demo-plan.json");
    if (!json) p.log.success(`Plan → ${planPath}`);
    return {
      ok: true,
      command: "plan",
      durationMs: Date.now() - startedAt,
      outputDir,
      artifacts: { planPath },
      warnings: [],
      metrics: { scenes: result.scenes.length },
    };
  }),
});

const validate = defineCommand({
  meta: { name: "validate", description: "Validate a hand-written demo-plan.json against the schema" },
  args: {
    path: { type: "positional", description: "Path to demo-plan.json", required: true },
    json: { type: "boolean", description: "Emit structured JSON" },
  },
  run: wrapCommand("validate", async ({ args, json, startedAt }) => {
    const path = resolve(process.cwd(), args.path as string);
    let plan: unknown;
    try {
      plan = await readJson(path);
    } catch (cause) {
      throw new DemoDevError("REUSE_ARTIFACT_INVALID", `Could not read ${path}`, { cause });
    }
    const parsed = demoPlanSchema.safeParse(plan);
    if (!parsed.success) {
      throw new DemoDevError("REUSE_ARTIFACT_INVALID", "Plan does not match schema", {
        details: { issues: parsed.error.issues },
      });
    }
    if (!json) p.log.success(`${path} is a valid demo plan (${parsed.data.scenes.length} scenes)`);
    return {
      ok: true,
      command: "validate",
      durationMs: Date.now() - startedAt,
      outputDir: ".",
      artifacts: { planPath: path },
      warnings: [],
      metrics: { scenes: parsed.data.scenes.length },
    };
  }),
});

const capture = defineCommand({
  meta: { name: "capture", description: "Record a continuous video from an existing demo plan" },
  args: {
    ...sharedArgs,
    plan: { type: "string", description: "Path to demo-plan.json (required)" },
    "allow-destructive": { type: "boolean", description: "Allow scenes flagged as destructive" },
    "allow-domain": { type: "string", description: "Comma-separated extra hosts allowed" },
    "blur-emails": { type: "boolean", description: "Blur email-like content" },
    "blur-credit-cards": { type: "boolean", description: "Blur credit-card-like content" },
  },
  run: wrapCommand("capture", async ({ args, json, reporter, startedAt }) => {
    const { outputDir, baseUrl } = await resolveConfig(args);
    const resolvedUrl = requireBaseUrl(baseUrl, "capture");
    if (!args.plan) {
      throw new DemoDevError("CONFIG_MISSING_BASE_URL", "capture requires --plan <path-to-demo-plan.json>");
    }
    const planObj = await readJson<DemoPlan>(resolve(process.cwd(), args.plan as string));
    reporter.phase("capture", "start", `Recording ${planObj.scenes.length} scenes`);
    const result = await capturePlanContinuous(planObj, {
      baseUrl: resolvedUrl,
      outputDir: join(outputDir, "captures"),
      reporter,
      allowDestructive: Boolean(args["allow-destructive"]),
      piiBlur:
        args["blur-emails"] || args["blur-credit-cards"]
          ? { emails: Boolean(args["blur-emails"]), creditCards: Boolean(args["blur-credit-cards"]) }
          : undefined,
    });
    const capturePath = join(outputDir, "continuous-capture.json");
    await writeJson(capturePath, {
      videoPath: result.videoPath,
      sceneMarkers: result.sceneMarkers,
      interactions: result.interactions,
      totalDurationMs: result.totalDurationMs,
      viewport: result.viewport,
      cursorSamples: result.cursorLog.length,
    });
    reporter.trackArtifact(capturePath);
    reporter.trackArtifact(result.videoPath);
    if (!json) p.log.success(`Video → ${result.videoPath}`);
    return {
      ok: true,
      command: "capture",
      durationMs: Date.now() - startedAt,
      outputDir,
      artifacts: { videoPath: result.videoPath, capturePath },
      warnings: [],
      metrics: { recordedMs: result.totalDurationMs },
    };
  }),
});

const voice = defineCommand({
  meta: { name: "voice", description: "Synthesize narration from a plan, or test TTS on a single string" },
  args: {
    ...sharedArgs,
    plan: { type: "string", description: "Path to demo-plan.json" },
    text: { type: "string", description: "One-off text to synthesize (for testing a TTS provider)" },
  },
  run: wrapCommand("voice", async ({ args, json, reporter, startedAt }) => {
    const { outputDir } = await resolveConfig(args);
    if (!args.plan && !args.text) {
      throw new DemoDevError(
        "CONFIG_MISSING_BASE_URL",
        "voice requires either --plan <demo-plan.json> or --text \"...\"",
      );
    }
    reporter.phase("voice", "start", "Synthesizing narration");
    if (args.text) {
      const lines = await synthesizeVoice(
        [{ sceneId: "adhoc", text: args.text as string, estimatedMs: 0, tokens: [] }],
        { outputDir: join(outputDir, "audio") },
      );
      const scriptPath = join(outputDir, "voice-script.json");
      await writeJson(scriptPath, lines);
      reporter.trackArtifact(scriptPath);
      if (!json) p.log.success(`Audio → ${lines[0]?.audioPath ?? "(none)"}`);
      return {
        ok: true,
        command: "voice",
        durationMs: Date.now() - startedAt,
        outputDir,
        artifacts: { voiceScriptPath: scriptPath },
        warnings: [],
      };
    }
    const planObj = await readJson<DemoPlan>(resolve(process.cwd(), args.plan as string));
    const lines = await synthesizeVoice(buildVoiceScript(planObj), { outputDir: join(outputDir, "audio") });
    const scriptPath = join(outputDir, "voice-script.json");
    await writeJson(scriptPath, lines);
    reporter.trackArtifact(scriptPath);
    if (!json) p.log.success(`Voice → ${scriptPath}`);
    return {
      ok: true,
      command: "voice",
      durationMs: Date.now() - startedAt,
      outputDir,
      artifacts: { voiceScriptPath: scriptPath },
      warnings: [],
      metrics: { audioFiles: lines.filter((l) => l.audioPath).length },
    };
  }),
});

const direct = defineCommand({
  meta: { name: "direct", description: "Generate a director plan (zoom + speed ramps) from an existing capture" },
  args: {
    ...sharedArgs,
    capture: { type: "string", description: "Path to continuous-capture.json", required: true },
    style: { type: "string", description: "Style preset name", default: DEFAULT_DEMO_STYLE },
  },
  run: wrapCommand("direct", async ({ args, json, reporter, startedAt }) => {
    const { outputDir } = await resolveConfig(args);
    const captureObj = await readJson<Parameters<typeof buildDirectorPlan>[0]>(
      resolve(process.cwd(), args.capture as string),
    );
    if (!captureObj.cursorLog) captureObj.cursorLog = [];
    if (!captureObj.interactions) captureObj.interactions = [];
    if (!captureObj.sceneMarkers) captureObj.sceneMarkers = [];
    reporter.phase("director", "start", "Computing zoom and speed ramps");
    const directorPlan = buildDirectorPlan(captureObj, { style: args.style as string });
    const directorPath = join(outputDir, "director-plan.json");
    await writeJson(directorPath, directorPlan);
    await writeJson(join(outputDir, "visual-plan.json"), directorPlan);
    reporter.trackArtifact(directorPath);
    reporter.phase("director", "success", "Director plan ready");
    if (!json) p.log.success(`Director → ${directorPath}`);
    return {
      ok: true,
      command: "direct",
      durationMs: Date.now() - startedAt,
      outputDir,
      artifacts: { directorPlanPath: directorPath },
      warnings: [],
      metrics: { keyframes: directorPlan.zoomKeyframes.length, speedSegments: directorPlan.speedSegments.length },
    };
  }),
});

const render = defineCommand({
  meta: { name: "render", description: "Compose the final mp4 from a capture + voice + director plan" },
  args: {
    ...sharedArgs,
    capture: { type: "string", description: "Path to continuous-capture.json", required: true },
    voice: { type: "string", description: "Path to voice-script.json" },
    plan: { type: "string", description: "Path to demo-plan.json (for title metadata)" },
    director: { type: "string", description: "Path to director-plan.json (auto-generated if omitted)" },
    out: { type: "string", description: "Output mp4 path", default: "artifacts/pr-demo.mp4" },
    quality: { type: "enum", options: ["draft", "standard", "high"], default: "standard" },
    style: { type: "enum", options: listDemoStyles().map((s) => s.name) as string[], default: DEFAULT_DEMO_STYLE },
    "aspect-ratio": { type: "enum", options: listExportAspectRatios() as string[] },
    ...frameArgs,
  },
  run: wrapCommand("render", async ({ args, json, reporter, startedAt }) => {
    const { outputDir } = await resolveConfig(args);
    const capturePath = resolve(process.cwd(), args.capture as string);
    const captureObj = await readJson<Awaited<ReturnType<typeof capturePlanContinuous>>>(capturePath);
    captureObj.cursorLog = captureObj.cursorLog ?? [];
    captureObj.interactions = captureObj.interactions ?? [];
    captureObj.sceneMarkers = captureObj.sceneMarkers ?? [];

    const voiceLines = args.voice
      ? await readJson<Awaited<ReturnType<typeof synthesizeVoice>>>(resolve(process.cwd(), args.voice as string))
      : [];
    const planObj = args.plan ? await readJson<DemoPlan>(resolve(process.cwd(), args.plan as string)) : undefined;
    const directorPlan = args.director
      ? await readJson<ReturnType<typeof buildDirectorPlan>>(resolve(process.cwd(), args.director as string))
      : buildVisualPlan(captureObj);

    const out = (args.out as string | undefined) ?? join(outputDir, "pr-demo.mp4");
    const frame = parseFrameOptions(args);

    reporter.phase("render", "start", "Composing video");
    const videoPath = await composeVideo({
      videoPath: captureObj.videoPath,
      outputPath: out,
      visualPlan: directorPlan,
      capture: captureObj,
      voiceLines,
      title: planObj?.title,
      quality: args.quality as "draft" | "standard" | "high",
      frame: typeof frame === "object" ? frame : frame === true ? {} : undefined,
    });
    reporter.trackArtifact(videoPath);
    if (!json) p.log.success(`Video → ${videoPath}`);
    return {
      ok: true,
      command: "render",
      durationMs: Date.now() - startedAt,
      outputDir,
      artifacts: { videoPath },
      warnings: [],
    };
  }),
});

const quality = defineCommand({
  meta: { name: "quality", description: "Score an existing mp4 against a plan + voice script" },
  args: {
    ...sharedArgs,
    video: { type: "positional", description: "Path to the mp4 to score", required: true },
    plan: { type: "string", description: "Path to demo-plan.json" },
    voice: { type: "string", description: "Path to voice-script.json" },
    "aspect-ratio": { type: "enum", options: listExportAspectRatios() as string[], default: "16:9" },
  },
  run: wrapCommand("quality", async ({ args, json, startedAt }) => {
    const { outputDir } = await resolveConfig(args);
    const videoPath = resolve(process.cwd(), args.video as string);
    const planObj = args.plan ? await readJson<DemoPlan>(resolve(process.cwd(), args.plan as string)) : { title: "", summary: "", branch: "", generatedAt: "", scenes: [] } as DemoPlan;
    const voiceLines = args.voice
      ? await readJson<Awaited<ReturnType<typeof synthesizeVoice>>>(resolve(process.cwd(), args.voice as string))
      : [];
    const exportProfile = resolveExportProfile({ aspectRatio: args["aspect-ratio"] as string | undefined });
    const report = await evaluateDemoQuality({
      videoPath,
      plan: planObj,
      voiceLines,
      expectedAspectRatio: exportProfile.aspectRatio,
    });
    const reportPath = join(outputDir, "quality-report.json");
    await writeJson(reportPath, report);
    if (!json) p.log.success(`Quality ${report.score}/100 → ${reportPath}`);
    return {
      ok: true,
      command: "quality",
      durationMs: Date.now() - startedAt,
      outputDir,
      artifacts: { qualityReportPath: reportPath },
      warnings: [],
      metrics: { qualityScore: report.score },
    };
  }),
});

// ---------------------------------------------------------------------------
// Full pipeline (the canonical agent entrypoint)
// ---------------------------------------------------------------------------

const demo = defineCommand({
  meta: { name: "demo", description: "Full pipeline: plan → capture → voice → render → mp4" },
  args: {
    ...sharedArgs,
    prompt: { type: "string", description: "Natural-language brief" },
    quality: { type: "enum", options: ["draft", "standard", "high"], default: "standard" },
    style: { type: "enum", options: listDemoStyles().map((s) => s.name) as string[], default: DEFAULT_DEMO_STYLE },
    "aspect-ratio": { type: "enum", options: listExportAspectRatios() as string[] },
    ...frameArgs,
    seed: { type: "string", description: "Deterministic seed (OpenAI only)" },
    "estimate-only": { type: "boolean", description: "Plan only and return cost/duration estimate" },
    "no-polish": { type: "boolean", description: "Skip the LLM polish pass over narration copy" },
    "reuse-plan": { type: "string", description: "Path to demo-plan.json to skip planning" },
    "reuse-capture": { type: "string", description: "Path to continuous-capture.json to skip recording" },
    "reuse-voice": { type: "string", description: "Path to voice-script.json to skip narration synthesis" },
    "storage-state": { type: "string", description: "Path to a Playwright storage-state to reuse a session" },
    "allow-destructive": { type: "boolean", description: "Allow scenes flagged as destructive" },
    "allow-domain": { type: "string", description: "Comma-separated extra hosts allowed" },
    "blur-emails": { type: "boolean", description: "Blur email addresses in captures" },
    "blur-credit-cards": { type: "boolean", description: "Blur credit-card-like content in captures" },
  },
  run: wrapCommand("demo", async ({ args, json, reporter, startedAt }) => {
    const { projectConfig, outputDir, baseUrl } = await resolveConfig(args);
    const resolvedUrl = requireBaseUrl(baseUrl, "demo");

    if (args["storage-state"]) process.env.DEMO_STORAGE_STATE = args["storage-state"] as string;

    if (!json) {
      p.intro("demo.dev");
      if (args.prompt) p.log.info(`Prompt: "${args.prompt}"`);
      if (args["estimate-only"]) p.log.info("Estimate-only mode");
    }

    const allowedHosts = parseList(args["allow-domain"] as string | undefined);
    const pipelineOptions: RunPipelineOptions = {
      baseUrl: resolvedUrl,
      outputDir,
      projectConfig,
      renderVideo: true,
      prompt: args.prompt as string | undefined,
      quality: args.quality as "draft" | "standard" | "high",
      style: args.style as string,
      aspectRatio: args["aspect-ratio"] as string | undefined,
      frame: parseFrameOptions(args),
      seed: args.seed ? Number(args.seed) : undefined,
      estimateOnly: Boolean(args["estimate-only"]),
      noPolish: Boolean(args["no-polish"]),
      reusePlan: args["reuse-plan"] as string | undefined,
      reuseCapture: args["reuse-capture"] as string | undefined,
      reuseVoice: args["reuse-voice"] as string | undefined,
      allowDestructive: Boolean(args["allow-destructive"]),
      allowedHosts,
      piiBlur:
        args["blur-emails"] || args["blur-credit-cards"]
          ? { emails: Boolean(args["blur-emails"]), creditCards: Boolean(args["blur-credit-cards"]) }
          : undefined,
      reporter,
    };

    const result = await runPipeline(pipelineOptions);

    if (!json) {
      if ((result as { estimate?: unknown }).estimate) {
        p.log.success("Estimate written");
      } else {
        if (result.videoPath) p.log.success(`Video → ${result.videoPath}`);
        if (result.qualityReport) p.log.info(`Quality score → ${result.qualityReport.score}/100`);
        p.outro(`Done → ${outputDir}`);
      }
    }

    const warnings = (result.plan?.scenes ?? [])
      .filter((scene) => scene.destructive && !args["allow-destructive"])
      .map((scene) => ({ code: "DESTRUCTIVE_ACTION_BLOCKED", message: `Skipped destructive scene "${scene.title}"` }));

    return {
      ok: true,
      command: "demo",
      durationMs: Date.now() - startedAt,
      outputDir,
      artifacts: {
        videoPath: result.videoPath,
        planPath: join(outputDir, "demo-plan.json"),
        capturePath: join(outputDir, "continuous-capture.json"),
        voiceScriptPath: join(outputDir, "voice-script.json"),
        qualityReportPath: join(outputDir, "quality-report.json"),
        estimatePath: (result as { estimate?: unknown }).estimate ? join(outputDir, "estimate.json") : undefined,
      },
      scenes: result.plan?.scenes.map((scene) => ({
        id: scene.id,
        title: scene.title,
        durationMs: scene.durationMs,
        actions: scene.actions.length,
        destructive: scene.destructive,
        skipped: scene.destructive && !args["allow-destructive"] ? true : undefined,
        skipReason: scene.destructive && !args["allow-destructive"] ? "destructive" : undefined,
      })),
      warnings,
      metrics: result.qualityReport ? { qualityScore: result.qualityReport.score } : undefined,
    };
  }),
});

const showcase = defineCommand({
  meta: { name: "showcase", description: "Generate a built-in public showcase demo video" },
  args: {
    ...sharedArgs,
    kind: { type: "enum", options: ["sheet"], default: "sheet" },
    quality: { type: "enum", options: ["draft", "standard", "high"], default: "standard" },
    style: { type: "enum", options: listDemoStyles().map((s) => s.name) as string[], default: "launch-demo" },
    "aspect-ratio": { type: "enum", options: listExportAspectRatios() as string[], default: "16:9" },
    ...frameArgs,
  },
  run: wrapCommand("showcase", async ({ args, json, reporter, startedAt }) => {
    const { outputDir, baseUrl } = await resolveConfig(args);
    const resolvedUrl = baseUrl ?? "http://localhost:3000";
    const showcaseOutputDir =
      (args["output-dir"] as string | undefined) === undefined ? "artifacts-showcase-sheet" : outputDir;
    const plan = buildSheetShowcasePlan(resolvedUrl);

    if (!json) p.intro("demo.dev showcase");

    const result = await runPipelineWithPlan({
      plan,
      baseUrl: resolvedUrl,
      outputDir: showcaseOutputDir,
      renderVideo: true,
      quality: args.quality as "draft" | "standard" | "high",
      style: args.style as string,
      aspectRatio: args["aspect-ratio"] as string,
      frame: parseFrameOptions(args),
      speedRamps: false,
      polishCopy: false,
      reporter,
    });
    if (!json && result.videoPath) p.log.success(`Video → ${result.videoPath}`);
    return {
      ok: true,
      command: "showcase",
      durationMs: Date.now() - startedAt,
      outputDir: showcaseOutputDir,
      artifacts: { videoPath: result.videoPath },
      warnings: [],
    };
  }),
});

// ---------------------------------------------------------------------------
// Root command
// ---------------------------------------------------------------------------

const main = defineCommand({
  meta: { name: "demo-dev", version: "0.3.0", description: "Screen Studio for AI agents" },
  subCommands: {
    demo,
    plan,
    validate,
    capture,
    voice,
    direct,
    render,
    quality,
    auth,
    doctor,
    init,
    config,
    providers,
    styles,
    exports,
    errors: errorsCmd,
    "tools-schema": toolsSchema,
    showcase,
  },
});

runMain(main);
