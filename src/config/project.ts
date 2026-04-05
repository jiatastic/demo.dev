import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ActionTarget } from "../types.js";

export interface ProjectAuthConfig {
  loginPath?: string;
  emailTarget?: ActionTarget;
  passwordTarget?: ActionTarget;
  submitTarget?: ActionTarget;
  successUrlPattern?: string;
  postSubmitWaitMs?: number;
}

export interface ProjectConfig {
  projectName?: string;
  baseUrl?: string;
  readyUrl?: string;
  devCommand?: string;
  baseRef?: string;
  outputDir?: string;
  storageStatePath?: string;
  saveStorageStatePath?: string;
  preferredRoutes?: string[];
  featureHints?: string[];
  authRequiredRoutes?: string[];
  auth?: ProjectAuthConfig;
}

const DEFAULT_CONFIG_PATHS = ["demo.dev.config.json", ".demo-dev.json"];

const fileExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const readStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
};

const readTarget = (value: unknown): ActionTarget | undefined => {
  if (!isRecord(value) || typeof value.strategy !== "string") return undefined;

  switch (value.strategy) {
    case "label":
    case "text":
    case "placeholder":
      if (typeof value.value === "string") {
        return {
          strategy: value.strategy,
          value: value.value,
          exact: typeof value.exact === "boolean" ? value.exact : undefined,
        };
      }
      return undefined;
    case "testId":
    case "css":
      if (typeof value.value === "string") {
        return { strategy: value.strategy, value: value.value };
      }
      return undefined;
    case "role":
      if (typeof value.role === "string") {
        return {
          strategy: "role",
          role: value.role,
          name: typeof value.name === "string" ? value.name : undefined,
          exact: typeof value.exact === "boolean" ? value.exact : undefined,
        };
      }
      return undefined;
    default:
      return undefined;
  }
};

const normalizeAuthConfig = (value: unknown): ProjectAuthConfig | undefined => {
  if (!isRecord(value)) return undefined;

  return {
    loginPath: typeof value.loginPath === "string" ? value.loginPath : undefined,
    emailTarget: readTarget(value.emailTarget),
    passwordTarget: readTarget(value.passwordTarget),
    submitTarget: readTarget(value.submitTarget),
    successUrlPattern: typeof value.successUrlPattern === "string" ? value.successUrlPattern : undefined,
    postSubmitWaitMs: typeof value.postSubmitWaitMs === "number" ? value.postSubmitWaitMs : undefined,
  };
};

const normalizeProjectConfig = (value: unknown): ProjectConfig => {
  if (!isRecord(value)) return {};

  return {
    projectName: typeof value.projectName === "string" ? value.projectName : undefined,
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : undefined,
    readyUrl: typeof value.readyUrl === "string" ? value.readyUrl : undefined,
    devCommand: typeof value.devCommand === "string" ? value.devCommand : undefined,
    baseRef: typeof value.baseRef === "string" ? value.baseRef : undefined,
    outputDir: typeof value.outputDir === "string" ? value.outputDir : undefined,
    storageStatePath: typeof value.storageStatePath === "string" ? value.storageStatePath : undefined,
    saveStorageStatePath: typeof value.saveStorageStatePath === "string" ? value.saveStorageStatePath : undefined,
    preferredRoutes: readStringArray(value.preferredRoutes),
    featureHints: readStringArray(value.featureHints),
    authRequiredRoutes: readStringArray(value.authRequiredRoutes),
    auth: normalizeAuthConfig(value.auth),
  };
};

export const loadProjectConfig = async (configPath?: string): Promise<{ path?: string; config: ProjectConfig }> => {
  const explicitPath = configPath ?? process.env.DEMO_CONFIG;
  const candidatePaths = explicitPath ? [explicitPath] : DEFAULT_CONFIG_PATHS;

  for (const candidate of candidatePaths) {
    const absolutePath = resolve(candidate);
    if (!(await fileExists(absolutePath))) continue;

    const parsed = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
    return {
      path: absolutePath,
      config: normalizeProjectConfig(parsed),
    };
  }

  return { config: {} };
};

export const applyProjectEnvironment = (config: ProjectConfig) => {
  if (!process.env.DEMO_STORAGE_STATE && config.storageStatePath) {
    process.env.DEMO_STORAGE_STATE = config.storageStatePath;
  }

  if (!process.env.DEMO_SAVE_STORAGE_STATE && config.saveStorageStatePath) {
    process.env.DEMO_SAVE_STORAGE_STATE = config.saveStorageStatePath;
  }
};

export const getProjectConfigField = (config: ProjectConfig, field: string): string | undefined => {
  switch (field) {
    case "projectName":
      return config.projectName;
    case "baseUrl":
      return config.baseUrl;
    case "readyUrl":
      return config.readyUrl ?? config.baseUrl;
    case "devCommand":
      return config.devCommand;
    case "baseRef":
      return config.baseRef;
    case "outputDir":
      return config.outputDir;
    case "storageStatePath":
      return config.storageStatePath;
    case "saveStorageStatePath":
      return config.saveStorageStatePath;
    case "preferredRoutes":
      return config.preferredRoutes ? JSON.stringify(config.preferredRoutes) : undefined;
    case "featureHints":
      return config.featureHints ? JSON.stringify(config.featureHints) : undefined;
    case "authRequiredRoutes":
      return config.authRequiredRoutes ? JSON.stringify(config.authRequiredRoutes) : undefined;
    case "auth.loginPath":
      return config.auth?.loginPath;
    default:
      return undefined;
  }
};

export const summarizeProjectHints = (config: ProjectConfig) => {
  return {
    preferredRoutes: config.preferredRoutes ?? [],
    featureHints: config.featureHints ?? [],
    authRequiredRoutes: config.authRequiredRoutes ?? [],
  };
};
