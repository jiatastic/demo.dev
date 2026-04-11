/**
 * FFmpeg-based video composition pipeline.
 *
 * Takes the raw continuous recording + visual plan and produces the final
 * polished mp4 with:
 *   - Smooth zoom/pan following interaction targets
 *   - Variable playback speed (compress loading, normal for interactions)
 *   - Narration audio overlay with proper sync
 *   - Background music with ducking
 *   - Intro/outro title cards
 */

import { execFile } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import type { CaptureInteraction, ContinuousCaptureResult, SceneMarker } from "../capture/continuous-capture.js";
import type {
  VisualPlanResult,
  ZoomKeyframe,
  SpeedSegment,
} from "./visual-plan.js";
import type { VoiceLine } from "../types.js";
import { applyBrowserFrame, type BrowserFrameOptions } from "./browser-frame.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VideoQuality = "draft" | "standard" | "high";

const QUALITY_PRESETS: Record<VideoQuality, { crf: number; preset: string; fps: number }> = {
  draft:    { crf: 28, preset: "ultrafast", fps: 24 },
  standard: { crf: 18, preset: "fast",      fps: 30 },
  high:     { crf: 12, preset: "slow",      fps: 60 },
};

export interface ComposeOptions {
  /** Path to the continuous WebM recording. */
  videoPath: string;
  /** Output mp4 path. */
  outputPath: string;
  /** Visual plan with zoom keyframes and speed segments. */
  visualPlan: VisualPlanResult;
  /** Capture result for viewport info and scene markers. */
  capture: ContinuousCaptureResult;
  /** Voice lines (narration audio files). */
  voiceLines?: VoiceLine[];
  /** Background music. */
  bgm?: {
    path: string;
    volume?: number;
    ducking?: number;
  };
  /** Video title for intro card. */
  title?: string;
  /** Output resolution. */
  width?: number;
  height?: number;
  fps?: number;
  /** Video quality: "draft" (fast, low), "standard" (default), "high" (slow, best). */
  quality?: VideoQuality;
  /** Wrap video in a Screen Studio–style browser frame with gradient background. */
  frame?: BrowserFrameOptions | boolean;
}

// ---------------------------------------------------------------------------
// FFmpeg filter expression builders
// ---------------------------------------------------------------------------

/**
 * Build a zoompan filter expression from zoom keyframes.
 *
 * The zoompan filter evaluates `z`, `x`, `y` expressions per frame.
 * We encode keyframes as piecewise-linear interpolation in the expression.
 */
const buildZoompanExpression = (
  keyframes: ZoomKeyframe[],
  fps: number,
  totalDurationMs: number,
  inputWidth: number,
  inputHeight: number,
  outputWidth: number,
  outputHeight: number,
): string => {
  if (keyframes.length === 0) {
    return `zoompan=z=1:x=0:y=0:d=1:s=${outputWidth}x${outputHeight}:fps=${fps}`;
  }

  // Convert keyframes to frame numbers
  const frameKeyframes = keyframes.map((kf) => ({
    frame: Math.round((kf.atMs / 1000) * fps),
    scale: kf.scale,
    centerX: kf.centerX,
    centerY: kf.centerY,
    transitionFrames: Math.round((kf.transitionMs / 1000) * fps),
  }));

  // Build piecewise zoom expression
  // FFmpeg expressions: if(cond,val_true,val_false), between(val,min,max), etc.
  const zParts: string[] = [];
  const xParts: string[] = [];
  const yParts: string[] = [];

  for (let i = 0; i < frameKeyframes.length; i++) {
    const kf = frameKeyframes[i];
    const next = frameKeyframes[i + 1];

    if (!next) {
      // Last keyframe: hold this zoom
      zParts.push(`if(gte(on,${kf.frame}),${kf.scale.toFixed(3)}`);
      xParts.push(
        `if(gte(on,${kf.frame}),${buildPanX(kf.centerX, kf.scale, inputWidth, outputWidth)}`,
      );
      yParts.push(
        `if(gte(on,${kf.frame}),${buildPanY(kf.centerY, kf.scale, inputHeight, outputHeight)}`,
      );
    } else {
      const transStart = next.frame - next.transitionFrames;
      const transEnd = next.frame;

      // Hold at current zoom until transition starts
      zParts.push(
        `if(between(on,${kf.frame},${transStart}),${kf.scale.toFixed(3)}`,
      );
      xParts.push(
        `if(between(on,${kf.frame},${transStart}),${buildPanX(kf.centerX, kf.scale, inputWidth, outputWidth)}`,
      );
      yParts.push(
        `if(between(on,${kf.frame},${transStart}),${buildPanY(kf.centerY, kf.scale, inputHeight, outputHeight)}`,
      );

      // Interpolate during transition
      if (next.transitionFrames > 0) {
        const progress = `((on-${transStart})/${next.transitionFrames})`;
        const zInterp = `${kf.scale.toFixed(3)}+${progress}*(${next.scale.toFixed(3)}-${kf.scale.toFixed(3)})`;
        zParts.push(
          `if(between(on,${transStart},${transEnd}),${zInterp}`,
        );

        // Interpolate pan position
        const fromX = buildPanX(kf.centerX, kf.scale, inputWidth, outputWidth);
        const toX = buildPanX(next.centerX, next.scale, inputWidth, outputWidth);
        xParts.push(
          `if(between(on,${transStart},${transEnd}),${fromX}+${progress}*(${toX}-(${fromX}))`,
        );

        const fromY = buildPanY(kf.centerY, kf.scale, inputHeight, outputHeight);
        const toY = buildPanY(next.centerY, next.scale, inputHeight, outputHeight);
        yParts.push(
          `if(between(on,${transStart},${transEnd}),${fromY}+${progress}*(${toY}-(${fromY}))`,
        );
      }
    }
  }

  // Close all if() expressions — default to scale 1 center
  const defaultX = buildPanX(0.5, 1, inputWidth, outputWidth);
  const defaultY = buildPanY(0.5, 1, inputHeight, outputHeight);
  const closers = ")".repeat(zParts.length);
  const zExpr = zParts.join(",") + `,1${closers}`;
  const xExpr = xParts.join(",") + `,${defaultX}${closers}`;
  const yExpr = yParts.join(",") + `,${defaultY}${closers}`;

  return `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${outputWidth}x${outputHeight}:fps=${fps}`;
};

const buildPanX = (
  centerX: number,
  scale: number,
  inputWidth: number,
  outputWidth: number,
): string => {
  // Pan so that centerX is at the center of the output
  const cropWidth = inputWidth / scale;
  const panX = centerX * inputWidth - cropWidth / 2;
  return Math.max(0, Math.min(inputWidth - cropWidth, panX)).toFixed(1);
};

const buildPanY = (
  centerY: number,
  scale: number,
  inputHeight: number,
  outputHeight: number,
): string => {
  const cropHeight = inputHeight / scale;
  const panY = centerY * inputHeight - cropHeight / 2;
  return Math.max(0, Math.min(inputHeight - cropHeight, panY)).toFixed(1);
};

// ---------------------------------------------------------------------------
// Title card generation via FFmpeg
// ---------------------------------------------------------------------------

const hasDrawtext = async (): Promise<boolean> => {
  try {
    const { stdout } = await execFileAsync("ffmpeg", ["-filters"], { maxBuffer: 1024 * 1024 });
    return stdout.includes("drawtext");
  } catch {
    return false;
  }
};

const generateTitleCard = async (
  title: string,
  outputPath: string,
  width: number,
  height: number,
  durationSec: number,
  fps: number,
): Promise<void> => {
  await mkdir(dirname(outputPath), { recursive: true });

  const canDrawText = await hasDrawtext();

  if (canDrawText) {
    await execFileAsync("ffmpeg", [
      "-f", "lavfi",
      "-i", `color=c=0x171410:s=${width}x${height}:d=${durationSec}:r=${fps}`,
      "-vf",
      `drawtext=text='${escapeFFmpegText(title)}':` +
        `fontsize=48:fontcolor=white:` +
        `x=(w-text_w)/2:y=(h-text_h)/2`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-y",
      outputPath,
    ]);
  } else {
    // Fallback: plain dark card (no text overlay)
    await execFileAsync("ffmpeg", [
      "-f", "lavfi",
      "-i", `color=c=0x171410:s=${width}x${height}:d=${durationSec}:r=${fps}`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-y",
      outputPath,
    ]);
  }
};

const escapeFFmpegText = (text: string): string =>
  text.replace(/'/g, "'\\''").replace(/:/g, "\\:").replace(/\\/g, "\\\\");

// ---------------------------------------------------------------------------
// Audio mixing
// ---------------------------------------------------------------------------

interface AudioTrack {
  path: string;
  /** Start time in the output video timeline (seconds). */
  startSec: number;
}

const buildNarrationTracks = (
  voiceLines: VoiceLine[],
  sceneMarkers: SceneMarker[],
  speedSegments: SpeedSegment[],
  interactions: CaptureInteraction[],
): AudioTrack[] => {
  const tracks: AudioTrack[] = [];
  const markerBySceneId = new Map(sceneMarkers.map((m) => [m.sceneId, m]));

  for (const line of voiceLines) {
    if (!line.audioPath) continue;
    const marker = markerBySceneId.get(line.sceneId);
    if (!marker) continue;

    // Map scene start in raw recording → output timeline (after speed ramps)
    const outputTimeSec = rawTimeToOutputTime(marker.startMs, speedSegments) / 1000;

    // Find the first interactive event in this scene to anchor narration
    // after content has loaded rather than at the raw scene start
    const sceneInteractions = interactions.filter(
      (i) => i.sceneId === marker.sceneId && i.type !== "scene-start" && i.type !== "scene-end",
    );
    const firstInteraction = sceneInteractions[0];
    let anchorSec = outputTimeSec;
    if (firstInteraction) {
      // Start narration 0.3s after the first meaningful interaction in the scene
      const interactionOutputSec = rawTimeToOutputTime(firstInteraction.atMs, speedSegments) / 1000;
      // But don't start later than 3s into the scene
      anchorSec = Math.min(interactionOutputSec + 0.3, outputTimeSec + 3.0);
      // And never before the scene start
      anchorSec = Math.max(anchorSec, outputTimeSec);
    }

    // Ensure this track doesn't overlap with the previous one
    const prev = tracks[tracks.length - 1];
    if (prev) {
      const prevVoice = voiceLines.find((v) => v.audioPath === prev.path);
      const prevEndSec = prev.startSec + (prevVoice?.audioDurationMs ?? 0) / 1000;
      if (anchorSec < prevEndSec) {
        // Push this track to start 0.3s after the previous one ends
        anchorSec = prevEndSec + 0.3;
      }
    }

    tracks.push({
      path: line.audioPath,
      startSec: anchorSec,
    });
  }

  return tracks;
};

/**
 * Map a timestamp in the raw recording to the output timeline,
 * accounting for speed ramps.
 */
const rawTimeToOutputTime = (
  rawMs: number,
  segments: SpeedSegment[],
): number => {
  let outputMs = 0;

  for (const seg of segments) {
    if (rawMs <= seg.startMs) break;

    const segStart = seg.startMs;
    const segEnd = Math.min(seg.endMs, rawMs);
    const segDuration = segEnd - segStart;

    outputMs += segDuration / seg.speed;

    if (rawMs <= seg.endMs) break;
  }

  return outputMs;
};

// ---------------------------------------------------------------------------
// Main composition
// ---------------------------------------------------------------------------

export const composeVideo = async (options: ComposeOptions): Promise<string> => {
  const q = QUALITY_PRESETS[options.quality ?? "standard"];
  const width = options.width ?? options.capture.viewport.width;
  const height = options.height ?? options.capture.viewport.height;
  const fps = options.fps ?? q.fps;

  await mkdir(dirname(options.outputPath), { recursive: true });

  const tempDir = join(dirname(options.outputPath), ".ffmpeg-temp");
  await mkdir(tempDir, { recursive: true });

  // Step 1: Apply speed ramps to the base video
  const speedAdjustedPath = join(tempDir, "speed-adjusted.mp4");
  await applySpeedRamps(
    options.videoPath,
    speedAdjustedPath,
    options.visualPlan.speedSegments,
    fps,
    width,
    height,
    q.crf,
    q.preset,
  );

  // Step 2: Zoom is now handled at capture time via CSS transforms (Screen Studio style)
  // No FFmpeg zoom step needed — the browser does smooth 60fps zoom during recording.

  // Step 3: Optional browser frame (Screen Studio style)
  let mainVideoPath = speedAdjustedPath;
  let finalWidth = width;
  let finalHeight = height;

  if (options.frame) {
    const frameOpts: BrowserFrameOptions = options.frame === true ? {} : options.frame;
    // Infer display URL from the first scene marker
    if (!frameOpts.displayUrl && options.capture.sceneMarkers[0]) {
      try {
        frameOpts.displayUrl = new URL(options.capture.sceneMarkers[0].url).host;
      } catch { /* keep default */ }
    }
    const framedPath = join(tempDir, "framed.mp4");
    const { outputWidth, outputHeight } = await applyBrowserFrame(
      speedAdjustedPath, framedPath, width, height, frameOpts, q.crf, q.preset,
    );
    mainVideoPath = framedPath;
    finalWidth = outputWidth;
    finalHeight = outputHeight;
  }

  // Step 3: Generate intro if title provided
  let introPath: string | undefined;
  if (options.title) {
    introPath = join(tempDir, "intro.mp4");
    await generateTitleCard(options.title, introPath, finalWidth, finalHeight, 2.0, fps);
  }

  // Step 4: Concatenate intro + main
  const concatPath = introPath
    ? join(tempDir, "concatenated.mp4")
    : mainVideoPath;

  if (introPath) {
    await concatVideos([introPath, mainVideoPath], concatPath);
  }

  // Step 5: Mix audio (narration + BGM)
  if (options.voiceLines?.length || options.bgm) {
    await mixAudio(
      concatPath,
      options.outputPath,
      options.voiceLines ?? [],
      options.capture.sceneMarkers,
      options.visualPlan.speedSegments,
      options.capture.interactions,
      options.bgm,
      introPath ? 2.0 : 0,
    );
  } else {
    // No audio to mix — just copy
    await execFileAsync("ffmpeg", [
      "-i", concatPath,
      "-c", "copy",
      "-y",
      options.outputPath,
    ]);
  }

  return options.outputPath;
};

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

const applySpeedRamps = async (
  inputPath: string,
  outputPath: string,
  segments: SpeedSegment[],
  fps: number,
  width: number,
  height: number,
  crf: number,
  preset: string,
): Promise<void> => {
  const allNormal = segments.every((s) => s.speed === 1.0);

  if (allNormal || segments.length <= 1) {
    await execFileAsync("ffmpeg", [
      "-i", inputPath,
      "-vf", `scale=${width}:${height}:flags=lanczos,fps=${fps}`,
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-pix_fmt", "yuv420p",
      "-an",
      "-y",
      outputPath,
    ]);
    return;
  }

  const tempDir = dirname(outputPath);
  const segmentPaths: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segPath = join(tempDir, `seg-${i}.mp4`);
    const startSec = (seg.startMs / 1000).toFixed(3);
    const durationSec = ((seg.endMs - seg.startMs) / 1000).toFixed(3);
    const ptsExpr = seg.speed === 1.0 ? "PTS-STARTPTS" : `(PTS-STARTPTS)/${seg.speed.toFixed(2)}`;

    await execFileAsync("ffmpeg", [
      "-ss", startSec,
      "-t", durationSec,
      "-i", inputPath,
      "-vf", `scale=${width}:${height}:flags=lanczos,fps=${fps},setpts=${ptsExpr}`,
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-pix_fmt", "yuv420p",
      "-an",
      "-y",
      segPath,
    ]);
    segmentPaths.push(segPath);
  }

  // Concat all segments (use absolute paths for FFmpeg -safe 0)
  const listPath = join(tempDir, "speed-concat.txt");
  const listContent = segmentPaths.map((p) => `file '${resolve(p)}'`).join("\n");
  await writeFile(listPath, listContent, "utf-8");

  await execFileAsync("ffmpeg", [
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c", "copy",
    "-y",
    outputPath,
  ]);
};

/**
 * Apply subtle visual polish to the speed-adjusted video.
 * For continuous screen recordings, the natural cursor/scroll motion
 * provides enough visual interest — we just ensure clean output.
 */
/**
 * Apply smooth zoom keyframes using FFmpeg crop filter with time-based
 * expressions. Uses cosine easing for smooth transitions (no hard cuts).
 *
 * Each frame evaluates a piecewise crop expression that smoothly
 * interpolates scale, centerX, centerY between keyframes.
 */
const applyVideoZoom = async (
  inputPath: string,
  outputPath: string,
  keyframes: ZoomKeyframe[],
  speedSegments: SpeedSegment[],
  fps: number,
  width: number,
  height: number,
  crf: number,
  preset: string,
): Promise<void> => {
  // Adjust keyframe timings for speed ramps
  const adjusted = keyframes
    .map((kf) => ({
      scale: kf.scale,
      centerX: kf.centerX,
      centerY: kf.centerY,
      tSec: rawTimeToOutputTime(kf.atMs, speedSegments) / 1000,
      transSec: kf.transitionMs / 1000,
    }))
    .sort((a, b) => a.tSec - b.tSec);

  if (adjusted.length === 0 || adjusted.every((k) => k.scale <= 1.01)) {
    await execFileAsync("ffmpeg", ["-i", inputPath, "-c", "copy", "-y", outputPath]);
    return;
  }

  // Build a piecewise expression for scale, centerX, centerY using t (time)
  // Smooth easing: 0.5-0.5*cos(progress*PI) gives cosine ease-in-out
  const buildExpr = (getter: (kf: typeof adjusted[0]) => number): string => {
    const parts: string[] = [];

    for (let i = 0; i < adjusted.length; i++) {
      const kf = adjusted[i];
      const next = adjusted[i + 1];
      const val = getter(kf).toFixed(4);

      if (!next) {
        // Last keyframe: hold
        parts.push(`if(gte(t,${kf.tSec.toFixed(3)}),${val}`);
      } else {
        const holdEnd = next.tSec - next.transSec;
        const transStart = Math.max(kf.tSec, holdEnd);
        const transEnd = next.tSec;

        // Hold at current value
        parts.push(`if(between(t,${kf.tSec.toFixed(3)},${transStart.toFixed(3)}),${val}`);

        // Smooth transition to next value
        if (transEnd > transStart) {
          const nextVal = getter(next).toFixed(4);
          // p = smoothstep: 3*p^2 - 2*p^3 where p = (t-start)/(end-start)
          const dur = (transEnd - transStart).toFixed(3);
          const raw = `clip((t-${transStart.toFixed(3)})/${dur},0,1)`;
          // smoothstep(p) = p*p*(3-2*p)
          const p = `(${raw})*(${raw})*(3-2*(${raw}))`;
          parts.push(
            `if(between(t,${transStart.toFixed(3)},${transEnd.toFixed(3)}),${val}+${p}*(${nextVal}-${val})`,
          );
        }
      }
    }

    const closers = ")".repeat(parts.length);
    const defaultVal = getter(adjusted[0]).toFixed(4);
    return parts.join(",") + `,${defaultVal}${closers}`;
  };

  const scaleExpr = buildExpr((k) => k.scale);
  const cxExpr = buildExpr((k) => k.centerX);
  const cyExpr = buildExpr((k) => k.centerY);

  // crop filter: crop to (w/scale, h/scale) centered at (cx*w, cy*h), then scale back
  // Using intermediate variables via sendcmd is too complex; instead embed directly
  const cropW = `${width}/(${scaleExpr})`;
  const cropH = `${height}/(${scaleExpr})`;
  const cropX = `clip((${cxExpr})*${width}-${width}/(${scaleExpr})/2,0,${width}-${width}/(${scaleExpr}))`;
  const cropY = `clip((${cyExpr})*${height}-${height}/(${scaleExpr})/2,0,${height}-${height}/(${scaleExpr}))`;

  const filter = `crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}':exact=1,scale=${width}:${height}:flags=lanczos`;

  await execFileAsync("ffmpeg", [
    "-i", inputPath,
    "-vf", filter,
    "-c:v", "libx264",
    "-preset", preset,
    "-crf", String(crf),
    "-pix_fmt", "yuv420p",
    "-an",
    "-y",
    outputPath,
  ]);
};

const applyVisualPolish = async (
  inputPath: string,
  outputPath: string,
  fps: number,
  width: number,
  height: number,
): Promise<void> => {
  // Ensure consistent output format; no zoompan (it's designed for images, not video)
  await execFileAsync("ffmpeg", [
    "-i", inputPath,
    "-vf", `scale=${width}:${height}:flags=lanczos,fps=${fps}`,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-an",
    "-y",
    outputPath,
  ]);
};

const applyZoomPan = async (
  inputPath: string,
  outputPath: string,
  keyframes: ZoomKeyframe[],
  speedSegments: SpeedSegment[],
  fps: number,
  inputWidth: number,
  inputHeight: number,
  outputWidth: number,
  outputHeight: number,
  totalDurationMs: number,
): Promise<void> => {
  // Adjust keyframe timings for speed ramps
  const adjustedKeyframes = keyframes.map((kf) => ({
    ...kf,
    atMs: rawTimeToOutputTime(kf.atMs, speedSegments),
    transitionMs: kf.transitionMs,
  }));

  // For zoom to work well, we upscale the input first then crop
  const upscaleWidth = outputWidth * 2;
  const upscaleHeight = outputHeight * 2;

  const zoompanFilter = buildZoompanExpression(
    adjustedKeyframes,
    fps,
    totalDurationMs,
    upscaleWidth,
    upscaleHeight,
    outputWidth,
    outputHeight,
  );

  await execFileAsync("ffmpeg", [
    "-i", inputPath,
    "-vf",
    `scale=${upscaleWidth}:${upscaleHeight}:flags=lanczos,${zoompanFilter}`,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-an",
    "-y",
    outputPath,
  ]);
};

const concatVideos = async (
  inputs: string[],
  outputPath: string,
): Promise<void> => {
  if (inputs.length === 1) {
    await execFileAsync("ffmpeg", ["-i", inputs[0], "-c", "copy", "-y", outputPath]);
    return;
  }

  // Use filter_complex concat for reliable merging (handles different codecs/sizes)
  const inputArgs = inputs.flatMap((p) => ["-i", resolve(p)]);
  const filterParts = inputs.map((_, i) => `[${i}:v]`).join("");
  const filter = `${filterParts}concat=n=${inputs.length}:v=1:a=0[outv]`;

  await execFileAsync("ffmpeg", [
    ...inputArgs,
    "-filter_complex", filter,
    "-map", "[outv]",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-y",
    outputPath,
  ]);
};

const mixAudio = async (
  videoPath: string,
  outputPath: string,
  voiceLines: VoiceLine[],
  sceneMarkers: SceneMarker[],
  speedSegments: SpeedSegment[],
  interactions: CaptureInteraction[],
  bgm: ComposeOptions["bgm"],
  introOffsetSec: number,
): Promise<void> => {
  const narrationTracks = buildNarrationTracks(voiceLines, sceneMarkers, speedSegments, interactions);

  // Offset narration by intro duration
  const adjustedTracks = narrationTracks.map((t) => ({
    ...t,
    startSec: t.startSec + introOffsetSec,
  }));

  if (adjustedTracks.length === 0 && !bgm) {
    await execFileAsync("ffmpeg", ["-i", videoPath, "-c", "copy", "-y", outputPath]);
    return;
  }

  // Strategy: use a silent audio base matching the video duration, then overlay
  // each narration track at the correct time. This avoids amix quirks.
  const inputs: string[] = ["-i", videoPath];
  const filterParts: string[] = [];
  let streamIdx = 1;

  // Generate a silent base audio from the video duration
  // (anullsrc generates silence; we trim it to video length via -shortest)
  filterParts.push(`anullsrc=r=44100:cl=stereo[silence]`);

  // Add narration audio inputs with precise adelay
  const overlayLabels: string[] = ["[silence]"];
  for (const track of adjustedTracks) {
    inputs.push("-i", track.path);
    const delayMs = Math.round(track.startSec * 1000);
    // adelay: delay in ms for left|right channels; pad to fill with silence after
    filterParts.push(
      `[${streamIdx}]aresample=44100,adelay=${delayMs}|${delayMs}:all=1,apad[narr${streamIdx}]`,
    );
    overlayLabels.push(`[narr${streamIdx}]`);
    streamIdx++;
  }

  // Add BGM
  if (bgm) {
    inputs.push("-i", bgm.path);
    const vol = bgm.volume ?? 0.16;
    filterParts.push(
      `[${streamIdx}]aresample=44100,volume=${vol.toFixed(2)},aloop=loop=-1:size=2e+09,apad[bgm]`,
    );
    overlayLabels.push("[bgm]");
    streamIdx++;
  }

  // Mix: amix with normalize=0 prevents volume dropping with fewer inputs
  filterParts.push(
    `${overlayLabels.join("")}amix=inputs=${overlayLabels.length}:duration=first:normalize=0[aout]`,
  );

  const filterComplex = filterParts.join(";");

  await execFileAsync("ffmpeg", [
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-y",
    outputPath,
  ]);
};
