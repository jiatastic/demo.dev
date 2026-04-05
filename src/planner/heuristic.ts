import type { ProjectConfig } from "../config/project.js";
import type { DemoPlan, DemoScene, DiffContext } from "../types.js";

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

const isUserFacingFile = (file: string) => {
  const normalized = file.replaceAll("\\", "/").toLowerCase();
  if (normalized.startsWith(".")) return false;
  if (/package(-lock)?\.json$/.test(normalized)) return false;
  if (/readme\.md$/.test(normalized)) return false;
  if (/^(src\/)?(lib|utils|server|scripts)\//.test(normalized)) return false;
  return /(^app\/|^pages\/|^src\/app\/|^src\/pages\/|component|route|screen|view|layout)/.test(normalized);
};

const normalizeRoute = (route: string) => {
  if (!route.startsWith("/")) return `/${route}`.replace(/\/+/g, "/");
  return route.replace(/\/+/g, "/");
};

const routeFromFile = (file: string, projectConfig?: ProjectConfig) => {
  const normalized = file.replaceAll("\\", "/");
  const routeLike = normalized
    .replace(/^src\//, "")
    .replace(/^app\//, "")
    .replace(/^pages\//, "")
    .replace(/\/page\.(tsx|ts|jsx|js)$/, "")
    .replace(/\.(tsx|ts|jsx|js|mdx)$/, "")
    .replace(/\/index$/, "");

  if (!routeLike || routeLike.startsWith("components/") || routeLike.startsWith("lib/")) {
    return "/";
  }

  const inferredRoute = normalizeRoute(routeLike);
  const hintedRoute = projectConfig?.preferredRoutes?.find((route) => inferredRoute.startsWith(normalizeRoute(route)));
  return hintedRoute ?? inferredRoute;
};

const classifyScene = (file: string) => {
  const lower = file.toLowerCase();

  if (/(login|signin|auth)/.test(lower)) {
    return {
      title: "Authentication flow",
      goal: "Show the user-facing authentication changes introduced by this PR.",
      narration: "This update tightens the authentication experience so users can get into the product faster.",
    };
  }

  if (/(signup|register|onboarding)/.test(lower)) {
    return {
      title: "First-run onboarding",
      goal: "Show how the first-run user journey has improved.",
      narration: "This scene focuses on a smoother first-run experience.",
    };
  }

  if (/(dashboard|home|overview)/.test(lower)) {
    return {
      title: "Core workspace",
      goal: "Show the main workspace where users feel the biggest product changes.",
      narration: "This scene highlights the most visible product changes in the core workspace.",
    };
  }

  if (/(settings|profile|account)/.test(lower)) {
    return {
      title: "Settings and personalization",
      goal: "Show how configuration and account flows have improved.",
      narration: "This section emphasizes clearer, more controllable settings.",
    };
  }

  if (/(search|discover|explore)/.test(lower)) {
    return {
      title: "Search and discovery",
      goal: "Show the updated discovery path for users.",
      narration: "This scene focuses on how search and discovery feel better in the updated product.",
    };
  }

  return {
    title: "Feature overview",
    goal: "Show the visible product changes introduced by this PR.",
    narration: "This segment quickly summarizes the feature update.",
  };
};

const dedupeByUrl = (scenes: DemoScene[]) => {
  const seen = new Set<string>();
  return scenes.filter((scene) => {
    if (seen.has(scene.url)) return false;
    seen.add(scene.url);
    return true;
  });
};

const buildSceneFromRoute = (route: string, index: number, hint?: string): DemoScene => ({
  id: `scene-${String(index + 1).padStart(2, "0")}`,
  title: hint ? `${hint} walkthrough` : "Feature walkthrough",
  goal: hint ? `Show the ${hint} experience in the product.` : "Show a meaningful product surface from this PR.",
  url: normalizeRoute(route),
  viewport: DEFAULT_VIEWPORT,
  actions: [
    { type: "navigate", url: normalizeRoute(route) },
    { type: "wait", ms: 1200 },
    { type: "scroll", y: 320 },
    { type: "wait", ms: 400 },
  ],
  narration: hint
    ? `This scene highlights ${hint} inside the product.`
    : "This scene captures a key product surface from the updated app.",
  caption: hint ? `${hint} · ${normalizeRoute(route)}` : `Feature walkthrough · ${normalizeRoute(route)}`,
  durationMs: 4200,
  evidenceHints: hint ? [hint] : [],
});

export const buildHeuristicPlan = (context: DiffContext, projectConfig?: ProjectConfig): DemoPlan => {
  const candidateFiles = context.changedFiles.filter(isUserFacingFile);

  const scenes = dedupeByUrl(
    candidateFiles.slice(0, 5).map((file, index) => {
      const classification = classifyScene(file);
      const url = routeFromFile(file, projectConfig);

      return {
        id: `scene-${String(index + 1).padStart(2, "0")}`,
        title: classification.title,
        goal: classification.goal,
        url,
        viewport: DEFAULT_VIEWPORT,
        actions: [
          { type: "navigate", url },
          { type: "wait", ms: 1200 },
          { type: "scroll", y: 420 },
          { type: "wait", ms: 500 },
        ],
        narration: classification.narration,
        caption: `${classification.title} · ${url}`,
        durationMs: 4500,
        evidenceHints: [file],
      } satisfies DemoScene;
    }),
  );

  const hintedScenes = scenes.length === 0
    ? (projectConfig?.preferredRoutes ?? []).slice(0, 4).map((route, index) => buildSceneFromRoute(route, index, projectConfig?.featureHints?.[index]))
    : scenes;

  return {
    title: `PR Demo · ${context.currentBranch}`,
    summary:
      hintedScenes.length > 0
        ? `Generated a demo plan from ${hintedScenes.length} user-facing route${hintedScenes.length === 1 ? "" : "s"}.`
        : "Could not infer a specific route from the diff, so the plan falls back to the home page.",
    branch: context.currentBranch,
    generatedAt: new Date().toISOString(),
    scenes:
      hintedScenes.length > 0
        ? hintedScenes
        : [
            {
              id: "scene-01",
              title: "Home overview",
              goal: "Capture the home surface when no stronger route signal is available.",
              url: "/",
              viewport: DEFAULT_VIEWPORT,
              actions: [
                { type: "navigate", url: "/" },
                { type: "wait", ms: 1200 },
                { type: "scroll", y: 300 },
              ],
              narration: "The diff does not expose a clear product route, so the demo starts from the home surface.",
              caption: "Home overview",
              durationMs: 4000,
              evidenceHints: context.changedFiles,
            },
          ],
  };
};
