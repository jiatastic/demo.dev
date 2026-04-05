import { copyFile, mkdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

export const createAssetStager = async (label: string) => {
  const runSlug = `${slugify(label) || "demo"}-${Date.now()}`;
  const publicRoot = resolve(process.cwd(), "public", "__demo_assets__", runSlug);
  await mkdir(publicRoot, { recursive: true });

  return async (inputPath: string | undefined, outputName: string) => {
    if (!inputPath) return undefined;
    const extension = extname(inputPath) || extname(outputName);
    const safeBaseName = slugify(basename(outputName, extname(outputName))) || "asset";
    const filename = `${safeBaseName}${extension}`;
    const outputPath = join(publicRoot, filename);
    await copyFile(inputPath, outputPath);
    return `__demo_assets__/${runSlug}/${filename}`;
  };
};
