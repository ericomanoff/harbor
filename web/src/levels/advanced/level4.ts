import { mode, selection } from '../../app';
import { nsKey, type Pod } from '../../store/cluster';
import { lookoutsShipyard, readyShips } from '../goals';
import { deploymentYaml } from '../manifest';
import type { Level } from '../types';
import { academyHarbor, podEvent, shipyard } from './fixture';

const overlayOpen = (id: string): boolean => document.getElementById(id)?.hidden === false;

/** Level 4: readiness and liveness probes, the lookouts. */
export const level4: Level = {
  id: 'advanced/4',
  number: 4,
  title: 'Lookouts',
  concept: 'Health probes (readiness and liveness)',
  terms: ['lookouts', 'shipyard', 'ship', 'refit'],
  practises: 'Reconcile, Cattle not pets',
  parSeconds: 240,
  fixture: () => {
    const y = shipyard('courier', 1);
    return academyHarbor({ deployments: [y.deployment], pods: y.pods });
  },
  steps: (ctx) => {
    const old = nsKey('harbor', 'courier');
    let yard = '';
    let ship: Pod | undefined;
    return [
      {
        id: 'breach',
        onEnter: () => {
          selection.clear();
          const p = ctx.store.pods.get(nsKey('harbor', 'courier-a'));
          if (p) ctx.play([{ at: 800, msg: podEvent(p, 'Warning', 'HullBreach', 'courier-a answers nobody, yet reports Ready') }, { at: 4000, msg: podEvent(p, 'Warning', 'HullBreach', 'traders still being sent to courier-a') }]);
        },
        title: 'A broken hull',
        text: 'The courier is holed below the waterline: it answers nobody. But look: it still flies the ready flag, so traders keep being sent to it. The shipyard sees a running ship and does nothing. Nobody is watching the ship from inside.',
        anchor: { kind: 'map', key: `u:${nsKey('harbor', 'courier-a')}`, placement: 'top' },
      },
      {
        id: 'lookouts',
        title: 'Post lookouts',
        text: 'A lookout is a probe. A readiness lookout asks "may this ship take traders?": when it says no, the lighthouse stops sending them. A liveness lookout asks "is this ship still alive?": when it says no, the ship is sunk and relaunched. This shipyard has none, so build a new one with both, then sell the old.',
        cta: 'Open the Shop',
        hint: 'The green Shop button is at the bottom left.',
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => overlayOpen('shop'),
      },
      {
        id: 'card',
        title: 'A new shipyard',
        cta: 'Press Build on the Shipyard card',
        text: 'Lookouts are part of the ship design, so they live on the shipyard.',
        anchor: { kind: 'dom', selector: '#shop [data-card=shipyard]', placement: 'top' },
        waitFor: () => mode.current === 'place',
      },
      {
        id: 'site',
        title: 'Choose a site',
        cta: 'Click a green site on an island',
        hint: 'Any free land will do; try the harbor-control-plane island on the left.',
        anchor: { kind: 'map', key: 'dock:harbor-control-plane', placement: 'bottom' },
        text: 'Pick a site for the new shipyard.',
        waitFor: () => overlayOpen('build-form'),
      },
      {
        id: 'form',
        title: 'Lookouts on the manifest',
        text: 'Fleet harbor, name courier-v2, 1 unit, port 80. Then the two new fields: READINESS LOOKOUT /ready and LIVENESS LOOKOUT /healthz. The ship\'s manifest shows them as readinessProbe and livenessProbe.',
        cta: 'Fill it in and press BUILD',
        hint: 'Namespace harbor, name courier-v2, port 80, readiness /ready, liveness /healthz.',
        anchor: { kind: 'dom', selector: '#build-form .panel', placement: 'left' },
        waitFor: () => {
          const name = lookoutsShipyard(ctx.store, 'harbor');
          if (name) yard = name;
          return !!name;
        },
      },
      {
        id: 'sell',
        onEnter: () => selection.clear(),
        title: 'Retire the old shipyard',
        text: 'The new fleet has lookouts; the old one never will. Select the old courier shipyard and sell it. It asks twice: selling scraps its ship too.',
        cta: 'Sell the old courier shipyard',
        hint: 'Click the courier shipyard on the harbor-worker island, press Sell shipyard, then press it again to confirm.',
        anchor: { kind: 'map', key: `b:${old}`, placement: 'bottom' },
        waitFor: () => !ctx.store.deployments.has(old),
      },
      {
        id: 'again',
        onEnter: () => {
          selection.clear();
          ship = [...ctx.store.pods.values()].find((p) => p.ns === 'harbor' && p.deployment === yard && p.ready);
          if (!ship) return;
          const s = ship;
          ctx.play([
            { at: 1200, msg: podEvent(s, 'Warning', 'Unhealthy', 'Readiness probe failed: GET /ready 503') },
            { at: 1300, msg: { type: 'modified', kind: 'Pod', obj: { ...s, ready: false } } },
            { at: 3800, msg: podEvent(s, 'Warning', 'Unhealthy', 'Liveness probe failed: GET /healthz timed out') },
            { at: 3900, msg: podEvent(s, 'Normal', 'Killing', 'Container courier-v2 failed liveness probe, will be restarted') },
            { at: 5600, msg: podEvent(s, 'Normal', 'Started', 'Started container courier-v2') },
            { at: 5700, msg: { type: 'modified', kind: 'Pod', obj: { ...s, ready: true, restarts: s.restarts + 1 } } },
          ]);
        },
        title: 'The hull breaks again',
        text: 'Watch the lookouts work. The readiness lookout fails first: the ship is pulled from the beam, no trader is sent to it. Then the liveness lookout fails: the ship is restarted in place, comes back, and the readiness lookout lets it take traders again.',
        anchor: { kind: 'map', key: `unit-of:harbor/${yard || 'courier-v2'}`, placement: 'top' },
        waitFor: () => !!ship && (ctx.store.pods.get(nsKey('harbor', ship.name))?.restarts ?? 0) >= 1 && readyShips(ctx.store, 'harbor', yard) >= 1,
      },
      {
        id: 'lesson',
        title: 'Two questions',
        text: 'Readiness: may this pod receive traffic? Liveness: should this container be restarted? Both are asked by the kubelet, over and over, and both are yours to define. Without them Kubernetes only knows whether the process is running.',
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: (store) => {
    const d = [...store.deployments.values()].find((x) => x.ns === 'harbor' && x.readiness && x.liveness);
    const req = { ns: 'harbor', name: d?.name ?? 'courier-v2', image: d?.image ?? 'ghcr.io/example/courier:1.0', replicas: d?.replicas ?? 1, port: 80, readinessPath: d?.readiness?.replace(/^http /, '') ?? '/ready', livenessPath: d?.liveness?.replace(/^http /, '') ?? '/healthz' };
    return {
      naval: `The ${req.name} shipyard posts two lookouts on every ship. When the hull broke, the readiness lookout pulled the ship from the beam and the liveness lookout had it restarted; traders never met a dead ship.`,
      kubernetes: 'A readiness probe failing removes the pod from Service endpoints; a liveness probe failing restarts the container (restarts count goes up). Probes are HTTP, TCP, gRPC or exec, with a period, timeout and failure threshold. A startup probe guards slow starts.',
      devops: 'The payment service deadlocked at 2 a.m.: the process was alive, the load balancer kept sending requests into a black hole. With a liveness probe on /healthz the container would have been restarted in seconds, and a readiness probe would have kept traffic away meanwhile.',
      manifest: deploymentYaml(req),
      kubectl: `kubectl get pods -n harbor -w        # watch READY and RESTARTS\nkubectl describe pod -l app=${req.name} -n harbor | grep -E 'Liveness|Readiness|Unhealthy'`,
    };
  },
};
