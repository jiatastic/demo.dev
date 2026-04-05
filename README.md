<div align="center">

# demo.dev

### Turn pull requests into polished product demos

[![Node >=20](https://img.shields.io/badge/node-%3E%3D20-111827?style=flat-square)](#installation)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](#installation)
[![Playwright](https://img.shields.io/badge/playwright-browser_capture-2EAD33?style=flat-square&logo=playwright&logoColor=white)](#what-demo-dev-does)
[![Remotion](https://img.shields.io/badge/remotion-video_rendering-black?style=flat-square)](#what-demo-dev-does)
[![Agent Skill](https://img.shields.io/badge/agent-ready-7C3AED?style=flat-square)](#agent-skill)

`demo.dev` is a diff-aware demo generator for web apps.  
It reads a PR, plans what matters, captures the real product in the browser, and renders a clean video.

**PR opened → read diff → plan scenes → probe pages → capture product states → add voice / music → render mp4**

</div>

---

## Table of contents

- [Why demo.dev exists](#why-demo-dev-exists)
- [What demo.dev does](#what-demo-dev-does)
- [At a glance](#at-a-glance)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Example config](#example-config)
- [CLI](#cli)
- [Typical workflows](#typical-workflows)
- [Outputs](#outputs)
- [Background music](#background-music)
- [AI providers](#ai-providers)
- [Voice / TTS](#voice--tts)
- [Auth and storage state](#auth-and-storage-state)
- [GitHub workflow](#github-workflow)
- [Agent Skill](#agent-skill)
- [Publishing notes](#publishing-notes)
- [Current limitations](#current-limitations)
- [Roadmap](#roadmap)

---

## Why demo.dev exists

Code review usually answers:

> **“Is this correct?”**

`demo.dev` is built to answer:

> **“What does this feel like in the product?”**

It is for teams that want a fast, repeatable way to generate:

- PR walkthrough videos
- feature launch demos
- authenticated SaaS product tours
- internal review artifacts
- clean, editorial product films from real UI states

---

## What demo.dev does

### Diff-aware planning
- reads changed files and diff context
- proposes product-facing scenes
- refines them using live browser probes
- supports project hints like preferred routes and feature surfaces

### Browser capture
- uses Playwright to validate and record flows
- supports authenticated apps through storage state reuse
- captures screenshots, videos, and interaction events
- can fall back to manual plans for high-value feature demos

### Video rendering
- renders with Remotion
- keeps screen continuity for same-route scenes
- supports editorial camera motion
- supports optional narration and background music
- exports clean mp4 outputs and PR artifacts

### Agent-native usage
- ships with a standalone CLI
- ships with a reusable Agent Skill
- can be installed as a pi package and used by other agents

---

## At a glance

| Layer | What it handles |
| --- | --- |
| Planning | Turns diff + hints into a scene plan |
| Probing | Verifies pages and interactive surfaces in the real app |
| Capture | Records stable product states with Playwright |
| Voice | Generates narration and TTS |
| Music | Adds optional BGM with ducking and fades |
| Render | Produces the final mp4 with Remotion |
| Review loop | Uploads artifacts and comments on the PR |
| Agent support | Exposes a CLI + reusable Agent Skill |

---

## Core ideas

`demo.dev` is not a QA recorder with a nicer theme.

It follows a few principles:

1. **Start from the diff**  
   Decide what matters from the code change before touching the browser.

2. **Use the real product**  
   Probe and capture the live app instead of inventing scenes from static assumptions.

3. **Prefer product storytelling over test choreography**  
   Stable, legible, product-first scenes beat long, noisy interaction replays.

4. **Make the pipeline composable**  
   Planning, probing, capture, voice, music, rendering, and PR comments can evolve independently.

---

## Installation

```bash
npm install
npx playwright install chromium
```

---

## Quick start

### 1) Bootstrap a repo

```bash
demo-dev init
```

This creates:

- `demo.dev.config.json`
- `.github/workflows/pr-demo.yml`

### 2) Verify setup

```bash
demo-dev doctor
```

### 3) Generate a demo

```bash
demo-dev pr-demo
```

If you do not want a config file yet, you can still run it directly:

```bash
demo-dev pr-demo --base-url http://localhost:3000 --base-ref origin/main
```

---

## Example config

Create a `demo.dev.config.json` in the target repo:

```json
{
  "projectName": "My App",
  "baseUrl": "http://localhost:3000",
  "readyUrl": "http://localhost:3000",
  "devCommand": "npm run dev",
  "baseRef": "origin/main",
  "outputDir": "artifacts",
  "storageStatePath": "artifacts/storage-state.json",
  "saveStorageStatePath": "artifacts/storage-state.json",
  "preferredRoutes": ["/", "/dashboard"],
  "featureHints": ["home", "dashboard"],
  "authRequiredRoutes": ["/dashboard"],
  "auth": {
    "loginPath": "/login",
    "emailTarget": { "strategy": "css", "value": "#email" },
    "passwordTarget": { "strategy": "css", "value": "#password" },
    "submitTarget": { "strategy": "role", "role": "button", "name": "Login" },
    "postSubmitWaitMs": 1500
  }
}
```

A reusable starter file is also included:

- `demo.dev.config.example.json`

---

## CLI

`demo.dev` has a first-class CLI.

### Main commands

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

### Repo-local npm wrappers

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

---

## Typical workflows

### Generate a PR demo

```bash
demo-dev pr-demo
```

### Inspect the plan before recording

```bash
demo-dev plan
demo-dev probe
```

### Re-render only

```bash
demo-dev render --manifest artifacts/render-manifest.json --out artifacts/pr-demo.mp4
```

### Authenticated product

```bash
demo-dev auth:bootstrap \
  --email you@example.com \
  --password 'your-password'

demo-dev pr-demo
```

### Add background music

```bash
DEMO_BGM_PATH=./assets/music/bed.mp3 \
DEMO_BGM_VOLUME=0.14 \
DEMO_BGM_DUCKING=0.28 \
demo-dev pr-demo
```

This will:
- loop the music bed across the full video
- fade it in and out
- automatically duck it under narration

---

## Outputs

By default, `demo.dev` writes to `artifacts/`.

Typical outputs include:

- `artifacts/demo-context.json`
- `artifacts/demo-plan.initial.json`
- `artifacts/page-probes.json`
- `artifacts/demo-plan.json`
- `artifacts/captures/screenshots/*.png`
- `artifacts/captures/videos/*.webm`
- `artifacts/voice-script.json`
- `artifacts/render-manifest.json`
- `artifacts/cover.png`
- `artifacts/pr-demo.mp4`

---

## Background music

Optional background music is supported through environment variables:

- `DEMO_BGM_PATH` — local path to a music file
- `DEMO_BGM_VOLUME` — base music volume, default `0.16`
- `DEMO_BGM_DUCKING` — multiplier while narration is active, default `0.3`
- `DEMO_BGM_FADE_IN_MS` — default `700`
- `DEMO_BGM_FADE_OUT_MS` — default `1200`

This is intended for subtle, editorial music beds — not loud trailer-style soundtracks.

---

## AI providers

Planning and refinement can use multiple providers.

### Supported today

- `cursor`
- `claude`
- `codex`
- `openai`
- `auto`

Check what is available locally:

```bash
demo-dev providers
```

### Useful environment variables

- `DEMO_AI_PROVIDER`
- `DEMO_AI_MODEL`
- `DEMO_AI_MANDATORY`
- `OPENAI_API_KEY` / `DEMO_OPENAI_API_KEY`
- `DEMO_OPENAI_MODEL`
- `DEMO_OPENAI_BASE_URL`

---

## Voice / TTS

Supported TTS modes:

- `elevenlabs`
- `openai`
- `local`
- `auto`

Useful variables:

- `DEMO_TTS_PROVIDER`
- `DEMO_TTS_MODEL`
- `DEMO_TTS_VOICE`
- `DEMO_LOCAL_TTS_VOICE`
- `DEMO_LOCAL_TTS_RATE`
- `DEMO_ELEVENLABS_*`

---

## Auth and storage state

Useful variables:

- `DEMO_STORAGE_STATE`
- `DEMO_SAVE_STORAGE_STATE`
- `DEMO_LOGIN_EMAIL`
- `DEMO_LOGIN_PASSWORD`
- `DEMO_CONFIG`

If your product is behind login, generate a storage state first:

```bash
demo-dev auth:bootstrap \
  --email you@example.com \
  --password 'your-password' \
  --storage-state artifacts/storage-state.json
```

Then reuse it:

```bash
DEMO_STORAGE_STATE=artifacts/storage-state.json \
DEMO_SAVE_STORAGE_STATE=artifacts/storage-state.json \
demo-dev pr-demo
```

---

## GitHub workflow

A reusable workflow template is included:

- `.github/workflows/pr-demo.yml`

It supports this config order:

1. GitHub Variables
   - `DEMO_BASE_URL`
   - `DEMO_READY_URL`
   - `DEMO_DEV_COMMAND`
   - `DEMO_OUTPUT_DIR`
2. fallback to repo-local `demo.dev.config.json`

The PR comment step can post:

- workflow run link
- scene summary
- output file summary
- artifact download hint

---

## Agent Skill

This repo includes a reusable Agent Skill:

- `skills/demo-dev/SKILL.md`

That means other users can install this repo and let their agent learn how to use `demo.dev`.

```bash
pi install /absolute/path/to/demo.dev
pi install git:github.com/your-org/demo.dev
```

The skill includes setup guidance, workflow recipes, and project configuration references.

---

## Publishing notes

The repo is set up to stay clean when shared:

- artifacts are ignored
- local config is ignored
- only `demo.dev.config.example.json` is intended for publication
- npm packaging is restricted through `package.json#files`

---

## Current limitations

- AI planning is strong, but not yet fully repo-aware beyond diff signals and project hints.
- Probe exploration still follows a small set of likely actions, not a full app state machine.
- The renderer is moving toward a true product-film mode, but is not yet a full timeline editor.
- Agent provider support exists, but is not yet as complete as tools like `expect`.

---

## Roadmap

- richer repo-aware planning
- stronger state-based product film mode
- better agent/provider ergonomics
- more polished onboarding and publishing flows
- more robust multi-project recipes

---

## In one sentence

**demo.dev helps teams turn code changes into something people can actually watch.**
