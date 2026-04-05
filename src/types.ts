export type ActionTarget =
  | { strategy: "label"; value: string; exact?: boolean }
  | { strategy: "text"; value: string; exact?: boolean }
  | { strategy: "placeholder"; value: string; exact?: boolean }
  | { strategy: "testId"; value: string }
  | { strategy: "css"; value: string }
  | { strategy: "role"; role: string; name?: string; exact?: boolean };

export type SceneAction =
  | { type: "navigate"; url: string }
  | { type: "wait"; ms: number }
  | { type: "scroll"; y: number }
  | { type: "scrollIntoView"; target: ActionTarget }
  | { type: "click"; target: ActionTarget }
  | { type: "hover"; target: ActionTarget }
  | { type: "fill"; target: ActionTarget; value: string }
  | { type: "press"; key: string }
  | { type: "select"; target: ActionTarget; value: string }
  | {
      type: "dragSelect";
      target: ActionTarget;
      startX?: number;
      startY?: number;
      endX?: number;
      endY?: number;
    }
  | { type: "waitForText"; value: string; exact?: boolean; timeoutMs?: number }
  | { type: "waitForUrl"; value: string; timeoutMs?: number };

export interface DiffContext {
  currentBranch: string;
  baseRef: string;
  changedFiles: string[];
  diffPreview: string;
}

export interface FocusRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

export interface SceneDirection {
  shot: "hero" | "detail" | "workflow";
  focusRegion?: FocusRegion;
  accentColor?: string;
  cameraMove?: "push-in" | "pan-left" | "pan-right";
}

export interface DemoScene {
  id: string;
  title: string;
  goal: string;
  url: string;
  viewport: {
    width: number;
    height: number;
  };
  actions: SceneAction[];
  narration: string;
  caption: string;
  durationMs: number;
  evidenceHints: string[];
  direction?: SceneDirection;
}

export interface DemoPlan {
  title: string;
  summary: string;
  branch: string;
  generatedAt: string;
  scenes: DemoScene[];
}

export interface ProbeElement {
  tag: string;
  role: string;
  name: string;
  text?: string;
  label?: string;
  placeholder?: string;
  type?: string;
  href?: string;
  testId?: string;
}

export interface ProbeSnapshot {
  resolvedUrl?: string;
  pageTitle?: string;
  headings: string[];
  textPreview: string;
  interactiveElements: ProbeElement[];
  error?: string;
}

export interface PageProbe {
  sceneId: string;
  sceneTitle: string;
  requestedUrl: string;
  initial: ProbeSnapshot;
  followUpAction?: SceneAction;
  followUp?: ProbeSnapshot;
}

export interface CaptureEvent {
  type: SceneAction["type"] | "stable";
  atMs: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface CaptureArtifact {
  sceneId: string;
  sceneTitle: string;
  url: string;
  screenshotPath: string;
  screenshotSrc?: string;
  videoPath?: string;
  videoSrc?: string;
  viewport: {
    width: number;
    height: number;
  };
  title?: string;
  events?: CaptureEvent[];
}

export interface VoiceToken {
  text: string;
  startMs: number;
  endMs: number;
}

export interface VoiceLine {
  sceneId: string;
  text: string;
  estimatedMs: number;
  audioDurationMs?: number;
  tokens: VoiceToken[];
  audioPath?: string;
  audioSrc?: string;
}

export interface RenderScene {
  id: string;
  title: string;
  caption: string;
  narration: string;
  durationInFrames: number;
  leadInFrames?: number;
  contentFrames?: number;
  holdFrames?: number;
  screenshotPath?: string;
  screenshotSrc?: string;
  screenshotAssetPath?: string;
  videoPath?: string;
  videoSrc?: string;
  videoAssetPath?: string;
  videoTrimBeforeFrames?: number;
  audioPath?: string;
  audioSrc?: string;
  audioAssetPath?: string;
  tokens?: VoiceToken[];
  direction?: SceneDirection;
  events?: CaptureEvent[];
  viewport?: {
    width: number;
    height: number;
  };
  visualGroupKey?: string;
}

export interface RenderManifest {
  title: string;
  fps: number;
  width: number;
  height: number;
  scenes: RenderScene[];
}
