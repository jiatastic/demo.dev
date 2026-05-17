import { mkdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import {
  buildOriginPolicy,
  DemoDevError,
  writeJson,
  type OriginPolicy,
  type PiiBlurOptions,
  type ProgressReporter,
} from "@demo-dev/core";
import { createNullReporter } from "@demo-dev/core";
import type { DemoPlan } from "@demo-dev/types";
import {
  annotateDestructiveScenes,
  buildPromptPlan,
  polishPresentationCopy,
  refineDemoPlan,
} from "@demo-dev/planner";
import { capturePlanContinuous, probePlanScenes } from "@demo-dev/browser";
import { buildVoiceScript, synthesizeVoice } from "@demo-dev/voice";
import { composeVideo } from "@demo-dev/render";
import { buildDirectorPlan } from "@demo-dev/director";
import { resolveExportProfile, resolveCaptureViewport, type ExportAspectRatio } from "@demo-dev/exporter";
import { evaluateDemoQuality } from "@demo-dev/quality";
import { resolveDemoStyle, type DemoStyleName } from "@demo-dev/style-presets";
import type { ProjectConfig } from "@demo-dev/core";
import type { BrowserFrameOptions } from "@demo-dev/render";
import { getChromeHeight } from "@demo-dev/render";

export interface PipelineSafetyOptions {
  /** Allow scenes flagged as destructive to execute. Default false. */
  allowDestructive?: boolean;
  /** Hosts allowed to be navigated to, in addition to the baseUrl host. Wildcard ("*.example.com") supported. */
  allowedHosts?: string[];
  /** Blur emails / credit-card-like content during capture. */
  piiBlur?: PiiBlurOptions;
}

export interface PipelineReuseOptions {
  /** Path to a pre-existing demo-plan.json — skips planning. */
  reusePlan?: string;
  /** Path to a pre-existing continuous-capture.json — skips capture. */
  reuseCapture?: string;
  /** Path to a pre-existing voice-script.json — skips TTS synthesis. */
  reuseVoice?: string;
}

export interface RunPipelineOptions extends PipelineSafetyOptions, PipelineReuseOptions {
  baseUrl: string;
  outputDir: string;
  projectConfig?: ProjectConfig;
  renderVideo?: boolean;
  /** Natural-language brief. Required unless reusePlan is provided. */
  prompt?: string;
  quality?: "draft" | "standard" | "high";
  style?: DemoStyleName | string;
  aspectRatio?: ExportAspectRatio | string;
  frame?: boolean | BrowserFrameOptions;
  /** Deterministic seed for LLM-based planning (OpenAI provider only). */
  seed?: number;
  /** Only run the planner phase and return cost/duration estimates. */
  estimateOnly?: boolean;
  /** Skip the LLM polish pass over narration copy. */
  noPolish?: boolean;
  /** NDJSON progress events sink. Falls back to null reporter. */
  reporter?: ProgressReporter;
}

export interface EstimateReport {
  scenes: number;
  estimatedCaptureSec: number;
  estimatedNarrationChars: number;
  estimatedTtsCostUsd: { low: number; high: number };
  estimatedTotalSec: number;
  destructiveScenes: Array<{ id: string; title: string; match?: string }>;
}

const fileExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const readJsonOrThrow = async <T>(path: string, errorCode: "REUSE_ARTIFACT_NOT_FOUND" | "REUSE_ARTIFACT_INVALID"): Promise<T> => {
  if (!(await fileExists(path))) {
    throw new DemoDevError("REUSE_ARTIFACT_NOT_FOUND", `Cannot reuse: ${path} does not exist`, { details: { path } });
  }
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    throw new DemoDevError(errorCode, `Cannot parse reuse artifact at ${path}`, { details: { path }, cause: error });
  }
};

const trackWrite = async (reporter: ProgressReporter, path: string, value: unknown) => {
  await writeJson(path, value);
  reporter.trackArtifact(path);
};

export const buildEstimate = (plan: DemoPlan): EstimateReport => {
  const captureMs = plan.scenes.reduce((acc, scene) => {
    const actionMs = scene.actions.length * 600;
    return acc + Math.max(scene.durationMs ?? 4000, actionMs + 3000);
  }, 15_000);
  const narrationChars = plan.scenes.reduce((acc, scene) => acc + (scene.narration?.length ?? 0), 0);
  const lowUsd = (narrationChars / 1000) * 0.015;
  const highUsd = (narrationChars / 1000) * 0.30;
  const destructive = plan.scenes
    .filter((scene) => scene.destructive)
    .map((scene) => ({ id: scene.id, title: scene.title, match: scene.destructiveMatch }));
  return {
    scenes: plan.scenes.length,
    estimatedCaptureSec: Math.round(captureMs / 1000),
    estimatedNarrationChars: narrationChars,
    estimatedTtsCostUsd: { low: Number(lowUsd.toFixed(3)), high: Number(highUsd.toFixed(3)) },
    estimatedTotalSec: Math.round((captureMs + captureMs * 0.5) / 1000),
    destructiveScenes: destructive,
  };
};

export interface PlanFromPromptOptions {
  prompt: string;
  baseUrl: string;
  outputDir: string;
  projectConfig?: ProjectConfig;
  seed?: number;
  reporter?: ProgressReporter;
  /** When true, also run page probing to refine selectors. */
  probe?: boolean;
}

/** Build a demo plan from a natural-language prompt. Optionally probe + refine selectors. */
export const planFromPrompt = async (options: PlanFromPromptOptions): Promise<DemoPlan> => {
  const reporter = options.reporter ?? createNullReporter();
  await mkdir(options.outputDir, { recursive: true });

  reporter.phase("plan", "start", "Exploring site and drafting plan from prompt");
  const draft = await buildPromptPlan({
    prompt: options.prompt,
    baseUrl: options.baseUrl,
    outputDir: options.outputDir,
    projectConfig: options.projectConfig,
    seed: options.seed,
  });
  let plan = annotateDestructiveScenes(draft);
  await trackWrite(reporter, join(options.outputDir, "demo-plan.json"), plan);
  reporter.phase("plan", "success", `Planned ${plan.scenes.length} scenes`, { scenes: plan.scenes.length });

  if (options.probe) {
    reporter.phase("probe", "start", "Probing pages to refine selectors");
    const probes = await probePlanScenes(plan, {
      baseUrl: options.baseUrl,
      outputDir: options.outputDir,
    });
    await trackWrite(reporter, join(options.outputDir, "page-probes.json"), probes);
    plan = annotateDestructiveScenes(await refineDemoPlan({ initialPlan: plan, probes }));
    await trackWrite(reporter, join(options.outputDir, "demo-plan.json"), plan);
    reporter.phase("probe", "success", "Refined plan written");
  }

  return plan;
};

const loadReusedPlan = async (path: string, reporter: ProgressReporter): Promise<DemoPlan> => {
  reporter.phase("plan", "skip", `Reusing plan from ${path}`);
  const plan = await readJsonOrThrow<DemoPlan>(path, "REUSE_ARTIFACT_INVALID");
  return annotateDestructiveScenes(plan);
};

export const runPipeline = async (options: RunPipelineOptions) => {
  const reporter = options.reporter ?? createNullReporter();
  await mkdir(options.outputDir, { recursive: true });

  let plan: DemoPlan;
  if (options.reusePlan) {
    plan = await loadReusedPlan(options.reusePlan, reporter);
    await trackWrite(reporter, join(options.outputDir, "demo-plan.json"), plan);
  } else if (options.prompt) {
    plan = await planFromPrompt({
      prompt: options.prompt,
      baseUrl: options.baseUrl,
      outputDir: options.outputDir,
      projectConfig: options.projectConfig,
      seed: options.seed,
      reporter,
    });
  } else {
    throw new DemoDevError(
      "CONFIG_MISSING_BASE_URL",
      "demo-dev needs either --prompt or --reuse-plan. The diff-driven mode has been removed.",
    );
  }

  if (options.estimateOnly) {
    reporter.phase("estimate", "start", "Computing estimate");
    const estimate = buildEstimate(plan);
    await trackWrite(reporter, join(options.outputDir, "estimate.json"), estimate);
    reporter.phase("estimate", "success", `~${estimate.estimatedTotalSec}s, ~$${estimate.estimatedTtsCostUsd.low}-${estimate.estimatedTtsCostUsd.high} TTS`);
    return { plan, estimate, voiceScript: undefined, videoPath: undefined, qualityReport: undefined };
  }

  return runPipelineWithPlan({
    plan,
    baseUrl: options.baseUrl,
    outputDir: options.outputDir,
    renderVideo: options.renderVideo,
    quality: options.quality,
    style: options.style,
    aspectRatio: options.aspectRatio,
    frame: options.frame,
    reporter,
    reuseCapture: options.reuseCapture,
    reuseVoice: options.reuseVoice,
    allowDestructive: options.allowDestructive,
    allowedHosts: options.allowedHosts,
    piiBlur: options.piiBlur,
    polishCopy: options.noPolish ? false : undefined,
  });
};

export interface RunPipelineWithPlanOptions extends PipelineSafetyOptions {
  plan: DemoPlan;
  baseUrl: string;
  outputDir: string;
  renderVideo?: boolean;
  quality?: "draft" | "standard" | "high";
  style?: DemoStyleName | string;
  aspectRatio?: ExportAspectRatio | string;
  frame?: boolean | BrowserFrameOptions;
  speedRamps?: boolean;
  polishCopy?: boolean;
  reporter?: ProgressReporter;
  reuseCapture?: string;
  reuseVoice?: string;
}

export const runPipelineWithPlan = async (options: RunPipelineWithPlanOptions) => {
  const reporter = options.reporter ?? createNullReporter();
  const { plan, baseUrl, outputDir, renderVideo = true } = options;
  const style = resolveDemoStyle(options.style);
  const exportProfile = resolveExportProfile({
    aspectRatio: options.aspectRatio,
    resolution: options.quality,
    defaultAspectRatio: style.defaultAspectRatio,
  });
  const frameEnabled = options.frame === true || (typeof options.frame === "object" && options.frame !== null) || (options.frame === undefined && style.frame.enabledByDefault);
  const userFrameOpts: BrowserFrameOptions | undefined =
    typeof options.frame === "object" && options.frame !== null ? options.frame : undefined;
  const framePadding = userFrameOpts?.padding ?? style.frame.padding;
  const frameChrome = userFrameOpts?.chrome ?? style.frame.chrome ?? "macos";
  const chromeHeight = getChromeHeight(frameChrome);
  const renderWidth = frameEnabled
    ? Math.max(640, exportProfile.width - framePadding * 2)
    : exportProfile.width;
  const renderHeight = frameEnabled
    ? Math.max(360, exportProfile.height - framePadding * 2 - chromeHeight)
    : exportProfile.height;
  const captureViewport = frameEnabled
    ? { width: renderWidth, height: renderHeight }
    : resolveCaptureViewport(exportProfile);

  await trackWrite(reporter, join(outputDir, "style-preset.json"), style);
  await trackWrite(reporter, join(outputDir, "export-profile.json"), exportProfile);

  const originPolicy: OriginPolicy = buildOriginPolicy(baseUrl, options.allowedHosts ?? []);

  let captureResult: Awaited<ReturnType<typeof capturePlanContinuous>>;
  if (options.reuseCapture) {
    reporter.phase("capture", "skip", `Reusing capture from ${options.reuseCapture}`);
    const restored = await readJsonOrThrow<Partial<Awaited<ReturnType<typeof capturePlanContinuous>>>>(
      options.reuseCapture,
      "REUSE_ARTIFACT_INVALID",
    );
    if (!restored.videoPath) {
      throw new DemoDevError("REUSE_ARTIFACT_INVALID", "Reused capture is missing videoPath");
    }
    captureResult = {
      videoPath: restored.videoPath,
      cursorLog: restored.cursorLog ?? [],
      interactions: restored.interactions ?? [],
      sceneMarkers: restored.sceneMarkers ?? [],
      totalDurationMs: restored.totalDurationMs ?? 0,
      viewport: restored.viewport ?? { width: 1600, height: 900 },
    } as Awaited<ReturnType<typeof capturePlanContinuous>>;
    reporter.trackArtifact(captureResult.videoPath);
  } else {
    reporter.phase("capture", "start", `Recording ${plan.scenes.length} scenes`);
    captureResult = await capturePlanContinuous(plan, {
      baseUrl,
      outputDir: join(outputDir, "captures"),
      viewport: captureViewport,
      reporter,
      originPolicy,
      allowDestructive: options.allowDestructive,
      piiBlur: options.piiBlur,
    });
    await trackWrite(reporter, join(outputDir, "continuous-capture.json"), {
      videoPath: captureResult.videoPath,
      sceneMarkers: captureResult.sceneMarkers,
      interactions: captureResult.interactions,
      totalDurationMs: captureResult.totalDurationMs,
      viewport: captureResult.viewport,
      cursorSamples: captureResult.cursorLog.length,
    });
    reporter.phase("capture", "success", `Recorded ${(captureResult.totalDurationMs / 1000).toFixed(1)}s`, {
      durationMs: captureResult.totalDurationMs,
    });
  }

  reporter.phase("director", "start", "Computing zoom and speed ramps");
  const baseDirectorPlan = buildDirectorPlan(captureResult, { style: style.name });
  const directorPlan =
    options.speedRamps === false
      ? {
          ...baseDirectorPlan,
          speedSegments: [
            { startMs: 0, endMs: captureResult.totalDurationMs, speed: 1, reason: "normal" as const },
          ],
          adjustedDurationMs: captureResult.totalDurationMs,
          diagnostics: {
            ...baseDirectorPlan.diagnostics,
            speedRampCount: 0,
            adjustedDurationMs: captureResult.totalDurationMs,
          },
        }
      : baseDirectorPlan;
  await trackWrite(reporter, join(outputDir, "director-plan.json"), directorPlan);
  await trackWrite(reporter, join(outputDir, "visual-plan.json"), directorPlan);
  reporter.phase("director", "success", "Director plan ready");

  const skipPolish = options.polishCopy === false || process.env.DEMO_SKIP_POLISH === "1";
  const polishedPlan = skipPolish ? plan : await polishPresentationCopy(plan);

  let voicedLines: Awaited<ReturnType<typeof synthesizeVoice>>;
  if (options.reuseVoice) {
    reporter.phase("voice", "skip", `Reusing voice from ${options.reuseVoice}`);
    voicedLines = await readJsonOrThrow(options.reuseVoice, "REUSE_ARTIFACT_INVALID");
  } else {
    reporter.phase("voice", "start", "Synthesizing narration");
    const voiceScript = buildVoiceScript(polishedPlan);
    voicedLines = await synthesizeVoice(voiceScript, {
      outputDir: join(outputDir, "audio"),
    });
    await trackWrite(reporter, join(outputDir, "voice-script.json"), voicedLines);
    reporter.phase("voice", "success", `${voicedLines.filter((l) => l.audioPath).length} audio tracks`);
  }

  const bgmPath = process.env.DEMO_BGM_PATH;
  const bgmVolume = process.env.DEMO_BGM_VOLUME ? Number(process.env.DEMO_BGM_VOLUME) : undefined;

  reporter.phase("render", renderVideo ? "start" : "skip", renderVideo ? "Composing video" : "Render skipped");
  const videoPath = renderVideo
    ? await composeVideo({
        videoPath: captureResult.videoPath,
        outputPath: join(outputDir, "pr-demo.mp4"),
        visualPlan: directorPlan,
        capture: captureResult,
        voiceLines: voicedLines,
        bgm: bgmPath ? { path: bgmPath, volume: bgmVolume } : undefined,
        title: style.name === "screen-studio" ? undefined : plan.title,
        width: renderWidth,
        height: renderHeight,
        fps: exportProfile.fps,
        quality: options.quality,
        frame: frameEnabled
          ? {
              gradientFrom: userFrameOpts?.gradientFrom ?? style.frame.gradientFrom,
              gradientTo: userFrameOpts?.gradientTo ?? style.frame.gradientTo,
              backgroundPreset: (userFrameOpts?.backgroundPreset ?? style.frame.backgroundPreset) as never,
              chrome: userFrameOpts?.chrome ?? style.frame.chrome,
              shadow: userFrameOpts?.shadow ?? style.frame.shadow,
              windowRadius: userFrameOpts?.windowRadius ?? style.frame.windowRadius,
              padding: framePadding,
              ...userFrameOpts,
            }
          : undefined,
      }).catch((error) => {
        reporter.phase("render", "fail", `FFmpeg composition failed: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      })
    : undefined;
  if (videoPath) {
    reporter.trackArtifact(videoPath);
    reporter.phase("render", "success", `Video written to ${videoPath}`);
  }

  reporter.phase("quality", "start", "Evaluating quality");
  const qualityReport = await evaluateDemoQuality({
    videoPath,
    plan: polishedPlan,
    voiceLines: voicedLines,
    expectedAspectRatio: exportProfile.aspectRatio,
  });
  await trackWrite(reporter, join(outputDir, "quality-report.json"), qualityReport);
  reporter.phase("quality", "success", `Score ${qualityReport.score}/100`, { score: qualityReport.score });

  return {
    plan: polishedPlan,
    voiceScript: voicedLines,
    videoPath,
    qualityReport,
  };
};
