import { z } from "zod";

const actionTargetSchema = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("label"), value: z.string(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal("text"), value: z.string(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal("placeholder"), value: z.string(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal("testId"), value: z.string() }),
  z.object({ strategy: z.literal("css"), value: z.string() }),
  z.object({ strategy: z.literal("role"), role: z.string(), name: z.string().optional(), exact: z.boolean().optional() }),
]);

export const sceneActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string() }),
  z.object({ type: z.literal("wait"), ms: z.number().int().min(0).max(20000) }),
  z.object({ type: z.literal("scroll"), y: z.number().int().min(-5000).max(5000) }),
  z.object({ type: z.literal("click"), target: actionTargetSchema }),
  z.object({ type: z.literal("hover"), target: actionTargetSchema }),
  z.object({ type: z.literal("fill"), target: actionTargetSchema, value: z.string() }),
  z.object({ type: z.literal("press"), key: z.string() }),
  z.object({ type: z.literal("select"), target: actionTargetSchema, value: z.string() }),
  z.object({ type: z.literal("waitForText"), value: z.string(), exact: z.boolean().optional(), timeoutMs: z.number().int().min(0).max(20000).optional() }),
  z.object({ type: z.literal("waitForUrl"), value: z.string(), timeoutMs: z.number().int().min(0).max(20000).optional() }),
]);

export const demoSceneSchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  url: z.string(),
  viewport: z.object({ width: z.number().int().min(320).max(2400), height: z.number().int().min(320).max(2400) }),
  actions: z.array(sceneActionSchema).min(1),
  narration: z.string(),
  caption: z.string(),
  durationMs: z.number().int().min(1000).max(30000),
  evidenceHints: z.array(z.string()).default([]),
});

export const demoPlanSchema = z.object({
  title: z.string(),
  summary: z.string(),
  branch: z.string(),
  generatedAt: z.string(),
  scenes: z.array(demoSceneSchema).min(1).max(6),
});

export type DemoPlanInput = z.infer<typeof demoPlanSchema>;
