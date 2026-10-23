import { campaigns as campaignApi, type Campaign, type CampaignGoal, type CampaignLevel, type CampaignStep } from '../api/client';
import { nsKey, type ClusterStore } from '../store/cluster';
import type { HintedStep } from '../tour/bubbleUI';
import { openFleetForm } from '../ui/fleetForm';
import { openGateForm } from '../ui/gateForm';
import { openLighthouseForm } from '../ui/lighthouseForm';
import { openOrdersForm } from '../ui/ordersForm';
import { openTechTree } from '../ui/techTree';
import type { Level, LevelContext, LevelSummary } from './types';

/** A goal from campaign YAML, evaluated over the live store (and the orders list for Secrets/ConfigMaps). */
export function goalMet(goal: CampaignGoal, store: ClusterStore, orders: (ns?: string) => { kind: string; name: string }[]): boolean {
  const ns = goal.ns ?? '';
  const name = goal.name ?? '';
  switch (goal.kind) {
    case 'namespace-exists':
      return store.namespaces.has(name);
    case 'orders-exist':
      return orders(ns || undefined).some((o) => o.name === name && (!goal.orders || o.kind === goal.orders));
    case 'deployment-ready': {
      const d = store.deployments.get(nsKey(ns, name));
      return !!d && d.available >= Math.max(1, d.replicas);
    }
    case 'release-deployed':
      return store.releases.get(nsKey(ns, name))?.status === 'deployed';
    case 'release-revision':
      return (store.releases.get(nsKey(ns, name))?.revision ?? 0) >= (goal.min ?? 1);
    case 'ingress-exists':
      return store.ingresses.has(nsKey(ns, name));
    case 'service-exists':
      return store.services.has(nsKey(ns, name));
    default:
      return false;
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Opens the shop form a campaign step names, prefilled. */
function openForm(step: CampaignStep): void {
  const pre = (step.prefill ?? {}) as Record<string, unknown>;
  const ns = str(pre['ns']);
  switch (step.form) {
    case 'orders':
      openOrdersForm({ ...(ns ? { defaultNamespace: ns } : {}), kind: pre['kind'] === 'Secret' ? 'Secret' : 'ConfigMap', ...(str(pre['name']) ? { name: str(pre['name'])! } : {}), ...(typeof pre['data'] === 'object' && pre['data'] ? { data: pre['data'] as Record<string, string> } : {}) });
      break;
    case 'fleet':
      openFleetForm({ ...(str(pre['name']) ? { name: str(pre['name'])! } : {}) });
      break;
    case 'lighthouse':
      openLighthouseForm({ ...(ns ? { defaultNamespace: ns } : {}) });
      break;
    case 'gate':
      openGateForm();
      break;
    default:
      break;
  }
}

/** One campaign step as a Huber step; goals become waitFor, checks and forms become the action button. */
export function campaignStep(step: CampaignStep, i: number, ctx: LevelContext, results: Map<number, boolean>): HintedStep {
  const base: HintedStep = {
    id: `step-${i}`,
    title: step.title ?? (step.kind === 'check' ? `Check: ${step.probe}` : step.kind),
    text: step.text ?? '',
    anchor: { kind: 'none' },
    ...(step.hint ? { hint: step.hint } : {}),
  };
  const goal = step.goal;
  const goalWait = goal ? () => goalMet(goal, ctx.store, ctx.orders) : undefined;
  switch (step.kind) {
    case 'check':
      return {
        ...base,
        cta: 'Run the check (or skip it for a dry run)',
        action: {
          label: 'Run check',
          run: async () => {
            const r = await campaignApi.probe(step.probe ?? '', step.args ?? {});
            results.set(i, r.ok);
            return r;
          },
        },
        waitFor: () => results.get(i) === true,
      };
    case 'form':
      return {
        ...base,
        cta: `Open the ${step.form} form and fill it in`,
        action: { label: 'Open form', run: async () => { openForm(step); } },
        ...(goalWait ? { waitFor: goalWait } : {}),
      };
    case 'values':
    case 'helm-install':
      return {
        ...base,
        cta: 'Open the chart table with the chart and deploy it',
        action: {
          label: 'Open chart',
          run: async () => {
            openTechTree({ installRef: { chart: step.chart ?? '', release: step.release ?? '', ns: step.ns ?? 'default', ...(step.version ? { version: step.version } : {}), ...(step.required ? { required: step.required } : {}) } });
          },
        },
        ...(goalWait ? { waitFor: goalWait } : {}),
      };
    case 'helm-upgrade':
      return {
        ...base,
        cta: 'Upgrade the release from the chart table',
        action: { label: 'Open release', run: async () => { openTechTree({ upgrade: nsKey(step.ns ?? 'default', step.release ?? '') }); } },
        ...(goalWait ? { waitFor: goalWait } : {}),
      };
    case 'wait':
      return { ...base, cta: 'Waiting for the harbor…', ...(goalWait ? { waitFor: goalWait } : {}) };
    default:
      return base;
  }
}

/** Levels of a campaign, playable by the runner in live mode; ids are "<campaign>/<level>". */
export function campaignLevels(c: Campaign): Level[] {
  return c.levels.map((l: CampaignLevel, idx) => ({
    id: `${c.id}/${l.id}`,
    number: idx + 1,
    title: l.title,
    concept: l.concept ?? c.title,
    terms: [],
    parSeconds: l.par ?? 600,
    live: true,
    fixture: () => ({ context: c.id, nodes: [], namespaces: [], deployments: [], pods: [], services: [], workloads: [], ingresses: [], releases: [] }),
    steps: (ctx) => {
      const results = new Map<number, boolean>();
      return l.steps.map((s, i) => campaignStep(s, i, ctx, results));
    },
    summary: (): LevelSummary => ({
      naval: l.summary?.naval ?? `${l.title} is done.`,
      kubernetes: l.summary?.kubernetes ?? '',
      devops: l.summary?.practice ?? (c.source ? `Follow the vendor guide: ${c.source}` : ''),
      ...(l.summary?.kubectl ? { kubectl: l.summary.kubectl.trim() } : {}),
    }),
  }));
}
