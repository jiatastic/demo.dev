export type DemoStyleName =
  | "clean-saas"
  | "launch-demo"
  | "premium-launch"
  | "screen-studio"
  | "tutorial"
  | "social-vertical"
  | "product-hunt";

export interface DirectorStyleSettings {
  clickZoomScale: number;
  hoverZoomScale: number;
  fillZoomScale: number;
  minZoomGapMs: number;
  preZoomMs: number;
  postInteractionHoldMs: number;
  zoomOutDelayMs: number;
  transitionMs: number;
  idleThresholdMs: number;
  idleSpeed: number;
  loadingSpeed: number;
  sceneMinMs: number;
  sceneMaxMs: number;
  maxZoomScale: number;
}

export interface FrameStyleSettings {
  enabledByDefault: boolean;
  gradientFrom: string;
  gradientTo: string;
  padding: number;
  chrome?: "macos" | "minimal" | "none";
  shadow?: "none" | "soft" | "medium" | "strong";
  windowRadius?: number;
  backgroundPreset?: string;
}

export interface CaptionStyleSettings {
  maxCharsPerLine: number;
  maxLines: number;
}

export interface DemoStylePreset {
  name: DemoStyleName;
  label: string;
  description: string;
  director: DirectorStyleSettings;
  frame: FrameStyleSettings;
  captions: CaptionStyleSettings;
  defaultAspectRatio: "16:9" | "9:16" | "1:1" | "4:5";
}

const BASE_DIRECTOR: DirectorStyleSettings = {
  clickZoomScale: 1.55,
  hoverZoomScale: 1.22,
  fillZoomScale: 1.45,
  minZoomGapMs: 900,
  preZoomMs: 320,
  postInteractionHoldMs: 850,
  zoomOutDelayMs: 1050,
  transitionMs: 540,
  idleThresholdMs: 1300,
  idleSpeed: 5.2,
  loadingSpeed: 2.8,
  sceneMinMs: 3200,
  sceneMaxMs: 8200,
  maxZoomScale: 1.85,
};

export const DEMO_STYLE_PRESETS: Record<DemoStyleName, DemoStylePreset> = {
  "clean-saas": {
    name: "clean-saas",
    label: "Clean SaaS",
    description: "Quiet, polished product walkthroughs for dashboards and B2B workflows.",
    director: BASE_DIRECTOR,
    frame: {
      enabledByDefault: true,
      gradientFrom: "#f8fafc",
      gradientTo: "#dbeafe",
      padding: 56,
    },
    captions: {
      maxCharsPerLine: 42,
      maxLines: 2,
    },
    defaultAspectRatio: "16:9",
  },
  "launch-demo": {
    name: "launch-demo",
    label: "Launch Demo",
    description: "Higher energy demos with tighter pacing and stronger zoom emphasis.",
    director: {
      ...BASE_DIRECTOR,
      clickZoomScale: 1.68,
      fillZoomScale: 1.58,
      idleSpeed: 6.4,
      sceneMaxMs: 7000,
    },
    frame: {
      enabledByDefault: true,
      gradientFrom: "#111827",
      gradientTo: "#0f766e",
      padding: 64,
    },
    captions: {
      maxCharsPerLine: 38,
      maxLines: 2,
    },
    defaultAspectRatio: "16:9",
  },
  "premium-launch": {
    name: "premium-launch",
    label: "Premium Launch",
    description: "Top-tier cinematic product demos with stronger camera moves, motion overlays, and premium framing.",
    director: {
      ...BASE_DIRECTOR,
      clickZoomScale: 1.82,
      fillZoomScale: 1.72,
      hoverZoomScale: 1.34,
      transitionMs: 620,
      postInteractionHoldMs: 980,
      idleSpeed: 7.0,
      sceneMaxMs: 6400,
      maxZoomScale: 2.08,
    },
    frame: {
      enabledByDefault: true,
      gradientFrom: "#111827",
      gradientTo: "#7c3aed",
      padding: 72,
    },
    captions: {
      maxCharsPerLine: 34,
      maxLines: 2,
    },
    defaultAspectRatio: "16:9",
  },
  "screen-studio": {
    name: "screen-studio",
    label: "Screen Studio",
    description: "Minimal Screen Studio-inspired output: clean canvas, natural shadows, camera-first zooms, and no decorative overlays.",
    director: {
      ...BASE_DIRECTOR,
      clickZoomScale: 1.62,
      fillZoomScale: 1.52,
      hoverZoomScale: 1.22,
      minZoomGapMs: 760,
      preZoomMs: 260,
      postInteractionHoldMs: 760,
      zoomOutDelayMs: 920,
      transitionMs: 680,
      idleThresholdMs: 950,
      idleSpeed: 8.0,
      loadingSpeed: 4.0,
      sceneMaxMs: 6200,
      maxZoomScale: 1.88,
    },
    frame: {
      enabledByDefault: true,
      gradientFrom: "#050505",
      gradientTo: "#171717",
      padding: 86,
      chrome: "none",
      shadow: "strong",
      windowRadius: 18,
    },
    captions: {
      maxCharsPerLine: 0,
      maxLines: 0,
    },
    defaultAspectRatio: "16:9",
  },
  tutorial: {
    name: "tutorial",
    label: "Tutorial",
    description: "Clearer pacing for instructional walkthroughs where comprehension matters.",
    director: {
      ...BASE_DIRECTOR,
      clickZoomScale: 1.45,
      fillZoomScale: 1.36,
      idleSpeed: 3.6,
      loadingSpeed: 2.2,
      sceneMaxMs: 10000,
    },
    frame: {
      enabledByDefault: true,
      gradientFrom: "#f1f5f9",
      gradientTo: "#e2e8f0",
      padding: 52,
    },
    captions: {
      maxCharsPerLine: 46,
      maxLines: 2,
    },
    defaultAspectRatio: "16:9",
  },
  "social-vertical": {
    name: "social-vertical",
    label: "Social Vertical",
    description: "Compact, fast vertical demos for social distribution.",
    director: {
      ...BASE_DIRECTOR,
      clickZoomScale: 1.72,
      fillZoomScale: 1.62,
      idleSpeed: 7.2,
      loadingSpeed: 3.4,
      sceneMaxMs: 6200,
    },
    frame: {
      enabledByDefault: true,
      gradientFrom: "#0f172a",
      gradientTo: "#7c3aed",
      padding: 44,
    },
    captions: {
      maxCharsPerLine: 30,
      maxLines: 2,
    },
    defaultAspectRatio: "9:16",
  },
  "product-hunt": {
    name: "product-hunt",
    label: "Product Hunt",
    description: "Crisp launch-video pacing with warm, high-contrast presentation.",
    director: {
      ...BASE_DIRECTOR,
      clickZoomScale: 1.62,
      fillZoomScale: 1.52,
      idleSpeed: 6.0,
      sceneMaxMs: 7200,
    },
    frame: {
      enabledByDefault: true,
      gradientFrom: "#ffedd5",
      gradientTo: "#fed7aa",
      padding: 58,
    },
    captions: {
      maxCharsPerLine: 36,
      maxLines: 2,
    },
    defaultAspectRatio: "16:9",
  },
};

export const DEFAULT_DEMO_STYLE: DemoStyleName = "clean-saas";

export const listDemoStyles = () => Object.values(DEMO_STYLE_PRESETS);

export const resolveDemoStyle = (name?: string): DemoStylePreset => {
  if (!name) return DEMO_STYLE_PRESETS[DEFAULT_DEMO_STYLE];
  return DEMO_STYLE_PRESETS[name as DemoStyleName] ?? DEMO_STYLE_PRESETS[DEFAULT_DEMO_STYLE];
};
