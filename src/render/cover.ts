import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { CaptureArtifact } from "../types.js";

export const buildCoverImage = async (captures: CaptureArtifact[], outputDir: string) => {
  const firstScreenshot = captures[0]?.screenshotPath;
  if (!firstScreenshot) return undefined;

  const coverPath = join(outputDir, "cover.png");
  await copyFile(firstScreenshot, coverPath);
  return coverPath;
};
