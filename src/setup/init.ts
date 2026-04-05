import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectConfig } from "../config/project.js";
import { writeJson } from "../lib/fs.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowTemplatePath = resolve(packageRoot, ".github", "workflows", "pr-demo.yml");
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

const inferDevCommand = (pkg?: { scripts?: Record<string, string> }) => {
  if (!pkg?.scripts) return undefined;
  if (pkg.scripts.dev) return "npm run dev";
  if (pkg.scripts.start) return "npm run start";
  return undefined;
};

const inferProjectName = (pkg?: { name?: string }) => {
  return pkg?.name ?? basename(process.cwd());
};

const buildDefaultConfig = async (existingConfig: ProjectConfig = {}): Promise<ProjectConfig> => {
  const pkg = await readPackageJson();
  const baseUrl = existingConfig.baseUrl ?? "http://localhost:3000";

  return {
    projectName: existingConfig.projectName ?? inferProjectName(pkg),
    baseUrl,
    readyUrl: existingConfig.readyUrl ?? baseUrl,
    devCommand: existingConfig.devCommand ?? inferDevCommand(pkg),
    baseRef: existingConfig.baseRef ?? "origin/main",
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
  const workflowPath = resolve(process.cwd(), ".github", "workflows", "pr-demo.yml");
  const configExists = await fileExists(configPath);
  const workflowExists = await fileExists(workflowPath);

  if (configExists && !options.force) {
    throw new Error(`${configFilename} already exists. Re-run with --force to overwrite.`);
  }

  if (workflowExists && !options.force) {
    throw new Error(`${workflowPath} already exists. Re-run with --force to overwrite.`);
  }

  const config = await buildDefaultConfig(options.existingConfig);
  await writeJson(configPath, config);

  await mkdir(dirname(workflowPath), { recursive: true });
  await copyFile(workflowTemplatePath, workflowPath);

  return {
    configPath,
    workflowPath,
    config,
  };
};
