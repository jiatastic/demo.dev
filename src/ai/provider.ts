import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

export type AiProvider = "cursor" | "claude" | "codex" | "openai";

interface ProviderConfig {
  provider: AiProvider | "auto";
  model?: string;
  mandatory: boolean;
}

const extractJson = (text: string) => {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  if (fenced) return fenced.trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text.trim();
};

const runCommand = async (command: string, args: string[], stdin?: string) => {
  if (stdin) {
    const { spawn } = await import("node:child_process");
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(command, args, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) reject(new Error(`${command} exited with ${code}: ${stderr}`));
        else resolve({ stdout, stderr });
      });
      child.stdin.write(stdin);
      child.stdin.end();
    });
  }
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024 * 20,
  });
  return { stdout, stderr };
};

const commandExists = async (command: string) => {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
};

const getConfig = (): ProviderConfig => ({
  provider: (process.env.DEMO_AI_PROVIDER as ProviderConfig["provider"]) ?? "auto",
  model: process.env.DEMO_AI_MODEL,
  mandatory: process.env.DEMO_AI_MANDATORY !== "false",
});

const getOpenAiConfig = () => {
  const apiKey = process.env.DEMO_OPENAI_API_KEY;
  const baseUrl = process.env.DEMO_OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.DEMO_OPENAI_MODEL ?? process.env.DEMO_AI_MODEL ?? "gpt-4.1-mini";
  return { apiKey, baseUrl, model };
};

const requestFromOpenAi = async <T>(options: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}) => {
  const config = getOpenAiConfig();
  if (!config.apiKey) throw new Error("OpenAI API key not configured. Set DEMO_OPENAI_API_KEY.");

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  }

  const payload = z
    .object({
      choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }) })),
    })
    .parse(await response.json());

  const content = payload.choices[0]?.message.content;
  if (!content) throw new Error("OpenAI returned empty content");
  return options.schema.parse(JSON.parse(extractJson(content)));
};

const requestFromCursor = async <T>(options: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  model?: string;
}) => {
  if (!(await commandExists("cursor-agent"))) throw new Error("cursor-agent not found");

  const stdinContent = `${options.system}\n\n${options.prompt}`;
  const args = ["--print", "--output-format", "json", "--trust", "--mode", "plan"];
  if (options.model) args.push("--model", options.model);
  // Pass prompt via stdin to avoid exceeding argument length limits
  args.push("-");

  const { stdout } = await runCommand("cursor-agent", args, stdinContent);
  const payload = JSON.parse(stdout) as { result?: string; is_error?: boolean };
  if (payload.is_error) throw new Error(payload.result ?? "Cursor provider returned error");
  if (!payload.result) throw new Error("Cursor provider returned empty result");
  return options.schema.parse(JSON.parse(extractJson(payload.result)));
};

const requestFromClaude = async <T>(options: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  model?: string;
}) => {
  if (!(await commandExists("claude"))) throw new Error("claude not found");

  const stdinContent = `${options.prompt}\n\nReturn strict JSON only.`;
  const args = [
    "-p",
    "--output-format",
    "json",
    "--system-prompt",
    options.system,
    "--allowedTools",
    "",
  ];
  if (options.model) args.push("--model", options.model);
  // Pass prompt via stdin to avoid exceeding argument length limits
  args.push("-");

  const { stdout } = await runCommand("claude", args, stdinContent);
  const payload = JSON.parse(stdout) as { result?: string; is_error?: boolean };
  if (payload.is_error) throw new Error(payload.result ?? "Claude provider returned error");
  if (!payload.result) throw new Error("Claude provider returned empty result");
  return options.schema.parse(JSON.parse(extractJson(payload.result)));
};

const requestFromCodex = async <T>(options: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  model?: string;
}) => {
  if (!(await commandExists("codex"))) throw new Error("codex not found");

  const tempDir = await mkdtemp(join(tmpdir(), "demo-dev-codex-"));
  const outputPath = join(tempDir, "last-message.json");

  try {
    const fullPrompt = `${options.system}\n\n${options.prompt}\n\nReturn strict JSON only.`;
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--output-last-message",
      outputPath,
    ];
    if (options.model) args.push("--model", options.model);
    args.push(fullPrompt);

    await runCommand("codex", args);
    const content = await readFile(outputPath, "utf8");
    return options.schema.parse(JSON.parse(extractJson(content)));
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const PROVIDERS: readonly AiProvider[] = ["cursor", "claude", "codex", "openai"];

export const listAvailableProviders = async () => {
  const openaiConfig = getOpenAiConfig();
  return {
    cursor: await commandExists("cursor-agent"),
    claude: await commandExists("claude"),
    codex: await commandExists("codex"),
    openai: Boolean(openaiConfig.apiKey),
    selected: getConfig().provider,
  };
};

export const requestAiJson = async <T>(options: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  temperature?: number;
}) => {
  const config = getConfig();
  const providers = config.provider === "auto" ? PROVIDERS : [config.provider];
  const errors: string[] = [];

  for (const provider of providers) {
    let prompt = options.prompt;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        switch (provider) {
          case "cursor":
            return await requestFromCursor({ ...options, prompt, model: config.model });
          case "claude":
            return await requestFromClaude({ ...options, prompt, model: config.model });
          case "codex":
            return await requestFromCodex({ ...options, prompt, model: config.model });
          case "openai":
            return await requestFromOpenAi({ ...options, prompt });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === 0) {
          prompt = `${options.prompt}\n\nYour previous response failed validation with this error:\n${message}\n\nReturn corrected strict JSON only.`;
          continue;
        }
        errors.push(`${provider}: ${message}`);
        break;
      }
    }

    if (config.provider !== "auto") break;
  }

  if (!config.mandatory) return null;
  throw new Error(`No AI provider succeeded. ${errors.join(" | ")}`);
};
