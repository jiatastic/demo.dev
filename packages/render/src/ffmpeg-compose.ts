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
const FFMPEG_TIMEOUT_MS = Number(process.env.DEMO_FFMPEG_TIMEOUT_MS ?? 300_000);
const FFMPEG_MAX_BUFFER = 1024 * 1024 * 64;
const ffmpegProgress = (msg: string) => {
  if (process.env.DEMO_FFMPEG_QUIET === "1") return;
  process.stderr.write(`[ffmpeg] ${msg}\n`);
};
import { access, writeFile, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import type { CaptureInteraction, ContinuousCaptureResult, SceneMarker } from "@demo-dev/browser";
import type {
  MotionOverlayCue,
  VisualPlanResult,
  ZoomKeyframe,
  SpeedSegment,
} from "./visual-plan.js";
import type { VoiceLine } from "@demo-dev/types";
import { applyBrowserFrame, getChromeHeight, type BrowserFrameOptions } from "./browser-frame.js";
import { getMediaDurationMs } from "@demo-dev/core";

const execFileAsync = promisify(execFile);

/** Wrap every ffmpeg invocation with a timeout + size cap so a stuck filter graph cannot deadlock the pipeline. */
const runFfmpeg = async (args: string[], opts: { timeoutMs?: number; label?: string } = {}): Promise<{ stdout: string; stderr: string }> => {
  const timeoutMs = opts.timeoutMs ?? FFMPEG_TIMEOUT_MS;
  // Prefer the output path (last media-like arg after `-y`) over the input path.
  const mediaArgs = args.filter((a) => a.endsWith(".mp4") || a.endsWith(".png") || a.endsWith(".webm"));
  const label = opts.label ?? mediaArgs[mediaArgs.length - 1] ?? "ffmpeg";
  const startedAt = Date.now();
  ffmpegProgress(`start ${label} timeout=${timeoutMs}ms`);
  try {
    const result = await execFileAsync("ffmpeg", args, { timeout: timeoutMs, maxBuffer: FFMPEG_MAX_BUFFER });
    ffmpegProgress(`done ${label} ${(Date.now() - startedAt)}ms`);
    return result;
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    ffmpegProgress(`FAIL ${label} ${elapsed}ms ${message.split("\n")[0]}`);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VideoQuality = "draft" | "standard" | "high";

const QUALITY_PRESETS: Record<VideoQuality, { crf: number; preset: string; fps: number; viewport?: { width: number; height: number } }> = {
  draft:    { crf: 28, preset: "ultrafast", fps: 24 },
  standard: { crf: 18, preset: "fast",      fps: 30 },
  high:     { crf: 12, preset: "slow",      fps: 30, viewport: { width: 2560, height: 1440 } },
};

export const getQualityViewport = (quality?: VideoQuality) => {
  return QUALITY_PRESETS[quality ?? "standard"].viewport;
};

export const listVideoQualities = (): Array<{ name: VideoQuality; crf: number; preset: string; fps: number }> =>
  (Object.entries(QUALITY_PRESETS) as Array<[VideoQuality, (typeof QUALITY_PRESETS)[VideoQuality]]>).map(([name, p]) => ({
    name,
    crf: p.crf,
    preset: p.preset,
    fps: p.fps,
  }));

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

const generateTitleCard = async (
  title: string,
  outputPath: string,
  width: number,
  height: number,
  durationSec: number,
  fps: number,
): Promise<void> => {
  await mkdir(dirname(outputPath), { recursive: true });

  const pngPath = join(dirname(outputPath), "intro-card.png");
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; width: ${width}px; height: ${height}px; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Helvetica Neue", Arial, sans-serif;
    color: white;
    background:
      radial-gradient(circle at 18% 18%, rgba(45,212,191,.42), transparent 34%),
      radial-gradient(circle at 82% 22%, rgba(99,102,241,.38), transparent 32%),
      linear-gradient(135deg, #111827 0%, #0f766e 100%);
  }
  .noise { position: absolute; inset: 0; opacity: .18; background-image: linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px); background-size: 48px 48px; mask-image: radial-gradient(circle at 50% 35%, black, transparent 72%); }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 96px; text-align: center; }
  .eyebrow { font-size: 20px; letter-spacing: .18em; text-transform: uppercase; color: rgba(255,255,255,.72); margin-bottom: 22px; font-weight: 700; }
  h1 { margin: 0; max-width: ${Math.round(width * 0.74)}px; font-size: ${Math.max(56, Math.round(width / 16))}px; line-height: .96; letter-spacing: -.06em; font-weight: 800; text-wrap: balance; text-shadow: 0 18px 60px rgba(0,0,0,.32); }
  .sub { margin-top: 26px; font-size: 24px; line-height: 1.35; color: rgba(255,255,255,.76); }
</style></head>
<body><div class="noise"></div><main class="wrap"><div><div class="eyebrow">demo.dev showcase</div><h1>${escapeHtml(title)}</h1><div class="sub">Generated from a browser workflow, then directed and rendered automatically.</div></div></main></body></html>`);
    await page.screenshot({ path: pngPath });
    await browser.close();
    await runFfmpeg([
      "-loop", "1",
      "-framerate", String(fps),
      "-i", pngPath,
      "-t", String(durationSec),
      "-r", String(fps),
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-y",
      outputPath,
    ], { label: "intro-card" });
  } catch {
    await runFfmpeg([
      "-f", "lavfi",
      "-i", `color=c=0x111827:s=${width}x${height}:d=${durationSec}:r=${fps}`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-y",
      outputPath,
    ]);
  }
};

const escapeFFmpegText = (text: string): string =>
  text.replace(/'/g, "'\\''").replace(/:/g, "\\:").replace(/\\/g, "\\\\");

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

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

const cueProgress = (tMs: number, cue: MotionOverlayCue): number => {
  const start = cue.atMs;
  const end = cue.atMs + cue.durationMs;
  const fade = Math.min(420, cue.durationMs / 3);
  if (tMs < start || tMs > end) return 0;
  if (tMs < start + fade) return (tMs - start) / fade;
  if (tMs > end - fade) return (end - tMs) / fade;
  return 1;
};

const applyMotionOverlays = async (
  inputPath: string,
  outputPath: string,
  cues: MotionOverlayCue[] | undefined,
  speedSegments: SpeedSegment[],
  options: {
    width: number;
    height: number;
    contentWidth: number;
    contentHeight: number;
    contentOffsetX: number;
    contentOffsetY: number;
    fps: number;
    crf: number;
    preset: string;
  },
): Promise<void> => {
  if (!cues?.length) {
    await runFfmpeg(["-i", inputPath, "-c", "copy", "-y", outputPath], { label: "motion-overlays-skip" });
    return;
  }

  const durationMs = await getMediaDurationMs(inputPath).catch(() => 0);
  if (!durationMs || durationMs < 500) {
    await runFfmpeg(["-i", inputPath, "-c", "copy", "-y", outputPath], { label: "motion-overlays-empty" });
    return;
  }

  const tempDir = join(dirname(outputPath), ".overlay-frames");
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(tempDir, { recursive: true });

  // HTML motion overlays are rendered as an alpha PNG sequence. Keep the overlay
  // layer intentionally lower-FPS than the screen capture so render time remains
  // practical in CI. Override with DEMO_OVERLAY_FPS for local/high-end renders.
  const overlayFps = Number(process.env.DEMO_OVERLAY_FPS ?? (durationMs > 20_000 ? 6 : 10));
  const frameCount = Math.ceil((durationMs / 1000) * overlayFps);
  const mappedCues = cues.map((cue) => ({
    ...cue,
    atMs: rawTimeToOutputTime(cue.atMs, speedSegments),
  }));

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html><html><head><style>
    html, body { margin:0; width:${options.width}px; height:${options.height}px; background:transparent; overflow:hidden; }
    body { font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",Inter,"Helvetica Neue",Arial,sans-serif; -webkit-font-smoothing:antialiased; }
    #root { position:relative; width:100%; height:100%; }
    .caption { position:absolute; left:50%; bottom:54px; transform:translateX(-50%); max-width:70%; padding:14px 22px; border-radius:999px; color:#fff; font-size:28px; font-weight:760; letter-spacing:-.03em; background:rgba(17,24,39,.72); border:1px solid rgba(255,255,255,.16); box-shadow:0 24px 70px rgba(0,0,0,.28); backdrop-filter:blur(18px) saturate(1.35); }
    .caption.success { background:rgba(5,150,105,.78); }
    .badge { position:absolute; right:64px; bottom:64px; padding:18px 22px; border-radius:22px; color:#fff; background:linear-gradient(135deg,rgba(16,185,129,.92),rgba(20,184,166,.82)); border:1px solid rgba(255,255,255,.22); box-shadow:0 30px 90px rgba(5,150,105,.38); }
    .badge .t { font-size:26px; font-weight:800; letter-spacing:-.04em; }
    .badge .s { margin-top:5px; font-size:15px; opacity:.82; }
    .callout { position:absolute; padding:10px 14px; border-radius:14px; color:#111827; font-size:15px; font-weight:780; letter-spacing:-.02em; background:rgba(255,255,255,.92); border:1px solid rgba(15,23,42,.10); box-shadow:0 18px 50px rgba(0,0,0,.20); }
    .callout:after { content:""; position:absolute; width:12px; height:12px; background:rgba(255,255,255,.92); transform:rotate(45deg); left:18px; bottom:-6px; border-right:1px solid rgba(15,23,42,.10); border-bottom:1px solid rgba(15,23,42,.10); }
    .spotlight { position:absolute; border-radius:14px; border:3px solid rgba(251,191,36,.96); box-shadow:0 0 0 9999px rgba(15,23,42,.12), 0 0 0 8px rgba(251,191,36,.18), 0 18px 70px rgba(251,191,36,.25); }
  </style></head><body><div id="root"></div></body></html>`);

  const toPx = (cue: MotionOverlayCue) => {
    const cx = options.contentOffsetX + (cue.x ?? 0.5) * options.contentWidth;
    const cy = options.contentOffsetY + (cue.y ?? 0.5) * options.contentHeight;
    const w = Math.max(36, (cue.width ?? 0.1) * options.contentWidth);
    const h = Math.max(28, (cue.height ?? 0.06) * options.contentHeight);
    return { cx, cy, w, h };
  };

  for (let i = 0; i < frameCount; i++) {
    const tMs = (i / overlayFps) * 1000;
    const active = mappedCues
      .map((cue) => ({ cue, p: cueProgress(tMs, cue) }))
      .filter((item) => item.p > 0.001);

    const html = active.map(({ cue, p }) => {
      const eased = 1 - Math.pow(1 - p, 3);
      const opacity = Math.max(0, Math.min(1, eased));
      const yLift = Math.round((1 - eased) * 18);
      const scale = (0.965 + eased * 0.035).toFixed(3);
      const toneClass = cue.tone === "success" ? " success" : "";
      if (cue.type === "caption") {
        return `<div class="caption${toneClass}" style="opacity:${opacity}; transform:translate(-50%, ${yLift}px) scale(${scale});">${escapeHtml(cue.text)}</div>`;
      }
      if (cue.type === "badge") {
        return `<div class="badge" style="opacity:${opacity}; transform:translateY(${yLift}px) scale(${scale});"><div class="t">${escapeHtml(cue.text)}</div>${cue.subtext ? `<div class="s">${escapeHtml(cue.subtext)}</div>` : ""}</div>`;
      }
      const box = toPx(cue);
      if (cue.type === "spotlight") {
        return `<div class="spotlight" style="opacity:${opacity}; left:${box.cx - box.w / 2 - 10}px; top:${box.cy - box.h / 2 - 8}px; width:${box.w + 20}px; height:${box.h + 16}px; transform:scale(${scale});"></div>`;
      }
      const left = Math.min(options.width - 260, Math.max(36, box.cx - 22));
      const top = Math.max(36, box.cy - box.h / 2 - 62);
      return `<div class="callout" style="opacity:${opacity}; left:${left}px; top:${top + yLift}px; transform:scale(${scale});">${escapeHtml(cue.text)}</div>`;
    }).join("");

    await page.evaluate((content) => {
      const root = document.getElementById("root");
      if (root) root.innerHTML = content;
    }, html);
    await page.screenshot({ path: join(tempDir, `frame-${String(i).padStart(5, "0")}.png`), omitBackground: true });
  }
  await browser.close().catch(() => undefined);

  await runFfmpeg([
    "-i", inputPath,
    "-framerate", String(overlayFps),
    "-i", join(tempDir, "frame-%05d.png"),
    "-filter_complex", `[1:v]fps=${options.fps},format=rgba[ov];[0:v][ov]overlay=0:0:shortest=1[out]`,
    "-map", "[out]",
    "-c:v", "libx264",
    "-preset", options.preset,
    "-crf", String(options.crf),
    "-pix_fmt", "yuv420p",
    "-an",
    "-y",
    outputPath,
  ], { label: "motion-overlays" });
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

  // Step 2: Apply post-production camera zoom/pan from the director plan.
  // Keeping raw capture clean and moving the camera in post produces a much more
  // controllable Screen Studio-style result than mutating the DOM during capture.
  const zoomedPath = join(tempDir, "zoomed.mp4");
  try {
    await applyVideoZoom(
      speedAdjustedPath,
      zoomedPath,
      options.visualPlan.zoomKeyframes,
      options.visualPlan.speedSegments,
      fps,
      width,
      height,
      q.crf,
      q.preset,
    );
  } catch (error) {
    console.warn("post-production zoom failed, continuing without zoom", error);
    await runFfmpeg(["-i", speedAdjustedPath, "-c", "copy", "-y", zoomedPath]);
  }

  // Step 3: Optional browser frame (Screen Studio style)
  let mainVideoPath = zoomedPath;
  let finalWidth = width;
  let finalHeight = height;
  let contentOffsetX = 0;
  let contentOffsetY = 0;

  if (options.frame) {
    const frameOpts: BrowserFrameOptions = options.frame === true ? {} : options.frame;
    // Infer display URL from the first scene marker
    if (!frameOpts.displayUrl && options.capture.sceneMarkers[0]) {
      try {
        frameOpts.displayUrl = new URL(options.capture.sceneMarkers[0].url).host;
      } catch { /* keep default */ }
    }
    const framedPath = join(tempDir, "framed.mp4");
    try {
      const { outputWidth, outputHeight } = await applyBrowserFrame(
        zoomedPath, framedPath, width, height, frameOpts, q.crf, q.preset,
      );
      mainVideoPath = framedPath;
      finalWidth = outputWidth;
      finalHeight = outputHeight;
      contentOffsetX = frameOpts.padding ?? 64;
      contentOffsetY = contentOffsetX + getChromeHeight(frameOpts.chrome ?? "macos");
    } catch (error) {
      console.warn("browser frame composition failed, continuing without frame", error);
    }
  }

  // Step 4: Premium motion overlays (captions, callouts, spotlights) after framing.
  const overlayedPath = join(tempDir, "motion-overlays.mp4");
  try {
    await applyMotionOverlays(
      mainVideoPath,
      overlayedPath,
      options.visualPlan.premium?.overlays,
      options.visualPlan.speedSegments,
      {
        width: finalWidth,
        height: finalHeight,
        contentWidth: width,
        contentHeight: height,
        contentOffsetX,
        contentOffsetY,
        fps,
        crf: q.crf,
        preset: q.preset,
      },
    );
    mainVideoPath = overlayedPath;
  } catch (error) {
    console.warn("motion overlays failed, continuing without overlays", error);
  }

  // Step 5: Generate intro if title provided
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
    await runFfmpeg( [
      "-i", concatPath,
      "-c", "copy",
      "-y",
      options.outputPath,
    ]);
  }

  // Step 6: Generate SRT captions alongside the video
  if (options.voiceLines?.length) {
    const srtPath = options.outputPath.replace(/\.mp4$/i, ".srt");
    await generateSrt(
      options.voiceLines,
      options.capture.sceneMarkers,
      options.visualPlan.speedSegments,
      options.capture.interactions,
      introPath ? 2.0 : 0,
      srtPath,
    );
  }

  return options.outputPath;
};

// ---------------------------------------------------------------------------
// SRT caption generation
// ---------------------------------------------------------------------------

const formatSrtTime = (ms: number): string => {
  const totalSec = Math.max(0, ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  const msRem = Math.round(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(msRem).padStart(3, "0")}`;
};

const generateSrt = async (
  voiceLines: VoiceLine[],
  sceneMarkers: SceneMarker[],
  speedSegments: SpeedSegment[],
  interactions: CaptureInteraction[],
  introOffsetSec: number,
  outputPath: string,
): Promise<void> => {
  const tracks = buildNarrationTracks(voiceLines, sceneMarkers, speedSegments, interactions);
  const lines: string[] = [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const voice = voiceLines.find((v) => v.audioPath === track.path);
    if (!voice?.text) continue;

    const startMs = (track.startSec + introOffsetSec) * 1000;
    const endMs = startMs + (voice.audioDurationMs ?? voice.estimatedMs ?? 5000);

    lines.push(String(i + 1));
    lines.push(`${formatSrtTime(startMs)} --> ${formatSrtTime(endMs)}`);
    lines.push(voice.text);
    lines.push("");
  }

  await writeFile(outputPath, lines.join("\n"), "utf-8");
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
  const fitFilter = `scale=${width}:${height}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0f1115,fps=${fps}`;

  if (allNormal || segments.length <= 1) {
    await runFfmpeg( [
      "-i", inputPath,
      "-vf", fitFilter,
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

    await runFfmpeg( [
      "-ss", startSec,
      "-t", durationSec,
      "-i", inputPath,
      "-vf", `${fitFilter},setpts=${ptsExpr}`,
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

  await runFfmpeg( [
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
    await runFfmpeg( ["-i", inputPath, "-c", "copy", "-y", outputPath]);
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

  await runFfmpeg( [
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
  await runFfmpeg( [
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

  await runFfmpeg( [
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
    await runFfmpeg( ["-i", inputs[0], "-c", "copy", "-y", outputPath]);
    return;
  }

  // Use filter_complex concat for reliable merging (handles different codecs/sizes)
  const inputArgs = inputs.flatMap((p) => ["-i", resolve(p)]);
  const filterParts = inputs.map((_, i) => `[${i}:v]`).join("");
  const filter = `${filterParts}concat=n=${inputs.length}:v=1:a=0[outv]`;

  await runFfmpeg( [
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
    await runFfmpeg( ["-i", videoPath, "-c", "copy", "-y", outputPath]);
    return;
  }

  // Strategy: use a silent audio base matching the video duration, then overlay
  // each narration track at the correct time. This avoids amix quirks.
  const inputs: string[] = ["-i", videoPath];
  const filterParts: string[] = [];
  let streamIdx = 1;
  const videoDurationMs = await getMediaDurationMs(videoPath);
  const videoDurationSec = Math.max(0.1, (videoDurationMs ?? 1000) / 1000);

  // Use a finite silent base. An infinite anullsrc can make amix hang on some FFmpeg builds.
  filterParts.push(
    `anullsrc=r=44100:cl=stereo,atrim=0:${videoDurationSec.toFixed(3)},asetpts=PTS-STARTPTS[silence]`,
  );

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

  await runFfmpeg( [
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
