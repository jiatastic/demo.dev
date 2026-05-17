import { classifyDestructive } from "@demo-dev/core";
import type { DemoPlan, DemoScene } from "@demo-dev/types";

/** Tag scenes that may modify production state. Conservative heuristic — false negatives expected. */
export const annotateDestructiveScenes = (plan: DemoPlan): DemoPlan => ({
  ...plan,
  scenes: plan.scenes.map((scene) => {
    const targetNames = scene.actions
      .map((action) => {
        if ("target" in action && action.target.strategy === "role") return action.target.name;
        if (
          "target" in action &&
          (action.target.strategy === "label" ||
            action.target.strategy === "text" ||
            action.target.strategy === "placeholder")
        ) {
          return action.target.value;
        }
        return undefined;
      })
      .filter((s): s is string => Boolean(s));
    const check = classifyDestructive(scene.title, scene.goal, scene.narration, scene.caption, ...targetNames);
    if (check.destructive) {
      const next: DemoScene = { ...scene, destructive: true, destructiveMatch: check.matched };
      return next;
    }
    return scene;
  }),
});
