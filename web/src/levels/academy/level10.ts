import { selection } from '../../app';
import { nsKey, type Pod } from '../../store/cluster';
import { crashShips, fleetRefitted } from '../goals';
import { trainingHistory } from '../../tour/training';
import type { Level, ScriptedMessage } from '../types';
import { academyHarbor, lighthouse, podEvent, shipyard } from './fixture';

const OLD = 'ghcr.io/example/courier:1.0';
const BAD = 'ghcr.io/example/courier:2.0';
const FIXED = 'ghcr.io/example/courier:2.1';

/** Level 10: rolling updates and rollback. */
export const level10: Level = {
  id: 'academy/10',
  number: 10,
  title: 'Refit at sea',
  concept: 'Rolling updates and rollback',
  terms: ['refit', 'rollback', 'launch-queue', 'burning'],
  parSeconds: 240,
  fixture: () => {
    const y = shipyard('courier', 3, { image: OLD, currentRS: 'courier-1', revision: 1, strategy: 'RollingUpdate maxUnavailable=25% maxSurge=25%' });
    const pods = y.pods.map((p) => ({ ...p, ownerRS: 'courier-1' }));
    return academyHarbor({ deployments: [y.deployment], pods, services: [lighthouse('courier', 'courier')] });
  },
  steps: (ctx) => {
    const key = nsKey('harbor', 'courier');
    const burning = (name: string, node: string): Pod => ({ ns: 'harbor', name, node, phase: 'Running', ready: false, restarts: 3, reason: 'CrashLoopBackOff', created: new Date().toISOString(), deployment: 'courier', labels: { app: 'courier' }, containers: ['courier'], ownerRS: 'courier-2' });
    return [
      {
        id: 'bad',
        onEnter: () => {
          selection.clear();
          trainingHistory.set(key, [{ image: OLD, rs: 'courier-1' }]);
          const dep = ctx.store.deployments.get(key);
          const a = ctx.store.pods.get(nsKey('harbor', 'courier-a'));
          const b = ctx.store.pods.get(nsKey('harbor', 'courier-b'));
          if (!dep || !a || !b) return;
          const script: ScriptedMessage[] = [
            { at: 800, msg: { type: 'modified', kind: 'Deployment', obj: { ...dep, image: BAD, currentRS: 'courier-2', revision: 2, updated: 0 } } },
            { at: 900, msg: podEvent(a, 'Normal', 'Refit', `shipyard courier → ${BAD}`) },
            { at: 1500, msg: { type: 'modified', kind: 'Pod', obj: { ...burning('courier-2-x', ''), phase: 'Pending', reason: undefined as never } } },
            { at: 3000, msg: { type: 'modified', kind: 'Pod', obj: burning('courier-2-x', 'harbor-worker') } },
            { at: 3100, msg: podEvent(burning('courier-2-x', 'harbor-worker'), 'Warning', 'BackOff', 'courier:2.0 exits at once: "config key MISSING"') },
            { at: 3600, msg: { type: 'deleted', kind: 'Pod', obj: a } },
            { at: 4200, msg: { type: 'modified', kind: 'Pod', obj: { ...burning('courier-2-y', ''), phase: 'Pending', reason: undefined as never } } },
            { at: 5700, msg: { type: 'modified', kind: 'Pod', obj: burning('courier-2-y', 'harbor-control-plane') } },
            { at: 6300, msg: { type: 'deleted', kind: 'Pod', obj: b } },
            { at: 6400, msg: podEvent(burning('courier-2-y', 'harbor-control-plane'), 'Warning', 'BackOff', 'two of three ships burning; the refit keeps going') },
          ];
          ctx.play(script);
        },
        title: 'A refit goes wrong',
        text: 'A refit is rolling out: courier:2.0. Watch the slipway. Each new hull catches fire the moment it launches, and the old ships are scrapped as the new ones arrive. In a minute the whole fleet will be burning and the lighthouse will have nobody to send traders to.',
        anchor: { kind: 'map', key: 'unit-of:harbor/courier', placement: 'top' },
        waitFor: () => crashShips(ctx.store, 'harbor', 'courier') >= 2,
      },
      {
        id: 'rollback',
        onEnter: () => selection.clear(),
        title: 'Roll back',
        text: 'Do not debug a burning fleet. The shipyard remembers its previous refit: roll back and the old hulls launch again while the burning ones are scrapped. Select the courier shipyard and press Roll back refit; it asks twice.',
        cta: 'Roll back the courier shipyard',
        hint: 'Click the courier shipyard, press Roll back refit, then press it again to confirm.',
        anchor: { kind: 'map', key: `b:${key}`, placement: 'bottom' },
        waitFor: () => fleetRefitted(ctx.store, 'harbor', 'courier', OLD, 3),
      },
      {
        id: 'refit',
        title: 'Refit, carefully',
        text: 'The crew fixed the hull: courier:2.1. This time refit with MAX UNAVAILABLE 0: a new ship must moor and pass its lookouts before an old one is scrapped, so the fleet never shrinks. If the new hull burned, the rollout would stop with every old ship still afloat.',
        cta: 'Refit shipyard to courier:2.1 with max unavailable 0',
        hint: `Click the courier shipyard, press Refit shipyard, image ${FIXED}, MAX UNAVAILABLE 0, REFIT.`,
        anchor: { kind: 'dom', selector: '#hud .selection', placement: 'top' },
        waitFor: () => fleetRefitted(ctx.store, 'harbor', 'courier', FIXED, 3),
      },
      {
        id: 'lesson',
        onEnter: () => selection.clear(),
        title: 'Rollouts and revisions',
        text: 'Every template change is a new revision with its own ReplicaSet; the Deployment moves pods from the old one to the new within maxUnavailable and maxSurge, and stops if new pods never become ready. kubectl rollout undo returns to the previous revision in one command.',
        anchor: { kind: 'map', key: `b:${key}`, placement: 'bottom' },
      },
    ];
  },
  summary: (store) => {
    const d = store.deployments.get(nsKey('harbor', 'courier'));
    return {
      naval: `The bad refit was rolled back with one click and the fleet sailed on the old hulls. The fixed refit went out with max unavailable 0, so a new ship moored before each old one was scrapped; the courier shipyard is on refit #${d?.revision ?? 4} with ${d?.image ?? FIXED}.`,
      kubernetes: 'A Deployment rollout creates a new ReplicaSet and scales it up while scaling the old one down, bounded by maxUnavailable and maxSurge; readiness probes gate progress. Revisions are kept (revisionHistoryLimit); kubectl rollout undo re-applies the previous template. Recreate kills everything first.',
      devops: 'A Friday deploy shipped a config change the new build needed and nobody had written. Pods crash-looped; rollout undo brought the site back in twenty seconds, and the fix went out on Monday with maxUnavailable 0 and a readiness probe that would have stopped the bad rollout at one pod.',
      manifest: [
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: courier',
        '  namespace: harbor',
        'spec:',
        '  replicas: 3',
        '  strategy:',
        '    type: RollingUpdate',
        '    rollingUpdate:',
        '      maxUnavailable: 0       # never fewer than 3 ships',
        '      maxSurge: 1             # one extra ship launched first',
        '  revisionHistoryLimit: 10  # refits remembered for rollback',
        '  template:',
        '    spec:',
        '      containers:',
        '        - name: courier',
        `          image: ${FIXED}`,
        '          readinessProbe:       # gates the rollout',
        '            httpGet: { path: /ready, port: 80 }',
      ].join('\n'),
      kubectl: `kubectl rollout undo deployment/courier -n harbor\nkubectl set image deployment/courier courier=${FIXED} -n harbor\nkubectl rollout status deployment/courier -n harbor\nkubectl rollout history deployment/courier -n harbor`,
    };
  },
};
