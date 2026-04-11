import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { VoiceLine } from "../types.js";
import { fileToDataUri } from "../lib/data-uri.js";
import { getMediaDurationMs } from "../lib/media.js";

const execFileAsync = promisify(execFile);

type TtsProvider = "auto" | "elevenlabs" | "openai" | "local";

interface TtsConfig {
  provider: TtsProvider;
  openAiApiKey?: string;
  openAiBaseUrl: string;
  openAiModel: string;
  openAiVoice: string;
  elevenlabsApiKey?: string;
  elevenlabsBaseUrl: string;
  elevenlabsVoiceId?: string;
  elevenlabsModel: string;
  elevenlabsOutputFormat: string;
  elevenlabsStability?: number;
  elevenlabsSimilarityBoost?: number;
  elevenlabsStyle?: number;
  elevenlabsSpeakerBoost?: boolean;
  localVoice: string;
  localRate: string;
}

const parseOptionalNumber = (value: string | undefined) => {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseOptionalBoolean = (value: string | undefined) => {
  if (!value?.trim()) return undefined;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  return undefined;
};

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

const getTtsConfig = (): TtsConfig => {
  return {
    provider: (process.env.DEMO_TTS_PROVIDER as TtsProvider | undefined) ?? "auto",
    openAiApiKey: process.env.DEMO_OPENAI_API_KEY,
    openAiBaseUrl: process.env.DEMO_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    openAiModel: process.env.DEMO_TTS_MODEL ?? "gpt-4o-mini-tts",
    openAiVoice: process.env.DEMO_TTS_VOICE ?? "alloy",
    elevenlabsApiKey: process.env.DEMO_ELEVENLABS_API_KEY,
    elevenlabsBaseUrl: process.env.DEMO_ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io/v1",
    elevenlabsVoiceId: process.env.DEMO_ELEVENLABS_VOICE_ID,
    elevenlabsModel: process.env.DEMO_ELEVENLABS_MODEL ?? "eleven_multilingual_v2",
    elevenlabsOutputFormat: process.env.DEMO_ELEVENLABS_OUTPUT_FORMAT ?? "mp3_44100_128",
    elevenlabsStability: parseOptionalNumber(process.env.DEMO_ELEVENLABS_STABILITY),
    elevenlabsSimilarityBoost: parseOptionalNumber(process.env.DEMO_ELEVENLABS_SIMILARITY_BOOST),
    elevenlabsStyle: parseOptionalNumber(process.env.DEMO_ELEVENLABS_STYLE),
    elevenlabsSpeakerBoost: parseOptionalBoolean(process.env.DEMO_ELEVENLABS_SPEAKER_BOOST),
    localVoice: process.env.DEMO_LOCAL_TTS_VOICE ?? "Samantha",
    localRate: process.env.DEMO_LOCAL_TTS_RATE ?? "185",
  };
};

const commandExists = async (command: string) => {
  try {
    await access(command);
    return true;
  } catch {
    try {
      await execFileAsync("which", [command]);
      return true;
    } catch {
      return false;
    }
  }
};

const retimeLineToAudioDuration = (line: VoiceLine, audioDurationMs?: number): VoiceLine => {
  if (!audioDurationMs || !line.tokens.length || line.estimatedMs <= 0) {
    return {
      ...line,
      audioDurationMs,
    };
  }

  const scale = audioDurationMs / line.estimatedMs;
  return {
    ...line,
    audioDurationMs,
    tokens: line.tokens.map((token, index) => ({
      ...token,
      startMs: Math.max(0, Math.round(token.startMs * scale)),
      endMs:
        index === line.tokens.length - 1 ? audioDurationMs : Math.max(1, Math.round(token.endMs * scale)),
    })),
  };
};

const writeAudioLine = async (line: VoiceLine, audioPath: string, arrayBuffer: ArrayBuffer): Promise<VoiceLine> => {
  await writeFile(audioPath, Buffer.from(arrayBuffer));
  const audioDurationMs = await getMediaDurationMs(audioPath);
  const timedLine = retimeLineToAudioDuration(line, audioDurationMs);

  return {
    ...timedLine,
    audioPath,
    audioSrc: await fileToDataUri(audioPath),
  };
};

const synthesizeOpenAiLine = async (line: VoiceLine, outputDir: string, config: TtsConfig): Promise<VoiceLine> => {
  if (!config.openAiApiKey) throw new Error("OpenAI TTS not configured. Set DEMO_OPENAI_API_KEY.");

  const response = await fetch(`${normalizeBaseUrl(config.openAiBaseUrl)}/audio/speech`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.openAiApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.openAiModel,
      voice: config.openAiVoice,
      input: line.text,
      format: "mp3",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI TTS request failed: ${response.status} ${errorText}`);
  }

  return writeAudioLine(line, join(outputDir, `${line.sceneId}.mp3`), await response.arrayBuffer());
};

const synthesizeElevenLabsLine = async (line: VoiceLine, outputDir: string, config: TtsConfig): Promise<VoiceLine> => {
  if (!config.elevenlabsApiKey) throw new Error("ElevenLabs TTS not configured. Set DEMO_ELEVENLABS_API_KEY.");
  if (!config.elevenlabsVoiceId) throw new Error("ElevenLabs voice id not configured");

  const voiceSettings = {
    ...(config.elevenlabsStability === undefined ? {} : { stability: config.elevenlabsStability }),
    ...(config.elevenlabsSimilarityBoost === undefined
      ? {}
      : { similarity_boost: config.elevenlabsSimilarityBoost }),
    ...(config.elevenlabsStyle === undefined ? {} : { style: config.elevenlabsStyle }),
    ...(config.elevenlabsSpeakerBoost === undefined
      ? {}
      : { use_speaker_boost: config.elevenlabsSpeakerBoost }),
  };

  const response = await fetch(
    `${normalizeBaseUrl(config.elevenlabsBaseUrl)}/text-to-speech/${encodeURIComponent(config.elevenlabsVoiceId)}`,
    {
      method: "POST",
      headers: {
        accept: "audio/mpeg",
        "content-type": "application/json",
        "xi-api-key": config.elevenlabsApiKey,
      },
      body: JSON.stringify({
        text: line.text,
        model_id: config.elevenlabsModel,
        output_format: config.elevenlabsOutputFormat,
        ...(Object.keys(voiceSettings).length > 0 ? { voice_settings: voiceSettings } : {}),
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs TTS request failed: ${response.status} ${errorText}`);
  }

  return writeAudioLine(line, join(outputDir, `${line.sceneId}.mp3`), await response.arrayBuffer());
};

const synthesizeLocalLine = async (line: VoiceLine, outputDir: string, config: TtsConfig): Promise<VoiceLine> => {
  const hasSay = await commandExists("say");
  const hasFfmpeg = await commandExists("ffmpeg");
  if (!hasSay || !hasFfmpeg) {
    throw new Error("Local TTS tools not available");
  }

  const tempDir = await mkdtemp(join(tmpdir(), "demo-dev-tts-"));
  const aiffPath = join(tempDir, `${line.sceneId}.aiff`);
  const audioPath = join(outputDir, `${line.sceneId}.mp3`);

  try {
    await execFileAsync("say", ["-v", config.localVoice, "-r", config.localRate, "-o", aiffPath, line.text], {
      maxBuffer: 1024 * 1024 * 10,
    });

    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", aiffPath, "-codec:a", "libmp3lame", "-q:a", "3", audioPath],
      { maxBuffer: 1024 * 1024 * 10 },
    );

    const audioDurationMs = await getMediaDurationMs(audioPath);
    const timedLine = retimeLineToAudioDuration(line, audioDurationMs);

    return {
      ...timedLine,
      audioPath,
      audioSrc: await fileToDataUri(audioPath),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const getProviderOrder = (config: TtsConfig): Array<Exclude<TtsProvider, "auto">> => {
  switch (config.provider) {
    case "elevenlabs":
      return ["elevenlabs"];
    case "openai":
      return ["openai"];
    case "local":
      return ["local"];
    case "auto":
    default: {
      const providers: Array<Exclude<TtsProvider, "auto">> = [];
      if (config.elevenlabsApiKey && config.elevenlabsVoiceId) providers.push("elevenlabs");
      if (config.openAiApiKey) providers.push("openai");
      providers.push("local");
      return providers;
    }
  }
};

const synthesizeWithProvider = async (
  provider: Exclude<TtsProvider, "auto">,
  line: VoiceLine,
  outputDir: string,
  config: TtsConfig,
) => {
  switch (provider) {
    case "elevenlabs":
      return synthesizeElevenLabsLine(line, outputDir, config);
    case "openai":
      return synthesizeOpenAiLine(line, outputDir, config);
    case "local":
      return synthesizeLocalLine(line, outputDir, config);
  }
};

export const synthesizeVoice = async (
  lines: VoiceLine[],
  options: { outputDir?: string } = {},
): Promise<VoiceLine[]> => {
  const outputDir = options.outputDir ?? "artifacts/audio";
  const config = getTtsConfig();
  const providers = getProviderOrder(config);
  await mkdir(outputDir, { recursive: true });

  const results: VoiceLine[] = [];
  for (const line of lines) {
    let synthesized: VoiceLine | undefined;
    const errors: string[] = [];

    for (const provider of providers) {
      try {
        synthesized = await synthesizeWithProvider(provider, line, outputDir, config);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${provider}: ${message}`);
      }
    }

    if (synthesized) {
      results.push(synthesized);
      continue;
    }

    console.warn(`TTS failed for ${line.sceneId}, fallback to text-only`, errors.join(" | "));
    results.push(line);
  }

  return results;
};
