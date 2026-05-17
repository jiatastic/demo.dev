import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};

export const fileToDataUri = async (path: string) => {
  const buffer = await readFile(path);
  const ext = extname(path).toLowerCase();
  const mimeType = MIME_TYPES[ext] ?? "application/octet-stream";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
};
