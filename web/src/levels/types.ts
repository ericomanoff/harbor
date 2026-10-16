import type { ClusterStore, Pod, Snapshot, WsMessage } from '../store/cluster';
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

/** How a level runs: in the training simulator, staged on the connected cluster, or live on it as it is. */
export type LevelMode = 'sim' | 'real' | 'live';

/** What a level needs to run on a real cluster. */
export interface RealPlan {
  /** Creates the starting harbor in the academy namespace (ctx.ns). */
  setup(ctx: LevelContext): Promise<void>;
  /** True once the live store shows the starting harbor. */
  ready(ctx: LevelContext): boolean;
}

export interface Level {
  id: string;
  /** Present when the level can be replayed on a real cluster. */
  real?: RealPlan;
  /** Runs only on the connected cluster as it is (expeditions): no fixture, no staging, no cleanup. */
  live?: boolean;
  number: number;
  title: string;
  concept: string;
  /** Glossary ids this level teaches; linked from the summary. */
  terms: string[];
  /** The principle(s) a hands-on level practises, shown on Harbor Select. */
  practises?: string;
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
  mode: LevelMode;
  /** The fleet the level plays in: `harbor` in the simulator, an academy namespace for real. */
  ns: string;
  /** Sinks a ship: the simulator or a staged incident, as the mode demands. */
  sink(pod: Pod): void;
  /** Stages a whitelisted incident on the real cluster (no-op in the simulator). */
  stage(incident: 'found' | 'lone-ship' | 'sink-pod' | 'bad-refit' | 'drain' | 'uncordon' | 'quota', args?: { name?: string; image?: string; node?: string }): Promise<void>;
  /** Sealed orders of a fleet (the level's by default), keys only; refreshed in the background for real. */
  orders(ns?: string): { kind: string; name: string }[];
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
