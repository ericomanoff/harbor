import { createDeployment } from '../../api/client';
import { selection } from '../../app';
import { nsKey, type Pod } from '../../store/cluster';
import { lighthouseFor, readyShips } from '../goals';
import { serviceKubectl, serviceYaml } from '../manifest';
import type { Level } from '../types';
import { academyHarbor, podEvent, shipyard } from './fixture';

const overlayOpen = (id: string): boolean => document.getElementById(id)?.hidden === false;

/** Level 5: a Service gives a fleet one stable address. */
export const level5: Level = {
  id: 'advanced/5',
  number: 5,
  title: 'The lighthouse',
  concept: 'Services (a stable address and a selector)',
  terms: ['lighthouse', 'beam', 'label', 'trader'],
  practises: 'Labels not references, Cattle not pets',
  parSeconds: 180,
  fixture: () => {
    const y = shipyard('courier', 2);
    const trader: Pod = { ns: 'harbor', name: 'trader', node: 'harbor-control-plane', phase: 'Running', ready: true, restarts: 0, created: new Date().toISOString(), labels: { app: 'trader' }, containers: ['trader'] };
    return academyHarbor({ deployments: [y.deployment], pods: [...y.pods, trader] });
  },
  real: {
    setup: async (ctx) => {
      await ctx.stage('found');
      await createDeployment({ ns: ctx.ns, name: 'courier', image: 'nginx:1.27-alpine', replicas: 2, port: 80 });
      await ctx.stage('lone-ship', { name: 'trader' });
    },
    ready: (ctx) => readyShips(ctx.store, ctx.ns, 'courier') >= 2 && ctx.store.pods.get(nsKey(ctx.ns, 'trader'))?.ready === true,
  },
  steps: (ctx) => {
    const NS = ctx.ns;
    const real = ctx.mode === 'real';
    const traderKey = nsKey(NS, 'trader');
    const trader = (): Pod | undefined => ctx.store.pods.get(traderKey);
    let beacon = '';
    let before: string[] = [];
    const courierNames = (): string[] => [...ctx.store.pods.values()].filter((p) => p.ns === NS && p.deployment === 'courier').map((p) => p.name);
    const sinkOne = (delay: number): void => {
      const victim = [...ctx.store.pods.values()].find((p) => p.ns === NS && p.deployment === 'courier' && p.ready);
      if (victim) setTimeout(() => ctx.sink(victim), delay);
    };
    return [
      {
        id: 'intro',
        onEnter: () => selection.clear(),
        title: 'A trader with an address',
        text: `The courier fleet has two ships. A trader (another pod) sails to one of them by name: ${courierNames()[0] ?? 'courier-a'}, the address it was given. Ships, though, do not keep their names.`,
        anchor: { kind: 'map', key: `u:${traderKey}`, placement: 'top' },
      },
      {
        id: 'lost',
        onEnter: () => {
          before = courierNames();
          sinkOne(400);
          const t = trader();
          if (t) {
            ctx.play([
              { at: 2600, msg: podEvent(t, 'Warning', 'NoRoute', `${before[0] ?? 'courier-a'}: no such host`) },
              ...(real ? [] : [{ at: 2700, msg: { type: 'modified' as const, kind: 'Pod' as const, obj: { ...t, ready: false, reason: 'NoRoute' } } }]),
            ]);
          }
        },
        title: 'The address is gone',
        text: `${before[0] ?? 'courier-a'} sinks (a refit, a reef, a node draining: it happens all day). The shipyard launches a replacement with a new name and a new berth. The trader is still sailing for the old name, and finds nothing.`,
        anchor: { kind: 'map', key: `u:${traderKey}`, placement: 'top' },
        waitFor: () => (real ? courierNames().some((n) => !before.includes(n)) && readyShips(ctx.store, NS, 'courier') >= 2 : trader()?.ready === false),
      },
      {
        id: 'shop',
        title: 'Light a lighthouse',
        text: 'A lighthouse is a Service: one name and one address that never change, with a beam that always points at the ready ships of a fleet. Traders sail to the lighthouse, never to a ship.',
        cta: 'Open the Shop',
        hint: 'The green Shop button is at the bottom left; the Lighthouse card is under Harbor.',
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => overlayOpen('shop'),
      },
      {
        id: 'card',
        title: 'The Lighthouse card',
        cta: 'Press Light on the Lighthouse card',
        text: 'The Lighthouse card lights a Service.',
        anchor: { kind: 'dom', selector: '#shop [data-card=lighthouse]', placement: 'top' },
        waitFor: () => overlayOpen('lighthouse-form'),
      },
      {
        id: 'form',
        title: 'Which ships?',
        text: `Fleet ${NS}, name courier. SHIPS TO GUIDE is the selector: pick the courier shipyard and the beam will reach every ship flying its ensign (the label app=courier), today and after every relaunch. Port 80 is where traders knock.`,
        cta: 'Fill it in and press LIGHT',
        hint: `Namespace ${NS}, name courier, ships to guide: courier (shipyard), port 80.`,
        anchor: { kind: 'dom', selector: '#lighthouse-form .panel', placement: 'left' },
        waitFor: () => {
          const name = lighthouseFor(ctx.store, NS, 'courier');
          if (name) beacon = name;
          return !!name;
        },
      },
      {
        id: 'again',
        onEnter: () => {
          selection.clear();
          before = courierNames();
          const t = trader();
          if (t) ctx.play([{ at: 600, msg: podEvent(t, 'Normal', 'Resolved', `${beacon}.${NS}.svc: following the beam`) }, ...(real ? [] : [{ at: 700, msg: { type: 'modified' as const, kind: 'Pod' as const, obj: { ...t, ready: true, reason: undefined as never } } }])]);
          sinkOne(2600);
        },
        title: 'Ships come and go',
        text: 'The trader now sails to the lighthouse and is back in business. Watch another ship sink and get replaced: the beam swings to the new ship and the trader never notices.',
        anchor: { kind: 'map', key: `s:${nsKey(NS, beacon || 'courier')}`, placement: 'bottom' },
        waitFor: () => trader()?.ready === true && readyShips(ctx.store, NS, 'courier') >= 2 && courierNames().some((n) => !before.includes(n)),
      },
      {
        id: 'lesson',
        title: 'One name, many ships',
        text: `A Service is a stable name and IP in front of a changing set of pods, chosen by label selector. Inside the cluster it is reachable as courier.${NS}.svc; the beam is its endpoints, kept up to date by the control plane as pods come and go.`,
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: (store) => {
    const s = [...store.services.values()].find((x) => (x.ns === 'harbor' || x.ns.startsWith('harbor-academy')) && x.selector['app'] === 'courier');
    const req = { ns: s?.ns ?? 'harbor', name: s?.name ?? 'courier', selector: s?.selector ?? { app: 'courier' }, port: s?.ports[0]?.port ?? 80 };
    return {
      naval: `The ${req.name} lighthouse gives the fleet one address. Its beam follows the ensign app=courier, so when a ship sinks and a new one launches the trader keeps arriving.`,
      kubernetes: 'A Service has a stable ClusterIP and DNS name (courier.harbor.svc.cluster.local) and a label selector; the endpoints controller keeps the list of ready pods behind it current. ClusterIP is inside-only; NodePort and LoadBalancer open it outward.',
      devops: 'The frontend had the API pod\'s IP in its config. After a routine rollout the API pods had new IPs and the frontend went 502 for an hour. Pointing it at the api Service name fixed it for good.',
      manifest: serviceYaml(req),
      kubectl: `${serviceKubectl(req)}\nkubectl get endpoints ${req.name} -n ${req.ns}   # the beam`,
    };
  },
};
