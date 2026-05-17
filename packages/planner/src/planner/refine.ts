import type { DemoPlan, DemoScene, PageProbe, ProbeSnapshot, SceneAction } from "@demo-dev/types";
import { requestAiJson } from "@demo-dev/ai";
import { demoPlanSchema } from "./schema.js";

const ACTIONABLE_NAME_RE =
  /get started|start|continue|next|learn more|try demo|demo|explore|open|view|create|new|save|submit|search/i;
const NEGATIVE_NAME_RE = /delete|remove|logout|log out|sign out|cancel/i;

const snapshotFor = (probe: PageProbe): ProbeSnapshot => (probe.followUp && !probe.followUp.error ? probe.followUp : probe.initial);

const normalizeTargetAction = (scene: DemoScene, probe: PageProbe): SceneAction[] => {
  const initial = probe.initial;
  const active = snapshotFor(probe);
  const actions: SceneAction[] = [{ type: "navigate", url: scene.url }];

  if (initial.headings[0]) {
    actions.push({ type: "waitForText", value: initial.headings[0], timeoutMs: 10000 });
  } else {
    actions.push({ type: "wait", ms: 1200 });
  }

  const searchField = initial.interactiveElements.find(
    (element) =>
      element.role === "textbox" &&
      /search/i.test([element.name, element.label, element.placeholder].filter(Boolean).join(" ")),
  );

  if (searchField?.placeholder) {
    actions.push({
      type: "fill",
      target: { strategy: "placeholder", value: searchField.placeholder },
      value: "demo",
    });
    actions.push({ type: "press", key: "Enter" });
    actions.push({ type: "wait", ms: 1200 });
    if (active !== initial && active.headings[0] && active.headings[0] !== initial.headings[0]) {
      actions.push({ type: "waitForText", value: active.headings[0], timeoutMs: 10000 });
    }
    return actions;
  }

  const primaryAction = initial.interactiveElements.find(
    (element) =>
      ["button", "link", "tab"].includes(element.role) &&
      ACTIONABLE_NAME_RE.test(element.name) &&
      !NEGATIVE_NAME_RE.test(element.name),
  );

  if (primaryAction) {
    actions.push({
      type: "click",
      target: primaryAction.testId
        ? { strategy: "testId", value: primaryAction.testId }
        : { strategy: "role", role: primaryAction.role, name: primaryAction.name, exact: false },
    });

    if (probe.followUp?.resolvedUrl && probe.followUp.resolvedUrl !== initial.resolvedUrl) {
      actions.push({ type: "waitForUrl", value: probe.followUp.resolvedUrl, timeoutMs: 10000 });
    } else {
      actions.push({ type: "wait", ms: 1200 });
    }

    if (probe.followUp?.headings[0] && probe.followUp.headings[0] !== initial.headings[0]) {
      actions.push({ type: "waitForText", value: probe.followUp.headings[0], timeoutMs: 10000 });
    }

    return actions;
  }

  actions.push({ type: "scroll", y: 360 });
  actions.push({ type: "wait", ms: 400 });
  return actions;
};

const allowHeuristicFallback = process.env.DEMO_AI_MANDATORY === "false";

const buildRefinementPrompt = (context: {
  initialPlan: DemoPlan;
  probes: PageProbe[];
}) => {
  return [
    "You are a product demo director. You already have an initial scene plan and real browser probe output.",
    "Task: revise the initial plan into a more executable browser plan.",
    "Rules:",
    "1. Only use headings, buttons, links, inputs, and placeholders that actually appear in the probes.",
    "2. If a followUp probe exists, prefer turning it into a multi-step flow such as click -> waitForUrl -> waitForText.",
    "3. Do not invent labels, buttons, or text that were not observed.",
    "4. If a probe failed, keep the scene as a page-level presentation.",
    "5. Prefer stable flows: navigate -> waitForText -> click/fill -> waitForUrl/waitForText.",
    "6. If no reliable element exists, keep the scene simple instead of forcing a complex form flow.",
    "7. Return full JSON matching the original plan shape.",
    "",
    "Initial plan:",
    JSON.stringify(context.initialPlan, null, 2),
    "",
    "Probe results:",
    JSON.stringify(context.probes, null, 2),
  ].join("\n");
};

export const refineDemoPlan = async (options: {
  initialPlan: DemoPlan;
  probes: PageProbe[];
}): Promise<DemoPlan> => {
  try {
    const refined = await requestAiJson({
      system:
        "You refine browser demo plans using only observed page probes. Prefer concise multi-step flows when a follow-up page state was observed. Keep outputs executable and JSON-only.",
      prompt: buildRefinementPrompt(options),
      schema: demoPlanSchema,
      temperature: 0.2,
    });

    if (refined) {
      return {
        ...refined,
        branch: options.initialPlan.branch,
        generatedAt: new Date().toISOString(),
        scenes: refined.scenes.map((scene) => ({
          ...scene,
          evidenceHints: scene.evidenceHints ?? [],
        })),
      };
    }
  } catch (error) {
    if (!allowHeuristicFallback) {
      throw error;
    }
    console.warn("LLM refinement failed, fallback to heuristic refinement", error);
  }

  if (!allowHeuristicFallback) {
    throw new Error("AI provider did not return a refined plan. Set DEMO_AI_MANDATORY=false to allow heuristic fallback.");
  }

  const probeBySceneId = new Map(options.probes.map((probe) => [probe.sceneId, probe]));

  return {
    ...options.initialPlan,
    summary: `${options.initialPlan.summary} Refined using real page probes.`,
    generatedAt: new Date().toISOString(),
    scenes: options.initialPlan.scenes.map((scene) => {
      const probe = probeBySceneId.get(scene.id);
      if (!probe || probe.initial.error) return scene;

      const active = snapshotFor(probe);

      return {
        ...scene,
        caption: active.pageTitle ? `${scene.title} · ${active.pageTitle}` : scene.caption,
        actions: normalizeTargetAction(scene, probe),
      };
    }),
  };
};
