/**
 * Continuous capture module.
 *
 * Instead of recording each scene as a separate browser context (which produces
 * choppy, slideshow-like output), this module runs ALL scenes in a single
 * continuous Playwright session while:
 *
 *   1. Using the Playwright 1.59 `page.screencast` API for a single unbroken
 *      WebM recording.
 *   2. Using `ghost-cursor-playwright` for human-like Bézier-curve mouse
 *      movement (Fitts's Law, overshoot, random landing points inside elements).
 *   3. Logging high-frequency cursor positions + interaction events as metadata
 *      so post-processing can generate intelligent zoom keyframes à la Screen
 *      Studio.
 *
 * The entire module is headless-capable and CI-friendly.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page, type Locator } from "playwright";
import { createCursor } from "ghost-cursor-playwright";
import {
  getContextOptionsWithSession,
  persistSessionState,
  resolveSessionConfig,
} from "../browser/session.js";
import type {
  ActionTarget,
  DemoPlan,
  SceneAction,
} from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single logged cursor position sample. */
export interface CursorSample {
  /** Milliseconds since capture start */
  atMs: number;
  x: number;
  y: number;
}

/** A logged interaction event with screen coordinates + timing. */
export interface CaptureInteraction {
  type: SceneAction["type"] | "scene-start" | "scene-end" | "stable";
  sceneId: string;
  atMs: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** For fill actions – the value typed. */
  fillValue?: string;
}

/** Scene timing marker within the continuous recording. */
export interface SceneMarker {
  sceneId: string;
  sceneTitle: string;
  startMs: number;
  endMs: number;
  url: string;
}

/** Full output of a continuous capture session. */
export interface ContinuousCaptureResult {
  /** Path to the single continuous WebM recording. */
  videoPath: string;
  /** High-frequency cursor position log. */
  cursorLog: CursorSample[];
  /** Interaction events (clicks, fills, navigations, etc.). */
  interactions: CaptureInteraction[];
  /** Per-scene timing markers. */
  sceneMarkers: SceneMarker[];
  /** Total duration in milliseconds. */
  totalDurationMs: number;
  /** Viewport size used for the recording. */
  viewport: { width: number; height: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip trailing numbers/badges that LLMs often include (e.g. "Positive reply8" → "Positive reply"). */
const stripBadge = (text: string) => text.replace(/\d+\s*$/, "").trim();

/** Core locator resolution — exact match. */
const resolveLocatorExact = (page: Page, target: ActionTarget): Locator => {
  switch (target.strategy) {
    case "label":
      return page.getByLabel(target.value, { exact: target.exact });
    case "text":
      return page.getByText(target.value, { exact: target.exact });
    case "placeholder":
      return page.getByPlaceholder(target.value, { exact: target.exact });
    case "testId":
      return page.getByTestId(target.value);
    case "css":
      return page.locator(target.value);
    case "role":
      return page.getByRole(target.role as never, {
        name: target.name,
        exact: target.exact,
      });
  }
};

/**
 * Resolve a locator with fuzzy fallback.
 * Tries exact match first, then progressively looser strategies:
 *   1. Strip trailing numbers/badges from text
 *   2. Use non-exact (substring) matching
 *   3. For role targets, try text strategy instead
 */
const resolveLocator = (page: Page, target: ActionTarget): Locator => {
  const exact = resolveLocatorExact(page, target);

  // Build a chain of fallback locators using .or()
  let result = exact;

  if (target.strategy === "text" || target.strategy === "label") {
    const stripped = stripBadge(target.value);
    if (stripped !== target.value && stripped.length > 0) {
      // Try without the badge number
      result = result.or(
        target.strategy === "text"
          ? page.getByText(stripped, { exact: false })
          : page.getByLabel(stripped, { exact: false }),
      );
    }
    if (target.exact) {
      // Also try non-exact (substring) match
      result = result.or(
        target.strategy === "text"
          ? page.getByText(target.value, { exact: false })
          : page.getByLabel(target.value, { exact: false }),
      );
    }
  }

  if (target.strategy === "role" && target.name) {
    const stripped = stripBadge(target.name);
    if (stripped !== target.name && stripped.length > 0) {
      // Try role with stripped name
      result = result.or(
        page.getByRole(target.role as never, { name: stripped, exact: false }),
      );
    }
    // Also try as text match (LLMs sometimes confuse role vs text)
    result = result.or(page.getByText(target.name, { exact: false }));
    if (stripped !== target.name) {
      result = result.or(page.getByText(stripped, { exact: false }));
    }
  }

  return result;
};

/** Random delay that feels "human": base ± jitter. */
const humanDelay = (baseMs: number, jitter = 0.4) => {
  const factor = 1 + (Math.random() * 2 - 1) * jitter;
  return Math.max(50, Math.round(baseMs * factor));
};

/** Get bounding-box center for an action's target element. */
const boxForAction = async (
  page: Page,
  action: SceneAction,
): Promise<{ x: number; y: number; width: number; height: number } | undefined> => {
  const getBox = async (locator: Locator) => {
    const box = await locator.first().boundingBox().catch(() => null);
    if (!box) return undefined;
    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      width: box.width,
      height: box.height,
    };
  };

  switch (action.type) {
    case "click":
    case "hover":
    case "fill":
    case "select":
    case "dragSelect":
      return getBox(resolveLocator(page, action.target));
    case "scrollIntoView":
      return getBox(resolveLocator(page, action.target));
    case "waitForText":
      return getBox(page.getByText(action.value, { exact: action.exact }));
    default:
      return undefined;
  }
};

// ---------------------------------------------------------------------------
// Cursor position tracking
// ---------------------------------------------------------------------------

/**
 * Inject a JS snippet into the page that tracks mouse position at ~60 fps
 * and stores samples on `window.__cursorSamples`. We poll these from Node.
 */
const CURSOR_TRACKER_SCRIPT = `
(() => {
  if (window.__cursorTrackerInstalled) return;
  window.__cursorTrackerInstalled = true;
  window.__cursorSamples = [];
  window.__cursorTrackingStart = Date.now();
  let lastX = 0, lastY = 0;

  document.addEventListener('mousemove', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
  }, { passive: true });

  const tick = () => {
    window.__cursorSamples.push({
      atMs: Date.now() - window.__cursorTrackingStart,
      x: lastX,
      y: lastY,
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;

// ---------------------------------------------------------------------------
// CSS-based zoom (Screen Studio style — animated in browser at 60fps)
// ---------------------------------------------------------------------------

const ZOOM_INJECT_SCRIPT = `
(() => {
  if (window.__zoomInstalled) return;
  window.__zoomInstalled = true;
  const html = document.documentElement;
  html.style.transition = 'transform 0.8s cubic-bezier(0.22, 0.61, 0.36, 1)';
  html.style.transformOrigin = '0 0';
  window.__zoomTo = (x, y, scale) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tx = -(x - vw / scale / 2) * (scale - 1);
    const ty = -(y - vh / scale / 2) * (scale - 1);
    const clampedTx = Math.min(0, Math.max(tx, -(vw * (scale - 1))));
    const clampedTy = Math.min(0, Math.max(ty, -(vh * (scale - 1))));
    html.style.transform = 'scale(' + scale + ') translate(' + clampedTx / scale + 'px, ' + clampedTy / scale + 'px)';
  };
  window.__zoomReset = () => {
    html.style.transform = 'scale(1) translate(0px, 0px)';
  };
})();
`;

/** Smoothly zoom into a point on the page (captured by screencast at 60fps). */
const zoomToPoint = async (page: Page, x: number, y: number, scale = 1.5) => {
  await page.evaluate(ZOOM_INJECT_SCRIPT).catch(() => undefined);
  await page.evaluate(
    ({ x, y, scale }) => (window as any).__zoomTo?.(x, y, scale),
    { x, y, scale },
  ).catch(() => undefined);
  // Wait for CSS transition to complete (0.8s)
  await page.waitForTimeout(850);
};

/** Smoothly zoom back to 1x. */
const zoomReset = async (page: Page) => {
  await page.evaluate(() => (window as any).__zoomReset?.()).catch(() => undefined);
  await page.waitForTimeout(850);
};

/** Drain cursor samples from the page and append to our log. */
const drainCursorSamples = async (
  page: Page,
  log: CursorSample[],
  offsetMs: number,
): Promise<void> => {
  try {
    const samples: CursorSample[] = await page.evaluate(() => {
      const s = (window as any).__cursorSamples ?? [];
      (window as any).__cursorSamples = [];
      return s;
    });
    for (const s of samples) {
      log.push({ atMs: s.atMs + offsetMs, x: s.x, y: s.y });
    }
  } catch {
    // page may have navigated – silently skip
  }
};

// ---------------------------------------------------------------------------
// Visible cursor rendering (for headless)
// ---------------------------------------------------------------------------

const CURSOR_OVERLAY_SCRIPT = `
(() => {
  if (document.getElementById('__ghost-cursor')) return;

  /* ── macOS-style pointer cursor ── */
  const cursor = document.createElement('div');
  cursor.id = '__ghost-cursor';
  Object.assign(cursor.style, {
    position: 'fixed', zIndex: '999999', pointerEvents: 'none',
    left: '0px', top: '0px', width: '22px', height: '32px',
    transition: 'left 0.04s cubic-bezier(.2,.8,.3,1), top 0.04s cubic-bezier(.2,.8,.3,1)',
    filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.4))',
  });
  /* Standard macOS cursor: white fill, black outline, clean geometry */
  cursor.innerHTML = '<svg width="22" height="32" viewBox="0 0 22 32" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M1.5 0.5L1.5 24.5L7 18.5L11.5 28.5L14.5 27L10 17.5L18 17.5Z" fill="white" stroke="black" stroke-width="1.2" stroke-linejoin="round"/>' +
    '</svg>';
  document.body.appendChild(cursor);

  /* ── Click ripple ── */
  const ripple = document.createElement('div');
  ripple.id = '__ghost-ripple';
  Object.assign(ripple.style, {
    position: 'fixed', zIndex: '999998', pointerEvents: 'none',
    width: '40px', height: '40px', borderRadius: '50%',
    border: '2px solid rgba(59,130,246,0.6)',
    background: 'rgba(59,130,246,0.12)',
    transform: 'translate(-50%,-50%) scale(0)',
    opacity: '0', left: '0px', top: '0px',
    transition: 'transform 0.35s cubic-bezier(.2,.8,.3,1), opacity 0.35s ease-out',
  });
  document.body.appendChild(ripple);

  document.addEventListener('mousemove', (e) => {
    cursor.style.left = e.clientX + 'px';
    cursor.style.top = e.clientY + 'px';
  }, { passive: true });

  document.addEventListener('mousedown', (e) => {
    /* Pointer press animation */
    cursor.style.transform = 'scale(0.82)';
    setTimeout(() => { cursor.style.transform = 'scale(1)'; }, 150);

    /* Ripple at click position */
    ripple.style.left = e.clientX + 'px';
    ripple.style.top = e.clientY + 'px';
    ripple.style.transform = 'translate(-50%,-50%) scale(0)';
    ripple.style.opacity = '1';
    /* Force reflow so transition restarts */
    void ripple.offsetWidth;
    ripple.style.transform = 'translate(-50%,-50%) scale(1)';
    ripple.style.opacity = '0';
  });
})();
`;

// ---------------------------------------------------------------------------
// Human-like action execution
// ---------------------------------------------------------------------------

type GhostCursor = Awaited<ReturnType<typeof createCursor>>;

const humanTypeInto = async (page: Page, locator: Locator, value: string) => {
  await locator.first().click();
  // Clear existing content
  await locator.first().fill("");
  // Type character by character with human-like delays
  for (const char of value) {
    await page.keyboard.type(char, { delay: humanDelay(65, 0.5) });
  }
};

const runActionWithCursor = async (
  page: Page,
  action: SceneAction,
  baseUrl: string,
  cursor: GhostCursor,
) => {
  switch (action.type) {
    case "navigate": {
      const url = new URL(action.url, baseUrl).toString();
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("page.goto: Timeout")) throw error;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1500);
      }
      // Re-inject scripts after navigation
      await page.evaluate(CURSOR_OVERLAY_SCRIPT).catch(() => undefined);
      await page.evaluate(CURSOR_TRACKER_SCRIPT).catch(() => undefined);
      await page.evaluate(ZOOM_INJECT_SCRIPT).catch(() => undefined);
      await page.waitForTimeout(humanDelay(400));
      break;
    }

    case "wait": {
      await page.waitForTimeout(action.ms);
      break;
    }

    case "scroll": {
      // Smooth scroll instead of instant
      await page.evaluate(
        (y) => window.scrollBy({ top: y, behavior: "smooth" }),
        action.y,
      );
      await page.waitForTimeout(humanDelay(500));
      break;
    }

    case "scrollIntoView": {
      const locator = resolveLocator(page, action.target);
      await locator.first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(humanDelay(300));
      break;
    }

    case "click": {
      const selector = buildCssSelector(action.target);
      if (selector) {
        await cursor.actions.click({
          target: selector,
          waitBeforeClick: [100, 300],
        });
      } else {
        const box = await resolveLocator(page, action.target)
          .first().boundingBox().catch(() => null);
        if (box) {
          await cursor.actions.move({
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
          });
          await page.waitForTimeout(humanDelay(120));
          await page.mouse.click(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
        } else {
          await resolveLocator(page, action.target).first().click();
        }
      }
      // Zoom in AFTER clicking to show the result (Screen Studio style)
      const clickBox = await resolveLocator(page, action.target)
        .first().boundingBox().catch(() => null);
      if (clickBox) {
        await zoomToPoint(page, clickBox.x + clickBox.width / 2, clickBox.y + clickBox.height / 2, 1.4);
        await page.waitForTimeout(humanDelay(1200));
        await zoomReset(page);
      } else {
        await page.waitForTimeout(humanDelay(200));
      }
      break;
    }

    case "hover": {
      const selector = buildCssSelector(action.target);
      if (selector) {
        await cursor.actions.move(selector);
      } else {
        const box = await resolveLocator(page, action.target)
          .first().boundingBox().catch(() => null);
        if (box) {
          await cursor.actions.move({
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
          });
        } else {
          await resolveLocator(page, action.target).first().hover();
        }
      }
      // Zoom in to emphasize what we're hovering over
      const hoverBox = await resolveLocator(page, action.target)
        .first().boundingBox().catch(() => null);
      if (hoverBox) {
        await zoomToPoint(page, hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2, 1.3);
        await page.waitForTimeout(humanDelay(1000));
        await zoomReset(page);
      } else {
        await page.waitForTimeout(humanDelay(300));
      }
      break;
    }

    case "fill": {
      const locator = resolveLocator(page, action.target);
      // Move cursor to the input first
      const selector = buildCssSelector(action.target);
      if (selector) {
        await cursor.actions.click({
          target: selector,
          waitBeforeClick: [80, 200],
        });
      } else {
        const box = await locator.first().boundingBox().catch(() => null);
        if (box) {
          await cursor.actions.move({
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
          });
          await page.waitForTimeout(humanDelay(100));
          await page.mouse.click(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
        }
      }
      await page.waitForTimeout(humanDelay(150));
      await humanTypeInto(page, locator, action.value);
      await page.waitForTimeout(humanDelay(200));
      break;
    }

    case "press": {
      await page.keyboard.press(action.key);
      await page.waitForTimeout(humanDelay(150));
      break;
    }

    case "select": {
      const locator = resolveLocator(page, action.target);
      await locator.first().selectOption(action.value);
      await page.waitForTimeout(humanDelay(200));
      break;
    }

    case "dragSelect": {
      const box = await resolveLocator(page, action.target)
        .first()
        .boundingBox();
      if (!box) throw new Error("dragSelect: no bounding box");

      const startX = box.x + box.width * (action.startX ?? 0.08);
      const startY = box.y + box.height * (action.startY ?? 0.12);
      const endX = box.x + box.width * (action.endX ?? 0.7);
      const endY =
        box.y + box.height * (action.endY ?? action.startY ?? 0.12);

      await cursor.actions.move({ x: startX, y: startY });
      await page.waitForTimeout(humanDelay(100));
      await page.mouse.down();
      await page.mouse.move(endX, endY, { steps: 24 });
      await page.mouse.up();
      await page.waitForTimeout(humanDelay(200));
      break;
    }

    case "waitForText": {
      await page
        .getByText(action.value, { exact: action.exact })
        .first()
        .waitFor({ timeout: action.timeoutMs ?? 10000 })
        .catch(() => console.warn(`[capture] waitForText timed out: "${action.value}"`));
      break;
    }

    case "waitForUrl": {
      const urlMatcher =
        action.value.startsWith("http://") ||
        action.value.startsWith("https://") ||
        action.value.includes("*")
          ? action.value
          : new URL(action.value, baseUrl).toString();
      await page.waitForURL(urlMatcher, { timeout: action.timeoutMs ?? 10000 })
        .catch(() => console.warn(`[capture] waitForUrl timed out: "${action.value}"`));
      break;
    }
  }
};

/** Try to produce a pure CSS selector that ghost-cursor can use.
 *  Playwright-specific pseudo-selectors like :has-text() are NOT valid CSS
 *  and will crash ghost-cursor's querySelector, so we reject them. */
const buildCssSelector = (target: ActionTarget): string | undefined => {
  switch (target.strategy) {
    case "css": {
      // Reject Playwright-specific pseudo-selectors
      if (/:has-text|:text|:visible|>>/.test(target.value)) return undefined;
      return target.value;
    }
    case "testId":
      return `[data-testid="${target.value}"]`;
    default:
      return undefined;
  }
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface ContinuousCaptureOptions {
  baseUrl: string;
  outputDir: string;
  viewport?: { width: number; height: number };
}

const DEFAULT_VIEWPORT = { width: 1600, height: 900 };

export const capturePlanContinuous = async (
  plan: DemoPlan,
  options: ContinuousCaptureOptions,
): Promise<ContinuousCaptureResult> => {
  const viewport = options.viewport ?? plan.scenes[0]?.viewport ?? DEFAULT_VIEWPORT;
  const captureDir = join(options.outputDir, "continuous");
  await mkdir(captureDir, { recursive: true });

  const videoPath = join(captureDir, "recording.webm");
  const session = resolveSessionConfig(options.outputDir);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    await getContextOptionsWithSession({ viewport }, session),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(8000);

  const cursorLog: CursorSample[] = [];
  const interactions: CaptureInteraction[] = [];
  const sceneMarkers: SceneMarker[] = [];

  const captureStartedAt = Date.now();
  const elapsed = () => Date.now() - captureStartedAt;

  // Start screencast recording
  await page.screencast.start({ path: videoPath });

  // Initialize ghost cursor
  const cursor = await createCursor(page, {
    overshootSpread: 2,
    overshootRadius: 8,
  });

  // Set up a periodic drain for cursor samples
  let cursorTrackingOffset = 0;
  const drainInterval = setInterval(async () => {
    await drainCursorSamples(page, cursorLog, cursorTrackingOffset);
  }, 200);

  try {
    for (const scene of plan.scenes) {
      const sceneStart = elapsed();

      // Mark scene start
      interactions.push({
        type: "scene-start",
        sceneId: scene.id,
        atMs: sceneStart,
      });

      // Show chapter title via screencast overlay
      await page.screencast.showChapter(scene.title).catch(() => undefined);
      await page.waitForTimeout(humanDelay(600));

      // Run all actions in this scene
      for (const action of scene.actions) {
        // Log interaction before
        const boxBefore = await boxForAction(page, action).catch(() => undefined);

        try {
          await runActionWithCursor(page, action, options.baseUrl, cursor);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.warn(`[capture] action ${action.type} failed (skipping): ${msg.split("\n")[0]}`);
        }

        // Re-inject scripts after navigation
        if (action.type === "navigate") {
          cursorTrackingOffset = elapsed();
          await page.evaluate(CURSOR_TRACKER_SCRIPT).catch(() => undefined);
          await page.evaluate(CURSOR_OVERLAY_SCRIPT).catch(() => undefined);
        }

        // Log interaction after
        const boxAfter = await boxForAction(page, action);
        const box = boxAfter ?? boxBefore;
        interactions.push({
          type: action.type,
          sceneId: scene.id,
          atMs: elapsed(),
          x: box?.x,
          y: box?.y,
          width: box?.width,
          height: box?.height,
          fillValue: action.type === "fill" ? action.value : undefined,
        });
      }

      // Wait for page to stabilize
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(humanDelay(500));

      // Persist session state
      await persistSessionState(page, session);

      const sceneEnd = elapsed();

      // Mark scene end
      interactions.push({
        type: "scene-end",
        sceneId: scene.id,
        atMs: sceneEnd,
      });

      sceneMarkers.push({
        sceneId: scene.id,
        sceneTitle: scene.title,
        startMs: sceneStart,
        endMs: sceneEnd,
        url: page.url(),
      });

      // Brief pause between scenes (feels like a human taking a breath)
      await page.waitForTimeout(humanDelay(400));
    }

    // Final drain of cursor samples
    await drainCursorSamples(page, cursorLog, cursorTrackingOffset);

    // Stop recording
    const totalDurationMs = elapsed();
    await page.screencast.stop();
    await context.close();
    await browser.close();

    return {
      videoPath,
      cursorLog,
      interactions,
      sceneMarkers,
      totalDurationMs,
      viewport,
    };
  } finally {
    clearInterval(drainInterval);
    await browser.close().catch(() => undefined);
  }
};
