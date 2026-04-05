import { chromium, type Page } from "playwright";
import { getContextOptionsWithSession, resolveSessionConfig, persistSessionState } from "../browser/session.js";
import type { ActionTarget, DemoPlan, PageProbe, ProbeSnapshot, SceneAction } from "../types.js";

const PROBE_SCRIPT = String.raw`(() => {
  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim().slice(0, 140);
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      style.opacity !== "0"
    );
  }

  function deriveRole(element) {
    const explicitRole = element.getAttribute("role");
    if (explicitRole) return explicitRole;
    const tag = element.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (["submit", "button"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      return "textbox";
    }
    return tag;
  }

  function deriveName(element) {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelNode = document.getElementById(labelledBy);
      const labelText = normalizeText(labelNode && labelNode.textContent);
      if (labelText) return labelText;
    }

    const ariaLabel = normalizeText(element.getAttribute("aria-label"));
    if (ariaLabel) return ariaLabel;

    const placeholder = normalizeText(element.placeholder);
    if (placeholder) return placeholder;

    const text = normalizeText(element.textContent);
    if (text) return text;

    const value = normalizeText(element.value);
    if (value) return value;

    return deriveRole(element);
  }

  function getLabel(element) {
    const id = element.getAttribute("id");
    if (!id) return undefined;
    const label = document.querySelector('label[for="' + id + '"]');
    return normalizeText(label && label.textContent) || undefined;
  }

  const selectors = [
    "button",
    "a[href]",
    "input",
    "select",
    "textarea",
    "[role=button]",
    "[role=link]",
    "[role=textbox]",
    "[role=tab]",
    "[data-testid]"
  ].join(",");

  const interactiveElements = Array.from(document.querySelectorAll(selectors))
    .filter(isVisible)
    .slice(0, 30)
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      role: deriveRole(element),
      name: deriveName(element),
      text: normalizeText(element.textContent) || undefined,
      label: getLabel(element),
      placeholder: normalizeText(element.placeholder) || undefined,
      type: element.type || undefined,
      href: element.href || undefined,
      testId: element.getAttribute("data-testid") || undefined,
    }));

  const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
    .map((heading) => normalizeText(heading.textContent))
    .filter(Boolean)
    .slice(0, 10);

  const textPreview = normalizeText(document.body && document.body.innerText).slice(0, 500);

  return { interactiveElements, headings, textPreview };
})()`;

const ACTIONABLE_NAME_RE = /get started|start|continue|next|learn more|try demo|demo|explore|open|view|create|new|save|submit|search/i;
const NEGATIVE_NAME_RE = /delete|remove|logout|log out|sign out|cancel/i;

const collectSnapshot = async (page: Page): Promise<ProbeSnapshot> => {
  const collected = (await page.evaluate(PROBE_SCRIPT)) as {
    headings: string[];
    textPreview: string;
    interactiveElements: ProbeSnapshot["interactiveElements"];
  };

  return {
    resolvedUrl: page.url(),
    pageTitle: await page.title().catch(() => undefined),
    headings: collected.headings,
    textPreview: collected.textPreview,
    interactiveElements: collected.interactiveElements,
  };
};

const deriveFollowUpAction = (snapshot: ProbeSnapshot): SceneAction | undefined => {
  const candidate = snapshot.interactiveElements.find(
    (element) =>
      ["button", "link", "tab"].includes(element.role) &&
      ACTIONABLE_NAME_RE.test(element.name) &&
      !NEGATIVE_NAME_RE.test(element.name),
  );

  if (!candidate) return undefined;

  const target: ActionTarget = candidate.testId
    ? { strategy: "testId", value: candidate.testId }
    : { strategy: "role", role: candidate.role, name: candidate.name, exact: false };

  return { type: "click", target };
};

export const probePlanScenes = async (
  plan: DemoPlan,
  options: { baseUrl: string; outputDir?: string },
): Promise<PageProbe[]> => {
  const browser = await chromium.launch({ headless: true });
  const session = resolveSessionConfig(options.outputDir ?? "artifacts");

  try {
    const probes: PageProbe[] = [];

    for (const scene of plan.scenes) {
      const context = await browser.newContext(
        await getContextOptionsWithSession({ viewport: scene.viewport }, session),
      );
      const page = await context.newPage();
      const requestedUrl = new URL(scene.url, options.baseUrl).toString();

      try {
        await page.goto(requestedUrl, { waitUntil: "networkidle" });
        const initial = await collectSnapshot(page);
        const followUpAction = deriveFollowUpAction(initial);

        let followUp: ProbeSnapshot | undefined;
        if (followUpAction?.type === "click") {
          try {
            let locator;
            if (followUpAction.target.strategy === "testId") {
              locator = page.getByTestId(followUpAction.target.value);
            } else if (followUpAction.target.strategy === "role") {
              locator = page.getByRole(followUpAction.target.role as never, {
                name: followUpAction.target.name,
                exact: followUpAction.target.exact,
              });
            } else {
              locator = page.locator("body");
            }

            await locator.first().click();
            await page.waitForLoadState("networkidle").catch(() => undefined);
            followUp = await collectSnapshot(page);
          } catch (error) {
            followUp = {
              headings: [],
              textPreview: "",
              interactiveElements: [],
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }

        await persistSessionState(page, session);

        probes.push({
          sceneId: scene.id,
          sceneTitle: scene.title,
          requestedUrl,
          initial,
          followUpAction,
          followUp,
        });
      } catch (error) {
        probes.push({
          sceneId: scene.id,
          sceneTitle: scene.title,
          requestedUrl,
          initial: {
            headings: [],
            textPreview: "",
            interactiveElements: [],
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }

      await context.close();
    }

    return probes;
  } finally {
    await browser.close();
  }
};
