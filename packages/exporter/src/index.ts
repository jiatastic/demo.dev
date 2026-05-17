export type ExportAspectRatio = "16:9" | "9:16" | "1:1" | "4:5";
export type ExportResolution = "draft" | "standard" | "high";

export interface ExportProfile {
  aspectRatio: ExportAspectRatio;
  resolution: ExportResolution;
  width: number;
  height: number;
  fps: number;
}

const EXPORT_DIMENSIONS: Record<ExportAspectRatio, Record<ExportResolution, { width: number; height: number }>> = {
  "16:9": {
    draft: { width: 1280, height: 720 },
    standard: { width: 1920, height: 1080 },
    high: { width: 2560, height: 1440 },
  },
  "9:16": {
    draft: { width: 720, height: 1280 },
    standard: { width: 1080, height: 1920 },
    high: { width: 1440, height: 2560 },
  },
  "1:1": {
    draft: { width: 720, height: 720 },
    standard: { width: 1080, height: 1080 },
    high: { width: 1600, height: 1600 },
  },
  "4:5": {
    draft: { width: 720, height: 900 },
    standard: { width: 1080, height: 1350 },
    high: { width: 1600, height: 2000 },
  },
};

export const listExportAspectRatios = (): ExportAspectRatio[] => ["16:9", "9:16", "1:1", "4:5"];

export const resolveExportProfile = (options: {
  aspectRatio?: string;
  resolution?: string;
  defaultAspectRatio?: ExportAspectRatio;
}): ExportProfile => {
  const aspectRatio = listExportAspectRatios().includes(options.aspectRatio as ExportAspectRatio)
    ? (options.aspectRatio as ExportAspectRatio)
    : options.defaultAspectRatio ?? "16:9";
  const resolution = ["draft", "standard", "high"].includes(options.resolution ?? "")
    ? (options.resolution as ExportResolution)
    : "standard";
  const dimensions = EXPORT_DIMENSIONS[aspectRatio][resolution];

  return {
    aspectRatio,
    resolution,
    width: dimensions.width,
    height: dimensions.height,
    fps: resolution === "draft" ? 24 : 30,
  };
};

export const resolveCaptureViewport = (profile: ExportProfile): { width: number; height: number } => {
  if (profile.aspectRatio === "16:9") {
    return profile.resolution === "high"
      ? { width: 2560, height: 1440 }
      : { width: 1920, height: 1080 };
  }

  // Capture web apps in a landscape viewport, then frame/pad into social formats.
  return profile.resolution === "draft"
    ? { width: 1280, height: 720 }
    : { width: 1920, height: 1080 };
};
