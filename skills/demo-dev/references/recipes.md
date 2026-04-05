# demo.dev skill recipes

## Recipe: run on a simple local app

```bash
npm install
npx playwright install chromium
demo-dev doctor
demo-dev pr-demo
```

## Recipe: authenticated SaaS

```bash
demo-dev auth:bootstrap \
  --email you@example.com \
  --password 'your-password'

demo-dev pr-demo
```

## Recipe: inspect plan quality first

```bash
demo-dev plan
demo-dev probe
```

Use this when the feature is not obvious from the diff.

## Recipe: re-render without recapturing

```bash
demo-dev render --manifest artifacts/render-manifest.json --out artifacts/pr-demo.mp4
```

## Recipe: manual feature film

Use a manual plan when you need a specific flow like:
- AI editing
- inbox triage
- onboarding
- dashboard walkthrough

Suggested flow:

1. Create `artifacts/manual-plan.json`
2. Run capture against that plan
3. Build manifest
4. Render mp4

## Recipe: PR automation

In CI, run:

```bash
demo-dev pr-demo
demo-dev comment --output-dir artifacts
```

If the app needs a server, set `devCommand` and `readyUrl` in config or GitHub Variables.
