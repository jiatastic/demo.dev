import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { RenderManifest } from "../types.js";

export const renderVideoFromManifest = async (options: {
  manifestPath: string;
  outputPath: string;
}) => {
  const manifest = JSON.parse(await readFile(options.manifestPath, "utf8")) as RenderManifest;
  const entryPoint = fileURLToPath(new URL("./remotion/index.ts", import.meta.url));

  const bundled = await bundle({
    entryPoint,
    webpackOverride: (config) => config,
  });

  const inputProps = manifest as unknown as Record<string, unknown>;

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "PrDemo",
    inputProps,
  });

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: options.outputPath,
    inputProps,
  });

  return options.outputPath;
};
