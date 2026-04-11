/**
 * Prompt-driven demo planner.
 *
 * Instead of starting from a git diff, this planner takes a natural language
 * prompt ("show the Magic Inbox, filter by positive replies, open a thread")
 * and generates a DemoPlan by:
 *
 *   1. Launching Playwright to explore the target site
 *   2. Taking screenshots + collecting interactive elements from key pages
 *   3. Sending the screenshots + element inventory + user prompt to an LLM
 *   4. Parsing the LLM response into a validated DemoPlan
 *
 * This gives users a zero-config, one-shot way to create demos.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import {
  getContextOptionsWithSession,
  resolveSessionConfig,
} from "../browser/session.js";
import type { ProjectConfig } from "../config/project.js";
import { summarizeProjectHints } from "../config/project.js";
import { requestAiJson } from "../ai/provider.js";
import type { DemoPlan } from "../types.js";
import { demoPlanSchema } from "./schema.js";

// ---------------------------------------------------------------------------
// Page exploration
// ---------------------------------------------------------------------------

interface PageSnapshot {
  url: string;
  title: string;
  headings: string[];
  textPreview: string;
  interactiveElements: Array<{
    tag: string;
    role: string;
    name: string;
    text?: string;
    label?: string;
    placeholder?: string;
    href?: string;
    testId?: string;
  }>;
  navLinks: Array<{ text: string; href: string }>;
}

const EXPLORE_SCRIPT = `(() => {
  function norm(v) { return (v||"").replace(/\\s+/g," ").trim().slice(0,140); }
  function vis(el) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width>0 && r.height>0 && s.visibility!=="hidden" && s.display!=="none" && s.opacity!=="0";
  }
  function role(el) {
    const r = el.getAttribute("role"); if(r) return r;
    const t = el.tagName.toLowerCase();
    if(t==="a") return "link"; if(t==="button") return "button";
    if(t==="select") return "combobox"; if(t==="textarea") return "textbox";
    if(t==="input") { const tp=(el.type||"text").toLowerCase(); return ["submit","button"].includes(tp)?"button":"textbox"; }
    return t;
  }
  function name(el) {
    return norm(el.getAttribute("aria-label")) || norm(el.placeholder) || norm(el.textContent) || role(el);
  }
  const sels = "button,a[href],input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[data-testid]";
  const elems = Array.from(document.querySelectorAll(sels)).filter(vis).slice(0,50).map(el => ({
    tag: el.tagName.toLowerCase(), role: role(el), name: name(el),
    text: norm(el.textContent)||undefined, label: undefined,
    placeholder: norm(el.placeholder)||undefined,
    href: el.href||undefined, testId: el.getAttribute("data-testid")||undefined,
  }));
  const headings = Array.from(document.querySelectorAll("h1,h2,h3")).map(h=>norm(h.textContent)).filter(Boolean).slice(0,10);
  const text = norm(document.body?.innerText).slice(0,800);
  const navLinks = Array.from(document.querySelectorAll("nav a[href], aside a[href], [role=navigation] a[href]"))
    .filter(vis).slice(0,20).map(a => ({ text: norm(a.textContent), href: a.href }));
  return { headings, textPreview: text, interactiveElements: elems, navLinks };
})()`;

const collectPageSnapshot = async (page: Page): Promise<PageSnapshot> => {
  const data = await page.evaluate(EXPLORE_SCRIPT) as Omit<PageSnapshot, "url" | "title">;
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    ...data,
  };
};

// ---------------------------------------------------------------------------
// Site exploration: visit landing + follow key nav links
// ---------------------------------------------------------------------------

interface SiteExploration {
  pages: PageSnapshot[];
  screenshotPaths: string[];
}

const exploreSite = async (
  baseUrl: string,
  outputDir: string,
  projectConfig?: ProjectConfig,
): Promise<SiteExploration> => {
  const screenshotDir = join(outputDir, "exploration");
  await mkdir(screenshotDir, { recursive: true });

  const session = resolveSessionConfig(outputDir);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    await getContextOptionsWithSession(
      { viewport: { width: 1440, height: 900 } },
      session,
    ),
  );
  const page = await context.newPage();

  const pages: PageSnapshot[] = [];
  const screenshotPaths: string[] = [];
  const visited = new Set<string>();

  // Determine which URLs to explore
  const startUrls = ["/"];
  if (projectConfig?.preferredRoutes) {
    startUrls.push(...projectConfig.preferredRoutes);
  }

  try {
    for (const route of startUrls) {
      const fullUrl = new URL(route, baseUrl).toString();
      const normalized = new URL(fullUrl).pathname;
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      try {
        await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 20000 });
      } catch {
        try {
          await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForTimeout(1500);
        } catch {
          continue;
        }
      }

      const snapshot = await collectPageSnapshot(page);
      pages.push(snapshot);

      const ssPath = join(screenshotDir, `page-${pages.length}.png`);
      await page.screenshot({ path: ssPath });
      screenshotPaths.push(ssPath);

      // Follow nav links we haven't visited (up to 4 total pages)
      if (pages.length >= 4) break;

      for (const link of snapshot.navLinks) {
        if (pages.length >= 4) break;
        try {
          const linkPath = new URL(link.href).pathname;
          if (visited.has(linkPath)) continue;
          if (!link.href.startsWith(baseUrl)) continue;
          visited.add(linkPath);

          await page.goto(link.href, { waitUntil: "networkidle", timeout: 15000 });
          const navSnapshot = await collectPageSnapshot(page);
          pages.push(navSnapshot);

          const navSsPath = join(screenshotDir, `page-${pages.length}.png`);
          await page.screenshot({ path: navSsPath });
          screenshotPaths.push(navSsPath);
        } catch {
          continue;
        }
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return { pages, screenshotPaths };
};

// ---------------------------------------------------------------------------
// LLM prompt construction
// ---------------------------------------------------------------------------

const buildPromptPlannerPrompt = (
  userPrompt: string,
  exploration: SiteExploration,
  projectConfig?: ProjectConfig,
): string => {
  const pageDescriptions = exploration.pages.map((p, i) => {
    const elements = p.interactiveElements
      .map((el) => {
        const parts = [`${el.role}: "${el.name}"`];
        if (el.href) parts.push(`→ ${el.href}`);
        if (el.placeholder) parts.push(`(placeholder: "${el.placeholder}")`);
        if (el.testId) parts.push(`[data-testid="${el.testId}"]`);
        return `    ${parts.join(" ")}`;
      })
      .join("\n");

    return [
      `Page ${i + 1}: ${p.title}`,
      `  URL: ${p.url}`,
      `  Headings: ${p.headings.join(" | ")}`,
      `  Content preview: ${p.textPreview.slice(0, 300)}`,
      `  Interactive elements (${p.interactiveElements.length}):`,
      elements,
    ].join("\n");
  });

  return [
    "You are a product demo director.",
    "A user wants to create a demo video of their web app with a single prompt.",
    "",
    "USER PROMPT:",
    `"${userPrompt}"`,
    "",
    "SITE EXPLORATION:",
    "I visited the app and found these pages with their interactive elements:",
    "",
    ...pageDescriptions,
    "",
    "INSTRUCTIONS:",
    "1. Create 3-6 scenes that tell the story the user described.",
    "2. Each scene should have specific, executable actions (navigate, click, hover, fill, scroll, wait, press).",
    "3. Use REAL element selectors from the exploration above. Prefer strategy: 'text' or 'role' with the exact name/text shown.",
    "4. Write narration that sounds like a human giving a product tour — conversational, not robotic.",
    "5. All URLs must be relative paths (e.g., /inbox not https://app.example.com/inbox).",
    "6. Keep durationMs between 4000 and 9000 per scene.",
    "7. Start with a navigate action in the first scene.",
    "8. Add wait actions (300-800ms) between interactions for pacing.",
    "9. Use scroll actions to reveal below-the-fold content when relevant.",
    "",
    "ACTION TARGET STRATEGIES (use these exact formats):",
    '  { "strategy": "text", "value": "Button Text", "exact": false }  — match by visible text',
    '  { "strategy": "role", "role": "button", "name": "Submit" }      — match by ARIA role + name',
    '  { "strategy": "css", "value": ".my-class" }                     — CSS selector',
    '  { "strategy": "placeholder", "value": "Search..." }             — match by placeholder',
    '  { "strategy": "testId", "value": "my-test-id" }                 — match by data-testid',
    "",
    "Project hints:",
    JSON.stringify(summarizeProjectHints(projectConfig ?? {}), null, 2),
    "",
    "EXACT JSON SCHEMA (follow this structure precisely):",
    JSON.stringify({
      title: "Demo Title",
      summary: "One sentence summary",
      branch: "prompt",
      generatedAt: "2026-01-01T00:00:00.000Z",
      scenes: [{
        id: "scene-1",
        title: "Scene Title",
        goal: "What this scene demonstrates",
        url: "/relative-path",
        viewport: { width: 1440, height: 900 },
        actions: [
          { type: "navigate", url: "/relative-path" },
          { type: "wait", ms: 500 },
          { type: "click", target: { strategy: "text", value: "Button Text", exact: false } },
          { type: "hover", target: { strategy: "role", role: "button", name: "Name" } },
          { type: "scroll", y: 200 },
          { type: "fill", target: { strategy: "placeholder", value: "Search..." }, value: "typed text" },
        ],
        narration: "Conversational narration for this scene.",
        caption: "Short caption",
        durationMs: 6000,
        evidenceHints: [],
      }],
    }, null, 2),
    "",
    "Output a strict JSON DemoPlan following the schema above. No markdown, no explanation.",
  ].join("\n");
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const buildPromptPlan = async (options: {
  prompt: string;
  baseUrl: string;
  outputDir: string;
  projectConfig?: ProjectConfig;
}): Promise<DemoPlan> => {
  // Step 1: Explore the site
  const exploration = await exploreSite(
    options.baseUrl,
    options.outputDir,
    options.projectConfig,
  );

  if (exploration.pages.length === 0) {
    throw new Error("Could not load any pages from " + options.baseUrl);
  }

  // Step 2: Ask LLM to generate a plan
  const prompt = buildPromptPlannerPrompt(
    options.prompt,
    exploration,
    options.projectConfig,
  );

  const plan = await requestAiJson({
    system:
      "You are a product demo director. You create demo plans from natural language prompts. " +
      "You have been given a site exploration with real page content and interactive elements. " +
      "Use ONLY elements that actually exist on the pages. Output strict JSON only.",
    prompt,
    schema: demoPlanSchema,
    temperature: 0.3,
  });

  if (!plan) {
    throw new Error(
      "AI provider could not generate a plan. Set DEMO_OPENAI_API_KEY or use a local AI provider.",
    );
  }

  return {
    ...plan,
    branch: "prompt",
    generatedAt: new Date().toISOString(),
    scenes: plan.scenes.map((scene) => ({
      ...scene,
      evidenceHints: scene.evidenceHints ?? [],
    })),
  };
};
