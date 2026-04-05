import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildDiffContext } from "./lib/git.js";
import { writeJson } from "./lib/fs.js";
import { buildDemoPlan } from "./planner/index.js";
import { refineDemoPlan } from "./planner/refine.js";
import { probePlanScenes } from "./probe/page-probe.js";
import { capturePlan } from "./capture/playwright-recorder.js";
import { buildVoiceScript } from "./voice/script.js";
import { synthesizeVoice } from "./voice/tts.js";
import { buildRenderManifest } from "./render/manifest.js";
import { buildCoverImage } from "./render/cover.js";
import { renderVideoFromManifest } from "./render/video.js";
import { polishPresentationCopy } from "./presentation/polish.js";
import { directPresentationPlan } from "./presentation/director.js";
import type { ProjectConfig } from "./config/project.js";

export interface RunPipelineOptions {
  baseRef: string;
  baseUrl: string;
  outputDir: string;
  projectConfig?: ProjectConfig;
  renderVideo?: boolean;
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

export const runPipeline = async ({
  baseRef,
  baseUrl,
  outputDir,
  projectConfig,
  renderVideo = true,
}: RunPipelineOptions) => {
  await mkdir(outputDir, { recursive: true });

  const { context, initialPlan, probes, plan } = await buildExecutablePlan({
    baseRef,
    baseUrl,
    outputDir,
    projectConfig,
  });

  const captures = await capturePlan(plan, {
    baseUrl,
    outputDir: join(outputDir, "captures"),
  });
  await writeJson(join(outputDir, "captures.json"), captures);

  const coverPath = await buildCoverImage(captures, outputDir);

  const polishedPlan = await polishPresentationCopy(plan);
  await writeJson(join(outputDir, "demo-plan.presentation.json"), polishedPlan);

  const presentationPlan = await directPresentationPlan(polishedPlan);
  await writeJson(join(outputDir, "demo-plan.directed.json"), presentationPlan);

  const voiceScript = buildVoiceScript(presentationPlan);
  const voicedLines = await synthesizeVoice(voiceScript, {
    outputDir: join(outputDir, "audio"),
  });
  await writeJson(join(outputDir, "voice-script.json"), voicedLines);

  const manifest = await buildRenderManifest(presentationPlan, captures, voicedLines);
  const manifestPath = join(outputDir, "render-manifest.json");
  await writeJson(manifestPath, manifest);

  const videoPath = renderVideo
    ? await renderVideoFromManifest({
        manifestPath,
        outputPath: join(outputDir, "pr-demo.mp4"),
      }).catch((error) => {
        console.warn("render failed, manifest kept for later rendering", error);
        return undefined;
      })
    : undefined;

  return {
    context,
    initialPlan,
    probes,
    plan: presentationPlan,
    captures,
    voiceScript: voicedLines,
    manifest,
    manifestPath,
    videoPath,
    coverPath,
  };
};
