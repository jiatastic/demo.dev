/**
 * Post-processing intelligence layer.
 *
 * Analyzes the metadata from a continuous capture session (cursor positions,
 * interaction events, scene markers) and generates a "visual plan" — a timeline
 * of zoom keyframes, speed ramps, and cursor smoothing parameters that can be
 * consumed by the FFmpeg composition pipeline.
 *
 * The goal is to replicate Screen Studio's approach: raw recording + metadata
 * → intelligent post-processing that makes the video feel cinematic.
 */

import type {
  CursorSample,
  CaptureInteraction,
  SceneMarker,
  ContinuousCaptureResult,
} from "../capture/continuous-capture.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZoomKeyframe {
  /** Time offset in the raw recording (ms). */
  atMs: number;
  /** Zoom center X as fraction of viewport width (0–1). */
  centerX: number;
  /** Zoom center Y as fraction of viewport height (0–1). */
  centerY: number;
  /** Zoom scale (1.0 = no zoom, 2.0 = 2x zoom). */
  scale: number;
  /** Duration to hold this zoom (ms) before transitioning. */
  holdMs: number;
  /** Easing for transitioning INTO this keyframe. */
  easing: "ease-in-out" | "ease-out" | "spring";
  /** Transition duration from previous keyframe (ms). */
  transitionMs: number;
}

export interface SpeedSegment {
  /** Start time in raw recording (ms). */
  startMs: number;
  /** End time in raw recording (ms). */
  endMs: number;
  /** Playback speed (1.0 = normal, 2.0 = 2x, 0.5 = slow). */
  speed: number;
  /** Reason for this speed change. */
  reason: "normal" | "loading" | "idle" | "transition";
}

export interface SmoothedCursorPoint {
  /** Time in output video timeline (ms). */
  atMs: number;
  x: number;
  y: number;
}

export interface VisualPlanResult {
  zoomKeyframes: ZoomKeyframe[];
  speedSegments: SpeedSegment[];
  smoothedCursor: SmoothedCursorPoint[];
  /** Total duration after speed adjustments (ms). */
  adjustedDurationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How close to a click target to zoom (scale factor). */
const CLICK_ZOOM_SCALE = 1.6;
const HOVER_ZOOM_SCALE = 1.3;
const FILL_ZOOM_SCALE = 1.5;
const DEFAULT_ZOOM_SCALE = 1.0;

/** Minimum gap between zoom keyframes (ms). */
const MIN_ZOOM_GAP_MS = 800;

/** If no interaction for this long, consider it "idle" and speed up. */
const IDLE_THRESHOLD_MS = 1500;

/** Speed multiplier for idle segments. */
const IDLE_SPEED = 6.0;

/** Speed for navigating between pages (the loading part). */
const LOADING_SPEED = 2.5;

/** Cursor smoothing window size (samples). */
const SMOOTH_WINDOW = 5;

// ---------------------------------------------------------------------------
// Zoom keyframe generation
// ---------------------------------------------------------------------------

const zoomScaleForEvent = (type: CaptureInteraction["type"]): number => {
  switch (type) {
    case "click":
      return CLICK_ZOOM_SCALE;
    case "fill":
      return FILL_ZOOM_SCALE;
    case "hover":
      return HOVER_ZOOM_SCALE;
    case "select":
      return CLICK_ZOOM_SCALE;
    case "dragSelect":
      return FILL_ZOOM_SCALE;
    default:
      return DEFAULT_ZOOM_SCALE;
  }
};

const isInteractive = (type: CaptureInteraction["type"]): boolean =>
  type === "click" ||
  type === "hover" ||
  type === "fill" ||
  type === "select" ||
  type === "dragSelect" ||
  type === "press";

const buildZoomKeyframes = (
  interactions: CaptureInteraction[],
  viewport: { width: number; height: number },
): ZoomKeyframe[] => {
  const keyframes: ZoomKeyframe[] = [];

  // Start with full view
  keyframes.push({
    atMs: 0,
    centerX: 0.5,
    centerY: 0.5,
    scale: 1.0,
    holdMs: 500,
    easing: "ease-in-out",
    transitionMs: 0,
  });

  let lastKeyframeMs = 0;

  for (const interaction of interactions) {
    if (!isInteractive(interaction.type)) continue;
    if (interaction.x == null || interaction.y == null) continue;
    if (interaction.atMs - lastKeyframeMs < MIN_ZOOM_GAP_MS) continue;

    const centerX = interaction.x / viewport.width;
    const centerY = interaction.y / viewport.height;
    const scale = zoomScaleForEvent(interaction.type);

    // Zoom in to the interaction target
    keyframes.push({
      atMs: interaction.atMs - 300, // Start zooming 300ms before
      centerX,
      centerY,
      scale,
      holdMs: 600,
      easing: "spring",
      transitionMs: 500,
    });

    // Zoom back out after the interaction
    keyframes.push({
      atMs: interaction.atMs + 800,
      centerX: 0.5,
      centerY: 0.5,
      scale: 1.0,
      holdMs: 200,
      easing: "ease-in-out",
      transitionMs: 600,
    });

    lastKeyframeMs = interaction.atMs + 800;
  }

  // Merge nearby "zoom out" keyframes to avoid jitter
  return mergeNearbyKeyframes(keyframes);
};

const mergeNearbyKeyframes = (keyframes: ZoomKeyframe[]): ZoomKeyframe[] => {
  if (keyframes.length <= 2) return keyframes;

  const merged: ZoomKeyframe[] = [keyframes[0]];

  for (let i = 1; i < keyframes.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = keyframes[i];

    // If two keyframes are very close and both zoom out, merge them
    if (
      curr.atMs - prev.atMs < 400 &&
      Math.abs(curr.scale - prev.scale) < 0.2
    ) {
      // Keep the one with the higher zoom (more interesting)
      if (curr.scale > prev.scale) {
        merged[merged.length - 1] = curr;
      }
      continue;
    }

    merged.push(curr);
  }

  return merged;
};

// ---------------------------------------------------------------------------
// Speed ramp generation
// ---------------------------------------------------------------------------

const buildSpeedSegments = (
  interactions: CaptureInteraction[],
  sceneMarkers: SceneMarker[],
  totalDurationMs: number,
): SpeedSegment[] => {
  const segments: SpeedSegment[] = [];

  // Find navigation events (page loads are boring → speed up)
  const navigations = interactions.filter((i) => i.type === "navigate");
  const interactiveEvents = interactions.filter((i) => isInteractive(i.type));

  // Build timeline of "interesting" moments
  // Only include interactive + navigate — scene-start is just a marker, not an activity
  type Moment = { atMs: number; type: "interactive" | "navigate" };
  const moments: Moment[] = [
    ...interactiveEvents.map((i) => ({ atMs: i.atMs, type: "interactive" as const })),
    ...navigations.map((i) => ({ atMs: i.atMs, type: "navigate" as const })),
  ].sort((a, b) => a.atMs - b.atMs);

  if (moments.length === 0) {
    segments.push({
      startMs: 0,
      endMs: totalDurationMs,
      speed: 1.0,
      reason: "normal",
    });
    return segments;
  }

  let cursor = 0;

  for (let i = 0; i < moments.length; i++) {
    const moment = moments[i];
    const gapMs = moment.atMs - cursor;

    if (gapMs > IDLE_THRESHOLD_MS) {
      // Long gap before this moment → speed up the idle part
      // But keep a 500ms buffer at normal speed before the interesting moment
      const idleEnd = moment.atMs - 500;
      if (idleEnd > cursor) {
        segments.push({
          startMs: cursor,
          endMs: idleEnd,
          speed: IDLE_SPEED,
          reason: "idle",
        });
        cursor = idleEnd;
      }
    }

    // After a navigate, speed through the loading phase
    if (moment.type === "navigate") {
      const nextInteractive = moments.find(
        (m) => m.atMs > moment.atMs && m.type === "interactive",
      );
      const loadEnd = nextInteractive
        ? Math.min(nextInteractive.atMs - 300, moment.atMs + 3000)
        : moment.atMs + 2000;

      if (loadEnd > moment.atMs + 500) {
        segments.push({
          startMs: cursor,
          endMs: moment.atMs,
          speed: 1.0,
          reason: "normal",
        });
        segments.push({
          startMs: moment.atMs,
          endMs: loadEnd,
          speed: LOADING_SPEED,
          reason: "loading",
        });
        cursor = loadEnd;
        continue;
      }
    }

    // Normal speed for interesting moments
    const nextMoment = moments[i + 1];
    const endMs = nextMoment ? nextMoment.atMs : totalDurationMs;

    if (cursor < endMs) {
      segments.push({
        startMs: cursor,
        endMs,
        speed: 1.0,
        reason: "normal",
      });
      cursor = endMs;
    }
  }

  // Fill remaining time
  if (cursor < totalDurationMs) {
    segments.push({
      startMs: cursor,
      endMs: totalDurationMs,
      speed: 1.0,
      reason: "normal",
    });
  }

  return mergeAdjacentSegments(segments);
};

const mergeAdjacentSegments = (segments: SpeedSegment[]): SpeedSegment[] => {
  if (segments.length <= 1) return segments;

  const merged: SpeedSegment[] = [segments[0]];

  for (let i = 1; i < segments.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = segments[i];

    if (prev.speed === curr.speed && prev.endMs >= curr.startMs - 10) {
      prev.endMs = curr.endMs;
    } else {
      merged.push(curr);
    }
  }

  return merged;
};

// ---------------------------------------------------------------------------
// Cursor smoothing (spring-damper)
// ---------------------------------------------------------------------------

const smoothCursorLog = (
  raw: CursorSample[],
  windowSize = SMOOTH_WINDOW,
): SmoothedCursorPoint[] => {
  if (raw.length === 0) return [];

  const smoothed: SmoothedCursorPoint[] = [];

  for (let i = 0; i < raw.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(raw.length, i + Math.ceil(windowSize / 2));

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (let j = start; j < end; j++) {
      // Weight: closer samples get more weight (triangular window)
      const weight = 1 - Math.abs(j - i) / windowSize;
      sumX += raw[j].x * weight;
      sumY += raw[j].y * weight;
      count += weight;
    }

    smoothed.push({
      atMs: raw[i].atMs,
      x: Math.round(sumX / count),
      y: Math.round(sumY / count),
    });
  }

  // Downsample to ~30fps (one point per ~33ms) to keep data manageable
  const downsampled: SmoothedCursorPoint[] = [];
  let lastMs = -Infinity;

  for (const pt of smoothed) {
    if (pt.atMs - lastMs >= 33) {
      downsampled.push(pt);
      lastMs = pt.atMs;
    }
  }

  return downsampled;
};

// ---------------------------------------------------------------------------
// Calculate adjusted duration after speed changes
// ---------------------------------------------------------------------------

const calculateAdjustedDuration = (segments: SpeedSegment[]): number => {
  let total = 0;
  for (const seg of segments) {
    total += (seg.endMs - seg.startMs) / seg.speed;
  }
  return Math.round(total);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const buildVisualPlan = (
  capture: ContinuousCaptureResult,
): VisualPlanResult => {
  const zoomKeyframes = buildZoomKeyframes(
    capture.interactions,
    capture.viewport,
  );

  const speedSegments = buildSpeedSegments(
    capture.interactions,
    capture.sceneMarkers,
    capture.totalDurationMs,
  );

  const smoothedCursor = smoothCursorLog(capture.cursorLog);

  const adjustedDurationMs = calculateAdjustedDuration(speedSegments);

  return {
    zoomKeyframes,
    speedSegments,
    smoothedCursor,
    adjustedDurationMs,
  };
};
