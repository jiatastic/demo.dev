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
  /** Wall-clock timeout for a single provider attempt (ms). */
  timeoutMs: number;
}

const DEFAULT_LLM_TIMEOUT_MS = 90_000;

/** Forward stderr/info to host. Defaults to console.warn so logs reach the agent. */
type LlmProgress = (line: string) => void;

const defaultProgress: LlmProgress = (line) => {
  if (process.env.DEMO_AI_QUIET === "1") return;
  process.stderr.write(`[ai] ${line}\n`);
};

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

interface RunCommandOptions {
  timeoutMs?: number;
  /** Called once per stderr newline-terminated chunk. Allows surfacing CLI progress. */
  onStderrLine?: LlmProgress;
}

const runCommand = async (
  command: string,
  args: string[],
  stdin: string | undefined,
  opts: RunCommandOptions = {},
) => {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  const { spawn } = await import("node:child_process");

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let stderrLineBuf = "";
    let settled = false;

    const finalize = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdin?.removeAllListeners(); } catch { /* noop */ }
      fn();
    };

    const timer = setTimeout(() => {
      finalize(() => {
        try { child.kill("SIGTERM"); } catch { /* noop */ }
        // Escalate to SIGKILL if the child does not exit promptly.
        setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* noop */ } }, 2000).unref();
        const truncated = stderr.length > 400 ? stderr.slice(-400) : stderr;
        reject(new Error(`${command} timed out after ${timeoutMs}ms${truncated ? `; stderr tail: ${truncated}` : ""}`));
      });
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => {
      const text = d.toString();
      stderr += text;
      if (opts.onStderrLine) {
        stderrLineBuf += text;
        let nl;
        while ((nl = stderrLineBuf.indexOf("\n")) >= 0) {
          const line = stderrLineBuf.slice(0, nl).trim();
          stderrLineBuf = stderrLineBuf.slice(nl + 1);
          if (line) opts.onStderrLine(line);
        }
      }
    });
    child.on("error", (err) => finalize(() => reject(err)));
    child.on("close", (code) => finalize(() => {
      if (code !== 0) reject(new Error(`${command} exited with ${code}: ${stderr.slice(-400)}`));
      else resolve({ stdout, stderr });
    }));

    if (stdin === undefined) {
      child.stdin.end();
      return;
    }

    // Stream stdin with backpressure handling. The Node Writable will buffer the
    // payload, but we still honor "drain" before calling end() to avoid theoretical
    // deadlocks when the child is very slow to consume.
    const writer = child.stdin;
    writer.on("error", () => { /* will surface via close/error events */ });
    const ok = writer.write(stdin, "utf8");
    if (ok) {
      writer.end();
    } else {
      writer.once("drain", () => writer.end());
    }
  });
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
  timeoutMs: Number(process.env.DEMO_LLM_TIMEOUT_MS ?? DEFAULT_LLM_TIMEOUT_MS),
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
  seed?: number;
  temperature?: number;
  timeoutMs: number;
}) => {
  const config = getOpenAiConfig();
  if (!config.apiKey) throw new Error("OpenAI API key not configured. Set DEMO_OPENAI_API_KEY.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: options.temperature ?? 0.2,
        response_format: { type: "json_object" },
        ...(typeof options.seed === "number" ? { seed: options.seed } : {}),
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.prompt },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new Error(`openai request timed out after ${options.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

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
  timeoutMs: number;
  progress: LlmProgress;
}) => {
  if (!(await commandExists("cursor-agent"))) throw new Error("cursor-agent not found");

  const stdinContent = `${options.system}\n\n${options.prompt}`;
  const args = ["--print", "--output-format", "json", "--trust", "--mode", "plan"];
  if (options.model) args.push("--model", options.model);
  // Pass prompt via stdin to avoid exceeding argument length limits
  args.push("-");

  const { stdout } = await runCommand("cursor-agent", args, stdinContent, {
    timeoutMs: options.timeoutMs,
    onStderrLine: options.progress,
  });
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
  timeoutMs: number;
  progress: LlmProgress;
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

  const { stdout } = await runCommand("claude", args, stdinContent, {
    timeoutMs: options.timeoutMs,
    onStderrLine: options.progress,
  });
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
  timeoutMs: number;
  progress: LlmProgress;
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

    await runCommand("codex", args, undefined, {
      timeoutMs: options.timeoutMs,
      onStderrLine: options.progress,
    });
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
  /** Pass-through deterministic seed. Only OpenAI honors this today. */
  seed?: number;
  /** Per-attempt wall-clock timeout. Overrides DEMO_LLM_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Stream of provider/attempt info. Defaults to stderr unless DEMO_AI_QUIET=1. */
  progress?: LlmProgress;
}) => {
  const config = getConfig();
  const providers = config.provider === "auto" ? PROVIDERS : [config.provider];
  const errors: string[] = [];
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const progress = options.progress ?? defaultProgress;

  for (const provider of providers) {
    let prompt = options.prompt;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const startedAt = Date.now();
      progress(`provider=${provider} attempt=${attempt + 1}/2 timeout=${timeoutMs}ms`);
      try {
        const common = { ...options, prompt, timeoutMs, progress } as const;
        switch (provider) {
          case "cursor":
            return await requestFromCursor({ ...common, model: config.model });
          case "claude":
            return await requestFromClaude({ ...common, model: config.model });
          case "codex":
            return await requestFromCodex({ ...common, model: config.model });
          case "openai":
            return await requestFromOpenAi({
              ...options,
              prompt,
              timeoutMs,
              seed: options.seed,
              temperature: options.temperature,
            });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const elapsed = Date.now() - startedAt;
        progress(`provider=${provider} attempt=${attempt + 1} FAILED after ${elapsed}ms: ${message.split("\n")[0]}`);
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
