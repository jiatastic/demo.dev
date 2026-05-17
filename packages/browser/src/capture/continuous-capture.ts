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
  buildPiiBlurScript,
  DemoDevError,
  isUrlAllowed,
  type OriginPolicy,
  type PiiBlurOptions,
  type ProgressReporter,
} from "@demo-dev/core";
import {
  getContextOptionsWithSession,
  persistSessionState,
  resolveSessionConfig,
} from "../session.js";
import type {
  ActionTarget,
  DemoPlan,
  SceneAction,
} from "@demo-dev/types";

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
  // ease-in-out cubic: gentle acceleration, smooth deceleration — matches Screen Studio's camera feel.
  html.style.transition = 'transform 1.2s cubic-bezier(0.45, 0, 0.15, 1)';
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

// ---------------------------------------------------------------------------
// Caption overlay (burned into the recording)
// ---------------------------------------------------------------------------

const CAPTION_INJECT_SCRIPT = `
(() => {
  if (document.getElementById('__caption')) return;
  const bar = document.createElement('div');
  bar.id = '__caption';
  Object.assign(bar.style, {
    position: 'fixed', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
    zIndex: '999996', pointerEvents: 'none',
    maxWidth: '80%', padding: '10px 24px', borderRadius: '10px',
    background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)',
    color: '#fff', fontSize: '15px', lineHeight: '1.5',
    fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif',
    fontWeight: '500', textAlign: 'center', letterSpacing: '0.01em',
    opacity: '0', transition: 'opacity 0.4s ease',
  });
  document.body.appendChild(bar);
  window.__showCaption = (text) => { bar.textContent = text; bar.style.opacity = '1'; };
  window.__hideCaption = () => { bar.style.opacity = '0'; };
})();
`;

const showCaption = async (page: Page, text: string) => {
  await page.evaluate(CAPTION_INJECT_SCRIPT).catch(() => undefined);
  await page.evaluate((t) => (window as any).__showCaption?.(t), text).catch(() => undefined);
};

const hideCaption = async (page: Page) => {
  await page.evaluate(() => (window as any).__hideCaption?.()).catch(() => undefined);
};

const SCENE_TRANSITION_SCRIPT = `
(() => {
  if (document.getElementById('__scene-fade')) return;
  const overlay = document.createElement('div');
  overlay.id = '__scene-fade';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    zIndex: '999997', pointerEvents: 'none',
    background: 'white', opacity: '0',
    transition: 'opacity 0.4s ease-in-out',
  });
  document.body.appendChild(overlay);
  window.__fadeOut = () => { overlay.style.opacity = '1'; };
  window.__fadeIn = () => { overlay.style.opacity = '0'; };
})();
`;

/** Fade to white and back — used between scenes. */
const fadeTransition = async (page: Page) => {
  await page.evaluate(SCENE_TRANSITION_SCRIPT).catch(() => undefined);
  await page.evaluate(() => (window as any).__fadeOut?.()).catch(() => undefined);
  await page.waitForTimeout(450);
  await page.evaluate(() => (window as any).__fadeIn?.()).catch(() => undefined);
  await page.waitForTimeout(450);
};

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
    left: '0px', top: '0px', width: '26px', height: '36px',
    opacity: '0',
    transition: 'left 0.035s linear, top 0.035s linear, opacity 0.28s ease, transform 0.16s ease',
  });
  /* Precise macOS default cursor — traced from Apple's actual cursor spec */
  cursor.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 20 28">' +
    '<defs><filter id="cs" x="-30%" y="-20%" width="160%" height="150%"><feDropShadow dx="0.7" dy="1.8" stdDeviation="0.9" flood-opacity="0.38"/></filter></defs>' +
    '<path filter="url(#cs)" d="M2.2 0L2.2 21.4L6.8 16.4L10.6 24.8L13.2 23.6L9.4 15.6L16 15.6Z" fill="white" stroke="rgba(0,0,0,.88)" stroke-width="1.05" stroke-linejoin="round"/>' +
    '</svg>';
  document.body.appendChild(cursor);

  /* ── Click ripple ── */
  const ripple = document.createElement('div');
  ripple.id = '__ghost-ripple';
  Object.assign(ripple.style, {
    position: 'fixed', zIndex: '999998', pointerEvents: 'none',
    width: '46px', height: '46px', borderRadius: '50%',
    border: '1.5px solid rgba(255,255,255,0.58)',
    background: 'radial-gradient(circle, rgba(255,255,255,0.12), rgba(255,255,255,0.03) 62%, transparent 64%)',
    transform: 'translate(-50%,-50%) scale(0)',
    opacity: '0', left: '0px', top: '0px',
    transition: 'transform 0.42s cubic-bezier(.16,1,.3,1), opacity 0.42s ease-out',
  });
  document.body.appendChild(ripple);

  let hideTimer;
  const showCursor = () => {
    cursor.style.opacity = '1';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { cursor.style.opacity = '0'; }, 1400);
  };

  document.addEventListener('mousemove', (e) => {
    cursor.style.left = e.clientX + 'px';
    cursor.style.top = e.clientY + 'px';
    showCursor();
  }, { passive: true });

  document.addEventListener('mousedown', (e) => {
    /* Pointer press animation */
    showCursor();
    cursor.style.transform = 'scale(0.88)';
    setTimeout(() => { cursor.style.transform = 'scale(1)'; }, 150);

    /* Ripple at click position */
    ripple.style.left = e.clientX + 'px';
    ripple.style.top = e.clientY + 'px';
    ripple.style.transform = 'translate(-50%,-50%) scale(0)';
    ripple.style.opacity = '0.42';
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
  options: { originPolicy?: OriginPolicy; reporter?: ProgressReporter } = {},
) => {
  switch (action.type) {
    case "navigate": {
      const url = new URL(action.url, baseUrl).toString();
      if (options.originPolicy && !isUrlAllowed(url, options.originPolicy)) {
        options.reporter?.log("warn", `Blocked navigation to ${url}: not in allowed hosts`, {
          allowed: options.originPolicy.allowedHosts,
        });
        throw new DemoDevError("NAVIGATION_BLOCKED_BY_POLICY", `Blocked cross-origin navigation: ${url}`, {
          details: { url, allowedHosts: options.originPolicy.allowedHosts },
        });
      }
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
      await page.evaluate(SCENE_TRANSITION_SCRIPT).catch(() => undefined);
      await page.evaluate(CAPTION_INJECT_SCRIPT).catch(() => undefined);
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
      // Keep capture footage clean. Camera zoom/pan is now applied in post from interaction metadata.
      const preBox = await resolveLocator(page, action.target)
        .first().boundingBox().catch(() => null);
      const selector = buildCssSelector(action.target);
      if (selector) {
        await cursor.actions.click({
          target: selector,
          waitBeforeClick: [100, 300],
        });
      } else if (preBox) {
        await cursor.actions.move({
          x: preBox.x + preBox.width / 2,
          y: preBox.y + preBox.height / 2,
        });
        await page.waitForTimeout(humanDelay(120));
        await page.mouse.click(preBox.x + preBox.width / 2, preBox.y + preBox.height / 2);
      } else {
        await resolveLocator(page, action.target).first().click();
      }
      await page.waitForTimeout(humanDelay(900));
      break;
    }

    case "hover": {
      // Keep capture footage clean. Camera zoom/pan is now applied in post from interaction metadata.
      const preBox = await resolveLocator(page, action.target)
        .first().boundingBox().catch(() => null);
      const selector = buildCssSelector(action.target);
      if (selector) {
        await cursor.actions.move(selector);
      } else if (preBox) {
        await cursor.actions.move({
          x: preBox.x + preBox.width / 2,
          y: preBox.y + preBox.height / 2,
        });
      } else {
        await resolveLocator(page, action.target).first().hover();
      }
      await page.waitForTimeout(humanDelay(900));
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
    case "css":
      // ghost-cursor's selector path is fragile in some headless pages; use locator bounding boxes instead.
      return undefined;
    case "testId":
      // ghost-cursor's selector path is fragile in some headless pages; use locator bounding boxes instead.
      return undefined;
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
  /** Show a centered chapter title at the start of each scene. Disabled by default for public videos. */
  showChapters?: boolean;
  /** Burn narration captions into the browser recording. Disabled by default; prefer post-production captions. */
  showCaptions?: boolean;
  /** Same-origin enforcement. Navigations outside the allowed hosts are skipped. */
  originPolicy?: OriginPolicy;
  /** Allow scenes flagged as destructive to execute. Default false → destructive scenes are skipped. */
  allowDestructive?: boolean;
  /** Inject a blur init script for emails / credit-card-like content. */
  piiBlur?: PiiBlurOptions;
  /** Progress reporter. */
  reporter?: ProgressReporter;
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
    await getContextOptionsWithSession(
      {
        viewport,
        userAgent:
          process.env.DEMO_USER_AGENT ??
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        locale: process.env.DEMO_LOCALE ?? "en-US",
        timezoneId: process.env.DEMO_TIMEZONE ?? "America/New_York",
      },
      session,
    ),
  );

  // PII blur init-script — runs before every page script, on every nav.
  if (options.piiBlur && (options.piiBlur.emails || options.piiBlur.creditCards)) {
    await context.addInitScript(buildPiiBlurScript(options.piiBlur));
  }

  const page = await context.newPage();
  page.setDefaultTimeout(8000);

  const cursorLog: CursorSample[] = [];
  const interactions: CaptureInteraction[] = [];
  const sceneMarkers: SceneMarker[] = [];

  // Preload the first route before recording starts so the exported video does not begin with a blank browser page.
  const firstAction = plan.scenes[0]?.actions[0];
  let preloadedInitialUrl: string | undefined;
  if (firstAction?.type === "navigate") {
    preloadedInitialUrl = new URL(firstAction.url, options.baseUrl).toString();
    try {
      await page.goto(preloadedInitialUrl, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      await page.goto(preloadedInitialUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
    }
    await page.evaluate(CURSOR_OVERLAY_SCRIPT).catch(() => undefined);
    await page.evaluate(CURSOR_TRACKER_SCRIPT).catch(() => undefined);
    await page.evaluate(SCENE_TRANSITION_SCRIPT).catch(() => undefined);
    await page.evaluate(CAPTION_INJECT_SCRIPT).catch(() => undefined);
  }

  const captureStartedAt = Date.now();
  const elapsed = () => Date.now() - captureStartedAt;

  // Start screencast recording
  await page.screencast.start({ path: videoPath });
  await page.evaluate(() => {
    (window as any).__cursorSamples = [];
    (window as any).__cursorTrackingStart = Date.now();
  }).catch(() => undefined);

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

      // Destructive-action guard. Default behavior: skip the scene entirely and record a marker.
      if (scene.destructive && !options.allowDestructive) {
        options.reporter?.phase(
          "capture",
          "skip",
          `Skipping destructive scene "${scene.title}" (match: ${scene.destructiveMatch ?? "n/a"}). Pass --allow-destructive to run it.`,
          { sceneId: scene.id },
        );
        sceneMarkers.push({
          sceneId: scene.id,
          sceneTitle: scene.title,
          startMs: sceneStart,
          endMs: sceneStart,
          url: page.url(),
        });
        continue;
      }

      // Mark scene start
      interactions.push({
        type: "scene-start",
        sceneId: scene.id,
        atMs: sceneStart,
      });

      if (options.showChapters) {
        await page.screencast.showChapter(scene.title).catch(() => undefined);
        await page.waitForTimeout(humanDelay(600));
      }

      // Optional browser-burned captions. Default is off so the raw capture stays clean for post-production.
      if (options.showCaptions && scene.narration) {
        await showCaption(page, scene.narration);
      }

      // Run all actions in this scene
      for (const action of scene.actions) {
        const isPreloadedInitialNavigate =
          action === plan.scenes[0]?.actions[0] &&
          action.type === "navigate" &&
          preloadedInitialUrl === new URL(action.url, options.baseUrl).toString();
        if (isPreloadedInitialNavigate) {
          await page.waitForTimeout(humanDelay(350));
          continue;
        }

        // Log interaction before
        const boxBefore = await boxForAction(page, action).catch(() => undefined);

        try {
          await runActionWithCursor(page, action, options.baseUrl, cursor, {
            originPolicy: options.originPolicy,
            reporter: options.reporter,
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.warn(`[capture] action ${action.type} failed (skipping): ${msg.split("\n")[0]}`);
          options.reporter?.log("warn", `action ${action.type} failed: ${msg.split("\n")[0]}`, { sceneId: scene.id });
        }

        // Re-inject scripts after navigation
        if (action.type === "navigate") {
          cursorTrackingOffset = elapsed();
          await page.evaluate(CURSOR_TRACKER_SCRIPT).catch(() => undefined);
          await page.evaluate(CURSOR_OVERLAY_SCRIPT).catch(() => undefined);
          await page.evaluate(ZOOM_INJECT_SCRIPT).catch(() => undefined);
          await page.evaluate(SCENE_TRANSITION_SCRIPT).catch(() => undefined);
          await page.evaluate(CAPTION_INJECT_SCRIPT).catch(() => undefined);
          if (options.showCaptions && scene.narration) {
            await showCaption(page, scene.narration);
          }
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

      // Hide caption before transitioning
      await hideCaption(page);
      await page.waitForTimeout(300);

      // Only fade between scenes if the next scene navigates to a different page
      const nextScene = plan.scenes[plan.scenes.indexOf(scene) + 1];
      const nextHasNavigate = nextScene?.actions.some((a) => a.type === "navigate");
      if (nextHasNavigate) {
        await fadeTransition(page);
      } else if (nextScene) {
        // Same page — just a brief pause, no flash
        await page.waitForTimeout(humanDelay(300));
      }
    }

    // Hold briefly at the end so the final result can breathe without creating a long dead tail.
    await page.waitForTimeout(2500);

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
