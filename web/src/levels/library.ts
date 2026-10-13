import { campaigns as campaignApi, type Campaign } from '../api/client';
import { ADVANCED } from './advanced';
import { campaignLevels } from './campaign';
import { PRINCIPLES } from './principles';
import type { Level } from './types';

/**
 * The Expeditions library: every training the harbor carries, in the order
 * it is shown. Code expeditions come first (they need the simulator); YAML
 * expeditions from the backend follow in the order the backend lists them.
 */
export interface Expedition {
  id: string;
  title: string;
  tagline: string;
  /** The vendor guide an expedition follows, if any. */
  source?: string;
  origin: 'builtin-code' | 'builtin-yaml' | 'user-yaml';
  /** Runs in the training simulator (code) or only on a connected cluster (yaml). */
  simulated: boolean;
  levels: Level[];
}

const CODE: Expedition[] = [
  { id: 'principles', title: '1st Principles', tagline: 'Why Kubernetes is built the way it is, one principle per level, and what that means in practice.', origin: 'builtin-code', simulated: true, levels: PRINCIPLES },
  { id: 'advanced', title: 'Advanced K8s', tagline: 'Hands-on levels: the objects and operations, each practising a principle.', origin: 'builtin-code', simulated: true, levels: ADVANCED },
];

let yaml: Expedition[] | undefined;

function fromCampaign(c: Campaign): Expedition {
  return {
    id: c.id,
    title: c.title,
    tagline: c.tagline ?? '',
    ...(c.source ? { source: c.source } : {}),
    origin: c.builtin ? 'builtin-yaml' : 'user-yaml',
    simulated: false,
    levels: campaignLevels(c),
  };
}

/** Code expeditions always; YAML ones once the backend answered (never in the demo harbor). */
export async function expeditions(opts: { demo: boolean }): Promise<Expedition[]> {
  const code = CODE.filter((e) => e.levels.length > 0);
  if (opts.demo) return code;
  if (!yaml) {
    try {
      yaml = (await campaignApi.list()).map(fromCampaign);
    } catch {
      yaml = [];
    }
  }
  return [...code, ...yaml];
}

/** Synchronous view of what is known so far (code always, yaml if loaded). */
export function knownExpeditions(): Expedition[] {
  return [...CODE.filter((e) => e.levels.length > 0), ...(yaml ?? [])];
}

export function expeditionOf(levelId: string): Expedition | undefined {
  const prefix = levelId.split('/')[0];
  return knownExpeditions().find((e) => e.id === prefix);
}

export function levelById(id: string): Level | undefined {
  return expeditionOf(id)?.levels.find((l) => l.id === id);
}

/** The next level inside the same expedition, if any. */
export function nextLevel(id: string): Level | undefined {
  const e = expeditionOf(id);
  if (!e) return undefined;
  return e.levels[e.levels.findIndex((l) => l.id === id) + 1];
}
