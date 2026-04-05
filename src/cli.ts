import { join } from "node:path";
import { parseCliOptions } from "./lib/args.js";
import { buildDiffContext } from "./lib/git.js";
import { writeJson } from "./lib/fs.js";
import { buildDemoPlan } from "./planner/index.js";
import { capturePlan } from "./capture/playwright-recorder.js";
import { buildVoiceScript } from "./voice/script.js";
import { synthesizeVoice } from "./voice/tts.js";
import { buildRenderManifest } from "./render/manifest.js";
import { renderVideoFromManifest } from "./render/video.js";
import { upsertPrComment } from "./github/comment.js";
import { buildExecutablePlan, runPipeline } from "./orchestrate.js";
import { bootstrapAuth } from "./auth/bootstrap.js";
import { listAvailableProviders } from "./ai/provider.js";
import { applyProjectEnvironment, getProjectConfigField, loadProjectConfig } from "./config/project.js";
import { initProject } from "./setup/init.js";
import { runDoctor } from "./setup/doctor.js";

const requireBaseUrl = (baseUrl: string | undefined, command: string) => {
  if (!baseUrl) {
    throw new Error(`${command} requires --base-url or a baseUrl value in demo.dev.config.json.`);
  }
  return baseUrl;
};

const main = async () => {
  const [, , command = "pr-demo", ...rest] = process.argv;
  const options = parseCliOptions(rest);
  const { path: configPath, config: projectConfig } = await loadProjectConfig(options.configPath);
  applyProjectEnvironment(projectConfig);

  const baseRef = options.baseRef ?? projectConfig.baseRef ?? "origin/main";
  const outputDir = options.outputDir ?? projectConfig.outputDir ?? "artifacts";
  const baseUrl = options.baseUrl ?? projectConfig.baseUrl;

  switch (command) {
    case "init": {
      const result = await initProject({
        force: options.force,
        existingConfig: {
          ...projectConfig,
          baseUrl,
          baseRef,
          outputDir,
        },
      });
      console.log(`Wrote config to ${result.configPath}`);
      console.log(`Wrote workflow to ${result.workflowPath}`);
      return;
    }

    case "doctor": {
      const result = await runDoctor({ configPath, config: { ...projectConfig, baseUrl, baseRef, outputDir } });
      if (!result.ok) {
        process.exitCode = 1;
      }
      return;
    }

    case "config": {
      if (options.field) {
        console.log(getProjectConfigField(projectConfig, options.field) ?? "");
        return;
      }

      console.log(
        JSON.stringify(
          {
            path: configPath,
            ...projectConfig,
            readyUrl: projectConfig.readyUrl ?? projectConfig.baseUrl,
          },
          null,
          2,
        ),
      );
      return;
    }

    case "providers": {
      const providers = await listAvailableProviders();
      console.log(JSON.stringify(providers, null, 2));
      return;
    }

    case "plan": {
      const context = await buildDiffContext(baseRef);
      const plan = await buildDemoPlan(context, projectConfig);
      await writeJson(join(outputDir, "demo-context.json"), context);
      await writeJson(join(outputDir, "demo-plan.json"), plan);
      console.log(`Plan written to ${join(outputDir, "demo-plan.json")}`);
      return;
    }

    case "probe": {
      const resolvedBaseUrl = requireBaseUrl(baseUrl, "probe");
      const result = await buildExecutablePlan({
        baseRef,
        baseUrl: resolvedBaseUrl,
        outputDir,
        projectConfig,
      });
      console.log(`Initial plan written to ${join(outputDir, "demo-plan.initial.json")}`);
      console.log(`Page probes written to ${join(outputDir, "page-probes.json")}`);
      console.log(`Refined plan written to ${join(outputDir, "demo-plan.json")}`);
      console.log(`Scenes refined: ${result.plan.scenes.length}`);
      return;
    }

    case "auth:bootstrap": {
      const resolvedBaseUrl = requireBaseUrl(baseUrl, "auth:bootstrap");
      const email = options.email ?? process.env.DEMO_LOGIN_EMAIL;
      const password = options.password ?? process.env.DEMO_LOGIN_PASSWORD;
      const storageStatePath =
        options.storageStatePath ??
        projectConfig.saveStorageStatePath ??
        process.env.DEMO_SAVE_STORAGE_STATE ??
        join(outputDir, "storage-state.json");
      if (!email || !password) {
        throw new Error("auth:bootstrap requires --email and --password, or DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD.");
      }

      const result = await bootstrapAuth({
        baseUrl: resolvedBaseUrl,
        email,
        password,
        outputPath: storageStatePath,
        auth: projectConfig.auth,
      });
      console.log(`Storage state written to ${result.storageStatePath}`);
      console.log(`Logged in at ${result.url}`);
      return;
    }

    case "capture": {
      const resolvedBaseUrl = requireBaseUrl(baseUrl, "capture");
      const { plan } = await buildExecutablePlan({
        baseRef,
        baseUrl: resolvedBaseUrl,
        outputDir,
        projectConfig,
      });
      const captures = await capturePlan(plan, {
        baseUrl: resolvedBaseUrl,
        outputDir: join(outputDir, "captures"),
      });
      await writeJson(join(outputDir, "captures.json"), captures);
      console.log(`Captures written to ${join(outputDir, "captures.json")}`);
      return;
    }

    case "voice": {
      const context = await buildDiffContext(baseRef);
      const plan = await buildDemoPlan(context, projectConfig);
      const voice = await synthesizeVoice(buildVoiceScript(plan), {
        outputDir: join(outputDir, "audio"),
      });
      await writeJson(join(outputDir, "voice-script.json"), voice);
      console.log(`Voice script written to ${join(outputDir, "voice-script.json")}`);
      return;
    }

    case "manifest": {
      const resolvedBaseUrl = requireBaseUrl(baseUrl, "manifest");
      const { plan } = await buildExecutablePlan({
        baseRef,
        baseUrl: resolvedBaseUrl,
        outputDir,
        projectConfig,
      });
      const captures = await capturePlan(plan, {
        baseUrl: resolvedBaseUrl,
        outputDir: join(outputDir, "captures"),
      });
      const voice = await synthesizeVoice(buildVoiceScript(plan), {
        outputDir: join(outputDir, "audio"),
      });
      const manifest = await buildRenderManifest(plan, captures, voice);
      await writeJson(join(outputDir, "render-manifest.json"), manifest);
      console.log(`Manifest written to ${join(outputDir, "render-manifest.json")}`);
      return;
    }

    case "render": {
      const manifestPath = options.manifestPath ?? join(outputDir, "render-manifest.json");
      const out = options.out ?? join(outputDir, "pr-demo.mp4");
      const videoPath = await renderVideoFromManifest({ manifestPath, outputPath: out });
      console.log(`Video rendered to ${videoPath}`);
      return;
    }

    case "comment": {
      if (options.prNumber) {
        process.env.DEMO_PR_NUMBER = options.prNumber;
      }
      await upsertPrComment({ outputDir });
      return;
    }

    case "pr-demo": {
      const resolvedBaseUrl = requireBaseUrl(baseUrl, "pr-demo");
      const result = await runPipeline({
        baseRef,
        baseUrl: resolvedBaseUrl,
        outputDir,
        projectConfig,
        renderVideo: true,
      });
      console.log(`Pipeline completed in ${outputDir}`);
      if (result.videoPath) {
        console.log(`Video rendered to ${result.videoPath}`);
      }
      return;
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
