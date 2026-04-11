# Library API

`demo.dev` can now be used as both a CLI and an importable rendering library.

## CLI outputs

Generate render artifacts:

```bash
demo-dev manifest
```

This now writes both:

- `artifacts/render-manifest.json`
- `artifacts/timeline-spec.json`

Render from the manifest:

```bash
demo-dev render --manifest artifacts/render-manifest.json --out artifacts/pr-demo.mp4
```

Render directly from the compiled timeline spec:

```bash
demo-dev render --timeline-spec artifacts/timeline-spec.json --out artifacts/pr-demo.from-spec.mp4
```

## Package usage

```ts
import { readFile, writeFile } from "node:fs/promises";
import {
  buildJsonRenderTimelineSpec,
  renderVideoFromTimelineSpecData,
  type RenderManifest,
} from "demo-dev";

const manifest = JSON.parse(
  await readFile("artifacts/render-manifest.json", "utf8"),
) as RenderManifest;

const spec = buildJsonRenderTimelineSpec(manifest);

await writeFile(
  "artifacts/timeline-spec.json",
  JSON.stringify(spec, null, 2) + "\n",
  "utf8",
);

await renderVideoFromTimelineSpecData({
  spec,
  outputPath: "artifacts/pr-demo.from-spec.mp4",
});
```

## Recommended integration model

Use the layers intentionally:

- `RenderManifest` for demo-aware semantics and capture metadata
- `TimelineSpec` for portable, stable, renderer-facing orchestration
- custom clip components for your house animation language and visual quality
