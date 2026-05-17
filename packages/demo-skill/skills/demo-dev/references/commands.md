# demo-dev — every command

All commands accept `--json` for NDJSON progress + a structured final result. The final stdout line is always `{"kind":"result"}` or `{"kind":"error"}`. Parse that line.

---

## Setup

### `doctor`
Sanity-check the environment.

```bash
demo-dev doctor --json
demo-dev doctor --check-session --json     # only verify storage-state freshness
```

### `auth`
Log into the target app and persist a Playwright storage-state.

```bash
demo-dev auth --base-url https://app.example.com \
  --credentials-file ./creds.json \
  --storage-state ./artifacts/storage-state.json --json
```

`creds.json` is `{"email":"...","password":"..."}`. Prefer this over `--password` (which leaks into shell history).

### `init`
Create a `demo.dev.config.json` in the current directory.

```bash
demo-dev init --base-url https://app.example.com --json
demo-dev init --force --json     # overwrite
```

### `config`
Show the resolved project config.

```bash
demo-dev config
demo-dev config --field baseUrl       # extract a single field
```

### `providers`
List available AI / TTS providers detected in the environment.

```bash
demo-dev providers
```

---

## Info (no side effects)

### `styles`
List visual direction style presets available for `--style`.

```bash
demo-dev styles
```

### `exports`
List available aspect ratios and quality presets.

```bash
demo-dev exports
```

### `errors`
List structured error codes the CLI may emit.

```bash
demo-dev errors
```

### `tools-schema`
Emit an OpenAI function-calling schema for every public command.

```bash
demo-dev tools-schema --format openai
demo-dev tools-schema --format json       # array only, no wrapper
```

---

## Build the pipeline step-by-step

Every step is its own CLI; every step writes an artifact you can re-use.

### `plan`
Build a demo plan from a natural-language prompt. Does not record.

```bash
demo-dev plan --base-url https://app.example.com \
  --prompt "Show the dashboard and create a new project" \
  --seed 42 --probe --json
```

- `--probe` also runs page-level probing to refine selectors.
- Writes `demo-plan.json`.

### `validate`
Validate a hand-written `demo-plan.json` against the schema. No browser, no LLM.

```bash
demo-dev validate ./demo-plan.json --json
```

### `capture`
Record a continuous video from an existing demo plan.

```bash
demo-dev capture --base-url https://app.example.com \
  --plan ./demo-plan.json \
  --allow-destructive --allow-domain login.auth.com \
  --blur-emails --json
```

- Writes `continuous-capture.json` + raw `recording.webm`.

### `voice`
Synthesize narration. Two modes:

```bash
# from a plan
demo-dev voice --plan ./demo-plan.json --json

# one-off TTS test
demo-dev voice --text "Hello world" --json
```

- Writes `voice-script.json` + per-line mp3 files.

### `direct`
Generate a director plan (zoom keyframes + speed ramps) from an existing capture.

```bash
demo-dev direct --capture ./continuous-capture.json --style launch-demo --json
```

- Writes `director-plan.json` + `visual-plan.json`.

### `render`
Compose the final mp4 from a capture (+ optional voice + director + plan).

```bash
demo-dev render \
  --capture ./continuous-capture.json \
  --voice ./voice-script.json \
  --plan ./demo-plan.json \
  --director ./director-plan.json \
  --out ./final.mp4 \
  --quality high --aspect-ratio 16:9 \
  --frame --background-preset mesh-purple \
  --json
```

### `quality`
Score an existing mp4.

```bash
demo-dev quality ./final.mp4 \
  --plan ./demo-plan.json --voice ./voice-script.json \
  --aspect-ratio 16:9 --json
```

---

## Full pipeline (the canonical agent entrypoint)

### `demo`
Plan → capture → voice → render → mp4.

```bash
demo-dev demo --base-url https://app.example.com \
  --prompt "Show the dashboard, create a project, invite a teammate" \
  --frame --background-preset mesh-purple --frame-chrome minimal \
  --quality high --aspect-ratio 16:9 --json
```

Reuse-cache flags (skip earlier phases):
- `--reuse-plan <path>`
- `--reuse-capture <path>`
- `--reuse-voice <path>`

Other useful flags:
- `--estimate-only` — only plan, return cost/duration estimate.
- `--no-polish` — skip the LLM polish pass over narration copy (saves up to 3 min).
- `--seed <number>` — deterministic plan (OpenAI only).
- `--storage-state <path>` — reuse a session.
- `--allow-destructive`, `--allow-domain`, `--blur-emails`, `--blur-credit-cards`.

### `showcase`
Built-in public showcase demo (no real app needed).

```bash
demo-dev showcase --quality high --frame --json
```

---

## Frame flags (apply to `demo`, `render`, `showcase`)

| Flag | Values | Default |
|---|---|---|
| `--frame` | enables the frame | off |
| `--frame-chrome` | `macos`, `minimal`, `none` | `macos` |
| `--frame-radius` | px | `14` |
| `--frame-shadow` | `none`, `soft`, `medium`, `strong` | `medium` |
| `--frame-padding` | px | `64` |
| `--background-preset` | `sunset`, `ocean`, `forest`, `mesh-purple`, `mesh-pink`, `midnight`, `paper` | (mesh-purple if frame on) |
| `--background-image` | path to image file | none |
| `--background-color` | hex string | none |
| `--display-url` | text in address bar (macos chrome only) | inferred from capture |

See [frame-styling.md](frame-styling.md) for visual recipes.

---

## Environment variables

| Var | Effect |
|---|---|
| `DEMO_AI_PROVIDER` | `auto` (default), `cursor`, `claude`, `codex`, `openai` |
| `DEMO_LLM_TIMEOUT_MS` | Per-attempt LLM timeout (default 90000) |
| `DEMO_FFMPEG_TIMEOUT_MS` | Per-step ffmpeg timeout (default 300000) |
| `DEMO_FRAME_RENDER_TIMEOUT_MS` | Hard deadline for frame PNG rendering (default 30000) |
| `DEMO_AI_QUIET=1` | Suppress `[ai]` stderr progress |
| `DEMO_FFMPEG_QUIET=1` | Suppress `[ffmpeg]` stderr progress |
| `DEMO_SKIP_POLISH=1` | Equivalent to `--no-polish` on `demo` |
| `DEMO_TTS_PROVIDER` | `auto`, `elevenlabs`, `openai`, `local` |
| `DEMO_OPENAI_API_KEY`, `DEMO_OPENAI_MODEL` | OpenAI provider |
| `DEMO_ELEVENLABS_API_KEY`, `DEMO_ELEVENLABS_VOICE_ID` | ElevenLabs TTS |
| `DEMO_LOGIN_EMAIL`, `DEMO_LOGIN_PASSWORD` | Credentials for `auth` |
| `DEMO_STORAGE_STATE` | Existing storage-state to reuse |
| `DEMO_BGM_PATH`, `DEMO_BGM_VOLUME` | Background music |
| `DEMO_SESSION_TTL_HOURS` | Storage-state TTL for `doctor --check-session` (default 168) |
