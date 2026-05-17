import { access, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { ProjectConfig } from "@demo-dev/core";
import { writeJson } from "@demo-dev/core";

const configFilename = "demo.dev.config.json";

const fileExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const readPackageJson = async () => {
  const packageJsonPath = resolve(process.cwd(), "package.json");
  if (!(await fileExists(packageJsonPath))) return undefined;

  try {
    return JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      name?: string;
      scripts?: Record<string, string>;
    };
  } catch {
    return undefined;
  }
};

const inferPackageManager = async () => {
  if (await fileExists(resolve(process.cwd(), "bun.lock"))) return "bun";
  if (await fileExists(resolve(process.cwd(), "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(resolve(process.cwd(), "yarn.lock"))) return "yarn";
  return "npm";
};

const inferDevCommand = (packageManager: string, pkg?: { scripts?: Record<string, string> }) => {
  if (!pkg?.scripts) return undefined;
  if (pkg.scripts.dev) return `${packageManager} run dev`;
  if (pkg.scripts.start) return `${packageManager} run start`;
  return undefined;
};

const inferProjectName = (pkg?: { name?: string }) => {
  return pkg?.name ?? basename(process.cwd());
};

const buildDefaultConfig = async (existingConfig: ProjectConfig = {}): Promise<ProjectConfig> => {
  const pkg = await readPackageJson();
  const packageManager = await inferPackageManager();
  const baseUrl = existingConfig.baseUrl ?? "http://localhost:3000";

  return {
    projectName: existingConfig.projectName ?? inferProjectName(pkg),
    baseUrl,
    readyUrl: existingConfig.readyUrl ?? baseUrl,
    devCommand: existingConfig.devCommand ?? inferDevCommand(packageManager, pkg),
    outputDir: existingConfig.outputDir ?? "artifacts",
    storageStatePath: existingConfig.storageStatePath ?? "artifacts/storage-state.json",
    saveStorageStatePath: existingConfig.saveStorageStatePath ?? "artifacts/storage-state.json",
    preferredRoutes: existingConfig.preferredRoutes ?? ["/"],
    featureHints: existingConfig.featureHints ?? [],
    authRequiredRoutes: existingConfig.authRequiredRoutes ?? [],
    auth: existingConfig.auth,
  };
};

export const initProject = async (options: { force?: boolean; existingConfig?: ProjectConfig }) => {
  const configPath = resolve(process.cwd(), configFilename);
  const configExists = await fileExists(configPath);

  if (configExists && !options.force) {
    throw new Error(`${configFilename} already exists. Re-run with --force to overwrite.`);
  }

  const config = await buildDefaultConfig(options.existingConfig);
  await writeJson(configPath, config);

  return {
    configPath,
    config,
  };
};
