import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { getContextOptionsWithSession, persistSessionState, resolveSessionConfig } from "../browser/session.js";
import { fileToDataUri } from "../lib/data-uri.js";
import type { ActionTarget, CaptureArtifact, CaptureEvent, DemoPlan, SceneAction } from "../types.js";

const resolveLocator = (page: Page, target: ActionTarget): Locator => {
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

interface ActionObserver {
  beforeAction?: (action: SceneAction, page: Page) => Promise<void>;
  afterAction?: (action: SceneAction, page: Page) => Promise<void>;
}

const runAction = async (page: Page, action: SceneAction, baseUrl: string, observer?: ActionObserver) => {
  await observer?.beforeAction?.(action, page);

  switch (action.type) {
    case "navigate": {
      const url = new URL(action.url, baseUrl).toString();
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("page.goto: Timeout")) {
          throw error;
        }
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1500);
      }
      break;
    }
    case "wait": {
      await page.waitForTimeout(action.ms);
      break;
    }
    case "scroll": {
      await page.evaluate((y) => window.scrollBy({ top: y, behavior: "instant" }), action.y);
      break;
    }
    case "scrollIntoView": {
      await resolveLocator(page, action.target).first().scrollIntoViewIfNeeded();
      break;
    }
    case "click": {
      await resolveLocator(page, action.target).first().click();
      break;
    }
    case "hover": {
      await resolveLocator(page, action.target).first().hover();
      break;
    }
    case "fill": {
      await resolveLocator(page, action.target).first().fill(action.value);
      break;
    }
    case "press": {
      await page.keyboard.press(action.key);
      break;
    }
    case "select": {
      await resolveLocator(page, action.target).first().selectOption(action.value);
      break;
    }
    case "dragSelect": {
      const box = await resolveLocator(page, action.target).first().boundingBox();
      if (!box) {
        throw new Error("Unable to drag-select target because no bounding box was found.");
      }

      const startX = box.x + box.width * (action.startX ?? 0.08);
      const startY = box.y + box.height * (action.startY ?? 0.12);
      const endX = box.x + box.width * (action.endX ?? 0.7);
      const endY = box.y + box.height * (action.endY ?? action.startY ?? 0.12);

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(endX, endY, { steps: 18 });
      await page.mouse.up();
      break;
    }
    case "waitForText": {
      await page
        .getByText(action.value, { exact: action.exact })
        .first()
        .waitFor({ timeout: action.timeoutMs ?? 10000 });
      break;
    }
    case "waitForUrl": {
      const urlMatcher =
        action.value.startsWith("http://") ||
        action.value.startsWith("https://") ||
        action.value.includes("*")
          ? action.value
          : new URL(action.value, baseUrl).toString();
      await page.waitForURL(urlMatcher, { timeout: action.timeoutMs ?? 10000 });
      break;
    }
  }

  await observer?.afterAction?.(action, page);
};

const isInteractiveAction = (action: SceneAction) =>
  action.type === "click" ||
  action.type === "hover" ||
  action.type === "fill" ||
  action.type === "press" ||
  action.type === "select" ||
  action.type === "dragSelect";

const preflightActionsFor = (actions: SceneAction[]) => {
  const boundaryIndex = actions.findIndex(isInteractiveAction);
  return boundaryIndex === -1 ? actions : actions.slice(0, boundaryIndex);
};

const firstInteractiveActionFor = (actions: SceneAction[]) => actions.find(isInteractiveAction);

const validateInteractiveTarget = async (page: Page, action: SceneAction) => {
  switch (action.type) {
    case "click":
    case "hover":
    case "fill":
    case "select":
    case "dragSelect": {
      await resolveLocator(page, action.target).first().waitFor({ state: "visible", timeout: 10000 });
      return;
    }
    case "press": {
      return;
    }
    default:
      return;
  }
};

const attachErrorCollectors = (page: Page, errors: string[]) => {
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
};

const centerOfBox = (box: { x: number; y: number; width: number; height: number } | null | undefined) => {
  if (!box) return undefined;
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    width: box.width,
    height: box.height,
  };
};

const captureBoxForAction = async (page: Page, action: SceneAction) => {
  switch (action.type) {
    case "click":
    case "hover":
    case "fill":
    case "select":
    case "dragSelect": {
      return centerOfBox(await resolveLocator(page, action.target).first().boundingBox().catch(() => null));
    }
    case "waitForText": {
      return centerOfBox(
        await page.getByText(action.value, { exact: action.exact }).first().boundingBox().catch(() => null),
      );
    }
    case "scroll": {
      const viewport = page.viewportSize();
      if (!viewport) return undefined;
      return {
        x: viewport.width / 2,
        y: viewport.height / 2,
        width: viewport.width * 0.8,
        height: viewport.height * 0.7,
      };
    }
    case "scrollIntoView": {
      return centerOfBox(await resolveLocator(page, action.target).first().boundingBox().catch(() => null));
    }
    default:
      return undefined;
  }
};

const runExplorationPass = async (
  browser: Browser,
  scene: DemoPlan["scenes"][number],
  baseUrl: string,
  outputDir: string,
) => {
  const session = resolveSessionConfig(outputDir);
  const context = await browser.newContext(
    await getContextOptionsWithSession({ viewport: scene.viewport }, session),
  );
  const page = await context.newPage();
  const errors: string[] = [];
  attachErrorCollectors(page, errors);

  try {
    for (const action of preflightActionsFor(scene.actions)) {
      await runAction(page, action, baseUrl);
    }

    const firstInteractiveAction = firstInteractiveActionFor(scene.actions);
    if (firstInteractiveAction) {
      await validateInteractiveTarget(page, firstInteractiveAction);
    }

    await page.waitForLoadState("networkidle").catch(() => undefined);
    await persistSessionState(page, session);

    return {
      title: await page.title().catch(() => undefined),
      url: page.url(),
      errors,
    };
  } finally {
    await context.close();
  }
};

const runRecordingPass = async (
  browser: Browser,
  scene: DemoPlan["scenes"][number],
  baseUrl: string,
  paths: { screenshotsDir: string; videosDir: string; tempVideoDir: string; outputDir: string },
) => {
  const session = resolveSessionConfig(paths.outputDir);
  const context = await browser.newContext(
    await getContextOptionsWithSession(
      {
        viewport: scene.viewport,
        recordVideo: {
          dir: paths.tempVideoDir,
          size: scene.viewport,
        },
      },
      session,
    ),
  );
  const page = await context.newPage();
  const errors: string[] = [];
  const events: CaptureEvent[] = [];
  attachErrorCollectors(page, errors);
  const recordedVideo = page.video();
  const recordingStartedAt = Date.now();

  try {
    for (const action of scene.actions) {
      let pendingBox: Awaited<ReturnType<typeof captureBoxForAction>>;
      await runAction(page, action, baseUrl, {
        beforeAction: async (currentAction, currentPage) => {
          pendingBox = await captureBoxForAction(currentPage, currentAction);
          if (currentAction.type === "navigate") {
            const viewport = currentPage.viewportSize();
            if (viewport) {
              events.push({
                type: currentAction.type,
                atMs: Date.now() - recordingStartedAt,
                x: viewport.width / 2,
                y: viewport.height / 2,
                width: viewport.width,
                height: viewport.height,
              });
            }
          }
        },
        afterAction: async (currentAction, currentPage) => {
          const box = pendingBox ?? (await captureBoxForAction(currentPage, currentAction));
          events.push({
            type: currentAction.type,
            atMs: Date.now() - recordingStartedAt,
            x: box?.x,
            y: box?.y,
            width: box?.width,
            height: box?.height,
          });
        },
      });
    }

    await page.waitForLoadState("networkidle").catch(() => undefined);
    const viewport = page.viewportSize();
    if (viewport) {
      events.push({
        type: "stable",
        atMs: Date.now() - recordingStartedAt,
        x: viewport.width / 2,
        y: viewport.height / 2,
        width: viewport.width,
        height: viewport.height,
      });
    }

    const screenshotPath = join(paths.screenshotsDir, `${scene.id}.png`);
    await page.screenshot({ path: screenshotPath });

    const pageTitle = await page.title().catch(() => undefined);
    const currentUrl = page.url();
    await persistSessionState(page, session);

    await context.close();

    const videoPath = join(paths.videosDir, `${scene.id}.webm`);
    let videoSrc: string | undefined;

    if (recordedVideo) {
      await recordedVideo.saveAs(videoPath).catch(() => undefined);
      videoSrc = await fileToDataUri(videoPath).catch(() => undefined);
    }

    return {
      pageTitle,
      currentUrl,
      screenshotPath,
      screenshotSrc: await fileToDataUri(screenshotPath).catch(() => undefined),
      videoPath,
      videoSrc,
      errors,
      events,
    };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
};

export const capturePlan = async (
  plan: DemoPlan,
  options: { baseUrl: string; outputDir: string },
): Promise<CaptureArtifact[]> => {
  const browser = await chromium.launch({ headless: true });
  const artifacts: CaptureArtifact[] = [];
  const videosDir = join(options.outputDir, "videos");
  const screenshotsDir = join(options.outputDir, "screenshots");
  const tempVideoDir = join(options.outputDir, ".playwright-videos");

  await mkdir(screenshotsDir, { recursive: true });
  await mkdir(videosDir, { recursive: true });
  await mkdir(tempVideoDir, { recursive: true });

  try {
    for (const scene of plan.scenes) {
      const exploration = await runExplorationPass(browser, scene, options.baseUrl, options.outputDir);
      const recording = await runRecordingPass(browser, scene, options.baseUrl, {
        screenshotsDir,
        videosDir,
        tempVideoDir,
        outputDir: options.outputDir,
      });

      artifacts.push({
        sceneId: scene.id,
        sceneTitle: scene.title,
        url: recording.currentUrl,
        screenshotPath: recording.screenshotPath,
        screenshotSrc: recording.screenshotSrc,
        videoPath: recording.videoSrc ? recording.videoPath : undefined,
        videoSrc: recording.videoSrc,
        viewport: scene.viewport,
        title: recording.pageTitle ?? exploration.title,
        events: recording.events,
      });

      const mergedErrors = [...exploration.errors, ...recording.errors];
      if (mergedErrors.length > 0) {
        console.warn(`[capture:${scene.id}] browser errors`, mergedErrors);
      }
    }
  } finally {
    await browser.close();
  }

  return artifacts;
};
