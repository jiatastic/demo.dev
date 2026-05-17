import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const writeJson = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
};
