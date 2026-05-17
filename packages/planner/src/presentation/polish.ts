import type { DemoPlan } from "@demo-dev/types";
import { requestAiJson } from "@demo-dev/ai";
import { z } from "zod";

const polishedPresentationSchema = z.object({
  title: z.string(),
  summary: z.string(),
  scenes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      caption: z.string(),
      narration: z.string(),
    }),
  ),
});

const getPresentationConfig = () => ({
  language: process.env.DEMO_SCRIPT_LANGUAGE ?? "en",
  style: process.env.DEMO_PRESENTATION_STYLE ?? "launch",
});

export const polishPresentationCopy = async (plan: DemoPlan): Promise<DemoPlan> => {
  const config = getPresentationConfig();

  try {
    const polished = await requestAiJson({
      system:
        "You are a world-class product launch copy director. Rewrite demo video copy to sound premium, concise, cinematic, and confident. Output strict JSON only.",
      prompt: [
        `Rewrite the following demo plan copy in ${config.language}.`,
        `Style: ${config.style}. Think product launch / premium SaaS demo, not QA output.`,
        "Rules:",
        "1. Keep the same number of scenes and preserve every scene id exactly.",
        "2. Rewrite only title, caption, narration, plus top-level title and summary.",
        "3. Narration should sound like polished spoken demo copy.",
        "4. Caption should be short, punchy, and on-screen friendly.",
        "5. Title should be product-marketing quality, not generic.",
        "6. Do not mention git diff, tests, heuristics, JSON, or implementation details unless the product truly shows them.",
        "7. English should be natural and launch-video ready.",
        JSON.stringify(
          {
            title: plan.title,
            summary: plan.summary,
            scenes: plan.scenes.map((scene) => ({
              id: scene.id,
              title: scene.title,
              caption: scene.caption,
              narration: scene.narration,
              goal: scene.goal,
            })),
          },
          null,
          2,
        ),
      ].join("\n"),
      schema: polishedPresentationSchema,
      temperature: 0.7,
    });

    if (!polished) return plan;

    const copyBySceneId = new Map(polished.scenes.map((scene) => [scene.id, scene]));

    return {
      ...plan,
      title: polished.title,
      summary: polished.summary,
      scenes: plan.scenes.map((scene) => {
        const copy = copyBySceneId.get(scene.id);
        if (!copy) return scene;
        return {
          ...scene,
          title: copy.title,
          caption: copy.caption,
          narration: copy.narration,
        };
      }),
    };
  } catch (error) {
    console.warn("presentation polish failed, using original copy", error);
    return plan;
  }
};
