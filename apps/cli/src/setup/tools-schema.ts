/**
 * Hand-curated tool schema for the `demo-dev` CLI in OpenAI function-calling
 * shape. Every public command is here. Run `demo-dev tools-schema` to emit it.
 */

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties: false;
    };
  };
}

const stringParam = (description: string, options: { enum?: string[]; default?: string } = {}) => ({
  type: "string",
  description,
  ...(options.enum ? { enum: options.enum } : {}),
  ...(options.default ? { default: options.default } : {}),
});
const boolParam = (description: string) => ({ type: "boolean", description });
const numberParam = (description: string) => ({ type: "number", description });

const baseUrl = stringParam("Base URL of the target web app.");
const outputDir = stringParam("Output directory for artifacts. Defaults to `artifacts`.");

const frameProperties = {
  frame: boolParam("Wrap the video in a Screen Studio–style browser frame."),
  "frame-chrome": stringParam("Chrome style.", { enum: ["macos", "minimal", "none"] }),
  "frame-radius": numberParam("Window corner radius in px (default 14)."),
  "frame-shadow": stringParam("Shadow intensity.", { enum: ["none", "soft", "medium", "strong"] }),
  "frame-padding": numberParam("Padding around the window in px (default 64)."),
  "background-image": stringParam("Path to a background image file."),
  "background-color": stringParam("Solid background color (hex)."),
  "background-preset": stringParam("Built-in background preset.", {
    enum: ["sunset", "ocean", "forest", "mesh-purple", "mesh-pink", "midnight", "paper"],
  }),
  "display-url": stringParam("URL label shown in the address bar (chrome=macos only)."),
};

export const buildToolsSchema = (): ToolDefinition[] => [
  {
    type: "function",
    function: {
      name: "demo_dev_doctor",
      description: "Check that the local environment is ready (ffmpeg, Playwright Chromium, config, optionally storage-state). Call BEFORE any recording command.",
      parameters: {
        type: "object",
        properties: {
          "check-session": boolParam("Only check storage-state validity."),
          json: boolParam("Emit a single structured JSON object."),
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "demo_dev_auth",
      description: "Log into the target app and persist a Playwright storage-state. Prefer `--credentials-file` over `--password`.",
      parameters: {
        type: "object",
        properties: {
          "base-url": baseUrl,
          "credentials-file": stringParam("Path to JSON file with {email, password}. Preferred."),
          email: stringParam("Login email."),
          "storage-state": stringParam("Path to write the Playwright storage-state JSON."),
        },
        required: ["base-url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "demo_dev_plan",
      description: "Build a demo plan from a natural-language prompt. Does not record. Writes demo-plan.json.",
      parameters: {
        type: "object",
        properties: {
          "base-url": baseUrl,
          prompt: stringParam("Natural-language brief."),
          seed: numberParam("Deterministic seed (OpenAI only)."),
          probe: boolParam("Also probe pages to refine selectors."),
          "output-dir": outputDir,
          json: boolParam("Emit structured JSON output."),
        },
        required: ["base-url", "prompt"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "demo_dev_validate",
      description: "Validate a hand-written demo-plan.json against the schema.",
      parameters: {
        type: "object",
        properties: {
          path: stringParam("Path to demo-plan.json."),
          json: boolParam("Emit structured JSON output."),
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "demo_dev_capture",
      description: "Record a continuous video from an existing demo plan.",
      parameters: {
        type: "object",
        properties: {
          "base-url": baseUrl,
          plan: stringParam("Path to demo-plan.json."),
          "allow-destructive": boolParam("Allow scenes flagged as destructive."),
          "allow-domain": stringParam("Comma-separated extra hosts allowed."),
          "blur-emails": boolParam("Blur email-like content."),
          "blur-credit-cards": boolParam("Blur credit-card-like content."),
          "output-dir": outputDir,
          json: boolParam("Emit NDJSON progress + result."),
        },
        required: ["base-url", "plan"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "demo_dev_voice",
      description: "Synthesize narration from a plan, or test TTS on a single string with --text.",
      parameters: {
        type: "object",
        properties: {
          plan: stringParam("Path to demo-plan.json."),
          text: stringParam("One-off text to synthesize (for testing a TTS provider)."),
          "output-dir": outputDir,
          json: boolParam("Emit structured JSON output."),
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "demo_dev_direct",
      description: "Generate a director plan (zoom + speed ramps) from an existing capture.",
      parameters: {
        type: "object",
        properties: {
          capture: stringParam("Path to continuous-capture.json."),
          style: stringParam("Style preset name."),
          "output-dir": outputDir,
          json: boolParam("Emit structured JSON output."),
        },
        required: ["capture"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "demo_dev_render",
      description: "Compose the final mp4 from a capture + voice + (optional) director plan.",
      parameters: {
        type: "object",
        properties: {
          capture: stringParam("Path to continuous-capture.json."),
          voice: stringParam("Path to voice-script.json."),
          plan: stringParam("Path to demo-plan.json (for title metadata)."),
          director: stringParam("Path to director-plan.json. Auto-generated if omitted."),
          out: stringParam("Output mp4 path."),
          quality: stringParam("Video quality preset.", { enum: ["draft", "standard", "high"] }),
          style: stringParam("Style preset name."),
          "aspect-ratio": stringParam("Export aspect ratio.", { enum: ["16:9", "9:16", "1:1", "4:5"] }),
          ...frameProperties,
          json: boolParam("Emit structured JSON output."),
        },
        required: ["capture"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "demo_dev_quality",
      description: "Score an existing mp4 against a plan + voice script.",
      parameters: {
        type: "object",
        properties: {
          video: stringParam("Path to the mp4 to score."),
          plan: stringParam("Path to demo-plan.json."),
          voice: stringParam("Path to voice-script.json."),
          "aspect-ratio": stringParam("Expected aspect ratio.", { enum: ["16:9", "9:16", "1:1", "4:5"] }),
          json: boolParam("Emit structured JSON output."),
        },
        required: ["video"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "demo_dev_demo",
      description: "Full pipeline: plan → capture → voice → render → mp4. Use --estimate-only first if cost/duration is uncertain.",
      parameters: {
        type: "object",
        properties: {
          "base-url": baseUrl,
          prompt: stringParam("Natural-language brief."),
          quality: stringParam("Video quality preset.", { enum: ["draft", "standard", "high"], default: "standard" }),
          style: stringParam("Style preset name."),
          "aspect-ratio": stringParam("Export aspect ratio.", { enum: ["16:9", "9:16", "1:1", "4:5"] }),
          ...frameProperties,
          "estimate-only": boolParam("Plan only and return cost/duration estimate."),
          "no-polish": boolParam("Skip the LLM polish pass over narration copy."),
          seed: numberParam("Deterministic seed (OpenAI only)."),
          "storage-state": stringParam("Path to a Playwright storage-state to reuse a session."),
          "allow-destructive": boolParam("Allow scenes flagged as destructive."),
          "allow-domain": stringParam("Comma-separated extra hosts allowed."),
          "blur-emails": boolParam("Blur email-like content."),
          "blur-credit-cards": boolParam("Blur credit-card-like content."),
          "reuse-plan": stringParam("Path to demo-plan.json to skip planning."),
          "reuse-capture": stringParam("Path to continuous-capture.json to skip recording."),
          "reuse-voice": stringParam("Path to voice-script.json to skip narration synthesis."),
          "output-dir": outputDir,
          json: boolParam("Emit NDJSON progress + structured result."),
        },
        required: ["base-url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "demo_dev_styles",
      description: "List visual direction style presets available for --style.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "demo_dev_exports",
      description: "List available aspect ratios and quality presets.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "demo_dev_errors",
      description: "List structured error codes the CLI may emit.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "demo_dev_providers",
      description: "List available AI / TTS providers detected in the environment.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

export const formatToolsSchema = (format: "openai" | "json"): string => {
  const tools = buildToolsSchema();
  if (format === "json") return JSON.stringify(tools, null, 2);
  return JSON.stringify({ tools }, null, 2);
};
