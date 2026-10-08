import type { ClusterStore, Snapshot, WsMessage } from '../store/cluster';
import type { HintedStep } from '../tour/bubbleUI';

/** One scripted stream message at an offset from the script's start. */
export interface ScriptedMessage {
  at: number;
  msg: WsMessage;
}

export interface LevelSummary {
  /** What happened, in harbor words. */
  naval: string;
  /** The same, in Kubernetes words. */
  kubernetes: string;
  /** The DevOps situation this stands for. */
  devops: string;
  /** YAML the learner's forms produced (or would), with naval notes. */
  manifest?: string;
  kubectl?: string;
}

export interface Level {
  id: string;
  number: number;
  title: string;
  concept: string;
  /** Glossary ids this level teaches; linked from the summary. */
  terms: string[];
  parSeconds: number;
  /** The harbor the level starts in. */
  fixture: () => Snapshot;
  /** Steps shown by the harbor master; waitFor steps are the goals. */
  steps: (ctx: LevelContext) => HintedStep[];
  summary: (store: ClusterStore) => LevelSummary;
}

/** What a level's steps can use at runtime. */
export interface LevelContext {
  store: ClusterStore;
  /** Play a script into the store; returns a cancel function. */
  play: (script: ScriptedMessage[]) => () => void;
  /** Simulate an API call the way the training harbor does (e.g. sink a pod and let the controller relaunch it). */
  simulate: (method: string, path: string, body?: unknown) => unknown;
}

export interface LevelResult {
  levelId: string;
  stars: number;
  seconds: number;
  hintsUsed: number;
}
