---
name: demo-dev
description: Generate product demo videos for any web app. Give a URL and a prompt, get a narrated Screen Studio-style video. Supports authenticated SaaS, prompt-driven or diff-driven planning, and AI narration.
allowed-tools: Bash Read Edit Write
---

# demo-dev

Use this skill when the user wants to generate a demo video of a web app.

## What this skill does

- Opens a web app in a headless browser
- AI plans the demo from a natural language prompt (or git diff)
- Ghost-cursor navigates with human-like mouse movement
- Records continuously with Playwright screencast + CSS zoom
- Generates narration per scene with ElevenLabs / OpenAI / local TTS
- Composes a polished mp4 with FFmpeg (speed ramps, browser frame, audio)

## Quick start

### 1. Check environment

```bash
demo-dev doctor
```

Requires: Node.js >= 20, FFmpeg, Chromium (`npx playwright install chromium`).

### 2. If auth is required

```bash
demo-dev auth \
  --base-url https://app.example.com \
  --email you@example.com \
  --password 'your-password'
```

### 3. Generate a demo

```bash
demo-dev demo \
  --base-url https://app.example.com \
  --prompt "Show the dashboard, create a new project, invite a teammate" \
  --frame
```

This single command will: explore the site → AI plan scenes → record → narrate → compose → mp4.

### Diff-driven mode (from a PR branch)

```bash
demo-dev demo --base-url http://localhost:3000
```

No `--prompt` = auto-detect changes from git diff.

## Key flags

| Flag | Description |
|------|-------------|
| `--prompt "..."` | Describe the demo in natural language |
| `--frame` | Add Screen Studio-style browser frame with gradient background |
| `--quality draft\|standard\|high` | Video quality preset |
| `--base-url` | URL of the app |
| `--output-dir` | Where to write output (default: artifacts) |

## All commands

```bash
demo-dev demo        # Full pipeline
demo-dev auth        # Login and save session
demo-dev capture     # Record only
demo-dev voice       # Generate narration only
demo-dev render      # Record + narrate + compose
demo-dev plan        # Generate plan from git diff
demo-dev probe       # Plan + probe pages
demo-dev init        # Create config file
demo-dev doctor      # Check environment
demo-dev config      # Show config
demo-dev providers   # List AI/TTS providers
demo-dev comment     # Post as PR comment
```

## When to use prompt vs diff mode

| Mode | When to use |
|------|-------------|
| `--prompt "..."` | Feature demos, product tours, any app you can reach via URL |
| No prompt (diff) | PR walkthroughs, auto-detected from code changes |

## Recommended agent behavior

1. Prefer prompt-driven mode — it works with any web app, no git repo needed.
2. Use `--frame` for polished output.
3. If auth is required, run `demo-dev auth` first.
4. If AI-generated selectors fail, the system auto-retries with fuzzy matching.
5. Keep narration conversational and product-focused.
6. For best voice quality, set `DEMO_TTS_PROVIDER=elevenlabs`.

## Outputs

- `artifacts/pr-demo.mp4` — the final video
- `artifacts/demo-plan.json` — AI-generated scene plan
- `artifacts/visual-plan.json` — zoom keyframes + speed ramps
- `artifacts/voice-script.json` — narration text + audio paths
- `artifacts/continuous-capture.json` — recording metadata

See [references/configuration.md](references/configuration.md) and [references/recipes.md](references/recipes.md).
