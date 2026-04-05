import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DiffContext } from "../types.js";

const execFileAsync = promisify(execFile);

const runGit = async (args: string[]) => {
  const { stdout } = await execFileAsync("git", args, { maxBuffer: 1024 * 1024 * 10 });
  return stdout.trim();
};

const resolveRange = async (baseRef: string) => {
  try {
    await runGit(["rev-parse", "--verify", baseRef]);
    return `${baseRef}...HEAD`;
  } catch {
    try {
      await runGit(["rev-parse", "--verify", "HEAD~1"]);
      return "HEAD~1...HEAD";
    } catch {
      return undefined;
    }
  }
};

export const getCurrentBranch = async () => {
  return runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
};

export const getChangedFiles = async (baseRef: string) => {
  const range = await resolveRange(baseRef);
  const output = range
    ? await runGit(["diff", "--name-only", range])
    : await runGit(["status", "--porcelain"]);

  return output
    .split("\n")
    .map((line) => (range ? line : line.slice(3)).trim())
    .filter(Boolean);
};

export const getDiffPreview = async (baseRef: string, maxChars = 12000) => {
  const range = await resolveRange(baseRef);
  const diff = range ? await runGit(["diff", "--no-color", range]) : await runGit(["diff", "--no-color"]);
  return diff.length > maxChars ? `${diff.slice(0, maxChars)}\n... (truncated)` : diff;
};

export const buildDiffContext = async (baseRef: string): Promise<DiffContext> => {
  const currentBranch = await getCurrentBranch();
  const changedFiles = await getChangedFiles(baseRef);
  const diffPreview = await getDiffPreview(baseRef);

  return {
    currentBranch,
    baseRef,
    changedFiles,
    diffPreview,
  };
};
