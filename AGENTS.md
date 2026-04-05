# AGENTS.md

## Project overview

This repository is `demo.dev`: a diff-aware PR demo generator for web apps.

Primary goal:

- turn pull requests into polished product demos
- probe and capture real product states in the browser
- render launch-style videos with Remotion
- support both CLI usage and agent-native usage through a reusable skill

This repo is intended to become:

- a standalone CLI (`demo-dev ...`)
- a reusable engine for many repos, not just one app
- an installable pi package with an Agent Skill

---

## Current product direction

The project is intentionally positioned closer to **product storytelling** than to QA replay.

Key principles:

1. Start from the diff.
2. Prefer user-visible product surfaces.
3. Use live browser evidence.
4. Prefer stable product states over noisy loading states.
5. Keep the screen as the hero.
6. For the same route, preserve one screen object and move the camera instead of cutting to another screen.
7. Aim for a clean, editorial, light product-film aesthetic rather than flashy AI-startup styling.

---

## Important repo status

The repo already includes:

- standalone CLI via `bin/demo-dev.js`
- npm script wrapper via `npm run demo-dev -- ...`
- project bootstrap via `demo-dev init`
- setup validation via `demo-dev doctor`
- multi-project config support through `demo.dev.config.json`
- project hints:
  - `preferredRoutes`
  - `featureHints`
  - `authRequiredRoutes`
- browser capture and recording
- voice/TTS support
- optional background music support
- Remotion rendering
- GitHub PR comment support
- Agent Skill in `skills/demo-dev/`

---

## Commands you should know

### Main CLI

```bash
demo-dev init
demo-dev doctor
demo-dev config
demo-dev providers
demo-dev plan
demo-dev probe
demo-dev auth:bootstrap
demo-dev capture
demo-dev voice
demo-dev manifest
demo-dev render --manifest artifacts/render-manifest.json --out artifacts/pr-demo.mp4
demo-dev comment --output-dir artifacts --pr-number 123
demo-dev pr-demo
```

### Repo-local equivalents

```bash
npm run init
npm run doctor
npm run config
npm run providers
npm run plan
npm run probe
npm run auth:bootstrap
npm run capture
npm run voice
npm run manifest
npm run render -- --manifest artifacts/render-manifest.json --out artifacts/pr-demo.mp4
npm run comment -- --output-dir artifacts --pr-number 123
npm run pr-demo
```

### Sanity check

Before making changes, run:

```bash
npm run typecheck
```

---

## Important files

### Core product
- `src/cli.ts` — top-level CLI entry
- `src/orchestrate.ts` — pipeline composition
- `src/config/project.ts` — repo-level config loading and project hints
- `src/setup/init.ts` — bootstrap config + workflow
- `src/setup/doctor.ts` — setup diagnostics

### Planning
- `src/planner/index.ts`
- `src/planner/heuristic.ts`
- `src/planner/llm.ts`
- `src/planner/refine.ts`
- `src/planner/schema.ts`

### Capture
- `src/capture/playwright-recorder.ts`
- `src/probe/page-probe.ts`
- `src/browser/session.ts`

### Rendering
- `src/render/manifest.ts`
- `src/render/video.ts`
- `src/render/remotion/Root.tsx`
- `src/render/remotion/DemoVideo.tsx`

### Voice and audio
- `src/voice/script.ts`
- `src/voice/tts.ts`

### Agent support
- `skills/demo-dev/SKILL.md`
- `skills/demo-dev/references/configuration.md`
- `skills/demo-dev/references/recipes.md`

### Public-facing docs
- `README.md`
- `demo.dev.config.example.json`

---

## Configuration model

The preferred integration pattern is:

1. each target repo has its own `demo.dev.config.json`
2. the repo may also reuse `.github/workflows/pr-demo.yml`
3. auth flows are configured in the config file
4. project hints improve planning quality

Relevant config fields:

- `projectName`
- `baseUrl`
- `readyUrl`
- `devCommand`
- `baseRef`
- `outputDir`
- `storageStatePath`
- `saveStorageStatePath`
- `preferredRoutes`
- `featureHints`
- `authRequiredRoutes`
- `auth.*`

---

## Background music

Background music is now supported through environment variables:

- `DEMO_BGM_PATH`
- `DEMO_BGM_VOLUME`
- `DEMO_BGM_DUCKING`
- `DEMO_BGM_FADE_IN_MS`
- `DEMO_BGM_FADE_OUT_MS`

Intent:

- subtle editorial music bed
- low presence
- fades in and out
- ducks under narration automatically

Avoid loud, trailer-like, or overly “AI startup” sounding music.

---

## Agent/provider support

Current AI provider layer supports:

- `cursor`
- `claude`
- `codex`
- `openai`
- `auto`

The repo also ships an Agent Skill so external agent sessions can learn how to use the tool.

Note:

- provider support exists, but it is not yet as broad or ergonomic as tools like `expect`
- there is not yet full Expect-style `-a <provider>` parity across all possible coding agents

---

## Style and implementation expectations

When working in this repo:

- keep everything in English
- prefer clear product language over internal jargon
- keep README and public docs clean and polished
- preserve multi-project support, not PodPitch-only assumptions
- avoid committing temporary outputs or local config
- prefer additive, reusable abstractions over one-off hacks
- if a feature can be generic, make it generic

---

## Security and publishing constraints

Be careful not to commit secrets or repo-local private config.

Already ignored:

- `artifacts/`
- `artifacts-*/`
- `tmp/`
- `public/__demo_assets__/`
- `.expect/`
- `.playwright/`
- `demo.dev.config.json`

Publishing notes:

- `demo.dev.config.example.json` is publishable
- `demo.dev.config.json` is local/project-specific and should stay untracked
- `package.json#files` restricts npm package contents

Before publishing, it is reasonable to double-check:

```bash
npm pack --dry-run --json
```

---

## Current expectation for future sessions

If you are continuing work here, assume the user wants to keep pushing the repo toward:

- a polished open-source tool
- a strong standalone CLI
- a reusable Agent Skill
- a multi-project PR demo engine
- high-quality product-film output

When in doubt, optimize for:

- cleaner product UX
- better repo portability
- better agent usability
- cleaner public documentation
