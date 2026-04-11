import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildDiffContext } from "./lib/git.js";
import { writeJson } from "./lib/fs.js";
import type { DemoPlan } from "./types.js";
import { buildDemoPlan } from "./planner/index.js";
import { refineDemoPlan } from "./planner/refine.js";
import { probePlanScenes } from "./probe/page-probe.js";
import { capturePlanContinuous } from "./capture/continuous-capture.js";
import { buildVoiceScript } from "./voice/script.js";
import { synthesizeVoice } from "./voice/tts.js";
import { buildVisualPlan } from "./render/visual-plan.js";
import { composeVideo } from "./render/ffmpeg-compose.js";
import { polishPresentationCopy } from "./presentation/polish.js";
import { buildPromptPlan } from "./planner/prompt.js";
import type { ProjectConfig } from "./config/project.js";

export interface RunPipelineOptions {
  baseRef: string;
  baseUrl: string;
  outputDir: string;
  projectConfig?: ProjectConfig;
  renderVideo?: boolean;
  /** When set, skip diff-based planning and use prompt-driven planning instead. */
  prompt?: string;
  /** Video quality: "draft", "standard", "high". */
  quality?: "draft" | "standard" | "high";
  /** Wrap video in a browser frame with gradient background. */
  frame?: boolean;
}

export const buildExecutablePlan = async (options: {
  baseRef: string;
  baseUrl: string;
  outputDir: string;
  projectConfig?: ProjectConfig;
}) => {
  const context = await buildDiffContext(options.baseRef);
  await writeJson(join(options.outputDir, "demo-context.json"), context);

  const initialPlan = await buildDemoPlan(context, options.projectConfig);
  await writeJson(join(options.outputDir, "demo-plan.initial.json"), initialPlan);

  const probes = await probePlanScenes(initialPlan, {
    baseUrl: options.baseUrl,
    outputDir: options.outputDir,
  });
  await writeJson(join(options.outputDir, "page-probes.json"), probes);

  const refinedPlan = await refineDemoPlan({ initialPlan, probes });
  await writeJson(join(options.outputDir, "demo-plan.json"), refinedPlan);

  return { context, initialPlan, probes, plan: refinedPlan };
};

export const runPipelineFromPrompt = async (options: {
  prompt: string;
  baseUrl: string;
  outputDir: string;
  projectConfig?: ProjectConfig;
  renderVideo?: boolean;
  quality?: "draft" | "standard" | "high";
  frame?: boolean;
}) => {
  await mkdir(options.outputDir, { recursive: true });

  const plan = await buildPromptPlan({
    prompt: options.prompt,
    baseUrl: options.baseUrl,
    outputDir: options.outputDir,
    projectConfig: options.projectConfig,
  });
  await writeJson(join(options.outputDir, "demo-plan.json"), plan);

  return runPipelineWithPlan({ plan, baseUrl: options.baseUrl, outputDir: options.outputDir, renderVideo: options.renderVideo, quality: options.quality, frame: options.frame });
};

export const runPipeline = async ({
  baseRef,
  baseUrl,
  outputDir,
  projectConfig,
  renderVideo = true,
  prompt,
  quality,
  frame,
}: RunPipelineOptions) => {
  await mkdir(outputDir, { recursive: true });

  if (prompt) {
    return runPipelineFromPrompt({ prompt, baseUrl, outputDir, projectConfig, renderVideo, quality, frame });
  }

  const { context, initialPlan, probes, plan } = await buildExecutablePlan({
    baseRef,
    baseUrl,
    outputDir,
    projectConfig,
  });

  return runPipelineWithPlan({ plan, baseUrl, outputDir, renderVideo, quality, frame });
};

const runPipelineWithPlan = async (options: {
  plan: DemoPlan;
  baseUrl: string;
  outputDir: string;
  renderVideo?: boolean;
  quality?: "draft" | "standard" | "high";
  frame?: boolean;
}) => {
  const { plan, baseUrl, outputDir, renderVideo = true } = options;

  const captureResult = await capturePlanContinuous(plan, {
    baseUrl,
    outputDir: join(outputDir, "captures"),
  });
  await writeJson(join(outputDir, "continuous-capture.json"), {
    videoPath: captureResult.videoPath,
    sceneMarkers: captureResult.sceneMarkers,
    interactions: captureResult.interactions,
    totalDurationMs: captureResult.totalDurationMs,
    viewport: captureResult.viewport,
    cursorSamples: captureResult.cursorLog.length,
  });

  const visualPlan = buildVisualPlan(captureResult);
  await writeJson(join(outputDir, "visual-plan.json"), visualPlan);

  const polishedPlan = await polishPresentationCopy(plan);
  const voiceScript = buildVoiceScript(polishedPlan);
  const voicedLines = await synthesizeVoice(voiceScript, {
    outputDir: join(outputDir, "audio"),
  });
  await writeJson(join(outputDir, "voice-script.json"), voicedLines);

  const bgmPath = process.env.DEMO_BGM_PATH;
  const bgmVolume = process.env.DEMO_BGM_VOLUME
    ? Number(process.env.DEMO_BGM_VOLUME)
    : undefined;

  const videoPath = renderVideo
    ? await composeVideo({
        videoPath: captureResult.videoPath,
        outputPath: join(outputDir, "pr-demo.mp4"),
        visualPlan,
        capture: captureResult,
        voiceLines: voicedLines,
        bgm: bgmPath ? { path: bgmPath, volume: bgmVolume } : undefined,
        title: plan.title,
        width: captureResult.viewport.width,
        height: captureResult.viewport.height,
        quality: options.quality,
        frame: options.frame || undefined,
      }).catch((error) => {
        console.warn("FFmpeg composition failed:", error);
        return undefined;
      })
    : undefined;

  return {
    plan: polishedPlan,
    voiceScript: voicedLines,
    videoPath,
  };
};
