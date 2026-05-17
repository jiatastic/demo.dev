import type { DemoDevErrorPayload } from "./errors.js";
import { toErrorPayload } from "./errors.js";
import type { ProgressReporter, ResultEvent, ErrorEvent } from "./progress.js";

export interface RunArtifacts {
  videoPath?: string;
  planPath?: string;
  capturePath?: string;
  voiceScriptPath?: string;
  qualityReportPath?: string;
  storageStatePath?: string;
  estimatePath?: string;
  [key: string]: string | undefined;
}

export interface SceneSummary {
  id: string;
  title: string;
  durationMs?: number;
  actions: number;
  destructive?: boolean;
  skipped?: boolean;
  skipReason?: string;
}

export interface RunSummary {
  ok: true;
  command: string;
  durationMs: number;
  outputDir: string;
  artifacts: RunArtifacts;
  scenes?: SceneSummary[];
  warnings: Array<{ code?: string; message: string }>;
  metrics?: Record<string, number | string>;
}

export interface RunFailure {
  ok: false;
  command: string;
  durationMs: number;
  outputDir?: string;
  error: DemoDevErrorPayload;
  partialArtifacts: string[];
}

export type RunResult = RunSummary | RunFailure;

/** Emit the final result event (JSON mode) or pretty-printed text (default). */
export const emitRunResult = (
  result: RunResult,
  options: { json: boolean; sink?: (line: string) => void },
) => {
  const sink = options.sink ?? ((line: string) => process.stdout.write(line));
  if (options.json) {
    if (result.ok) {
      const event: ResultEvent = {
        kind: "result",
        ok: true,
        at: new Date().toISOString(),
        command: result.command,
        durationMs: result.durationMs,
        outputDir: result.outputDir,
        artifacts: result.artifacts,
        scenes: result.scenes,
        warnings: result.warnings,
        metrics: result.metrics,
      };
      sink(JSON.stringify(event) + "\n");
    } else {
      const event: ErrorEvent = {
        kind: "error",
        at: new Date().toISOString(),
        error: result.error,
        partialArtifacts: result.partialArtifacts,
      };
      sink(JSON.stringify(event) + "\n");
    }
  } else if (!result.ok) {
    sink(`✗ ${result.error.code}: ${result.error.message}\n`);
    if (result.partialArtifacts.length > 0) {
      sink(`  Partial artifacts: ${result.partialArtifacts.join(", ")}\n`);
    }
  }
};

export const failFromError = (
  command: string,
  error: unknown,
  options: { startedAt: number; outputDir?: string; reporter?: ProgressReporter },
): RunFailure => ({
  ok: false,
  command,
  durationMs: Date.now() - options.startedAt,
  outputDir: options.outputDir,
  error: toErrorPayload(error),
  partialArtifacts: options.reporter?.artifacts() ?? [],
});
