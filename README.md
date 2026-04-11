<div align="center">

# demo.dev

### Turn pull requests into polished product demos

`demo.dev` reads a PR, decides what matters, captures the real product in the browser, and renders a clean video.

**PR opened → read diff → plan scenes → probe pages → capture product states → add voice / music → render mp4**

</div>

---

## What it is

`demo.dev` is a diff-aware demo generator for web apps.

It is built for teams that want to create:

- PR walkthrough videos
- feature launch demos
- authenticated SaaS product tours
- internal review artifacts

It is designed to feel closer to **product storytelling** than to **QA replay**.

---

## Quick start

```bash
npm install
npx playwright install chromium
```

Bootstrap a repo:

```bash
demo-dev init
```

Verify setup:

```bash
demo-dev doctor
```

Generate a demo:

```bash
demo-dev pr-demo
```

If you do not want a config file yet:

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
  "authRequiredRoutes": ["/dashboard"]
}
```

A reusable starter file is included:

- `demo.dev.config.example.json`

---

## Core CLI

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

Repo-local npm wrappers are also available:

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

### Authenticated product

```bash
demo-dev auth:bootstrap \
  --email you@example.com \
  --password 'your-password'

demo-dev pr-demo
```

### Re-render only

```bash
demo-dev render --manifest artifacts/render-manifest.json --out artifacts/pr-demo.mp4
```

### Add background music

```bash
DEMO_BGM_PATH=./assets/music/bed.mp3 \
DEMO_BGM_VOLUME=0.14 \
DEMO_BGM_DUCKING=0.28 \
demo-dev pr-demo
```

### Use AI providers and TTS

`demo.dev` now uses only `DEMO_*` provider keys for its own AI and TTS integrations.
There is no fallback to generic provider env vars.

```bash
DEMO_OPENAI_API_KEY=your_openai_key
DEMO_AI_PROVIDER=openai
DEMO_TTS_PROVIDER=openai

demo-dev pr-demo
```

Useful env vars:

- `DEMO_OPENAI_API_KEY`
- `DEMO_OPENAI_BASE_URL` (optional, defaults to `https://api.openai.com/v1`)
- `DEMO_OPENAI_MODEL` (planner / AI requests)
- `DEMO_TTS_PROVIDER` (`auto`, `openai`, `elevenlabs`, `local`)
- `DEMO_TTS_MODEL` (optional OpenAI TTS model)
- `DEMO_TTS_VOICE` (optional OpenAI TTS voice)
- `DEMO_ELEVENLABS_API_KEY`
- `DEMO_ELEVENLABS_VOICE_ID`

If no cloud TTS provider is configured, `demo.dev` falls back to local speech synthesis tools when available.

---

## Outputs

By default, outputs go to `artifacts/`.

Typical files:

- `artifacts/demo-context.json`
- `artifacts/demo-plan.initial.json`
- `artifacts/page-probes.json`
- `artifacts/demo-plan.json`
- `artifacts/captures/`
- `artifacts/voice-script.json`
- `artifacts/render-manifest.json`
- `artifacts/cover.png`
- `artifacts/pr-demo.mp4`

---

## Agent Skill

This repo includes a reusable Agent Skill:

- `skills/demo-dev/SKILL.md`

Other users can install this repo and let their agent use `demo.dev` directly:

```bash
pi install /absolute/path/to/demo.dev
pi install git:github.com/your-org/demo.dev
```

---

## What is implemented

- diff-aware planning
- browser probing and capture with Playwright
- session/auth storage state reuse
- Remotion rendering
- optional narration and background music
- PR comment integration
- multi-project config support
- standalone CLI + Agent Skill

---

## Notes

- AI providers currently support `cursor`, `claude`, `codex`, `openai`, and `auto`.
- Provider keys are intentionally namespaced to `DEMO_*` env vars for explicit, project-local configuration.
- Local config is intentionally not committed.
- Publishable config lives in `demo.dev.config.example.json`.
- Before publishing, you can verify package contents with:

```bash
npm pack --dry-run --json
```

---

## In one sentence

**demo.dev helps teams turn code changes into something people can actually watch.**
