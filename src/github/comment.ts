import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DemoPlan } from "../types.js";

const COMMENT_MARKER = "<!-- demo-dev-pr-comment -->";

interface PullRequestPayload {
  pull_request?: { number?: number };
}

const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;

const getRequiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const getPrNumber = async () => {
  const direct = process.env.DEMO_PR_NUMBER;
  if (direct) return Number(direct);

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  const payload = await readJson<PullRequestPayload>(eventPath);
  return payload.pull_request?.number;
};

const buildRunUrl = () => {
  const serverUrl = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!serverUrl || !repository || !runId) return undefined;
  return `${serverUrl}/${repository}/actions/runs/${runId}`;
};

const code = (value: string) => `\`${value}\``;

const buildArtifactSummary = (outputDir: string) => {
  return [
    `- Video: ${code(join(outputDir, "pr-demo.mp4"))}`,
    `- Cover: ${code(join(outputDir, "cover.png"))}`,
    `- Manifest: ${code(join(outputDir, "render-manifest.json"))}`,
  ].join("\n");
};

const buildBody = (plan: DemoPlan, outputDir: string) => {
  const runUrl = buildRunUrl();
  const sceneLines = plan.scenes.map((scene) => `- **${scene.title}** · ${scene.caption}`).join("\n");

  return [
    COMMENT_MARKER,
    "## 🎬 PR Demo generated",
    "",
    plan.summary,
    "",
    runUrl ? `- Workflow run: ${runUrl}` : undefined,
    "- Artifacts: download `pr-demo-artifacts` from this workflow run",
    "",
    "### Scenes",
    sceneLines,
    "",
    "### Output files",
    buildArtifactSummary(outputDir),
    "",
    "The cover has been exported as `cover.png`, and the video has been exported as `pr-demo.mp4`.",
  ]
    .filter(Boolean)
    .join("\n");
};

const request = async (path: string, init: RequestInit) => {
  const token = getRequiredEnv("GITHUB_TOKEN");
  const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${errorText}`);
  }

  return response;
};

const findExistingCommentId = async (repository: string, prNumber: number) => {
  const response = await request(`/repos/${repository}/issues/${prNumber}/comments?per_page=100`, {
    method: "GET",
  });
  const comments = (await response.json()) as Array<{ id: number; body?: string }>;
  return comments.find((comment) => comment.body?.includes(COMMENT_MARKER))?.id;
};

export const upsertPrComment = async (options: { outputDir: string }) => {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token) {
    console.log("Missing GitHub context, skipping PR comment.");
    return;
  }

  const prNumber = await getPrNumber();
  if (!prNumber) {
    console.log("No PR number found, skipping PR comment.");
    return;
  }

  const plan = await readJson<DemoPlan>(join(options.outputDir, "demo-plan.json"));
  const body = buildBody(plan, options.outputDir);
  const existingCommentId = await findExistingCommentId(repository, prNumber);

  if (existingCommentId) {
    await request(`/repos/${repository}/issues/comments/${existingCommentId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
    console.log(`Updated PR comment #${existingCommentId}`);
    return;
  }

  await request(`/repos/${repository}/issues/${prNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  console.log(`Created PR comment on #${prNumber}`);
};
