import type { CaptureInteraction, ContinuousCaptureResult } from "@demo-dev/browser";
import type { MotionOverlayCue, PremiumShot, SpeedSegment, VisualPlanResult, ZoomKeyframe } from "@demo-dev/render";
import { buildVisualPlan } from "@demo-dev/render";
import { resolveDemoStyle, type DemoStylePreset } from "@demo-dev/style-presets";

export interface DirectorPlanResult extends VisualPlanResult {
  style: string;
  diagnostics: {
    interactionCount: number;
    zoomKeyframeCount: number;
    speedRampCount: number;
    rawDurationMs: number;
    adjustedDurationMs: number;
  };
}

const isInteractive = (type: CaptureInteraction["type"]): boolean =>
  type === "click" ||
  type === "hover" ||
  type === "fill" ||
  type === "select" ||
  type === "dragSelect" ||
  type === "press";

const zoomScaleForEvent = (type: CaptureInteraction["type"], style: DemoStylePreset): number => {
  switch (type) {
    case "click":
    case "select":
      return style.director.clickZoomScale;
    case "fill":
    case "dragSelect":
      return style.director.fillZoomScale;
    case "hover":
      return style.director.hoverZoomScale;
    default:
      return 1;
  }
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildDirectedZoomKeyframes = (
  capture: ContinuousCaptureResult,
  style: DemoStylePreset,
): ZoomKeyframe[] => {
  const keyframes: ZoomKeyframe[] = [
    {
      atMs: 0,
      centerX: 0.5,
      centerY: 0.5,
      scale: 1,
      holdMs: 650,
      easing: "ease-in-out",
      transitionMs: 0,
    },
  ];

  let lastZoomMs = 0;

  for (const interaction of capture.interactions) {
    if (!isInteractive(interaction.type)) continue;
    if (interaction.x == null || interaction.y == null) continue;

    const gapMs = interaction.atMs - lastZoomMs;
    if (gapMs < style.director.minZoomGapMs) continue;

    const targetWidth = interaction.width ?? capture.viewport.width * 0.16;
    const targetHeight = interaction.height ?? capture.viewport.height * 0.12;
    const targetFraction = Math.max(
      targetWidth / capture.viewport.width,
      targetHeight / capture.viewport.height,
      0.05,
    );
    const sizeAwareScale = clamp(0.58 / targetFraction, 1.18, style.director.maxZoomScale);
    const scale = Math.min(zoomScaleForEvent(interaction.type, style), sizeAwareScale);

    const centerX = clamp(interaction.x / capture.viewport.width, 0.12, 0.88);
    const centerY = clamp(interaction.y / capture.viewport.height, 0.16, 0.84);
    const atMs = Math.max(0, interaction.atMs - style.director.preZoomMs);

    keyframes.push({
      atMs,
      centerX,
      centerY,
      scale,
      holdMs: style.director.postInteractionHoldMs,
      easing: "spring",
      transitionMs: style.director.transitionMs,
    });

    keyframes.push({
      atMs: interaction.atMs + style.director.zoomOutDelayMs,
      centerX,
      centerY,
      scale: Math.max(1.08, Math.min(1.18, scale - 0.32)),
      holdMs: 300,
      easing: "ease-out",
      transitionMs: Math.round(style.director.transitionMs * 0.7),
    });

    lastZoomMs = interaction.atMs + style.director.zoomOutDelayMs;
  }

  const tailMs = Math.max(0, capture.totalDurationMs - 700);
  const last = keyframes[keyframes.length - 1];
  if (!last || tailMs - last.atMs > 900) {
    keyframes.push({
      atMs: tailMs,
      centerX: 0.5,
      centerY: 0.5,
      scale: 1,
      holdMs: 400,
      easing: "ease-in-out",
      transitionMs: style.director.transitionMs,
    });
  }

  return mergeKeyframes(keyframes);
};

const mergeKeyframes = (keyframes: ZoomKeyframe[]): ZoomKeyframe[] => {
  const sorted = [...keyframes].sort((a, b) => a.atMs - b.atMs);
  const merged: ZoomKeyframe[] = [];

  for (const keyframe of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      keyframe.atMs - previous.atMs < 260 &&
      Math.abs(keyframe.scale - previous.scale) < 0.12
    ) {
      previous.holdMs = Math.max(previous.holdMs, keyframe.holdMs);
      continue;
    }
    merged.push(keyframe);
  }

  return merged;
};

const buildDirectedSpeedSegments = (
  capture: ContinuousCaptureResult,
  style: DemoStylePreset,
): SpeedSegment[] => {
  const interactions = capture.interactions.filter((i) => isInteractive(i.type));
  if (capture.totalDurationMs <= 0) return [];
  if (interactions.length === 0) {
    return [{ startMs: 0, endMs: capture.totalDurationMs, speed: 1, reason: "normal" }];
  }

  const protectedRanges = interactions.map((interaction) => ({
    startMs: Math.max(0, interaction.atMs - 450),
    endMs: Math.min(capture.totalDurationMs, interaction.atMs + 1050),
  }));

  for (const marker of capture.sceneMarkers) {
    protectedRanges.push({
      startMs: marker.startMs,
      endMs: Math.min(marker.endMs, marker.startMs + style.director.sceneMinMs),
    });
  }

  protectedRanges.sort((a, b) => a.startMs - b.startMs);

  const mergedProtected: Array<{ startMs: number; endMs: number }> = [];
  for (const range of protectedRanges) {
    const previous = mergedProtected[mergedProtected.length - 1];
    if (previous && range.startMs <= previous.endMs + 250) {
      previous.endMs = Math.max(previous.endMs, range.endMs);
    } else {
      mergedProtected.push({ ...range });
    }
  }

  const segments: SpeedSegment[] = [];
  let cursor = 0;

  for (const range of mergedProtected) {
    if (range.startMs > cursor) {
      const gap = range.startMs - cursor;
      const speed = gap > style.director.idleThresholdMs ? style.director.idleSpeed : 1;
      segments.push({
        startMs: cursor,
        endMs: range.startMs,
        speed,
        reason: speed === 1 ? "normal" : "idle",
      });
    }

    segments.push({
      startMs: range.startMs,
      endMs: range.endMs,
      speed: 1,
      reason: "normal",
    });
    cursor = range.endMs;
  }

  if (cursor < capture.totalDurationMs) {
    const gap = capture.totalDurationMs - cursor;
    const speed = gap > style.director.idleThresholdMs ? style.director.idleSpeed : 1;
    segments.push({
      startMs: cursor,
      endMs: capture.totalDurationMs,
      speed,
      reason: speed === 1 ? "normal" : "idle",
    });
  }

  return mergeSpeedSegments(segments.filter((segment) => segment.endMs > segment.startMs));
};

const mergeSpeedSegments = (segments: SpeedSegment[]): SpeedSegment[] => {
  const merged: SpeedSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.speed === segment.speed && previous.reason === segment.reason && previous.endMs >= segment.startMs - 10) {
      previous.endMs = segment.endMs;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
};

const calculateAdjustedDuration = (segments: SpeedSegment[]) =>
  Math.round(segments.reduce((sum, segment) => sum + (segment.endMs - segment.startMs) / segment.speed, 0));

const labelForInteraction = (interaction: CaptureInteraction): string => {
  switch (interaction.type) {
    case "fill": return "Typed query";
    case "click": return "Click target";
    case "hover": return "Focus area";
    case "select": return "Choose option";
    case "dragSelect": return "Select range";
    case "press": return "Keyboard step";
    default: return "Action";
  }
};

const buildPremiumDirection = (
  capture: ContinuousCaptureResult,
  style: DemoStylePreset,
): { shots: PremiumShot[]; overlays: MotionOverlayCue[]; preset: string } => {
  const shots: PremiumShot[] = [];
  const overlays: MotionOverlayCue[] = [];
  const decorativeOverlaysEnabled = style.name !== "screen-studio";

  for (const [index, marker] of capture.sceneMarkers.entries()) {
    const durationMs = Math.max(900, marker.endMs - marker.startMs);
    const kind: PremiumShot["kind"] =
      index === 0 ? "overview" : index === capture.sceneMarkers.length - 1 ? "result" : "action";
    shots.push({
      id: `shot-${marker.sceneId}`,
      sceneId: marker.sceneId,
      kind,
      atMs: marker.startMs,
      durationMs,
      title: marker.sceneTitle,
      intent: kind === "overview" ? "establish context" : kind === "result" ? "show outcome" : "demonstrate action",
    });

    if (decorativeOverlaysEnabled) {
      overlays.push({
        id: `caption-${marker.sceneId}`,
        type: "caption",
        atMs: marker.startMs + 450,
        durationMs: Math.min(3200, Math.max(1800, durationMs - 700)),
        text: marker.sceneTitle,
        tone: index === capture.sceneMarkers.length - 1 ? "success" : "default",
      });
    }
  }

  if (!decorativeOverlaysEnabled) return { shots, overlays, preset: style.name };

  let calloutCount = 0;
  for (const interaction of capture.interactions) {
    if (!isInteractive(interaction.type)) continue;
    if (interaction.x == null || interaction.y == null) continue;
    if (calloutCount >= 8) break;

    const x = clamp(interaction.x / capture.viewport.width, 0.08, 0.92);
    const y = clamp(interaction.y / capture.viewport.height, 0.12, 0.88);
    const width = (interaction.width ?? 120) / capture.viewport.width;
    const height = (interaction.height ?? 44) / capture.viewport.height;

    overlays.push({
      id: `spotlight-${interaction.sceneId}-${calloutCount}`,
      type: "spotlight",
      atMs: Math.max(0, interaction.atMs - 220),
      durationMs: 1450,
      text: "",
      x,
      y,
      width,
      height,
      tone: "info",
    });
    overlays.push({
      id: `callout-${interaction.sceneId}-${calloutCount}`,
      type: "callout",
      atMs: Math.max(0, interaction.atMs + 120),
      durationMs: 1900,
      text: labelForInteraction(interaction),
      x,
      y,
      width,
      height,
      tone: interaction.type === "click" ? "success" : "info",
    });
    calloutCount += 1;
  }

  if (capture.totalDurationMs > 1400) {
    overlays.push({
      id: "final-badge",
      type: "badge",
      atMs: Math.max(0, capture.totalDurationMs - 3200),
      durationMs: 2600,
      text: "Research flow complete",
      subtext: "No checkout or purchase step",
      tone: "success",
    });
  }

  return { shots, overlays, preset: style.name };
};

export const buildDirectorPlan = (
  capture: ContinuousCaptureResult,
  options: {
    style?: string;
  } = {},
): DirectorPlanResult => {
  const style = resolveDemoStyle(options.style);
  const base = buildVisualPlan(capture);
  const speedSegments = buildDirectedSpeedSegments(capture, style);
  const zoomKeyframes = buildDirectedZoomKeyframes(capture, style);
  const adjustedDurationMs = calculateAdjustedDuration(speedSegments);
  const premium = buildPremiumDirection(capture, style);

  return {
    ...base,
    zoomKeyframes,
    speedSegments,
    adjustedDurationMs,
    premium,
    style: style.name,
    diagnostics: {
      interactionCount: capture.interactions.filter((i) => isInteractive(i.type)).length,
      zoomKeyframeCount: zoomKeyframes.length,
      speedRampCount: speedSegments.filter((segment) => segment.speed !== 1).length,
      rawDurationMs: capture.totalDurationMs,
      adjustedDurationMs,
    },
  };
};
