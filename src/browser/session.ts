import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BrowserContextOptions, Page } from "playwright";

const fileExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export interface SessionConfig {
  storageStatePath?: string;
  saveStorageStatePath?: string;
}

export const resolveSessionConfig = (outputDir: string): SessionConfig => {
  const storageStatePath = process.env.DEMO_STORAGE_STATE;
  const saveStorageStatePath = process.env.DEMO_SAVE_STORAGE_STATE ?? `${outputDir}/storage-state.json`;
  return { storageStatePath, saveStorageStatePath };
};

export const getContextOptionsWithSession = async (
  contextOptions: BrowserContextOptions,
  session: SessionConfig,
): Promise<BrowserContextOptions> => {
  if (session.storageStatePath && (await fileExists(session.storageStatePath))) {
    return {
      ...contextOptions,
      storageState: session.storageStatePath,
    };
  }

  return contextOptions;
};

export const persistSessionState = async (page: Page, session: SessionConfig) => {
  if (!session.saveStorageStatePath) return;
  await mkdir(dirname(session.saveStorageStatePath), { recursive: true }).catch(() => undefined);
  await page.context().storageState({ path: session.saveStorageStatePath }).catch(() => undefined);
};
