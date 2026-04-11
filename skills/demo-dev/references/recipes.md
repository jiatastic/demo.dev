# demo-dev recipes

## Recipe: prompt-driven demo (recommended)

```bash
demo-dev demo \
  --base-url https://app.example.com \
  --prompt "Show the onboarding flow, create a workspace, invite a teammate" \
  --frame
```

## Recipe: prompt-driven with premium voice

```bash
DEMO_ELEVENLABS_API_KEY=sk_... \
DEMO_ELEVENLABS_VOICE_ID=... \
DEMO_TTS_PROVIDER=elevenlabs \
demo-dev demo \
  --base-url https://app.example.com \
  --prompt "Show the dashboard and settings page" \
  --frame
```

## Recipe: authenticated SaaS

```bash
demo-dev auth \
  --base-url https://app.example.com \
  --email you@example.com \
  --password 'your-password'

demo-dev demo \
  --base-url https://app.example.com \
  --prompt "Show the inbox and open a conversation" \
  --frame
```

## Recipe: diff-driven PR demo

```bash
demo-dev demo --base-url http://localhost:3000
```

No `--prompt` means it reads the git diff and auto-plans scenes.

## Recipe: high quality render

```bash
demo-dev demo \
  --base-url https://app.example.com \
  --prompt "..." \
  --frame \
  --quality high
```

## Recipe: fast draft for iteration

```bash
demo-dev demo \
  --base-url https://app.example.com \
  --prompt "..." \
  --quality draft
```

## Recipe: with background music

```bash
DEMO_BGM_PATH=./assets/music/bed.mp3 \
DEMO_BGM_VOLUME=0.14 \
demo-dev demo \
  --base-url https://app.example.com \
  --prompt "..." \
  --frame
```

## Recipe: OpenAI for planning and TTS

```bash
DEMO_OPENAI_API_KEY=sk-... \
DEMO_AI_PROVIDER=openai \
DEMO_TTS_PROVIDER=openai \
demo-dev demo \
  --base-url https://app.example.com \
  --prompt "..." \
  --frame
```

## Recipe: inspect plan before recording

```bash
demo-dev plan
cat artifacts/demo-plan.json
```

## Recipe: PR automation in CI

```bash
demo-dev demo --base-url http://localhost:3000
demo-dev comment --output-dir artifacts
```
