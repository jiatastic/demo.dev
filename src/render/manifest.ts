import { fileToDataUri } from "../lib/data-uri.js";
import type { CaptureArtifact, DemoPlan, RenderManifest, VoiceLine } from "../types.js";
import { createAssetStager } from "./stage-assets.js";

const FPS = 30;
const WIDTH = 1600;
const HEIGHT = 900;
const LEAD_IN_FRAMES = 18;
const HOLD_FRAMES = 12;

const readNumberEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const visualGroupKeyFor = (capture: CaptureArtifact | undefined, scene: DemoPlan["scenes"][number]) => {
  const rawUrl = capture?.url ?? scene.url;
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl;
  }
};

export const buildRenderManifest = async (
  plan: DemoPlan,
  captures: CaptureArtifact[],
  voiceLines: VoiceLine[],
): Promise<RenderManifest> => {
  const stageAsset = await createAssetStager(plan.title);
  const captureBySceneId = new Map(captures.map((capture) => [capture.sceneId, capture]));
  const bgmPath = process.env.DEMO_BGM_PATH;
  const bgmAssetPath = await stageAsset(bgmPath, "bgm-track.mp3");
  const bgmSrc = !bgmAssetPath && bgmPath ? await fileToDataUri(bgmPath).catch(() => undefined) : undefined;

  let previousVisualGroupKey: string | undefined;
  let sharedVisualCapture: CaptureArtifact | undefined;

  const scenes = [] as RenderManifest["scenes"];

  for (const scene of plan.scenes) {
    const capture = captureBySceneId.get(scene.id);
    const voice = voiceLines.find((item) => item.sceneId === scene.id);
    const voiceDurationMs = voice?.audioDurationMs ?? voice?.estimatedMs ?? 0;
    const durationMs = Math.max(scene.durationMs, voiceDurationMs + 450);
    const visualGroupKey = visualGroupKeyFor(capture, scene);

    if (visualGroupKey !== previousVisualGroupKey) {
      sharedVisualCapture = capture;
      previousVisualGroupKey = visualGroupKey;
    }

    const visualCapture = sharedVisualCapture ?? capture;

    const screenshotAssetPath = await stageAsset(visualCapture?.screenshotPath, `${scene.id}-screenshot.png`);
    const videoAssetPath = await stageAsset(visualCapture?.videoPath, `${scene.id}-video.webm`);
    const audioAssetPath = await stageAsset(voice?.audioPath, `${scene.id}-audio.mp3`);
    const videoTrimBeforeFrames = scene.actions.some((action) => action.type === "navigate") ? 24 : 12;

    const screenshotSrc = !screenshotAssetPath && visualCapture?.screenshotPath
      ? await fileToDataUri(visualCapture.screenshotPath).catch(() => undefined)
      : undefined;

    const videoSrc = !videoAssetPath && visualCapture?.videoPath
      ? await fileToDataUri(visualCapture.videoPath).catch(() => undefined)
      : undefined;

    const audioSrc = !audioAssetPath && voice?.audioPath
      ? await fileToDataUri(voice.audioPath).catch(() => undefined)
      : undefined;

    const durationInFrames = Math.max(75, Math.round((durationMs / 1000) * FPS));
    const contentFrames = Math.max(30, durationInFrames - LEAD_IN_FRAMES - HOLD_FRAMES);

    scenes.push({
      id: scene.id,
      title: scene.title,
      caption: scene.caption,
      narration: voice?.text ?? scene.narration,
      screenshotPath: visualCapture?.screenshotPath,
      screenshotSrc,
      screenshotAssetPath,
      videoPath: visualCapture?.videoPath,
      videoSrc,
      videoAssetPath,
      videoTrimBeforeFrames,
      audioPath: voice?.audioPath,
      audioSrc,
      audioAssetPath,
      tokens: voice?.tokens,
      direction: scene.direction,
      events: capture?.events,
      viewport: visualCapture?.viewport ?? scene.viewport,
      visualGroupKey,
      leadInFrames: LEAD_IN_FRAMES,
      contentFrames,
      holdFrames: HOLD_FRAMES,
      durationInFrames,
    });
  }

  return {
    title: plan.title,
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    scenes,
    bgm: bgmPath
      ? {
          path: bgmPath,
          src: bgmSrc,
          assetPath: bgmAssetPath,
          volume: readNumberEnv("DEMO_BGM_VOLUME", 0.16),
          ducking: readNumberEnv("DEMO_BGM_DUCKING", 0.3),
          fadeInFrames: Math.max(0, Math.round((readNumberEnv("DEMO_BGM_FADE_IN_MS", 700) / 1000) * FPS)),
          fadeOutFrames: Math.max(0, Math.round((readNumberEnv("DEMO_BGM_FADE_OUT_MS", 1200) / 1000) * FPS)),
        }
      : undefined,
  };
};
