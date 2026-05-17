/**
 * Screen Studio–style browser frame compositing.
 *
 * Renders a polished window-on-background PNG (via Playwright/Chromium) and
 * overlays the recording on top with FFmpeg. Supports custom background images
 * or presets, multiple chrome styles, multi-layered shadows, and configurable
 * window radius.
 */

import { execFile } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { fileToDataUri } from "@demo-dev/core";

const execFileAsync = promisify(execFile);

const FFMPEG_TIMEOUT_MS = Number(process.env.DEMO_FFMPEG_TIMEOUT_MS ?? 300_000);
const FRAME_RENDER_TIMEOUT_MS = Number(process.env.DEMO_FRAME_RENDER_TIMEOUT_MS ?? 30_000);

const ffmpegLog = (msg: string) => {
  if (process.env.DEMO_FFMPEG_QUIET === "1") return;
  process.stderr.write(`[ffmpeg] ${msg}\n`);
};

const runFfmpeg = async (args: string[], label: string) => {
  const startedAt = Date.now();
  ffmpegLog(`start ${label} timeout=${FFMPEG_TIMEOUT_MS}ms`);
  try {
    const result = await execFileAsync("ffmpeg", args, {
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 64,
    });
    ffmpegLog(`done ${label} ${Date.now() - startedAt}ms`);
    return result;
  } catch (error) {
    ffmpegLog(`FAIL ${label} ${Date.now() - startedAt}ms`);
    throw error;
  }
};

const withDeadline = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms hard deadline`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ChromeStyle = "macos" | "minimal" | "none";
export type ShadowLevel = "none" | "soft" | "medium" | "strong";
export type BackgroundPresetName =
  | "sunset"
  | "ocean"
  | "forest"
  | "mesh-purple"
  | "mesh-pink"
  | "aurora-pro"
  | "midnight"
  | "paper";

export interface BrowserFrameOptions {
  /** Chrome style. Default "macos". */
  chrome?: ChromeStyle;
  /** Window corner radius in pixels. Default 14. */
  windowRadius?: number;
  /** Shadow intensity. Default "medium". */
  shadow?: ShadowLevel;
  /** Padding around the window in pixels. Default 64. */
  padding?: number;
  /** URL label shown in the address bar (chrome=macos only). Inferred from capture if unset. */
  displayUrl?: string;

  /** Path to a background image file. Takes precedence over preset/color/gradient. */
  backgroundImage?: string;
  /** Solid background color. Used if backgroundImage and preset are absent. */
  backgroundColor?: string;
  /** Built-in background preset name. */
  backgroundPreset?: BackgroundPresetName;
  /** Legacy gradient endpoints — kept for back-compat. */
  gradientFrom?: string;
  gradientTo?: string;
}

const DEFAULTS = {
  chrome: "macos" as ChromeStyle,
  windowRadius: 14,
  shadow: "medium" as ShadowLevel,
  padding: 64,
};

export const getChromeHeight = (chrome: ChromeStyle): number => {
  switch (chrome) {
    case "macos": return 52;
    case "minimal": return 32;
    case "none": return 0;
  }
};

// ---------------------------------------------------------------------------
// CSS builders
// ---------------------------------------------------------------------------

const BACKGROUND_PRESETS: Record<BackgroundPresetName, string> = {
  sunset: "linear-gradient(135deg, #ff6b6b 0%, #feca57 50%, #ff9ff3 100%)",
  ocean: "linear-gradient(135deg, #0c3483 0%, #6b8cff 50%, #00d2ff 100%)",
  forest: "linear-gradient(135deg, #134e5e 0%, #71b280 100%)",
  "mesh-purple": [
    "radial-gradient(circle at 20% 30%, rgba(196,113,245,0.85) 0%, transparent 50%)",
    "radial-gradient(circle at 80% 70%, rgba(250,113,205,0.85) 0%, transparent 50%)",
    "linear-gradient(135deg, #4a00e0 0%, #2d033b 100%)",
  ].join(", "),
  "mesh-pink": [
    "radial-gradient(circle at 15% 50%, rgba(255,154,158,0.85) 0%, transparent 50%)",
    "radial-gradient(circle at 85% 30%, rgba(250,208,196,0.85) 0%, transparent 50%)",
    "linear-gradient(135deg, #ff6b6b 0%, #ee0979 100%)",
  ].join(", "),
  "aurora-pro": [
    "radial-gradient(circle at 18% 18%, rgba(45,212,191,0.58) 0%, transparent 34%)",
    "radial-gradient(circle at 78% 20%, rgba(129,140,248,0.62) 0%, transparent 33%)",
    "radial-gradient(circle at 50% 88%, rgba(168,85,247,0.54) 0%, transparent 38%)",
    "linear-gradient(135deg, #06121f 0%, #0f172a 52%, #1e1b4b 100%)",
  ].join(", "),
  midnight: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
  paper: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
};

const SHADOW_CSS: Record<ShadowLevel, string> = {
  none: "none",
  soft: "0 8px 24px rgba(0,0,0,0.18)",
  medium: "0 30px 60px rgba(0,0,0,0.28), 0 10px 20px rgba(0,0,0,0.18), 0 3px 6px rgba(0,0,0,0.12)",
  strong: "0 56px 120px rgba(0,0,0,0.34), 0 24px 54px rgba(0,0,0,0.22), 0 8px 18px rgba(0,0,0,0.16)",
};

const buildBackgroundCss = async (options: BrowserFrameOptions): Promise<string> => {
  if (options.backgroundImage) {
    const dataUri = await fileToDataUri(options.backgroundImage);
    return `url('${dataUri}') center/cover no-repeat, #000`;
  }
  if (options.backgroundPreset && BACKGROUND_PRESETS[options.backgroundPreset]) {
    return BACKGROUND_PRESETS[options.backgroundPreset];
  }
  if (options.backgroundColor) {
    return options.backgroundColor;
  }
  if (options.gradientFrom || options.gradientTo) {
    return `linear-gradient(135deg, ${options.gradientFrom ?? "#f97316"} 0%, ${options.gradientTo ?? "#a855f7"} 100%)`;
  }
  return BACKGROUND_PRESETS["aurora-pro"];
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const buildChromeHtml = (chrome: ChromeStyle, displayUrl: string): string => {
  if (chrome === "none") return "";
  if (chrome === "minimal") {
    return `
      <div class="chrome chrome-minimal">
        <div class="traffic-lights">
          <span class="dot dot-red"></span>
          <span class="dot dot-yellow"></span>
          <span class="dot dot-green"></span>
        </div>
      </div>`;
  }
  return `
    <div class="chrome chrome-macos">
      <div class="traffic-lights">
        <span class="dot dot-red"></span>
        <span class="dot dot-yellow"></span>
        <span class="dot dot-green"></span>
      </div>
      <div class="url-bar">
        <span class="lock">&#x1f512;</span>
        <span class="url-text">${escapeHtml(displayUrl)}</span>
      </div>
      <div class="chrome-right"></div>
    </div>`;
};

// ---------------------------------------------------------------------------
// Frame template renderer
// ---------------------------------------------------------------------------

const renderFrameTemplate = async (
  outputPath: string,
  contentWidth: number,
  contentHeight: number,
  options: BrowserFrameOptions,
): Promise<{ canvasWidth: number; canvasHeight: number; contentOffsetX: number; contentOffsetY: number }> => {
  const chrome = options.chrome ?? DEFAULTS.chrome;
  const padding = options.padding ?? DEFAULTS.padding;
  const radius = options.windowRadius ?? DEFAULTS.windowRadius;
  const shadow = SHADOW_CSS[options.shadow ?? DEFAULTS.shadow];
  const chromeHeight = getChromeHeight(chrome);
  const displayUrl = options.displayUrl ?? "app.example.com";
  const backgroundCss = await buildBackgroundCss(options);

  const windowWidth = contentWidth;
  const windowHeight = contentHeight + chromeHeight;
  const canvasWidth = windowWidth + padding * 2;
  const canvasHeight = windowHeight + padding * 2;
  const contentOffsetX = padding;
  const contentOffsetY = padding + chromeHeight;

  const chromeHtml = buildChromeHtml(chrome, displayUrl);

  const html = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${canvasWidth}px; height: ${canvasHeight}px; }
  body {
    background: ${backgroundCss};
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Helvetica Neue", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  body::before {
    content: ""; position: fixed; inset: 0; pointer-events: none;
    background-image: linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px);
    background-size: 42px 42px;
    mask-image: radial-gradient(circle at 50% 42%, rgba(0,0,0,.72), transparent 76%);
    opacity: .08;
  }
  body::after {
    content: ""; position: fixed; inset: 0; pointer-events: none;
    background: radial-gradient(circle at 50% 42%, transparent 46%, rgba(0,0,0,.18) 100%);
  }
  .window {
    width: ${windowWidth}px; height: ${windowHeight}px;
    border-radius: ${radius}px;
    overflow: hidden;
    background: #fff;
    border: 1px solid rgba(255,255,255,.34);
    box-shadow: ${shadow};
    position: relative;
  }
  .window::before { content:""; position:absolute; inset:0; pointer-events:none; border-radius:${radius}px; box-shadow: inset 0 1px 0 rgba(255,255,255,.55), inset 0 0 0 1px rgba(0,0,0,.04); z-index: 2; }
  .chrome {
    display: flex; align-items: center;
    background: linear-gradient(180deg, rgba(250,250,249,.96) 0%, rgba(226,225,222,.94) 100%);
    border-bottom: 1px solid rgba(0,0,0,0.08);
    padding: 0 14px;
    backdrop-filter: blur(18px) saturate(1.25);
    position: relative; z-index: 3;
  }
  .chrome-macos { height: 52px; }
  .chrome-minimal { height: 32px; padding: 0 12px; }
  .traffic-lights { display: flex; gap: 8px; }
  .chrome-minimal .traffic-lights { gap: 7px; }
  .dot {
    width: 12px; height: 12px; border-radius: 50%;
    box-shadow: inset 0 -1px 0 rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.35);
  }
  .chrome-minimal .dot { width: 10px; height: 10px; }
  .dot-red    { background: #ff5f57; }
  .dot-yellow { background: #febc2e; }
  .dot-green  { background: #28c840; }
  .url-bar {
    flex: 1;
    height: 30px;
    margin: 0 14px;
    border-radius: 7px;
    background: rgba(255,255,255,0.85);
    border: 1px solid rgba(0,0,0,0.08);
    display: flex; align-items: center; justify-content: center;
    padding: 0 12px;
    font-size: 13px; color: #4a4a4a;
    gap: 6px;
    overflow: hidden;
  }
  .url-bar .lock { font-size: 11px; color: #6e6e6e; }
  .url-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chrome-right { width: 56px; }
  .content { width: ${contentWidth}px; height: ${contentHeight}px; background: #fff; }
</style></head><body>
  <div class="window">${chromeHtml}<div class="content"></div></div>
</body></html>`;

  await mkdir(dirname(outputPath), { recursive: true });

  await withDeadline(
    (async () => {
      const browser = await chromium.launch({ headless: true, timeout: 15000 });
      try {
        const page = await browser.newPage({ viewport: { width: canvasWidth, height: canvasHeight } });
        await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.screenshot({ path: outputPath, omitBackground: false, timeout: 15000 });
      } finally {
        await browser.close().catch(() => undefined);
      }
    })(),
    FRAME_RENDER_TIMEOUT_MS,
    "renderFrameTemplate",
  );

  return { canvasWidth, canvasHeight, contentOffsetX, contentOffsetY };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const applyBrowserFrame = async (
  inputPath: string,
  outputPath: string,
  contentWidth: number,
  contentHeight: number,
  options: BrowserFrameOptions,
  crf: number,
  preset: string,
): Promise<{ outputWidth: number; outputHeight: number }> => {
  const tempDir = join(dirname(outputPath), ".frame-temp");
  await mkdir(tempDir, { recursive: true });

  const framePngPath = join(tempDir, "browser-frame.png");
  const { canvasWidth, canvasHeight, contentOffsetX, contentOffsetY } = await renderFrameTemplate(
    framePngPath,
    contentWidth,
    contentHeight,
    options,
  );

  await runFfmpeg(
    [
      "-i", inputPath,
      "-i", framePngPath,
      "-filter_complex",
      `[0:v]scale=${contentWidth}:${contentHeight}:flags=lanczos[vid];` +
      `[1:v]loop=loop=-1:size=1:start=0,setpts=N/FRAME_RATE/TB[frame];` +
      `[frame][vid]overlay=${contentOffsetX}:${contentOffsetY}:shortest=1[out]`,
      "-map", "[out]",
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-pix_fmt", "yuv420p",
      "-an",
      "-y",
      outputPath,
    ],
    "frame-overlay",
  );

  return { outputWidth: canvasWidth, outputHeight: canvasHeight };
};

export const listBackgroundPresets = (): BackgroundPresetName[] =>
  Object.keys(BACKGROUND_PRESETS) as BackgroundPresetName[];

export const listChromeStyles = (): ChromeStyle[] => ["macos", "minimal", "none"];
export const listShadowLevels = (): ShadowLevel[] => ["none", "soft", "medium", "strong"];
