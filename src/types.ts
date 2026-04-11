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
