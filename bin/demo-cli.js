#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const cliPath = resolve(root, "src", "cli.ts");
const tsxPackagePath = require.resolve("tsx/package.json");
const tsxCliPath = resolve(dirname(tsxPackagePath), "dist", "cli.mjs");

const child = spawn(process.execPath, [tsxCliPath, cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
