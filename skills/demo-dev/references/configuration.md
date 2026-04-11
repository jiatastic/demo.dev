# demo-dev configuration

## Config file (optional)

Config is **optional for prompt-driven mode**. Just pass `--base-url` and `--prompt` directly.

For project-level defaults, create `demo.dev.config.json`:

```json
{
  "projectName": "My App",
  "baseUrl": "https://app.example.com",
  "baseRef": "origin/main",
  "outputDir": "artifacts",
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

Or bootstrap with `demo-dev init`.

## Config fields

| Field | Description |
|-------|-------------|
| `projectName` | Display name for the project |
| `baseUrl` | Default URL of the web app |
| `baseRef` | Git base ref for diff-based planning (default: origin/main) |
| `outputDir` | Where to write artifacts (default: artifacts) |
| `preferredRoutes` | Routes the AI planner should explore and prioritize |
| `featureHints` | Feature names to help the AI planner |
| `authRequiredRoutes` | Routes that need login |
| `auth.*` | Login flow configuration |

## Environment variables

### AI providers

```bash
DEMO_AI_PROVIDER=auto           # auto, claude, cursor, codex, openai
DEMO_OPENAI_API_KEY=sk-...      # Required for openai provider
DEMO_OPENAI_BASE_URL=...        # Optional
DEMO_OPENAI_MODEL=...           # Optional model override
```

### TTS providers

```bash
DEMO_TTS_PROVIDER=auto          # auto, elevenlabs, openai, local

# ElevenLabs (best quality)
DEMO_ELEVENLABS_API_KEY=sk_...
DEMO_ELEVENLABS_VOICE_ID=...

# OpenAI TTS
DEMO_OPENAI_API_KEY=sk-...

# Local (macOS only, free)
DEMO_LOCAL_TTS_VOICE=Samantha
```

### Auth

```bash
DEMO_STORAGE_STATE=path/to/storage-state.json
DEMO_LOGIN_EMAIL=you@example.com
DEMO_LOGIN_PASSWORD=your-password
```

### Background music

```bash
DEMO_BGM_PATH=./assets/music/bed.mp3
DEMO_BGM_VOLUME=0.16
```

## Precedence

CLI flags > Environment variables > Config file > Defaults

## Verify setup

```bash
demo-dev doctor
demo-dev config
```
