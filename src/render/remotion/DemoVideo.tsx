import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio, Video } from "@remotion/media";
import type { CaptureEvent, FocusRegion, RenderManifest, SceneDirection, VoiceToken } from "../../types.js";

export const INTRO_FRAMES = 1;
export const OUTRO_FRAMES = 1;
export const SCENE_OVERLAP_FRAMES = 14;

const FONT = "Inter, ui-sans-serif, system-ui";
const PALETTE = {
  bg: "#f7f4ee",
  bgSoft: "#fcfaf7",
  ink: "#171410",
  muted: "rgba(23,20,16,0.56)",
  border: "rgba(23,20,16,0.08)",
  shadow: "rgba(37,29,22,0.10)",
};

const STAGE = {
  width: 1548,
  height: 848,
  outerPadding: 26,
  innerPadding: 14,
  radius: 30,
};

type CameraPose = {
  scale: number;
  translateX: number;
  translateY: number;
  focusX: number;
  focusY: number;
};

type CameraKeyframe = {
  at: number;
  pose: CameraPose;
};

type VisualPlan = {
  continuation: boolean;
  keyframes: CameraKeyframe[];
  endPose: CameraPose;
};

type EventRegion = {
  event: CaptureEvent;
  region: FocusRegion;
  priority: number;
};

type ManifestScene = RenderManifest["scenes"][number];

const DEFAULT_REGION: FocusRegion = {
  x: 0.05,
  y: 0.07,
  width: 0.9,
  height: 0.78,
};

const normalizeToken = (token: string) => token.replace(/\s+/g, " ");
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;
const smoothstep = (value: number) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

const buildCaptionPages = (tokens: VoiceToken[]) => {
  if (tokens.length === 0) return [] as VoiceToken[][];

  const pages: VoiceToken[][] = [];
  let current: VoiceToken[] = [];
  let chars = 0;

  for (const token of tokens) {
    const tokenChars = token.text.trim().length;
    const shouldBreak = current.length >= 8 || chars + tokenChars > 30;

    if (current.length > 0 && shouldBreak) {
      pages.push(current);
      current = [];
      chars = 0;
    }

    current.push(token);
    chars += tokenChars;

    if (/[.!?]$/.test(token.text.trim()) && current.length >= 4) {
      pages.push(current);
      current = [];
      chars = 0;
    }
  }

  if (current.length > 0) {
    pages.push(current);
  }

  return pages;
};

const centerOfRegion = (region: FocusRegion) => ({
  x: region.x + region.width / 2,
  y: region.y + region.height / 2,
});

const normalizeRegion = (region: FocusRegion): FocusRegion => {
  const width = clamp(region.width, 0.18, 0.94);
  const height = clamp(region.height, 0.16, 0.88);
  const x = clamp(region.x, 0, 1 - width);
  const y = clamp(region.y, 0, 1 - height);

  return {
    ...region,
    x,
    y,
    width,
    height,
  };
};

const regionsSimilar = (left: FocusRegion, right: FocusRegion) => {
  const leftCenter = centerOfRegion(left);
  const rightCenter = centerOfRegion(right);

  return (
    Math.abs(leftCenter.x - rightCenter.x) < 0.06 &&
    Math.abs(leftCenter.y - rightCenter.y) < 0.06 &&
    Math.abs(left.width - right.width) < 0.12 &&
    Math.abs(left.height - right.height) < 0.12
  );
};

const posesSimilar = (left: CameraPose, right: CameraPose) => {
  return (
    Math.abs(left.scale - right.scale) < 0.025 &&
    Math.abs(left.translateX - right.translateX) < 12 &&
    Math.abs(left.translateY - right.translateY) < 12
  );
};

const priorityForEvent = (type: CaptureEvent["type"]) => {
  switch (type) {
    case "click":
    case "hover":
    case "fill":
    case "select":
      return 5;
    case "waitForText":
    case "waitForUrl":
      return 4;
    case "scroll":
      return 3;
    case "stable":
      return 1;
    case "navigate":
      return 0;
    default:
      return 2;
  }
};

const eventToRegion = (
  event: CaptureEvent,
  viewport: { width: number; height: number },
): FocusRegion | undefined => {
  if (!event.x || !event.y || !event.width || !event.height) {
    if (event.type === "navigate" || event.type === "stable") {
      return DEFAULT_REGION;
    }

    return undefined;
  }

  const centerX = event.x / viewport.width;
  const centerY = event.y / viewport.height;
  let width = event.width / viewport.width;
  let height = event.height / viewport.height;

  switch (event.type) {
    case "navigate":
      width = 0.92;
      height = 0.82;
      break;
    case "stable":
      width = Math.max(width, 0.88);
      height = Math.max(height, 0.76);
      break;
    case "scroll":
      width = Math.max(width, 0.72);
      height = Math.max(height, 0.54);
      break;
    case "waitForText":
    case "waitForUrl":
      width = Math.max(width + 0.14, 0.34);
      height = Math.max(height + 0.14, 0.22);
      break;
    default:
      width = Math.max(width + 0.12, 0.26);
      height = Math.max(height + 0.14, 0.24);
      break;
  }

  return normalizeRegion({
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  });
};

const regionToPose = (region: FocusRegion, direction?: SceneDirection): CameraPose => {
  const normalizedRegion = normalizeRegion(region);
  const { x, y } = centerOfRegion(normalizedRegion);
  const shot = direction?.shot ?? "hero";
  const maxScale = shot === "detail" ? 1.22 : shot === "workflow" ? 1.16 : 1.1;
  const minScale = shot === "detail" ? 1.08 : shot === "workflow" ? 1.05 : 1.02;
  const targetScale = Math.min(
    maxScale,
    Math.max(
      minScale,
      Math.min(
        1 / Math.max(normalizedRegion.width + 0.18, 0.66),
        1 / Math.max(normalizedRegion.height + 0.2, 0.7),
      ),
    ),
  );

  const directionalBiasX = direction?.cameraMove === "pan-right" ? -20 : direction?.cameraMove === "pan-left" ? 20 : 0;
  const directionalBiasY = direction?.cameraMove === "push-in" ? -10 : 0;

  return {
    scale: targetScale,
    translateX: clamp((0.5 - x) * 260 + directionalBiasX, -160, 160),
    translateY: clamp((0.5 - y) * 170 + directionalBiasY, -110, 110),
    focusX: x,
    focusY: y,
  };
};

const settlePose = (pose: CameraPose, continuation: boolean): CameraPose => ({
  ...pose,
  scale: Math.max(1.01, pose.scale - (continuation ? 0.015 : 0.025)),
  translateX: pose.translateX * 0.92,
  translateY: pose.translateY * 0.94,
});

const appendDistinctRegion = (regions: FocusRegion[], candidate?: FocusRegion) => {
  if (!candidate) return;
  if (regions.some((region) => regionsSimilar(region, candidate))) return;
  regions.push(candidate);
};

const buildTargetRegions = (scene: ManifestScene) => {
  const regions: FocusRegion[] = [];
  const viewport = scene.viewport ?? { width: 1440, height: 900 };

  appendDistinctRegion(regions, scene.direction?.focusRegion ? normalizeRegion(scene.direction.focusRegion) : undefined);

  const eventRegions = (scene.events ?? [])
    .map((event) => ({
      event,
      region: eventToRegion(event, viewport),
      priority: priorityForEvent(event.type),
    }))
    .filter((entry): entry is EventRegion => Boolean(entry.region))
    .sort((left, right) => left.event.atMs - right.event.atMs);

  const pool = eventRegions.some((entry) => entry.priority >= 3)
    ? eventRegions.filter((entry) => entry.priority >= 3)
    : eventRegions;

  const sampled = [pool[0], pool[Math.floor((pool.length - 1) / 2)], pool[pool.length - 1]].filter(Boolean) as EventRegion[];

  for (const sample of sampled) {
    appendDistinctRegion(regions, sample.region);
  }

  if (regions.length === 0) {
    regions.push(DEFAULT_REGION);
  }

  return regions.slice(0, 3);
};

const buildVisualPlans = (scenes: RenderManifest["scenes"]): VisualPlan[] => {
  const plans: VisualPlan[] = [];
  let previousVisualGroupKey: string | undefined;
  let previousEndPose: CameraPose | undefined;

  for (const scene of scenes) {
    const continuation = Boolean(scene.visualGroupKey && scene.visualGroupKey === previousVisualGroupKey && previousEndPose);
    const openingPose = continuation && previousEndPose
      ? previousEndPose
      : regionToPose(DEFAULT_REGION, { shot: "hero" });

    const targetPoses = buildTargetRegions(scene)
      .map((region) => regionToPose(region, scene.direction))
      .filter((pose, index, poses) => index === 0 || !posesSimilar(pose, poses[index - 1]));

    const distinctTargetPoses = targetPoses.filter((pose) => !(continuation && posesSimilar(pose, openingPose)));

    const keyframes: CameraKeyframe[] = [{ at: 0, pose: openingPose }];

    if (distinctTargetPoses.length === 0) {
      keyframes.push({ at: 0.72, pose: openingPose });
      keyframes.push({ at: 1, pose: settlePose(openingPose, continuation) });
    } else if (distinctTargetPoses.length === 1) {
      keyframes.push({ at: continuation ? 0.58 : 0.38, pose: distinctTargetPoses[0] });
      keyframes.push({ at: 1, pose: settlePose(distinctTargetPoses[0], continuation) });
    } else if (distinctTargetPoses.length === 2) {
      keyframes.push({ at: continuation ? 0.3 : 0.2, pose: distinctTargetPoses[0] });
      keyframes.push({ at: 0.76, pose: distinctTargetPoses[1] });
      keyframes.push({ at: 1, pose: settlePose(distinctTargetPoses[1], continuation) });
    } else {
      keyframes.push({ at: continuation ? 0.22 : 0.14, pose: distinctTargetPoses[0] });
      keyframes.push({ at: 0.52, pose: distinctTargetPoses[1] });
      keyframes.push({ at: 0.82, pose: distinctTargetPoses[2] });
      keyframes.push({ at: 1, pose: settlePose(distinctTargetPoses[2], continuation) });
    }

    const compactKeyframes = keyframes.filter((keyframe, index, frames) => {
      if (index === 0) return true;
      const previous = frames[index - 1];
      return keyframe.at > previous.at + 0.01 && !posesSimilar(keyframe.pose, previous.pose);
    });

    const endPose = compactKeyframes[compactKeyframes.length - 1]?.pose ?? openingPose;
    plans.push({
      continuation,
      keyframes: compactKeyframes,
      endPose,
    });

    previousVisualGroupKey = scene.visualGroupKey;
    previousEndPose = endPose;
  }

  return plans;
};

const samplePose = (keyframes: CameraKeyframe[], progress: number): CameraPose => {
  if (keyframes.length === 0) {
    return regionToPose(DEFAULT_REGION, { shot: "hero" });
  }

  if (keyframes.length === 1 || progress <= keyframes[0].at) {
    return keyframes[0].pose;
  }

  for (let index = 1; index < keyframes.length; index += 1) {
    const previous = keyframes[index - 1];
    const current = keyframes[index];

    if (progress <= current.at) {
      const segmentProgress = smoothstep((progress - previous.at) / Math.max(0.0001, current.at - previous.at));
      return {
        scale: lerp(previous.pose.scale, current.pose.scale, segmentProgress),
        translateX: lerp(previous.pose.translateX, current.pose.translateX, segmentProgress),
        translateY: lerp(previous.pose.translateY, current.pose.translateY, segmentProgress),
        focusX: lerp(previous.pose.focusX, current.pose.focusX, segmentProgress),
        focusY: lerp(previous.pose.focusY, current.pose.focusY, segmentProgress),
      };
    }
  }

  return keyframes[keyframes.length - 1].pose;
};

const Background: React.FC<{ accent?: string }> = ({ accent = "#ddd4c8" }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 72) * 6;

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.bg }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.16) 24%, rgba(0,0,0,0) 58%, rgba(0,0,0,0.02) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 680,
          height: 680,
          borderRadius: 999,
          background: accent,
          opacity: 0.08,
          filter: "blur(140px)",
          top: -300,
          right: -100 + drift,
        }}
      />
    </AbsoluteFill>
  );
};

const StageShell: React.FC = () => {
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: STAGE.outerPadding }}>
      <div
        style={{
          position: "relative",
          width: STAGE.width,
          height: STAGE.height,
          borderRadius: STAGE.radius,
          background: "rgba(255,255,255,0.82)",
          border: `1px solid ${PALETTE.border}`,
          boxShadow: `0 26px 72px ${PALETTE.shadow}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: STAGE.innerPadding,
            borderRadius: STAGE.radius - 10,
            background: PALETTE.bgSoft,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const CaptionLowerThird: React.FC<{
  tokens?: VoiceToken[];
  accentColor: string;
  audioDelayFrames: number;
}> = ({ tokens = [], accentColor, audioDelayFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const activeFrame = frame - audioDelayFrames;
  const pages = React.useMemo(() => buildCaptionPages(tokens), [tokens]);

  if (pages.length === 0 || activeFrame < 0) return null;

  const currentMs = (activeFrame / fps) * 1000;
  const activePage =
    pages.find((page) => {
      const first = page[0];
      const last = page[page.length - 1];
      return currentMs >= first.startMs && currentMs <= last.endMs + 120;
    }) ?? pages[pages.length - 1];

  const opacity = interpolate(activeFrame, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        opacity,
        maxWidth: 400,
        padding: "8px 12px 9px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.58)",
        border: `1px solid ${accentColor}22`,
        boxShadow: "0 8px 18px rgba(0,0,0,0.03)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div style={{ fontSize: 14, lineHeight: 1.42, color: PALETTE.muted, fontWeight: 500, letterSpacing: -0.1 }}>
        {activePage.map((token) => {
          const active = currentMs >= token.startMs && currentMs < token.endMs;
          return (
            <span
              key={`${token.startMs}-${token.endMs}-${token.text}`}
              style={{
                color: active ? PALETTE.ink : PALETTE.muted,
                borderBottom: active ? `1px solid ${accentColor}` : "1px solid transparent",
                paddingBottom: 1,
              }}
            >
              {normalizeToken(token.text)}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const IntroCard: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background accent="#ddd4c8" />
    </AbsoluteFill>
  );
};

const OutroCard: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background accent="#d0d8cf" />
    </AbsoluteFill>
  );
};

const SceneVisual: React.FC<
  ManifestScene & {
    audioDelayFrames: number;
    visualPlan: VisualPlan;
  }
> = ({
  screenshotSrc,
  screenshotAssetPath,
  videoSrc,
  videoAssetPath,
  videoTrimBeforeFrames = 0,
  tokens,
  direction,
  leadInFrames = 18,
  contentFrames = 90,
  holdFrames = 12,
  audioDelayFrames,
  visualPlan,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const resolvedScreenshotSrc = screenshotAssetPath ? staticFile(screenshotAssetPath) : screenshotSrc;
  const resolvedVideoSrc = videoAssetPath ? staticFile(videoAssetPath) : videoSrc;
  const accentColor = direction?.accentColor ?? "#d9d0c2";

  const enter = spring({ fps, frame, config: { damping: 30, stiffness: 90 } });
  const shellY = visualPlan.continuation ? 0 : interpolate(enter, [0, 1], [10, 0]);
  const shellScale = visualPlan.continuation ? 1 : interpolate(enter, [0, 1], [0.998, 1]);
  const opacity = interpolate(
    frame,
    [0, 10, leadInFrames + contentFrames - 10, leadInFrames + contentFrames + holdFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const progress = interpolate(frame, [0, leadInFrames + contentFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const pose = samplePose(visualPlan.keyframes, progress);
  const driftX = Math.sin((frame + audioDelayFrames) / 45) * 1.8;
  const driftY = Math.cos((frame + audioDelayFrames) / 52) * 1.2;
  const mediaScale = pose.scale;
  const mediaTranslateX = pose.translateX + driftX;
  const mediaTranslateY = pose.translateY + driftY;

  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: STAGE.outerPadding }}>
        <div
          style={{
            position: "relative",
            width: STAGE.width,
            height: STAGE.height,
            transform: `translateY(${shellY}px) scale(${shellScale})`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: STAGE.innerPadding,
              borderRadius: STAGE.radius - 10,
              overflow: "hidden",
            }}
          >
            {resolvedScreenshotSrc ? (
              <Img
                src={resolvedScreenshotSrc}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  transform: `translate(${mediaTranslateX}px, ${mediaTranslateY}px) scale(${mediaScale})`,
                  transformOrigin: `${pose.focusX * 100}% ${pose.focusY * 100}%`,
                }}
              />
            ) : resolvedVideoSrc ? (
              <Video
                src={resolvedVideoSrc}
                muted
                trimBefore={videoTrimBeforeFrames}
                objectFit="contain"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  transform: `translate(${mediaTranslateX}px, ${mediaTranslateY}px) scale(${mediaScale})`,
                  transformOrigin: `${pose.focusX * 100}% ${pose.focusY * 100}%`,
                }}
              />
            ) : null}
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start", padding: "0 0 34px 54px" }}>
        <CaptionLowerThird tokens={tokens} accentColor={accentColor} audioDelayFrames={audioDelayFrames} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const SceneAudio: React.FC<ManifestScene> = ({
  audioSrc,
  audioAssetPath,
  leadInFrames = 18,
  contentFrames = 90,
  holdFrames = 12,
}) => {
  const resolvedAudioSrc = audioAssetPath ? staticFile(audioAssetPath) : audioSrc;
  if (!resolvedAudioSrc) return null;

  return (
    <Audio
      src={resolvedAudioSrc}
      volume={(audioFrame: number) =>
        interpolate(
          audioFrame,
          [0, 8, Math.max(24, leadInFrames + contentFrames), leadInFrames + contentFrames + holdFrames],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )
      }
    />
  );
};

const buildTimeline = (scenes: RenderManifest["scenes"]) => {
  let audioCursor = INTRO_FRAMES;

  return scenes.map((scene, index) => {
    const audioStart = audioCursor;
    const visualStart = index === 0 ? audioStart : Math.max(INTRO_FRAMES, audioStart - SCENE_OVERLAP_FRAMES);
    const audioDelayFrames = audioStart - visualStart;
    const visualDuration = scene.durationInFrames + audioDelayFrames;

    audioCursor += scene.durationInFrames;

    return {
      scene,
      audioStart,
      visualStart,
      audioDelayFrames,
      visualDuration,
    };
  });
};

export const DemoVideo: React.FC<RenderManifest> = ({ scenes }) => {
  const timeline = React.useMemo(() => buildTimeline(scenes), [scenes]);
  const visualPlans = React.useMemo(() => buildVisualPlans(scenes), [scenes]);

  return (
    <AbsoluteFill>
      <Background />
      <StageShell />

      {timeline.map(({ scene, visualStart, visualDuration, audioDelayFrames }, index) => (
        <Sequence key={`${scene.id}-visual`} from={visualStart} durationInFrames={visualDuration} layout="none">
          <SceneVisual {...scene} audioDelayFrames={audioDelayFrames} visualPlan={visualPlans[index]} />
        </Sequence>
      ))}

      {timeline.map(({ scene, audioStart }) => (
        <Sequence key={`${scene.id}-audio`} from={audioStart} durationInFrames={scene.durationInFrames} layout="none">
          <SceneAudio {...scene} />
        </Sequence>
      ))}

      <Sequence from={0} durationInFrames={INTRO_FRAMES} layout="none">
        <IntroCard />
      </Sequence>
      <Sequence
        from={timeline.length > 0 ? timeline[timeline.length - 1].audioStart + timeline[timeline.length - 1].scene.durationInFrames : 0}
        durationInFrames={OUTRO_FRAMES}
        layout="none"
      >
        <OutroCard />
      </Sequence>
    </AbsoluteFill>
  );
};
