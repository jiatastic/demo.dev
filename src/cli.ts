import { join } from "node:path";
import { defineCommand, runMain } from "citty";
import * as p from "@clack/prompts";
import { buildDiffContext } from "./lib/git.js";
import { writeJson } from "./lib/fs.js";
import { buildDemoPlan } from "./planner/index.js";
import { capturePlanContinuous } from "./capture/continuous-capture.js";
import { buildVoiceScript } from "./voice/script.js";
import { synthesizeVoice } from "./voice/tts.js";
import { buildVisualPlan } from "./render/visual-plan.js";
import { composeVideo } from "./render/ffmpeg-compose.js";
import { upsertPrComment } from "./github/comment.js";
import { buildExecutablePlan, runPipeline } from "./orchestrate.js";
import { bootstrapAuth } from "./auth/bootstrap.js";
import { listAvailableProviders } from "./ai/provider.js";
import { applyProjectEnvironment, getProjectConfigField, loadProjectConfig } from "./config/project.js";
import { initProject } from "./setup/init.js";
import { runDoctor } from "./setup/doctor.js";

// ---------------------------------------------------------------------------
// Shared args & helpers
// ---------------------------------------------------------------------------

const sharedArgs = {
  "base-url": { type: "string" as const, description: "Base URL of the web app" },
  "base-ref": { type: "string" as const, description: "Git base ref", default: "origin/main" },
  "output-dir": { type: "string" as const, description: "Output directory", default: "artifacts" },
  config: { type: "string" as const, description: "Path to demo.dev.config.json" },
} as const;

const resolveConfig = async (args: Record<string, unknown>) => {
  const { path: configPath, config: projectConfig } = await loadProjectConfig(args.config as string | undefined);
  applyProjectEnvironment(projectConfig);
  return {
    configPath,
    projectConfig,
    baseRef: (args["base-ref"] as string) ?? projectConfig.baseRef ?? "origin/main",
    outputDir: (args["output-dir"] as string) ?? projectConfig.outputDir ?? "artifacts",
    baseUrl: (args["base-url"] as string) ?? projectConfig.baseUrl,
  };
};

const requireBaseUrl = (baseUrl: string | undefined, command: string) => {
  if (!baseUrl) {
    p.log.error(`${command} requires --base-url or baseUrl in demo.dev.config.json`);
    process.exit(1);
  }
  return baseUrl;
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const init = defineCommand({
  meta: { name: "init", description: "Initialize demo.dev config in a project" },
  args: {
    ...sharedArgs,
    force: { type: "boolean", description: "Overwrite existing config" },
  },
  async run({ args }) {
    const { projectConfig, baseUrl, baseRef, outputDir } = await resolveConfig(args);
    const s = p.spinner();
    s.start("Creating config");
    const result = await initProject({
      force: args.force,
      existingConfig: { ...projectConfig, baseUrl, baseRef, outputDir },
    });
    s.stop("Config created");
    p.log.success(`Config → ${result.configPath}`);
    p.log.success(`Workflow → ${result.workflowPath}`);
  },
});

const doctor = defineCommand({
  meta: { name: "doctor", description: "Check environment and config" },
  args: sharedArgs,
  async run({ args }) {
    const { configPath, projectConfig, baseUrl, baseRef, outputDir } = await resolveConfig(args);
    const result = await runDoctor({ configPath, config: { ...projectConfig, baseUrl, baseRef, outputDir } });
    if (!result.ok) process.exitCode = 1;
  },
});

const config = defineCommand({
  meta: { name: "config", description: "Show resolved project config" },
  args: {
    ...sharedArgs,
    field: { type: "string", description: "Get a single config field" },
  },
  async run({ args }) {
    const { configPath, projectConfig } = await resolveConfig(args);
    if (args.field) {
      console.log(getProjectConfigField(projectConfig, args.field) ?? "");
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
  meta: { name: "providers", description: "List available AI/TTS providers" },
  async run() {
    const list = await listAvailableProviders();
    console.log(JSON.stringify(list, null, 2));
  },
});

const plan = defineCommand({
  meta: { name: "plan", description: "Generate a demo plan from the current diff" },
  args: sharedArgs,
  async run({ args }) {
    const { projectConfig, baseRef, outputDir } = await resolveConfig(args);
    const s = p.spinner();
    s.start("Analyzing diff");
    const context = await buildDiffContext(baseRef);
    s.stop("Diff analyzed");
    s.start("Planning demo scenes");
    const demoPlan = await buildDemoPlan(context, projectConfig);
    s.stop(`Planned ${demoPlan.scenes.length} scenes`);
    await writeJson(join(outputDir, "demo-context.json"), context);
    await writeJson(join(outputDir, "demo-plan.json"), demoPlan);
    p.log.success(`Plan → ${join(outputDir, "demo-plan.json")}`);
  },
});

const probe = defineCommand({
  meta: { name: "probe", description: "Plan + probe pages to refine the demo" },
  args: sharedArgs,
  async run({ args }) {
    const { projectConfig, baseRef, outputDir, baseUrl } = await resolveConfig(args);
    const resolvedUrl = requireBaseUrl(baseUrl, "probe");
    const s = p.spinner();
    s.start("Building executable plan");
    const result = await buildExecutablePlan({ baseRef, baseUrl: resolvedUrl, outputDir, projectConfig });
    s.stop(`Refined ${result.plan.scenes.length} scenes`);
    p.log.success(`Plan → ${join(outputDir, "demo-plan.json")}`);
  },
});

const auth = defineCommand({
  meta: { name: "auth", description: "Bootstrap browser auth (login + save session)" },
  args: {
    ...sharedArgs,
    email: { type: "string", description: "Login email" },
    password: { type: "string", description: "Login password" },
    "storage-state": { type: "string", description: "Path to save storage state" },
  },
  async run({ args }) {
    const { projectConfig, baseUrl, outputDir } = await resolveConfig(args);
    const resolvedUrl = requireBaseUrl(baseUrl, "auth");
    const email = args.email ?? process.env.DEMO_LOGIN_EMAIL;
    const password = args.password ?? process.env.DEMO_LOGIN_PASSWORD;
    const storageStatePath = args["storage-state"]
      ?? projectConfig.saveStorageStatePath
      ?? process.env.DEMO_SAVE_STORAGE_STATE
      ?? join(outputDir, "storage-state.json");

    if (!email || !password) {
      p.log.error("Requires --email and --password, or DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD env vars");
      process.exit(1);
    }

    const s = p.spinner();
    s.start("Logging in");
    const result = await bootstrapAuth({
      baseUrl: resolvedUrl, email, password,
      outputPath: storageStatePath,
      auth: projectConfig.auth,
    });
    s.stop("Logged in");
    p.log.success(`Session → ${result.storageStatePath}`);
  },
});

const capture = defineCommand({
  meta: { name: "capture", description: "Continuous browser capture with screencast + ghost-cursor" },
  args: sharedArgs,
  async run({ args }) {
    const { projectConfig, baseRef, outputDir, baseUrl } = await resolveConfig(args);
    const resolvedUrl = requireBaseUrl(baseUrl, "capture");
    const s = p.spinner();
    s.start("Building plan");
    const { plan: demoPlan } = await buildExecutablePlan({ baseRef, baseUrl: resolvedUrl, outputDir, projectConfig });
    s.stop(`${demoPlan.scenes.length} scenes planned`);
    s.start("Recording (screencast + ghost-cursor)");
    const result = await capturePlanContinuous(demoPlan, { baseUrl: resolvedUrl, outputDir: join(outputDir, "captures") });
    s.stop(`Recorded ${(result.totalDurationMs / 1000).toFixed(1)}s`);
    await writeJson(join(outputDir, "continuous-capture.json"), {
      videoPath: result.videoPath,
      sceneMarkers: result.sceneMarkers,
      interactions: result.interactions,
      totalDurationMs: result.totalDurationMs,
      viewport: result.viewport,
      cursorSamples: result.cursorLog.length,
    });
    p.log.success(`Video → ${result.videoPath}`);
  },
});

const voice = defineCommand({
  meta: { name: "voice", description: "Generate TTS narration from the demo plan" },
  args: sharedArgs,
  async run({ args }) {
    const { projectConfig, baseRef, outputDir } = await resolveConfig(args);
    const s = p.spinner();
    s.start("Generating plan");
    const context = await buildDiffContext(baseRef);
    const demoPlan = await buildDemoPlan(context, projectConfig);
    s.stop(`${demoPlan.scenes.length} scenes`);
    s.start("Synthesizing voice");
    const lines = await synthesizeVoice(buildVoiceScript(demoPlan), { outputDir: join(outputDir, "audio") });
    s.stop(`${lines.filter(l => l.audioPath).length} audio files generated`);
    await writeJson(join(outputDir, "voice-script.json"), lines);
    p.log.success(`Voice → ${join(outputDir, "voice-script.json")}`);
  },
});

const render = defineCommand({
  meta: { name: "render", description: "Capture + voice + FFmpeg compose → mp4" },
  args: {
    ...sharedArgs,
    out: { type: "string", description: "Output video path" },
  },
  async run({ args }) {
    const { projectConfig, baseRef, outputDir, baseUrl } = await resolveConfig(args);
    const resolvedUrl = requireBaseUrl(baseUrl, "render");
    const s = p.spinner();

    s.start("Building plan");
    const { plan: demoPlan } = await buildExecutablePlan({ baseRef, baseUrl: resolvedUrl, outputDir, projectConfig });
    s.stop(`${demoPlan.scenes.length} scenes`);

    s.start("Recording");
    const captureResult = await capturePlanContinuous(demoPlan, { baseUrl: resolvedUrl, outputDir: join(outputDir, "captures") });
    s.stop(`Recorded ${(captureResult.totalDurationMs / 1000).toFixed(1)}s`);

    s.start("Generating voice");
    const voicedLines = await synthesizeVoice(buildVoiceScript(demoPlan), { outputDir: join(outputDir, "audio") });
    s.stop(`${voicedLines.filter(l => l.audioPath).length} audio tracks`);

    const visualPlan = buildVisualPlan(captureResult);
    const bgmPath = process.env.DEMO_BGM_PATH;
    const bgmVolume = process.env.DEMO_BGM_VOLUME ? Number(process.env.DEMO_BGM_VOLUME) : undefined;
    const out = args.out ?? join(outputDir, "pr-demo.mp4");

    s.start("Composing video");
    const videoPath = await composeVideo({
      videoPath: captureResult.videoPath, outputPath: out, visualPlan, capture: captureResult,
      voiceLines: voicedLines,
      bgm: bgmPath ? { path: bgmPath, volume: bgmVolume } : undefined,
      title: demoPlan.title,
    });
    s.stop("Video composed");
    p.log.success(`Video → ${videoPath}`);
  },
});

const comment = defineCommand({
  meta: { name: "comment", description: "Post demo artifacts as a PR comment" },
  args: {
    ...sharedArgs,
    "pr-number": { type: "string", description: "PR number to comment on" },
  },
  async run({ args }) {
    const { outputDir } = await resolveConfig(args);
    if (args["pr-number"]) process.env.DEMO_PR_NUMBER = args["pr-number"];
    const s = p.spinner();
    s.start("Posting PR comment");
    await upsertPrComment({ outputDir });
    s.stop("Comment posted");
  },
});

const demo = defineCommand({
  meta: { name: "demo", description: "Full pipeline: plan → capture → voice → render → mp4" },
  args: {
    ...sharedArgs,
    prompt: { type: "string", description: "Natural language prompt describing the demo (skips diff-based planning)" },
    quality: { type: "enum", options: ["draft", "standard", "high"], description: "Video quality preset", default: "standard" },
    frame: { type: "boolean", description: "Wrap in a Screen Studio–style browser frame with gradient background" },
  },
  async run({ args }) {
    const { projectConfig, baseRef, outputDir, baseUrl } = await resolveConfig(args);
    const resolvedUrl = requireBaseUrl(baseUrl, "demo");

    p.intro("demo.dev");

    if (args.prompt) {
      p.log.info(`Prompt mode: "${args.prompt}"`);
    }

    const result = await runPipeline({
      baseRef, baseUrl: resolvedUrl, outputDir, projectConfig, renderVideo: true,
      prompt: args.prompt,
      quality: args.quality as "draft" | "standard" | "high",
      frame: args.frame,
    });

    if (result.videoPath) {
      p.log.success(`Video → ${result.videoPath}`);
    }
    p.outro(`Done → ${outputDir}`);
  },
});

// ---------------------------------------------------------------------------
// Root command
// ---------------------------------------------------------------------------

const main = defineCommand({
  meta: {
    name: "demo-cli",
    version: "0.2.0",
    description: "Turn pull requests into polished product demos",
  },
  subCommands: {
    demo,
    init,
    doctor,
    config,
    providers,
    plan,
    probe,
    auth,
    capture,
    voice,
    render,
    comment,
  },
});

runMain(main);
