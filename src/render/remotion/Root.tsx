import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { z } from "zod";
import { DemoVideo, INTRO_FRAMES, OUTRO_FRAMES, SCENE_OVERLAP_FRAMES } from "./DemoVideo.tsx";

const VoiceTokenSchema = z.object({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
});

const FocusRegionSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  label: z.string().optional(),
});

const SceneDirectionSchema = z.object({
  shot: z.enum(["hero", "detail", "workflow"]),
  focusRegion: FocusRegionSchema.optional(),
  accentColor: z.string().optional(),
  cameraMove: z.enum(["push-in", "pan-left", "pan-right"]).optional(),
});

const CaptureEventSchema = z.object({
  type: z.string(),
  atMs: z.number(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const RenderBgmSchema = z.object({
  path: z.string().optional(),
  src: z.string().optional(),
  assetPath: z.string().optional(),
  volume: z.number().optional(),
  ducking: z.number().optional(),
  fadeInFrames: z.number().optional(),
  fadeOutFrames: z.number().optional(),
});

export const RenderSceneSchema = z.object({
  id: z.string(),
  title: z.string(),
  caption: z.string(),
  narration: z.string(),
  durationInFrames: z.number(),
  leadInFrames: z.number().optional(),
  contentFrames: z.number().optional(),
  holdFrames: z.number().optional(),
  screenshotPath: z.string().optional(),
  screenshotSrc: z.string().optional(),
  screenshotAssetPath: z.string().optional(),
  videoPath: z.string().optional(),
  videoSrc: z.string().optional(),
  videoAssetPath: z.string().optional(),
  videoTrimBeforeFrames: z.number().optional(),
  audioPath: z.string().optional(),
  audioSrc: z.string().optional(),
  audioAssetPath: z.string().optional(),
  tokens: z.array(VoiceTokenSchema).optional(),
  direction: SceneDirectionSchema.optional(),
  events: z.array(CaptureEventSchema).optional(),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
  }).optional(),
  visualGroupKey: z.string().optional(),
});

export const RenderManifestSchema = z.object({
  title: z.string(),
  fps: z.number(),
  width: z.number(),
  height: z.number(),
  scenes: z.array(RenderSceneSchema),
  bgm: RenderBgmSchema.optional(),
});

export type RenderManifestProps = z.infer<typeof RenderManifestSchema>;

const calculateMetadata: CalculateMetadataFunction<RenderManifestProps> = async ({ props }) => {
  const sceneFrames = props.scenes.reduce(
    (sum: number, scene: RenderManifestProps["scenes"][number]) => sum + scene.durationInFrames,
    0,
  );
  const durationInFrames = INTRO_FRAMES + OUTRO_FRAMES + sceneFrames;

  return {
    durationInFrames: Math.max(durationInFrames, 1),
    fps: props.fps,
    width: props.width,
    height: props.height,
    defaultOutName: `${props.title.replace(/\s+/g, "-").toLowerCase()}.mp4`,
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="PrDemo"
      component={DemoVideo}
      schema={RenderManifestSchema}
      width={1600}
      height={900}
      fps={30}
      durationInFrames={300}
      defaultProps={{
        title: "PR Demo",
        fps: 30,
        width: 1600,
        height: 900,
        scenes: [],
        bgm: undefined,
      }}
      calculateMetadata={calculateMetadata}
    />
  );
};

export default RemotionRoot;
