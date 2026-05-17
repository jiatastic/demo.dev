# demo-dev recipes

End-to-end patterns. Each recipe assumes the agent invokes commands with `--json` and parses the final `{"kind":"result"}` line.

---

## Recipe: prompt-driven demo (the canonical agent entrypoint)

```bash
demo-dev doctor --json
demo-dev demo \
  --base-url https://app.example.com \
  --prompt "Show the onboarding flow, create a workspace, invite a teammate" \
  --frame --background-preset mesh-purple --frame-chrome macos \
  --quality high --json
```

---

## Recipe: estimate before committing (cost / time uncertain)

```bash
demo-dev demo \
  --base-url https://app.example.com \
  --prompt "..." \
  --estimate-only --json
```

The result's `estimate` field contains scenes count, capture seconds, TTS char count, and a TTS cost range. Surface this to the user before continuing.

---

## Recipe: step-by-step pipeline (fine control)

```bash
# 1) Plan only
demo-dev plan --base-url https://app.example.com --prompt "..." --json
# → demo-plan.json

# 2) (optional) Hand-edit demo-plan.json, then validate
demo-dev validate ./artifacts/demo-plan.json --json

# 3) Record
demo-dev capture --base-url https://app.example.com \
  --plan ./artifacts/demo-plan.json --json
# → continuous-capture.json + recording.webm

# 4) Narrate
demo-dev voice --plan ./artifacts/demo-plan.json --json
# → voice-script.json

# 5) Director plan (zoom + speed ramps)
demo-dev direct --capture ./artifacts/continuous-capture.json --json
# → director-plan.json

# 6) Compose final mp4
demo-dev render \
  --capture ./artifacts/continuous-capture.json \
  --voice ./artifacts/voice-script.json \
  --plan ./artifacts/demo-plan.json \
  --director ./artifacts/director-plan.json \
  --frame --background-preset midnight --frame-chrome minimal \
  --quality high --json
```

---

## Recipe: authenticated SaaS (never use plaintext password)

```bash
cat > /tmp/creds.json <<EOF
{"email":"you@example.com","password":"…"}
EOF
chmod 600 /tmp/creds.json

demo-dev auth --base-url https://app.example.com \
  --credentials-file /tmp/creds.json \
  --storage-state ./artifacts/storage-state.json --json

demo-dev demo --base-url https://app.example.com \
  --prompt "Show the inbox and open a conversation" \
  --storage-state ./artifacts/storage-state.json \
  --frame --quality high --json

rm /tmp/creds.json
```

Before reusing a session, verify it is still valid:

```bash
demo-dev doctor --check-session --json
# returns {"status":"valid"|"expired"|"missing"|"unreadable", ...}
```

---

## Recipe: premium voice (ElevenLabs)

```bash
DEMO_ELEVENLABS_API_KEY=sk_... \
DEMO_ELEVENLABS_VOICE_ID=... \
DEMO_TTS_PROVIDER=elevenlabs \
demo-dev demo \
  --base-url https://app.example.com \
  --prompt "..." \
  --frame --background-preset ocean --json
```

Test a TTS provider on a single line without running the full pipeline:

```bash
DEMO_TTS_PROVIDER=local demo-dev voice --text "Hello, this is a test." --json
```

---

## Recipe: fast iteration on a single piece

Re-render only — keep capture and voice:

```bash
demo-dev demo --base-url X --prompt "..." \
  --reuse-plan artifacts/demo-plan.json \
  --reuse-capture artifacts/continuous-capture.json \
  --reuse-voice artifacts/voice-script.json \
  --frame --background-preset sunset --json
```

Re-narrate only — keep plan and capture:

```bash
demo-dev demo --base-url X --prompt "..." \
  --reuse-plan artifacts/demo-plan.json \
  --reuse-capture artifacts/continuous-capture.json \
  --json
```

Deterministic plan across reruns (OpenAI only):

```bash
demo-dev demo --base-url X --prompt "..." --seed 42 --json
```

---

## Recipe: 9:16 vertical for social

```bash
demo-dev demo --base-url https://app.example.com \
  --prompt "Quickly walk through the new feature" \
  --aspect-ratio 9:16 \
  --frame --background-preset sunset --frame-chrome minimal \
  --quality high --json
```

---

## Recipe: bare recording (no frame), for use in your own editor

```bash
demo-dev demo --base-url https://app.example.com \
  --prompt "..." \
  --quality high --json
```

Omit any `--frame` / `--background-*` flag. Output is just the recording + narration, ready for ScreenFlow / Premiere / Final Cut.

---

## Recipe: PII-sensitive demo

```bash
demo-dev demo --base-url https://app.example.com \
  --prompt "..." \
  --blur-emails --blur-credit-cards \
  --frame --quality high --json
```

Injects a CSS blur on email-shaped + credit-card-shaped content in the recording.

---

## Recipe: safety — destructive flows

Destructive scenes (delete / revoke / cancel) are skipped by default. To run them:

```bash
demo-dev demo --base-url https://app.example.com \
  --prompt "Demo deleting an old project" \
  --allow-destructive --frame --json
```

Only do this after the user explicitly authorizes a non-production target.

---

## Recipe: validate a hand-written plan

```bash
demo-dev validate ./my-plan.json --json
# returns {"ok":true,"metrics":{"scenes":N}} or {"kind":"error","error":{"code":"REUSE_ARTIFACT_INVALID","details":{"issues":[...]}}}
```

Use this in agent workflows where the agent itself writes the plan — fail fast before recording.

---

## Recipe: with background music

```bash
DEMO_BGM_PATH=./assets/music/bed.mp3 \
DEMO_BGM_VOLUME=0.14 \
demo-dev demo \
  --base-url https://app.example.com \
  --prompt "..." \
  --frame --json
```

---

## Recipe: OpenAI for both planning and TTS

```bash
DEMO_OPENAI_API_KEY=sk-... \
DEMO_AI_PROVIDER=openai \
DEMO_TTS_PROVIDER=openai \
demo-dev demo \
  --base-url https://app.example.com \
  --prompt "..." \
  --frame --json
```

---

## Recipe: built-in showcase (no real app required)

```bash
demo-dev showcase --quality high --frame --background-preset mesh-purple --json
```

Generates a controlled, repeatable demo against a built-in spreadsheet UI. Useful for README hero videos.
