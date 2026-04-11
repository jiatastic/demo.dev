/**
 * Screen Studio–style browser frame compositing.
 *
 * Wraps raw screen recordings in a macOS browser window shell with:
 *   - Gradient background (configurable colors)
 *   - macOS-style browser chrome (traffic lights, URL bar)
 *   - Rounded corners + drop shadow
 *   - Padding/margin around the window
 *
 * Implemented as an FFmpeg filter chain that composites a pre-rendered
 * browser chrome PNG on top of the recording, positioned within a
 * gradient background canvas.
 */

import { execFile } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);

export interface BrowserFrameOptions {
  /** Gradient start color (top-left). Default: "#f97316" (orange) */
  gradientFrom?: string;
  /** Gradient end color (bottom-right). Default: "#a855f7" (purple) */
  gradientTo?: string;
  /** Padding around the browser window in pixels. Default: 48 */
  padding?: number;
  /** URL to display in the address bar. Default: inferred from capture */
  displayUrl?: string;
}

const DEFAULT_GRADIENT_FROM = "#f97316";
const DEFAULT_GRADIENT_TO = "#a855f7";
const DEFAULT_PADDING = 48;
const CHROME_HEIGHT = 52;

/**
 * Render a browser chrome bar + gradient background as a PNG using Playwright.
 * This gives us pixel-perfect rendering of the macOS-style window chrome.
 */
const renderFrameTemplate = async (
  outputPath: string,
  contentWidth: number,
  contentHeight: number,
  options: BrowserFrameOptions,
): Promise<{ canvasWidth: number; canvasHeight: number; contentOffsetX: number; contentOffsetY: number }> => {
  const padding = options.padding ?? DEFAULT_PADDING;
  const gradFrom = options.gradientFrom ?? DEFAULT_GRADIENT_FROM;
  const gradTo = options.gradientTo ?? DEFAULT_GRADIENT_TO;
  const displayUrl = options.displayUrl ?? "app.example.com";

  const windowWidth = contentWidth;
  const windowHeight = contentHeight + CHROME_HEIGHT;
  const canvasWidth = windowWidth + padding * 2;
  const canvasHeight = windowHeight + padding * 2;
  const contentOffsetX = padding;
  const contentOffsetY = padding + CHROME_HEIGHT;

  const html = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${canvasWidth}px; height: ${canvasHeight}px;
    background: linear-gradient(135deg, ${gradFrom} 0%, ${gradTo} 100%);
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  }
  .window {
    width: ${windowWidth}px; height: ${windowHeight}px;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 25px 60px rgba(0,0,0,0.35), 0 8px 20px rgba(0,0,0,0.2);
  }
  .chrome {
    height: ${CHROME_HEIGHT}px;
    background: linear-gradient(180deg, #e8e6e3 0%, #d5d3d0 100%);
    display: flex; align-items: center; padding: 0 16px;
    border-bottom: 1px solid #c4c2bf;
  }
  .traffic-lights { display: flex; gap: 8px; margin-right: 16px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot-red { background: #ff5f57; border: 1px solid #e0443e; }
  .dot-yellow { background: #febc2e; border: 1px solid #d4a020; }
  .dot-green { background: #28c840; border: 1px solid #1ea633; }
  .nav-buttons { display: flex; gap: 6px; margin-right: 12px; }
  .nav-btn { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; color: #888; font-size: 16px; }
  .url-bar {
    flex: 1; height: 30px; border-radius: 6px;
    background: rgba(255,255,255,0.75); border: 1px solid rgba(0,0,0,0.1);
    display: flex; align-items: center; justify-content: center;
    padding: 0 12px; font-size: 13px; color: #555;
  }
  .lock { margin-right: 5px; font-size: 11px; color: #888; }
  .content { width: ${contentWidth}px; height: ${contentHeight}px; background: #fff; }
</style></head><body>
  <div class="window">
    <div class="chrome">
      <div class="traffic-lights">
        <div class="dot dot-red"></div>
        <div class="dot dot-yellow"></div>
        <div class="dot dot-green"></div>
      </div>
      <div class="nav-buttons">
        <div class="nav-btn">&larr;</div>
        <div class="nav-btn">&rarr;</div>
      </div>
      <div class="url-bar">
        <span class="lock">&#x1f512;</span>
        ${escapeHtml(displayUrl)}
      </div>
    </div>
    <div class="content"></div>
  </div>
</body></html>`;

  await mkdir(dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: canvasWidth, height: canvasHeight } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.screenshot({ path: outputPath, omitBackground: false });
  await browser.close();

  return { canvasWidth, canvasHeight, contentOffsetX, contentOffsetY };
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Apply browser frame compositing to a video.
 * Renders the frame template once as PNG, then composites every frame of
 * the input video on top using FFmpeg overlay.
 */
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

  // FFmpeg: overlay video on top of the frame PNG at the content position
  await execFileAsync("ffmpeg", [
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
  ]);

  return { outputWidth: canvasWidth, outputHeight: canvasHeight };
};
