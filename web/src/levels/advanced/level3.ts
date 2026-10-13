import { selection } from '../../app';
import { nsKey } from '../../store/cluster';
import { readyShips } from '../goals';
import { deploymentKubectl, deploymentYaml } from '../manifest';
import type { Level, ScriptedMessage } from '../types';
import { academyHarbor, lighthouse, podEvent, shipyard } from './fixture';

/** Level 3: one ship cannot ride out a storm; three can. Scaling. */
export const level3: Level = {
  id: 'advanced/3',
  number: 3,
  title: 'Storm season',
  concept: 'Scaling (replicas)',
  terms: ['launch', 'shipyard', 'lighthouse', 'storm'],
  practises: 'Reconcile',
  parSeconds: 150,
  fixture: () => {
    const y = shipyard('courier', 1);
    return academyHarbor({ deployments: [y.deployment], pods: y.pods, services: [lighthouse('courier', 'courier')] });
  },
  steps: (ctx) => {
    const yard = nsKey('harbor', 'courier');
    let calm = 0;
    /** The storm: every ship of the fleet is overloaded for a while, then recovers. */
    const storm = (): void => {
      const ships = [...ctx.store.pods.values()].filter((p) => p.ns === 'harbor' && p.deployment === 'courier' && p.ready);
      const share = Math.max(1, Math.ceil(ships.length / 3)); // three ships share the traders; one alone takes them all
      const script: ScriptedMessage[] = [];
      if (ships[0]) script.push({ at: 0, msg: podEvent(ships[0], 'Warning', 'Storm', `traders arriving faster than ${ships.length} ship${ships.length === 1 ? '' : 's'} can serve`) });
      for (const p of ships.slice(0, share)) {
        script.push({ at: 600, msg: { type: 'modified', kind: 'Pod', obj: { ...p, ready: false, reason: 'Overloaded' } } });
        script.push({ at: ships.length >= 3 ? 2600 : 5000, msg: { type: 'modified', kind: 'Pod', obj: { ...p, ready: true } } });
      }
      ctx.play(script);
      calm = Date.now() + (ships.length >= 3 ? 3200 : 5600);
    };
    return [
      {
        id: 'intro',
        onEnter: () => selection.clear(),
        title: 'A lighthouse for the fleet',
        text: 'The courier shipyard keeps one ship afloat, and a lighthouse now guides traders to it: the beam reaches every ready ship of the fleet. Business is good. Too good.',
        anchor: { kind: 'map', key: `s:${yard}`, placement: 'bottom' },
      },
      {
        id: 'storm',
        onEnter: storm,
        title: 'Storm season',
        text: 'A storm of traders! One ship cannot serve them all: it is overloaded, drops out of the beam, and every trader waits. When the storm passes the ship recovers, but the traders are gone.',
        anchor: { kind: 'map', key: 'unit-of:harbor/courier', placement: 'top' },
        waitFor: () => Date.now() > calm && readyShips(ctx.store, 'harbor', 'courier') >= 1,
      },
      {
        id: 'select',
        title: 'More ships',
        text: 'A shipyard can keep as many ships afloat as you ask. Select it and launch until three are moored; the lighthouse will spread the traders across all of them.',
        cta: 'Click the courier shipyard',
        hint: 'The shipyard stands on the harbor-worker island, above the ship.',
        anchor: { kind: 'map', key: `b:${yard}`, placement: 'bottom' },
        waitFor: () => selection.keys.has(`b:${yard}`),
      },
      {
        id: 'launch',
        title: 'Launch ships',
        text: 'Launch ship raises the replicas the shipyard keeps. Each press is one more ship; the shipyard launches it from the slipway and the beam picks it up when it is ready.',
        cta: 'Press Launch ship until 3 ships are moored',
        hint: 'Press the green Launch ship button twice and wait for both ships to moor.',
        anchor: { kind: 'dom', selector: '#hud .selection', placement: 'top' },
        waitFor: () => (ctx.store.deployments.get(yard)?.replicas ?? 0) >= 3 && readyShips(ctx.store, 'harbor', 'courier') >= 3,
      },
      {
        id: 'again',
        onEnter: () => { selection.clear(); storm(); },
        title: 'The storm returns',
        text: 'Here it comes again. This time three ships share the traders: one may wobble, but the beam always has ready ships to send traders to. Nobody waits.',
        anchor: { kind: 'map', key: `s:${yard}`, placement: 'bottom' },
        waitFor: () => Date.now() > calm && readyShips(ctx.store, 'harbor', 'courier') >= 3,
      },
      {
        id: 'lesson',
        title: 'Replicas',
        text: 'Scaling is just changing the number the shipyard keeps: kubectl scale, or Launch ship here. In a real harbor a HorizontalPodAutoscaler watches the load and launches ships when a storm comes, scrapping them when it passes.',
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: (store) => {
    const d = store.deployments.get(nsKey('harbor', 'courier'));
    const req = { ns: 'harbor', name: 'courier', image: d?.image ?? 'ghcr.io/example/courier:1.0', replicas: d?.replicas ?? 3, port: 80 };
    return {
      naval: `The courier shipyard now keeps ${req.replicas} ships afloat. When the storm of traders returned, the lighthouse spread them across the fleet and nobody was left waiting.`,
      kubernetes: 'Scaling a Deployment changes spec.replicas; the ReplicaSet launches or retires pods to match. The Service load-balances across every ready pod. A HorizontalPodAutoscaler can change replicas for you from CPU or custom metrics.',
      devops: 'Marketing sent a newsletter at 9 a.m. and the single API pod fell over under the traffic. The fix was one command: scale to three, then an autoscaler so the next campaign scales itself.',
      manifest: deploymentYaml(req),
      kubectl: `kubectl scale deployment courier --replicas=${req.replicas} -n harbor\n# or let the harbor decide:\nkubectl autoscale deployment courier --min=2 --max=6 --cpu-percent=70 -n harbor\n# how it was built:\n${deploymentKubectl(req)}`,
    };
  },
};
