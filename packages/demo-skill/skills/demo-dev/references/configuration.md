# demo-dev configuration

## Config file (optional)

Most agent invocations pass everything as CLI flags. For project-level defaults, drop a `demo.dev.config.json` in the working directory:

```json
{
  "projectName": "My App",
  "baseUrl": "https://app.example.com",
  "outputDir": "artifacts",
  "storageStatePath": "artifacts/storage-state.json",
  "saveStorageStatePath": "artifacts/storage-state.json",
  "preferredRoutes": ["/", "/dashboard", "/settings"],
  "featureHints": ["dashboard", "onboarding", "settings"],
  "authRequiredRoutes": ["/dashboard", "/settings"],
  "auth": {
    "loginPath": "/login",
    "emailTarget": { "strategy": "css", "value": "#email" },
    "passwordTarget": { "strategy": "css", "value": "#password" },
    "submitTarget": { "strategy": "role", "role": "button", "name": "Login" },
    "postSubmitWaitMs": 1500
  }
}
```

Bootstrap with:

```bash
demo-dev init --base-url https://app.example.com --json
```

## Config fields

| Field | Description |
|-------|-------------|
| `projectName` | Display name for the project |
| `baseUrl` | Default URL of the web app |
| `readyUrl` | URL to ping during `doctor` health-checks |
| `outputDir` | Where to write artifacts (default: `artifacts`) |
| `storageStatePath` | Path to load an existing Playwright storage-state |
| `saveStorageStatePath` | Path where `auth` writes the storage-state |
| `preferredRoutes` | Routes the prompt planner should prioritize |
| `featureHints` | Feature names that help the prompt planner |
| `authRequiredRoutes` | Routes that need login (informational) |
| `auth.*` | Selectors and timing for the login flow |

## Environment variables

### AI providers (for planning)

```bash
DEMO_AI_PROVIDER=auto           # auto (default), claude, cursor, codex, openai
DEMO_AI_MODEL=...               # Optional model override (provider-specific)
DEMO_AI_MANDATORY=true          # Fail if no provider succeeds (default true)
DEMO_LLM_TIMEOUT_MS=90000       # Per-attempt timeout
DEMO_AI_QUIET=1                 # Suppress [ai] stderr progress
DEMO_SKIP_POLISH=1              # Equivalent to demo --no-polish
DEMO_OPENAI_API_KEY=sk-...      # Required for openai provider
DEMO_OPENAI_BASE_URL=...        # Optional
DEMO_OPENAI_MODEL=...           # Optional
```

### TTS providers (for narration)

```bash
DEMO_TTS_PROVIDER=auto          # auto, elevenlabs, openai, local

# ElevenLabs (best quality)
DEMO_ELEVENLABS_API_KEY=sk_...
DEMO_ELEVENLABS_VOICE_ID=...
DEMO_ELEVENLABS_MODEL=eleven_multilingual_v2

# OpenAI TTS
DEMO_OPENAI_API_KEY=sk-...
DEMO_TTS_MODEL=gpt-4o-mini-tts
DEMO_TTS_VOICE=alloy

# Local (macOS `say`, free)
DEMO_LOCAL_TTS_VOICE=Samantha
DEMO_LOCAL_TTS_RATE=185
DEMO_LOCAL_TTS_TIMEOUT_MS=45000
```

### Auth

```bash
DEMO_STORAGE_STATE=path/to/storage-state.json     # Reuse session for capture
DEMO_SAVE_STORAGE_STATE=path/to/storage-state.json # Where auth writes
DEMO_LOGIN_EMAIL=you@example.com
DEMO_LOGIN_PASSWORD=your-password
DEMO_SESSION_TTL_HOURS=168                         # Session freshness window for doctor --check-session
```

### FFmpeg / rendering

```bash
DEMO_FFMPEG_TIMEOUT_MS=300000       # Per-step timeout
DEMO_FRAME_RENDER_TIMEOUT_MS=30000  # Frame PNG render deadline
DEMO_FFMPEG_QUIET=1                 # Suppress [ffmpeg] stderr progress
```

### Background music

```bash
DEMO_BGM_PATH=./assets/music/bed.mp3
DEMO_BGM_VOLUME=0.16
```

## Precedence

CLI flags > Environment variables > Config file > Defaults.

## Verify setup

```bash
demo-dev doctor --json
demo-dev config
demo-dev providers
```
