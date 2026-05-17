import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import type { DemoPlan, VoiceLine } from "@demo-dev/types";

const execFileAsync = promisify(execFile);

export type QualitySeverity = "info" | "warning" | "error";

export interface QualityFinding {
  severity: QualitySeverity;
  code: string;
  message: string;
}

export interface VideoQualityReport {
  ok: boolean;
  score: number;
  findings: QualityFinding[];
  metrics: {
    durationMs?: number;
    width?: number;
    height?: number;
    fps?: number;
    voiceDurationMs?: number;
    sceneCount?: number;
  };
}

const addFinding = (
  findings: QualityFinding[],
  severity: QualitySeverity,
  code: string,
  message: string,
) => findings.push({ severity, code, message });

const probeVideo = async (videoPath: string): Promise<VideoQualityReport["metrics"]> => {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate,duration",
    "-of", "json",
    videoPath,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      duration?: string;
    }>;
  };
  const stream = parsed.streams?.[0];
  const fpsParts = stream?.avg_frame_rate?.split("/").map(Number) ?? [];
  const fps = fpsParts.length === 2 && fpsParts[1] ? fpsParts[0] / fpsParts[1] : undefined;

  return {
    width: stream?.width,
    height: stream?.height,
    fps,
    durationMs: stream?.duration ? Math.round(Number(stream.duration) * 1000) : undefined,
  };
};

export const evaluateDemoQuality = async (options: {
  videoPath?: string;
  plan: DemoPlan;
  voiceLines?: VoiceLine[];
  expectedAspectRatio?: string;
}): Promise<VideoQualityReport> => {
  const findings: QualityFinding[] = [];
  const voiceDurationMs = options.voiceLines?.reduce((sum, line) => sum + (line.audioDurationMs ?? line.estimatedMs ?? 0), 0);
  const metrics: VideoQualityReport["metrics"] = {
    sceneCount: options.plan.scenes.length,
    voiceDurationMs,
  };

  if (!options.videoPath) {
    addFinding(findings, "warning", "missing-video", "No rendered video path was produced.");
  } else {
    try {
      await access(options.videoPath);
      Object.assign(metrics, await probeVideo(options.videoPath));
    } catch {
      addFinding(findings, "warning", "probe-failed", "Could not inspect the rendered video with ffprobe.");
    }
  }

  if (options.plan.scenes.length === 0) {
    addFinding(findings, "error", "empty-plan", "The demo plan has no scenes.");
  }

  for (const scene of options.plan.scenes) {
    const narrationLength = scene.narration.trim().length;
    if (narrationLength > 170) {
      addFinding(findings, "warning", "long-narration", `Scene "${scene.title}" narration is long and may feel slow.`);
    }
    if (scene.actions.length === 0) {
      addFinding(findings, "warning", "static-scene", `Scene "${scene.title}" has no browser actions.`);
    }
  }

  if (metrics.durationMs != null) {
    if (metrics.durationMs < 6000) {
      addFinding(findings, "warning", "too-short", "Rendered video is under 6 seconds.");
    }
    if (metrics.durationMs > 120000) {
      addFinding(findings, "warning", "too-long", "Rendered video is over 2 minutes and may feel unfocused.");
    }
  }

  if (metrics.durationMs != null && voiceDurationMs != null && voiceDurationMs > metrics.durationMs + 5000) {
    addFinding(findings, "warning", "voice-longer-than-video", "Narration duration is significantly longer than the rendered video.");
  }

  if (metrics.width && metrics.height && options.expectedAspectRatio) {
    const ratio = metrics.width / metrics.height;
    const expected = options.expectedAspectRatio === "9:16"
      ? 9 / 16
      : options.expectedAspectRatio === "1:1"
        ? 1
        : options.expectedAspectRatio === "4:5"
          ? 4 / 5
          : 16 / 9;
    if (Math.abs(ratio - expected) > 0.08) {
      addFinding(findings, "warning", "aspect-ratio-mismatch", `Rendered aspect ratio does not match ${options.expectedAspectRatio}.`);
    }
  }

  const score = Math.max(
    0,
    100 -
      findings.filter((finding) => finding.severity === "warning").length * 8 -
      findings.filter((finding) => finding.severity === "error").length * 25,
  );

  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    score,
    findings,
    metrics,
  };
};
