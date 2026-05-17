# AGENTS.md

## Project overview

This repository is `demo.dev`: Screen Studio for AI agents. It generates polished product demo videos from a URL and a natural language goal.

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
demo-dev showcase        # Generate a built-in public showcase demo
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

# Public showcase without third-party auth
bun run showcase:web
demo-dev showcase --quality high --frame --output-dir artifacts-showcase-sheet
```

---

## Important files

### Core
- `apps/cli/src/cli.ts` — CLI entry (citty + @clack/prompts)
- `apps/cli/src/showcase/sheet.ts` — deterministic spreadsheet showcase plan
- `apps/web/src/server.ts` — web scaffold and built-in showcase pages
- `packages/agent/src/orchestrate.ts` — pipeline composition
- `packages/core/src/config/project.ts` — repo-level config loading

### Planning
- `packages/planner/src/planner/prompt.ts` — prompt-driven planner (explores site + AI generates plan)
- `packages/planner/src/planner/llm.ts` — diff-driven planner
- `packages/planner/src/planner/index.ts` — planner entry point
- `packages/planner/src/planner/refine.ts` — plan refinement from page probes
- `packages/planner/src/planner/schema.ts` — DemoPlan Zod schema

### Capture
- `packages/browser/src/capture/continuous-capture.ts` — screencast + ghost-cursor + CSS zoom
- `packages/browser/src/probe/page-probe.ts` — page element discovery
- `packages/browser/src/session.ts` — auth/session management

### Rendering
- `packages/render/src/ffmpeg-compose.ts` — FFmpeg video composition pipeline
- `packages/render/src/visual-plan.ts` — zoom keyframes, speed ramps, cursor smoothing
- `packages/render/src/browser-frame.ts` — Screen Studio-style browser window frame

### Voice
- `packages/voice/src/script.ts` — narration text generation
- `packages/voice/src/tts.ts` — TTS synthesis (ElevenLabs, OpenAI, local)

### AI
- `packages/ai/src/provider.ts` — multi-provider AI layer (claude, cursor, codex, openai)

### Agent support
- `packages/demo-skill/skills/demo-dev/SKILL.md`
- `packages/demo-skill/skills/demo-dev/references/configuration.md`
- `packages/demo-skill/skills/demo-dev/references/recipes.md`

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
