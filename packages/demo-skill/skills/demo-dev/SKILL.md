---
name: demo-dev
description: Screen Studio for AI agents. Generate a narrated, polished demo video of any web app from a URL and a natural-language prompt. Use when the user asks to "record a demo", "make a walkthrough video", "show off a feature", or wants a screencast of a product flow. Do NOT use for static screenshots, GIFs, headless E2E tests, scraping, or any task that does not produce an mp4.
allowed-tools: Bash Read Edit Write
---

# demo-dev

A CLI for generating Screen Studio–quality product demo videos. Designed to be driven by AI agents (Claude Code, Cursor, Devin, Codex, etc.). Every command supports `--json` for NDJSON progress + a structured final result; every error has a stable `code`.

## When to use

Triggers: "record a demo", "walkthrough video", "screencast", "show me X working", "make a Loom-style / Screen Studio–style video".

Do NOT use for:
- Static screenshots, GIFs → use a screenshot tool.
- Automated tests, E2E regression → use Playwright directly.
- Scraping page data → use a scraper.
- Live screen-share / streaming.

## Hard rules

1. **Never pass passwords in tool arguments.** Use `--credentials-file` or env vars (`DEMO_LOGIN_EMAIL` / `DEMO_LOGIN_PASSWORD`). Plaintext `--password` ends up in your transcript.
2. **Always run `demo-dev doctor --json` first** — verifies ffmpeg, Playwright Chromium, and config in <2s. Add `--check-session` to verify a stored session is fresh before recording.
3. **Always use `--json`** when running from an agent harness. Parse only the final NDJSON line: `{"kind":"result", ...}` or `{"kind":"error", ...}`.
4. **Run `demo --estimate-only` first** when cost/duration is uncertain. Returns scenes, capture seconds, and a TTS cost range without recording.
5. **Destructive scenes are skipped by default.** Pass `--allow-destructive` only after explicit user authorization for a non-production target.
6. **Same-origin only.** The recorder blocks navigations to hosts other than `--base-url`. Allow more via `--allow-domain a.example.com,b.example.com`.
7. **Prefer building up step-by-step** (`plan` → review → `capture` → `render`) over a one-shot `demo`. Each phase is its own CLI and each writes an artifact you can re-use.

## Decision tree

```
Want to make a demo video?
├─ YES
│   │
│   ├─ Run: demo-dev doctor --json   # 1) sanity-check env
│   │   └─ fix anything that fails before continuing
│   │
│   ├─ App requires login?
│   │   └─ YES → demo-dev doctor --check-session --json
│   │            ├─ valid           → continue
│   │            └─ missing/expired → demo-dev auth --credentials-file creds.json
│   │
│   ├─ Have a prompt?
│   │   └─ YES → demo-dev demo --base-url X --prompt "..." --json
│   │            (the canonical one-shot)
│   │
│   ├─ Want fine-grained control?
│   │   1. demo-dev plan --base-url X --prompt "..." --json         (writes demo-plan.json)
│   │   2. demo-dev validate demo-plan.json --json                  (optional schema check)
│   │   3. demo-dev capture --base-url X --plan demo-plan.json --json
│   │   4. demo-dev voice --plan demo-plan.json --json
│   │   5. demo-dev direct --capture continuous-capture.json --json
│   │   6. demo-dev render --capture continuous-capture.json --voice voice-script.json --plan demo-plan.json --json
│   │
│   └─ Cost/duration uncertain?
│       └─ demo-dev demo ... --estimate-only --json
```

## Quick reference (most common invocations)

**One-shot full pipeline**:
```bash
demo-dev demo --base-url https://app.example.com \
  --prompt "Show the dashboard, create a project, invite a teammate" \
  --frame --background-preset mesh-purple --frame-chrome minimal \
  --quality high --json
```

**Plan only, no recording**:
```bash
demo-dev plan --base-url https://app.example.com --prompt "..." --json
```

**Reuse plan, rerun render with different visuals**:
```bash
demo-dev demo --base-url https://app.example.com \
  --reuse-plan demo-plan.json --reuse-capture continuous-capture.json \
  --frame --background-image ./bg.jpg --frame-chrome none --json
```

## 19 commands at a glance

Always run with `--json` from an agent harness. Full details in [references/commands.md](references/commands.md).

| Setup     | `doctor` · `auth` · `config` · `init` · `providers` |
| Info      | `styles` · `exports` · `errors` · `tools-schema` |
| Build     | `plan` · `validate` · `capture` · `voice` · `direct` · `render` · `quality` |
| Pipeline  | `demo` · `showcase` |

## Frame styling (Screen Studio quality)

The browser frame is fully styleable via CLI flags. Key options:
- `--background-preset` — `sunset | ocean | forest | mesh-purple | mesh-pink | midnight | paper`
- `--background-image PATH` — your own image
- `--background-color #hex` — solid color
- `--frame-chrome macos | minimal | none` — chrome style
- `--frame-shadow none | soft | medium | strong`
- `--frame-radius PX`
- `--frame-padding PX`

Full visual recipes: [references/frame-styling.md](references/frame-styling.md).

## Error codes (parse these from `{"kind":"error"}`)

| Code | Agent action |
|------|---|
| `CONFIG_MISSING_BASE_URL` | Ask user for URL, retry. |
| `AUTH_REQUIRED` / `STORAGE_STATE_MISSING` | Run `demo-dev auth --credentials-file ...`. |
| `STORAGE_STATE_EXPIRED` | Re-run `demo-dev auth`. |
| `AUTH_CREDENTIALS_MISSING` | Ask user, save to file, retry. |
| `LLM_PROVIDER_UNAVAILABLE` | `demo-dev providers`; set `DEMO_OPENAI_API_KEY` or install claude/cursor/codex CLI. |
| `LLM_RATE_LIMITED` | Back off ~60s, retry. |
| `LLM_FAILED` | Check the offending provider; consider `DEMO_AI_PROVIDER=openai`. |
| `FFMPEG_MISSING` / `FFMPEG_FAILED` | Install ffmpeg / inspect stderr. |
| `NAVIGATION_BLOCKED_BY_POLICY` | Confirm with user, add `--allow-domain <host>`. |
| `DESTRUCTIVE_ACTION_BLOCKED` | Confirm with user, rerun with `--allow-destructive`. |
| `REUSE_ARTIFACT_NOT_FOUND` / `REUSE_ARTIFACT_INVALID` | Drop the `--reuse-*` flag or fix the path. |
| `INTERRUPTED` | Run was cancelled. `partialArtifacts` lists what survived. |

Full list with `demo-dev errors --json`.

## Phase progress events (with `--json`)

Each phase emits `{"kind":"progress","phase":"plan|capture|voice|director|render|quality|estimate","status":"start|success|warn|skip|fail","message":"..."}`. Useful for UI; not required for correctness.

## Caching for iteration

After one full run you can iterate cheaply:

```bash
demo-dev demo --base-url X --prompt "..." \
  --reuse-plan artifacts/demo-plan.json \
  --reuse-capture artifacts/continuous-capture.json \
  --json
```

- Tweak narration only → pass `--reuse-capture`, omit `--reuse-voice`.
- Tweak visuals only → use `render` directly with the same capture.
- Deterministic plans across reruns → `--seed 42` (OpenAI only).

## Tool schema for non-Anthropic agents

```bash
demo-dev tools-schema --format openai
```

Drops a `tools: [...]` array directly into Cursor / Devin / Codex tool definitions.

## Outputs

A successful `demo` ends with one JSON line:

```json
{
  "kind": "result",
  "ok": true,
  "command": "demo",
  "durationMs": 41320,
  "outputDir": "artifacts",
  "artifacts": {
    "videoPath": "artifacts/pr-demo.mp4",
    "planPath": "artifacts/demo-plan.json",
    "capturePath": "artifacts/continuous-capture.json",
    "voiceScriptPath": "artifacts/voice-script.json",
    "qualityReportPath": "artifacts/quality-report.json"
  },
  "scenes": [...],
  "warnings": [],
  "metrics": { "qualityScore": 87 }
}
```

See [references/commands.md](references/commands.md) for every command, [references/frame-styling.md](references/frame-styling.md) for visual recipes, and [references/recipes.md](references/recipes.md) for common end-to-end patterns.
