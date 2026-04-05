# demo.dev skill configuration

## Quick bootstrap

A fast way to bootstrap a repo is:

```bash
demo-dev init
```

That writes a starter config plus the workflow template.

## Minimal config

Create `demo.dev.config.json` in the target repo:

```json
{
  "projectName": "My App",
  "baseUrl": "http://localhost:3000",
  "readyUrl": "http://localhost:3000",
  "devCommand": "npm run dev",
  "baseRef": "origin/main",
  "outputDir": "artifacts",
  "preferredRoutes": ["/", "/dashboard"],
  "featureHints": ["home", "dashboard"]
}
```

## Auth-enabled config

```json
{
  "projectName": "My SaaS",
  "baseUrl": "https://app.example.com",
  "readyUrl": "https://app.example.com",
  "baseRef": "origin/main",
  "outputDir": "artifacts",
  "storageStatePath": "artifacts/storage-state.json",
  "saveStorageStatePath": "artifacts/storage-state.json",
  "preferredRoutes": ["/dashboard", "/settings"],
  "featureHints": ["dashboard", "settings"],
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

## Useful overrides

You can override config through:

- CLI flags like `--base-url`, `--output-dir`, `--base-ref`
- env vars like `DEMO_STORAGE_STATE`, `DEMO_SAVE_STORAGE_STATE`, `DEMO_CONFIG`
- GitHub Variables in workflow:
  - `DEMO_BASE_URL`
  - `DEMO_READY_URL`
  - `DEMO_DEV_COMMAND`
  - `DEMO_OUTPUT_DIR`

## Suggested setup for other repos

1. Copy `demo.dev.config.example.json` into the target repo.
2. Adjust `baseUrl`, `devCommand`, and `auth`.
3. Validate the repo:

```bash
demo-dev doctor
demo-dev config
demo-dev pr-demo
```
