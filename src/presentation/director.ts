import type { DemoPlan, DemoScene, FocusRegion, SceneDirection } from "../types.js";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const region = (x: number, y: number, width: number, height: number, label?: string): FocusRegion => ({
  x: clamp(x, 0, 1),
  y: clamp(y, 0, 1),
  width: clamp(width, 0.12, 1),
  height: clamp(height, 0.12, 1),
  label,
});

const inferDirection = (scene: DemoScene, index: number): SceneDirection => {
  if (scene.direction) return scene.direction;

  const haystack = [scene.title, scene.caption, scene.goal, scene.url].join(" ").toLowerCase();

  if (haystack.includes("inbox") || haystack.includes("workflow") || haystack.includes("flow")) {
    return {
      shot: "workflow",
      cameraMove: "pan-right",
      accentColor: "#d7c8b5",
      focusRegion: region(0.08, 0.15, 0.42, 0.68, "Workflow focus"),
    };
  }

  if (
    haystack.includes("action") ||
    haystack.includes("todo") ||
    haystack.includes("task") ||
    haystack.includes("next step") ||
    haystack.includes("ready")
  ) {
    return {
      shot: "detail",
      cameraMove: "push-in",
      accentColor: "#c9d6cc",
      focusRegion: region(0.1, 0.28, 0.8, 0.45, "Actionable work"),
    };
  }

  if (index === 0) {
    return {
      shot: "hero",
      cameraMove: "push-in",
      accentColor: "#ded6c8",
      focusRegion: region(0.08, 0.1, 0.84, 0.38, "Command center"),
    };
  }

  return {
    shot: "detail",
    cameraMove: index % 2 === 0 ? "pan-right" : "pan-left",
    accentColor: index % 2 === 0 ? "#ded6c8" : "#c9d6cc",
    focusRegion: region(0.16, 0.18, 0.68, 0.5, "Key product moment"),
  };
};

export const directPresentationPlan = async (plan: DemoPlan): Promise<DemoPlan> => {
  return {
    ...plan,
    scenes: plan.scenes.map((scene, index) => ({
      ...scene,
      direction: inferDirection(scene, index),
    })),
  };
};
