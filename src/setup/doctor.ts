import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import type { ProjectConfig } from "../config/project.js";

interface CheckResult {
  label: string;
  status: "pass" | "warn" | "fail" | "skip";
  detail: string;
}

const fileExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const commandExists = (command: string) => {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
    stdio: "ignore",
  });
  return result.status === 0;
};

const checkUrl = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

export const runDoctor = async (options: {
  configPath?: string;
  config: ProjectConfig;
}) => {
  const checks: CheckResult[] = [];
  const workflowPath = resolve(process.cwd(), ".github", "workflows", "pr-demo.yml");

  checks.push(
    options.configPath
      ? { label: "Config file", status: "pass", detail: options.configPath }
      : { label: "Config file", status: "warn", detail: "No demo.dev.config.json found." },
  );

  checks.push(
    options.config.baseUrl
      ? { label: "baseUrl", status: "pass", detail: options.config.baseUrl }
      : { label: "baseUrl", status: "fail", detail: "Missing baseUrl in config." },
  );

  checks.push(
    options.config.outputDir
      ? { label: "outputDir", status: "pass", detail: options.config.outputDir }
      : { label: "outputDir", status: "warn", detail: "Missing outputDir. Defaults to artifacts." },
  );

  checks.push(
    options.config.devCommand
      ? { label: "devCommand", status: "pass", detail: options.config.devCommand }
      : { label: "devCommand", status: "warn", detail: "No devCommand configured. CI must point at a live app URL." },
  );

  checks.push(
    (await fileExists(workflowPath))
      ? { label: "Workflow", status: "pass", detail: workflowPath }
      : { label: "Workflow", status: "warn", detail: "Missing .github/workflows/pr-demo.yml" },
  );

  checks.push(
    commandExists("git")
      ? { label: "git", status: "pass", detail: "git found" }
      : { label: "git", status: "fail", detail: "git is required" },
  );

  checks.push(
    commandExists("ffmpeg")
      ? { label: "ffmpeg", status: "pass", detail: "ffmpeg found" }
      : { label: "ffmpeg", status: "warn", detail: "ffmpeg not found. Local media workflows may fail." },
  );

  checks.push(
    commandExists("ffprobe")
      ? { label: "ffprobe", status: "pass", detail: "ffprobe found" }
      : { label: "ffprobe", status: "warn", detail: "ffprobe not found. Audio timing inspection may fail." },
  );

  const browserBinaryExists = await fileExists(chromium.executablePath()).catch(() => false);
  checks.push(
    browserBinaryExists
      ? { label: "Playwright Chromium", status: "pass", detail: chromium.executablePath() }
      : { label: "Playwright Chromium", status: "fail", detail: "Chromium browser is not installed. Run: npx playwright install chromium" },
  );

  if (options.config.readyUrl ?? options.config.baseUrl) {
    const readyUrl = options.config.readyUrl ?? options.config.baseUrl;
    const reachable = readyUrl ? await checkUrl(readyUrl) : false;
    checks.push(
      readyUrl
        ? reachable
          ? { label: "readyUrl", status: "pass", detail: `${readyUrl} is reachable` }
          : { label: "readyUrl", status: "warn", detail: `${readyUrl} is not reachable right now` }
        : { label: "readyUrl", status: "skip", detail: "No readyUrl configured" },
    );
  }

  const storageStatePath = options.config.storageStatePath ?? process.env.DEMO_STORAGE_STATE;
  if (storageStatePath) {
    checks.push(
      (await fileExists(resolve(process.cwd(), storageStatePath)))
        ? { label: "storageState", status: "pass", detail: storageStatePath }
        : { label: "storageState", status: "warn", detail: `${storageStatePath} is configured but does not exist yet` },
    );
  } else {
    checks.push({ label: "storageState", status: "skip", detail: "No storage state configured" });
  }

  const bgmPath = process.env.DEMO_BGM_PATH;
  if (bgmPath) {
    checks.push(
      (await fileExists(resolve(process.cwd(), bgmPath)))
        ? { label: "bgm", status: "pass", detail: bgmPath }
        : { label: "bgm", status: "warn", detail: `${bgmPath} is configured but does not exist` },
    );
  } else {
    checks.push({ label: "bgm", status: "skip", detail: "No background music configured" });
  }

  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");

  for (const check of checks) {
    const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "!" : check.status === "fail" ? "✗" : "-";
    console.log(`${icon} ${check.label}: ${check.detail}`);
  }

  console.log("");
  console.log(`Doctor summary: ${checks.length - warnings.length - failures.length} passed, ${warnings.length} warnings, ${failures.length} failures.`);

  return {
    ok: failures.length === 0,
    checks,
  };
};
