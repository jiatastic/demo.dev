import { z } from "zod";

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
});

export const getPlannerConfig = () => {
  const apiKey = process.env.DEMO_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  const baseUrl = process.env.DEMO_OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.DEMO_OPENAI_MODEL ?? "gpt-4.1-mini";
  return { apiKey, baseUrl, model };
};

const extractJson = (text: string) => {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  if (fenced) return fenced.trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text;
};

export const requestPlannerJson = async <T>(options: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  temperature?: number;
}) => {
  const config = getPlannerConfig();
  if (!config.apiKey) return null;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: options.temperature ?? 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: options.system,
        },
        {
          role: "user",
          content: options.prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`planner request failed: ${response.status} ${errorText}`);
  }

  const payload = responseSchema.parse(await response.json());
  const content = payload.choices[0]?.message.content;
  if (!content) return null;

  return options.schema.parse(JSON.parse(extractJson(content)));
};
