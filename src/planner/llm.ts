import type { ProjectConfig } from "../config/project.js";
import { summarizeProjectHints } from "../config/project.js";
import type { DemoPlan, DiffContext } from "../types.js";
import { requestAiJson } from "../ai/provider.js";
import { demoPlanSchema } from "./schema.js";

const buildPlannerPrompt = (context: DiffContext, projectConfig?: ProjectConfig) => {
  return [
    "You are a product demo director creating a polished product walkthrough video.",
    "Goal: turn a git diff into a concise, recordable, voice-friendly demo plan.",
    "Requirements:",
    "1. Pick only 2-4 scenes that best represent visible user-facing changes.",
    "2. Keep actions stable and executable. Prefer navigate / click / fill / waitForText / waitForUrl / scroll.",
    "3. If the diff does not reveal specific elements, do not invent complex actions. Fall back to page-level presentation.",
    "4. narration should sound conversational and human — like giving a product tour to a friend, not reading a test report.",
    "5. Output strict JSON only, with no markdown explanation.",
    "6. All URLs must be in-app relative paths such as /dashboard.",
    "7. Keep captions short enough for on-screen usage.",
    "8. Keep durationMs between 3000 and 8000.",
    "9. Prefer routes and feature surfaces hinted by the project config when relevant.",
    "",
    "Supported target examples:",
    JSON.stringify(
      {
        strategy: "role",
        role: "button",
        name: "Sign in",
      },
      null,
      2,
    ),
    JSON.stringify(
      {
        strategy: "label",
        value: "Email",
      },
      null,
      2,
    ),
    JSON.stringify(
      {
        strategy: "text",
        value: "Welcome",
      },
      null,
      2,
    ),
    "",
    "Project hints:",
    JSON.stringify(summarizeProjectHints(projectConfig ?? {}), null, 2),
    "",
    "Plan from the following context:",
    JSON.stringify(
      {
        branch: context.currentBranch,
        baseRef: context.baseRef,
        changedFiles: context.changedFiles.slice(0, 20),
        diffPreview: context.diffPreview,
      },
      null,
      2,
    ),
  ].join("\n");
};

export const buildLlmPlan = async (context: DiffContext, projectConfig?: ProjectConfig): Promise<DemoPlan | null> => {
  const normalized = await requestAiJson({
    system: "You create concise, production-ready demo plans for product videos. Output strict JSON only.",
    prompt: buildPlannerPrompt(context, projectConfig),
    schema: demoPlanSchema,
    temperature: 0.4,
  });

  if (!normalized) return null;

  return {
    ...normalized,
    branch: context.currentBranch,
    generatedAt: new Date().toISOString(),
    scenes: normalized.scenes.map((scene) => ({
      ...scene,
      evidenceHints: scene.evidenceHints ?? [],
    })),
  };
};
