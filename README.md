# demo.dev

An original, multi-project PR demo generator for web apps.

**PR opened -> read diff -> plan product walkthrough -> capture browser states -> synthesize voice -> render video with Remotion**

This is not a PodPitch-only script. It is a reusable engine that each repo can configure with its own `demo.dev.config.json`.

## Design principles

Instead of copying QA tools, demo.dev borrows a few strong ideas and applies them to product storytelling:

1. **Diff-aware**: read the diff first, then decide what to show.
2. **Browser evidence first**: validate against the real app before packaging the video.
3. **Decoupled pipeline**: planner, probe, capture, voice, and render can evolve independently.

## What is implemented today

- `src/planner`
  - heuristic planner
  - LLM planner through OpenAI-compatible and CLI-based providers
  - refinement step using real page probes
  - project-level hints such as `preferredRoutes` and `featureHints`
- `src/probe`
  - opens scene pages
  - captures headings, text previews, and interactive elements
  - follows one likely next action for a deeper probe
- `src/capture`
  - Playwright execution with exploration pass and recording pass
  - session storage state reuse
  - scene-level `.webm` recordings and screenshots
  - supports `navigate / click / fill / hover / select / press / waitForText / waitForUrl / scroll / scrollIntoView / dragSelect`
- `src/voice`
  - narration script generation
  - ElevenLabs / OpenAI / local macOS `say` fallback
- `src/render`
  - render manifest generation
  - staged assets in `public/__demo_assets__`
  - Remotion composition and mp4 output
  - editorial camera treatment and grouped screen continuity
- `.github/workflows/pr-demo.yml`
  - PR workflow template
  - artifact upload
  - PR comment upsert
- `skills/demo-dev`
  - an Agent Skill so other agents can learn how to use demo.dev

## Standalone CLI

demo.dev now has a first-class CLI entrypoint, not just `npm run ...` scripts.

Examples:

```bash
./bin/demo-dev.js config --field baseUrl
./bin/demo-dev.js doctor
./bin/demo-dev.js init
./bin/demo-dev.js pr-demo
```

Repo-local npm wrapper:

```bash
npm run demo-dev -- config --field baseUrl
npm run demo-dev -- doctor
npm run demo-dev -- pr-demo
```

When installed as a package, the command name is:

```bash
demo-dev init
demo-dev doctor
demo-dev pr-demo
```

## Core commands

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

Equivalent npm scripts are also available:

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

## Agent Skill

This repo ships with an Agent Skill:

- `skills/demo-dev/SKILL.md`

Other users can install this repo as a pi package and let their agent use the skill automatically.

```bash
pi install /absolute/path/to/demo.dev
pi install git:github.com/your-org/demo.dev
```

The repo also includes:

- `demo.dev.config.example.json`

so another repo can copy it and get started quickly.

## Project config

Each target repo can commit its own `demo.dev.config.json`:

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

Once config exists, many commands no longer need `--base-url` every time.

Inspect active config:

```bash
demo-dev config
demo-dev config --field baseUrl
demo-dev config --field preferredRoutes
```

## Quick start

```bash
npm install
npx playwright install chromium
demo-dev pr-demo
```

If you do not want a config file yet, you can still pass flags explicitly:

```bash
demo-dev pr-demo --base-url http://localhost:3000 --base-ref origin/main
```

## `init` command

Bootstrap a new repo:

```bash
demo-dev init
```

This writes:

- `demo.dev.config.json`
- `.github/workflows/pr-demo.yml`

Use `--force` to overwrite existing files.

## `doctor` command

Check whether the current repo is ready to run demo.dev:

```bash
demo-dev doctor
```

It checks:

- config presence
- `baseUrl`, `readyUrl`, `outputDir`, `devCommand`
- workflow presence
- `git`, `ffmpeg`, `ffprobe`
- Playwright Chromium availability
- storage state presence when configured
- whether the configured app URL is reachable

## Outputs

Default output files:

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

## Run each stage separately

```bash
demo-dev plan --base-ref origin/main
demo-dev probe
demo-dev capture
demo-dev voice
demo-dev manifest
demo-dev render --manifest artifacts/render-manifest.json --out artifacts/pr-demo.mp4
demo-dev comment --output-dir artifacts --pr-number 123
```

If the repo has no `demo.dev.config.json`, pass the missing CLI flags explicitly.

## Environment variables

### AI providers

- `DEMO_AI_PROVIDER`: `cursor` / `claude` / `codex` / `openai` / `auto`
- `DEMO_AI_MODEL`
- `DEMO_AI_MANDATORY`: defaults to `true`; set to `false` to allow heuristic fallback

#### OpenAI-compatible API

- `OPENAI_API_KEY` or `DEMO_OPENAI_API_KEY`
- `DEMO_OPENAI_MODEL` (default `gpt-4.1-mini`)
- `DEMO_OPENAI_BASE_URL` (default `https://api.openai.com/v1`)

#### CLI providers

- `cursor-agent`
- `claude`
- `codex`

Inspect what is available locally:

```bash
demo-dev providers
```

### TTS

- `DEMO_TTS_PROVIDER`: `auto` / `elevenlabs` / `openai` / `local`

#### ElevenLabs

- `ELEVENLABS_API_KEY` or `DEMO_ELEVENLABS_API_KEY`
- `DEMO_ELEVENLABS_VOICE_ID`
- `DEMO_ELEVENLABS_MODEL` (default `eleven_multilingual_v2`)
- `DEMO_ELEVENLABS_BASE_URL` (default `https://api.elevenlabs.io/v1`)
- `DEMO_ELEVENLABS_OUTPUT_FORMAT` (default `mp3_44100_128`)
- `DEMO_ELEVENLABS_STABILITY`
- `DEMO_ELEVENLABS_SIMILARITY_BOOST`
- `DEMO_ELEVENLABS_STYLE`
- `DEMO_ELEVENLABS_SPEAKER_BOOST`

#### OpenAI TTS

- `OPENAI_API_KEY` or `DEMO_OPENAI_API_KEY`
- `DEMO_TTS_MODEL` (default `gpt-4o-mini-tts`)
- `DEMO_TTS_VOICE` (default `alloy`)
- `DEMO_OPENAI_BASE_URL` (default `https://api.openai.com/v1`)

#### Local macOS fallback

- `DEMO_LOCAL_TTS_VOICE` (default `Samantha`)
- `DEMO_LOCAL_TTS_RATE` (default `185`)

### Session / auth

- `DEMO_STORAGE_STATE`
- `DEMO_SAVE_STORAGE_STATE`
- `DEMO_LOGIN_EMAIL`
- `DEMO_LOGIN_PASSWORD`
- `DEMO_CONFIG`

### GitHub comment

- `GITHUB_TOKEN`
- `GITHUB_REPOSITORY`
- `GITHUB_EVENT_PATH` or `--pr-number`

## Auth bootstrap

If your product requires login, generate a storage state first:

```bash
demo-dev auth:bootstrap \
  --email you@example.com \
  --password 'your-password' \
  --storage-state artifacts/storage-state.json
```

Then run the pipeline with that authenticated state:

```bash
DEMO_STORAGE_STATE=artifacts/storage-state.json \
DEMO_SAVE_STORAGE_STATE=artifacts/storage-state.json \
demo-dev pr-demo
```

## PR comments

The comment step writes back:

- workflow run link
- scene summary
- output file summary
- artifact download hint

## How other repos should use this

Recommended setup for every target repo:

1. Commit a repo-specific `demo.dev.config.json`
2. Reuse `.github/workflows/pr-demo.yml`
3. Generate storage state with `auth:bootstrap` when auth is required

The workflow supports this priority order:

1. GitHub Variables: `DEMO_BASE_URL`, `DEMO_READY_URL`, `DEMO_DEV_COMMAND`, `DEMO_OUTPUT_DIR`
2. fallback to `demo.dev.config.json`

So the intended positioning is:

> **a PR demo engine that every repo can configure for itself**

## Current limitations

1. AI providers mainly power planning and refinement; TTS still uses a separate provider stack.
2. The planner is not yet fully repo-aware beyond diff signals and project hints.
3. Probe exploration still follows only one likely next step, not a full state machine.
4. Voice generation does not yet support scene-level emotional direction or full casting.
5. The renderer is moving toward product-film quality, but it is not yet a full timeline editor.

## Near-term roadmap

1. Better project hints and route graphs
2. More robust state-based product film mode
3. Better init flows and repo onboarding
4. More polished standalone CLI ergonomics
