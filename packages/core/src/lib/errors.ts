export const ERROR_CODES = {
  CONFIG_MISSING_BASE_URL: "CONFIG_MISSING_BASE_URL",
  CONFIG_FILE_INVALID: "CONFIG_FILE_INVALID",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTH_FAILED: "AUTH_FAILED",
  AUTH_CREDENTIALS_MISSING: "AUTH_CREDENTIALS_MISSING",
  AUTH_CREDENTIALS_FILE_INVALID: "AUTH_CREDENTIALS_FILE_INVALID",
  STORAGE_STATE_MISSING: "STORAGE_STATE_MISSING",
  STORAGE_STATE_EXPIRED: "STORAGE_STATE_EXPIRED",
  LLM_PROVIDER_UNAVAILABLE: "LLM_PROVIDER_UNAVAILABLE",
  LLM_FAILED: "LLM_FAILED",
  LLM_RATE_LIMITED: "LLM_RATE_LIMITED",
  PLANNER_FAILED: "PLANNER_FAILED",
  REUSE_ARTIFACT_NOT_FOUND: "REUSE_ARTIFACT_NOT_FOUND",
  REUSE_ARTIFACT_INVALID: "REUSE_ARTIFACT_INVALID",
  SELECTOR_NOT_FOUND: "SELECTOR_NOT_FOUND",
  BROWSER_LAUNCH_FAILED: "BROWSER_LAUNCH_FAILED",
  NAVIGATION_BLOCKED_BY_POLICY: "NAVIGATION_BLOCKED_BY_POLICY",
  DESTRUCTIVE_ACTION_BLOCKED: "DESTRUCTIVE_ACTION_BLOCKED",
  FFMPEG_MISSING: "FFMPEG_MISSING",
  FFMPEG_FAILED: "FFMPEG_FAILED",
  INTERRUPTED: "INTERRUPTED",
  UNKNOWN: "UNKNOWN",
} as const;

export type DemoDevErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface DemoDevErrorPayload {
  code: DemoDevErrorCode;
  message: string;
  details?: Record<string, unknown>;
  cause?: { name: string; message: string };
}

export class DemoDevError extends Error {
  readonly code: DemoDevErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: DemoDevErrorCode,
    message: string,
    options?: { details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message);
    this.name = "DemoDevError";
    this.code = code;
    this.details = options?.details;
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

const inferCodeFromMessage = (message: string): DemoDevErrorCode => {
  const lower = message.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429")) return ERROR_CODES.LLM_RATE_LIMITED;
  if (lower.includes("openai") || lower.includes("claude") || lower.includes("cursor-agent") || lower.includes("codex")) {
    return ERROR_CODES.LLM_FAILED;
  }
  if (lower.includes("no ai provider")) return ERROR_CODES.LLM_PROVIDER_UNAVAILABLE;
  if (lower.includes("ffmpeg")) return ERROR_CODES.FFMPEG_FAILED;
  if (lower.includes("storage state")) return ERROR_CODES.STORAGE_STATE_MISSING;
  if (lower.includes("login") || lower.includes("auth")) return ERROR_CODES.AUTH_FAILED;
  if (lower.includes("selector") || lower.includes("locator")) return ERROR_CODES.SELECTOR_NOT_FOUND;
  if (lower.includes("base-url") || lower.includes("baseurl")) return ERROR_CODES.CONFIG_MISSING_BASE_URL;
  return ERROR_CODES.UNKNOWN;
};

export const toErrorPayload = (error: unknown): DemoDevErrorPayload => {
  if (error instanceof DemoDevError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      cause:
        (error as { cause?: unknown }).cause instanceof Error
          ? {
              name: ((error as { cause?: Error }).cause as Error).name,
              message: ((error as { cause?: Error }).cause as Error).message,
            }
          : undefined,
    };
  }
  if (error instanceof Error) {
    return {
      code: inferCodeFromMessage(error.message),
      message: error.message,
    };
  }
  return {
    code: ERROR_CODES.UNKNOWN,
    message: typeof error === "string" ? error : JSON.stringify(error),
  };
};
