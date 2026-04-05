---
name: demo-dev
description: Generate PR demo videos for any web app repo using demo.dev. Use when a user wants an agent to turn a PR, diff, feature branch, or live app flow into a product demo video, especially for authenticated SaaS flows, launch-style walkthroughs, or PR review artifacts.
allowed-tools: Bash Read Edit Write
---

# demo-dev

Use this skill when the user wants an agent to create or update a demo video with the `demo.dev` pipeline.

## What this skill does

- Reads project config from `demo.dev.config.json`
- Runs the pipeline from diff -> plan -> probe -> capture -> render
- Supports authenticated products via storage state
- Can also create manual plans for feature-specific demos
- Produces artifacts like mp4, manifest, captures, and PR comments

## Default workflow

### 1. Inspect config

```bash
demo-dev config
demo-dev config --field baseUrl
demo-dev doctor
```

If config is missing, run `demo-dev init` or create one from [`../../demo.dev.config.example.json`](../../demo.dev.config.example.json).

See [references/configuration.md](references/configuration.md).

### 2. If auth is required, bootstrap login

```bash
demo-dev auth:bootstrap \
  --email you@example.com \
  --password 'your-password'
```

This writes storage state using the configured path or `artifacts/storage-state.json`.

### 3. Run the full pipeline

```bash
demo-dev pr-demo
```

Or explicitly:

```bash
demo-dev pr-demo --base-url http://localhost:3000 --base-ref origin/main
```

### 4. Re-render only when capture and manifest already exist

```bash
demo-dev render --manifest artifacts/render-manifest.json --out artifacts/pr-demo.mp4
```

## When to use manual plans

Use a manual plan when:
- the feature is behind auth or deep navigation
- the planner cannot infer the correct route from diff
- the user wants a specific product moment, such as AI editing, onboarding, settings, inbox, or dashboards
- the user wants a more launch-style product film rather than raw replay

Place plans in an artifacts folder such as:

```bash
artifacts/manual-plan.json
```

Then run capture / manifest / render around that plan.

See [references/recipes.md](references/recipes.md).

## Recommended agent behavior

1. Prefer stable, product-facing flows over exhaustive QA coverage.
2. For the same route, keep one screen object and move the camera instead of cutting to a new screen.
3. Prefer stable states over loading transitions.
4. If auth is required, verify storage state early.
5. If planner output is weak, create a tighter manual plan instead of forcing bad automation.
6. Keep copy concise and product-first.

## Core commands

Preferred first-class CLI:

```bash
demo-dev config
demo-dev providers
demo-dev plan
demo-dev probe
demo-dev auth:bootstrap --email you@example.com --password 'your-password'
demo-dev capture
demo-dev voice
demo-dev manifest
demo-dev render --manifest artifacts/render-manifest.json --out artifacts/pr-demo.mp4
demo-dev comment --output-dir artifacts --pr-number 123
demo-dev pr-demo
```

Repo-local fallback:

```bash
npm run config
npm run providers
npm run plan
npm run probe
npm run auth:bootstrap
npm run capture
npm run voice
npm run manifest
npm run render -- --manifest artifacts/render-manifest.json --out artifacts/pr-demo.mp4
npm run comment -- --output-dir artifacts --pr-number 123
npm run pr-demo
```

## Outputs to check

- `artifacts/demo-context.json`
- `artifacts/demo-plan.initial.json`
- `artifacts/page-probes.json`
- `artifacts/demo-plan.json`
- `artifacts/captures.json`
- `artifacts/render-manifest.json`
- `artifacts/pr-demo.mp4`

## Troubleshooting

- If the app requires auth, run `auth:bootstrap` first.
- If the video is wrong, inspect `captures.json` and `render-manifest.json` before changing renderer code.
- If the planner misses the feature, create a manual plan.
- If the route is unstable, add project hints in config.

## Share this skill

Other users can install this repo as a pi package or point pi at this repo's `skills/` directory.

Example:

```bash
pi install /absolute/path/to/demo.dev
```

or

```bash
pi install git:github.com/your-org/demo.dev
```
