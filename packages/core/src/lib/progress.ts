import type { DemoDevErrorPayload } from "./errors.js";

export type ProgressPhase =
  | "config"
  | "auth"
  | "plan"
  | "probe"
  | "capture"
  | "voice"
  | "director"
  | "render"
  | "quality"
  | "estimate";

export type ProgressStatus = "start" | "progress" | "success" | "skip" | "warn" | "fail";

export interface ProgressEvent {
  kind: "progress";
  phase: ProgressPhase;
  status: ProgressStatus;
  message: string;
  meta?: Record<string, unknown>;
  at: string;
}

export interface LogEvent {
  kind: "log";
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
  at: string;
}

export interface ResultEvent {
  kind: "result";
  ok: boolean;
  at: string;
  [key: string]: unknown;
}

export interface ErrorEvent {
  kind: "error";
  at: string;
  error: DemoDevErrorPayload;
  partialArtifacts?: string[];
}

export type DemoDevEvent = ProgressEvent | LogEvent | ResultEvent | ErrorEvent;

export interface ProgressReporter {
  phase(name: ProgressPhase, status: ProgressStatus, message: string, meta?: Record<string, unknown>): void;
  log(level: LogEvent["level"], message: string, meta?: Record<string, unknown>): void;
  /** Record an artifact path so SIGTERM/error handlers can surface partial outputs. */
  trackArtifact(path: string): void;
  /** Snapshot of all tracked artifact paths. */
  artifacts(): string[];
}

const now = () => new Date().toISOString();

export const createNullReporter = (): ProgressReporter => {
  const tracked: string[] = [];
  return {
    phase() {},
    log() {},
    trackArtifact(path) {
      tracked.push(path);
    },
    artifacts() {
      return [...tracked];
    },
  };
};

/** Emits one NDJSON event per stdout line. Used by `--json` mode. */
export const createJsonReporter = (sink: (line: string) => void = (l) => process.stdout.write(l)): ProgressReporter => {
  const tracked: string[] = [];
  const emit = (event: DemoDevEvent) => sink(JSON.stringify(event) + "\n");

  return {
    phase(name, status, message, meta) {
      emit({ kind: "progress", phase: name, status, message, meta, at: now() });
    },
    log(level, message, meta) {
      emit({ kind: "log", level, message, meta, at: now() });
    },
    trackArtifact(path) {
      if (!tracked.includes(path)) tracked.push(path);
    },
    artifacts() {
      return [...tracked];
    },
  };
};

/** Emits human-readable lines to stderr without disturbing pretty UI. */
export const createTextReporter = (sink: (line: string) => void = (l) => process.stderr.write(l)): ProgressReporter => {
  const tracked: string[] = [];
  return {
    phase(name, status, message) {
      const tag = status === "fail" ? "✗" : status === "warn" ? "!" : status === "success" ? "✓" : "·";
      sink(`[${tag} ${name}] ${message}\n`);
    },
    log(level, message) {
      sink(`[${level}] ${message}\n`);
    },
    trackArtifact(path) {
      if (!tracked.includes(path)) tracked.push(path);
    },
    artifacts() {
      return [...tracked];
    },
  };
};
