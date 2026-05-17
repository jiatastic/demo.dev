import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import type { ProjectConfig } from "@demo-dev/core";

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

export type SessionStatus = "valid" | "expired" | "missing" | "unreadable";

export interface SessionCheckReport {
  status: SessionStatus;
  path: string | null;
  ageMs: number | null;
  ttlMs: number;
}

const DEFAULT_SESSION_TTL_HOURS = 24 * 7;

export const checkSession = async (options: {
  path?: string;
  ttlHours?: number;
}): Promise<SessionCheckReport> => {
  const ttlMs = (options.ttlHours ?? Number(process.env.DEMO_SESSION_TTL_HOURS ?? DEFAULT_SESSION_TTL_HOURS)) * 3600_000;
  if (!options.path) {
    return { status: "missing", path: null, ageMs: null, ttlMs };
  }
  const path = resolve(process.cwd(), options.path);
  if (!(await fileExists(path))) {
    return { status: "missing", path, ageMs: null, ttlMs };
  }
  try {
    const st = await stat(path);
    const ageMs = Date.now() - st.mtimeMs;
    // Cheap sanity-check that it's at least a JSON object with cookies/origins.
    const raw = await readFile(path, "utf8");
    JSON.parse(raw);
    return { status: ageMs > ttlMs ? "expired" : "valid", path, ageMs, ttlMs };
  } catch {
    return { status: "unreadable", path, ageMs: null, ttlMs };
  }
};

export const runDoctor = async (options: {
  configPath?: string;
  config: ProjectConfig;
  json?: boolean;
  checkSessionOnly?: boolean;
}) => {
  const json = options.json ?? false;
  const storageStatePath = options.config.storageStatePath ?? process.env.DEMO_STORAGE_STATE;

  if (options.checkSessionOnly) {
    const report = await checkSession({ path: storageStatePath });
    if (json) {
      process.stdout.write(JSON.stringify({ kind: "session-check", ...report }) + "\n");
    } else {
      console.log(`Session ${report.status}${report.path ? ` (${report.path})` : ""}${report.ageMs !== null ? ` age=${Math.round(report.ageMs / 60000)}min ttl=${Math.round(report.ttlMs / 60000)}min` : ""}`);
    }
    return { ok: report.status === "valid", checks: [] };
  }

  const checks: CheckResult[] = [];

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

  if (storageStatePath) {
    const session = await checkSession({ path: storageStatePath });
    const detail =
      session.status === "valid"
        ? `${storageStatePath} (age ${Math.round((session.ageMs ?? 0) / 60000)}min)`
        : session.status === "expired"
          ? `${storageStatePath} is older than TTL (${Math.round(session.ttlMs / 3600_000)}h); re-run \`demo-dev auth\``
          : session.status === "missing"
            ? `${storageStatePath} is configured but does not exist yet`
            : `${storageStatePath} exists but is not valid JSON`;
    const status: CheckResult["status"] =
      session.status === "valid" ? "pass" : session.status === "expired" ? "warn" : "warn";
    checks.push({ label: "storageState", status, detail });
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

  if (json) {
    process.stdout.write(
      JSON.stringify({
        kind: "doctor",
        ok: failures.length === 0,
        checks,
        summary: {
          passed: checks.length - warnings.length - failures.length,
          warnings: warnings.length,
          failures: failures.length,
        },
      }) + "\n",
    );
  } else {
    for (const check of checks) {
      const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "!" : check.status === "fail" ? "✗" : "-";
      console.log(`${icon} ${check.label}: ${check.detail}`);
    }
    console.log("");
    console.log(`Doctor summary: ${checks.length - warnings.length - failures.length} passed, ${warnings.length} warnings, ${failures.length} failures.`);
  }

  return {
    ok: failures.length === 0,
    checks,
  };
};
