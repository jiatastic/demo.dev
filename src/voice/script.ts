import type { DemoPlan, VoiceLine, VoiceToken } from "../types.js";

const estimateMs = (text: string) => {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const chineseChars = text.replace(/\s+/g, "").length;
  return Math.max(2500, Math.round((words > 1 ? words : chineseChars) * 280));
};

const tokenizeNarration = (text: string, estimatedMs: number): VoiceToken[] => {
  const tokens = text.match(/\S+\s*/g) ?? [text];
  const weighted = tokens.map((token) => ({
    text: token,
    weight: Math.max(token.replace(/\s+/g, "").length, 1),
  }));
  const totalWeight = weighted.reduce((sum, token) => sum + token.weight, 0) || 1;

  let cursor = 0;
  return weighted.map((token, index) => {
    const remaining = estimatedMs - cursor;
    const sliceMs = index === weighted.length - 1 ? remaining : Math.max(120, Math.round((token.weight / totalWeight) * estimatedMs));
    const startMs = cursor;
    const endMs = Math.min(estimatedMs, startMs + sliceMs);
    cursor = endMs;
    return {
      text: token.text,
      startMs,
      endMs,
    };
  });
};

export const buildVoiceScript = (plan: DemoPlan): VoiceLine[] => {
  return plan.scenes.map((scene) => {
    const estimatedMs = estimateMs(scene.narration);
    return {
      sceneId: scene.id,
      text: scene.narration,
      estimatedMs,
      tokens: tokenizeNarration(scene.narration, estimatedMs),
    };
  });
};
