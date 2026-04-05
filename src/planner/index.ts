import type { ProjectConfig } from "../config/project.js";
import type { DemoPlan, DiffContext } from "../types.js";
import { buildHeuristicPlan } from "./heuristic.js";
import { buildLlmPlan } from "./llm.js";

const allowHeuristicFallback = process.env.DEMO_AI_MANDATORY === "false";

export const buildDemoPlan = async (context: DiffContext, projectConfig?: ProjectConfig): Promise<DemoPlan> => {
  try {
    const llmPlan = await buildLlmPlan(context, projectConfig);
    if (llmPlan) {
      return llmPlan;
    }
  } catch (error) {
    if (!allowHeuristicFallback) {
      throw error;
    }
    console.warn("LLM planner failed, falling back to the heuristic planner", error);
  }

  if (!allowHeuristicFallback) {
    throw new Error("AI provider did not return a plan. Set DEMO_AI_MANDATORY=false to allow heuristic fallback.");
  }

  return buildHeuristicPlan(context, projectConfig);
};
