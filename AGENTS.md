# AGENTS.md

## Project overview

This repository is `demo.dev`: a tool that generates polished product demo videos from a URL and a natural language prompt.

Primary goal:

- generate demo videos from any web app with one command
- support both prompt-driven (describe what to show) and diff-driven (auto-detect from PR) modes
- capture real product states with human-like browser interaction
- compose polished videos with narration, browser frame, and smooth zoom
- work as a standalone CLI and as a reusable Agent Skill

---

## Current product direction

The project is positioned as **product storytelling**, not QA replay.

Key principles:

1. Start from a prompt or a diff — the user describes what matters.
2. Prefer user-visible product surfaces over implementation details.
3. Use live browser evidence — real clicks, real pages.
4. Prefer stable product states over noisy loading states.
5. Keep the screen as the hero.
6. Aim for a clean, editorial, Screen Studio-style aesthetic.

---

## Architecture

```
prompt + URL (or git diff)
     |
     v
AI generates a demo plan (scenes, actions, narration)
     |
     v
Playwright + ghost-cursor execute actions (human-like mouse)
     |
     v
page.screencast records continuous video + CSS zoom on interactions
     |
     v
TTS generates narration per scene (ElevenLabs / OpenAI / local)
     |
     v
FFmpeg composes: speed ramps + browser frame + audio sync → mp4
```

---

## Commands

```bash
demo-dev demo            # Full pipeline: prompt → capture → voice → render → mp4
demo-dev auth            # Login and save browser session
demo-dev init            # Create config file in a project
demo-dev doctor          # Check environment (ffmpeg, playwright, etc.)
demo-dev config          # Show resolved config
demo-dev providers       # List available AI/TTS providers
demo-dev plan            # Generate demo plan from git diff
demo-dev probe           # Plan + probe pages for element discovery
demo-dev capture         # Record only (no voice/render)
demo-dev voice           # Generate TTS narration only
demo-dev render          # Capture + voice + compose video
demo-dev comment         # Post demo as a PR comment
```

### Primary usage

```bash
# Prompt-driven (recommended)
demo-dev demo --base-url https://your-app.com \
  --prompt "Show the inbox, filter by positive replies, open a thread" \
  --frame

# Diff-driven (from a PR branch)
demo-dev demo --base-url http://localhost:3000

# With auth
demo-dev auth --base-url https://your-app.com --email x@y.com --password '...'
demo-dev demo --base-url https://your-app.com --prompt "..." --frame
```

---

## Important files

### Core
- `src/cli.ts` — CLI entry (citty + @clack/prompts)
- `src/orchestrate.ts` — pipeline composition
- `src/config/project.ts` — repo-level config loading

### Planning
- `src/planner/prompt.ts` — prompt-driven planner (explores site + AI generates plan)
- `src/planner/llm.ts` — diff-driven planner
- `src/planner/index.ts` — planner entry point
- `src/planner/refine.ts` — plan refinement from page probes
- `src/planner/schema.ts` — DemoPlan Zod schema

### Capture
- `src/capture/continuous-capture.ts` — screencast + ghost-cursor + CSS zoom
- `src/probe/page-probe.ts` — page element discovery
- `src/browser/session.ts` — auth/session management

### Rendering
- `src/render/ffmpeg-compose.ts` — FFmpeg video composition pipeline
- `src/render/visual-plan.ts` — zoom keyframes, speed ramps, cursor smoothing
- `src/render/browser-frame.ts` — Screen Studio-style browser window frame

### Voice
- `src/voice/script.ts` — narration text generation
- `src/voice/tts.ts` — TTS synthesis (ElevenLabs, OpenAI, local)

### AI
- `src/ai/provider.ts` — multi-provider AI layer (claude, cursor, codex, openai)

### Agent support
- `skills/demo-dev/SKILL.md`
- `skills/demo-dev/references/configuration.md`
- `skills/demo-dev/references/recipes.md`

---

## Configuration

Optional `demo.dev.config.json` in the target repo:

```json
{
  "projectName": "My App",
  "baseUrl": "https://app.example.com",
  "preferredRoutes": ["/", "/dashboard"],
  "featureHints": ["dashboard", "settings"],
  "auth": { ... }
}
```

Config is optional for prompt-driven mode — just pass `--base-url` and `--prompt`.

---

## Environment variables

### AI providers
- `DEMO_AI_PROVIDER` — `claude`, `cursor`, `codex`, `openai`, or `auto`
- `DEMO_OPENAI_API_KEY` — for OpenAI planning

### TTS providers
- `DEMO_TTS_PROVIDER` — `elevenlabs`, `openai`, or `local`
- `DEMO_ELEVENLABS_API_KEY` + `DEMO_ELEVENLABS_VOICE_ID`

### Auth
- `DEMO_STORAGE_STATE` — path to saved browser session

### Background music
- `DEMO_BGM_PATH`, `DEMO_BGM_VOLUME`

---

## Style expectations

When working in this repo:

- keep everything in English
- prefer clear product language over jargon
- keep README and docs clean
- preserve multi-project support (not tied to any specific app)
- avoid committing secrets or local config
- prefer generic, reusable abstractions

---

## Security

Already gitignored: `artifacts/`, `artifacts-*/`, `demo.dev.config.json`, `.env*`

Before publishing: `npm pack --dry-run --json`
