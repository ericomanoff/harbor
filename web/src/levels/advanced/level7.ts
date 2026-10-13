import { createDeployment } from '../../api/client';
import { selection } from '../../app';
import { nsKey } from '../../store/cluster';
import { ordersShipyard, readyShips, relaunched } from '../goals';
import { deploymentYaml, ordersKubectl, ordersYaml } from '../manifest';
import type { Level } from '../types';
import { academyHarbor, podEvent, shipyard } from './fixture';

const overlayOpen = (id: string): boolean => document.getElementById(id)?.hidden === false;
const ORDERS = 'ConfigMap/courier-orders';

/** Level 7: configuration lives outside the image, in ConfigMaps and Secrets. */
export const level7: Level = {
  id: 'advanced/7',
  number: 7,
  title: 'Sealed orders',
  concept: 'ConfigMaps and Secrets',
  terms: ['configmap', 'secret', 'cargo-crate', 'refit', 'shipyard'],
  practises: 'One door',
  parSeconds: 240,
  fixture: () => {
    const y = shipyard('courier', 1);
    return academyHarbor({ deployments: [y.deployment], pods: y.pods });
  },
  real: {
    setup: async (ctx) => {
      await ctx.stage('found');
      await createDeployment({ ns: ctx.ns, name: 'courier', image: 'nginx:1.27-alpine', replicas: 1, port: 80 });
    },
    ready: (ctx) => readyShips(ctx.store, ctx.ns, 'courier') >= 1,
  },
  steps: (ctx) => {
    const NS = ctx.ns;
    let yard = '';
    let sunk = '';
    const sealed = (): boolean => ctx.orders().some((o) => `${o.kind}/${o.name}` === ORDERS);
    const firstShip = () => [...ctx.store.pods.values()].find((p) => p.ns === NS && p.deployment === 'courier');
    return [
      {
        id: 'intro',
        onEnter: () => {
          selection.clear();
          const p = firstShip();
          if (p) ctx.play([{ at: 1000, msg: podEvent(p, 'Warning', 'WrongOrders', 'calling at port 8080, but the harbor moved to 8443') }, { at: 3500, msg: podEvent(p, 'Warning', 'WrongOrders', 'PORT=8080 is painted inside the hull (baked into the image)') }]);
        },
        title: 'Orders painted on the hull',
        text: 'The courier calls at port 8080 because that number is painted inside its hull: the setting is baked into the image. The harbor moved to 8443. Now every ship must be rebuilt and repainted to change one line.',
        anchor: { kind: 'map', key: `unit-of:${NS}/courier`, placement: 'top' },
      },
      {
        id: 'shop',
        title: 'Seal the orders',
        text: 'Orders belong in a chart locker on the quay, not on the hull: a ConfigMap holds plain settings, a Secret holds credentials. Ships read them at launch, so changing orders never means rebuilding an image.',
        cta: 'Open the Shop',
        hint: 'The green Shop button is at the bottom left; Sealed orders is under Harbor.',
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => overlayOpen('shop'),
      },
      {
        id: 'card',
        title: 'Sealed orders',
        cta: 'Press Seal on the Sealed orders card',
        text: 'The Sealed orders card writes a ConfigMap or a Secret.',
        anchor: { kind: 'dom', selector: '#shop [data-card=orders]', placement: 'top' },
        waitFor: () => overlayOpen('orders-form'),
      },
      {
        id: 'orders',
        title: 'A chart locker',
        text: `Kind: chart locker (ConfigMap). Fleet ${NS}, name courier-orders. Orders, one per line: PORT=8443 and REGION=north. A sealed envelope (Secret) would hold a password the same way, but its contents never show again.`,
        cta: 'Fill it in and press SEAL',
        hint: `Kind ConfigMap, namespace ${NS}, name courier-orders, then PORT=8443 on one line and REGION=north on the next.`,
        anchor: { kind: 'dom', selector: '#orders-form .panel', placement: 'left' },
        waitFor: sealed,
      },
      {
        id: 'build',
        title: 'A shipyard that reads them',
        text: 'Now build a shipyard whose ships read the locker: Shop, Shipyard, a site, then in the form pick courier-orders under SEALED ORDERS. Every ship it launches gets PORT and REGION as environment variables.',
        cta: 'Build shipyard courier-v2 with courier-orders selected',
        hint: `Shop → Shipyard → click green land → namespace ${NS}, name courier-v2, and select courier-orders in the SEALED ORDERS box, then BUILD.`,
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => {
          const name = ordersShipyard(ctx.store, NS, ORDERS);
          if (name) yard = name;
          return !!name;
        },
      },
      {
        id: 'again',
        onEnter: () => {
          selection.clear();
          const ship = [...ctx.store.pods.values()].find((p) => p.ns === NS && p.deployment === yard && p.ready);
          if (!ship) return;
          sunk = ship.name;
          ctx.play([
            { at: 600, msg: { type: 'added', kind: 'Event', obj: { ns: NS, kind: 'ConfigMap', name: 'courier-orders', type: 'Normal', reason: 'OrdersChanged', message: 'PORT=9443 written to the chart locker', ts: new Date().toISOString() } } },
            { at: 2200, msg: podEvent(ship, 'Normal', 'Refit', 'relaunching to read the new orders') },
          ]);
          setTimeout(() => ctx.sink(ship), 2400);
        },
        title: 'The orders change',
        text: 'The port changes again: one line in the chart locker. A refit (a relaunch) is all it takes; the new ship reads PORT=9443 at launch. No image was rebuilt, no hull repainted.',
        anchor: { kind: 'map', key: `b:${nsKey(NS, yard || 'courier-v2')}`, placement: 'bottom' },
        waitFor: () => !!yard && !!sunk && relaunched(ctx.store, NS, yard, sunk),
      },
      {
        id: 'lesson',
        title: 'Image and configuration, apart',
        text: 'One image, many harbors: the same build runs in test and production with different ConfigMaps and Secrets. Inject them as environment (envFrom) or mount them as files. Secrets are base64, not encrypted: guard access with RBAC and encrypt at rest.',
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: (store) => {
    const d = [...store.deployments.values()].find((x) => (x.ns === 'harbor' || x.ns.startsWith('harbor-academy')) && x.orders?.includes(ORDERS));
    const orders = { ns: d?.ns ?? 'harbor', name: 'courier-orders', kind: 'ConfigMap' as const, data: { PORT: '8443', REGION: 'north' } };
    const dep = { ns: d?.ns ?? 'harbor', name: d?.name ?? 'courier-v2', image: d?.image ?? 'ghcr.io/example/courier:1.0', replicas: d?.replicas ?? 1, port: 80, orders: [{ kind: 'ConfigMap' as const, name: 'courier-orders' }] };
    return {
      naval: `The courier-orders chart locker holds the fleet's orders. The ${dep.name} shipyard launches ships that read it, so changing the port is one line in the locker and a refit, never a new hull.`,
      kubernetes: 'ConfigMaps hold non-secret key/values, Secrets hold sensitive ones (base64-encoded, encrypt at rest and restrict with RBAC). Pods consume them through envFrom, env valueFrom, or volumes. Env values are read at container start, so a change needs a rollout restart; mounted files update in place.',
      devops: 'The database URL was hard-coded and the staging deploy pointed at production. Moving it to a ConfigMap per environment, with the password in a Secret, let the same image ship to both safely.',
      manifest: `${ordersYaml(orders)}\n---\n${deploymentYaml(dep)}`,
      kubectl: `${ordersKubectl(orders)}\nkubectl set env deployment/${dep.name} --from=configmap/courier-orders -n ${dep.ns}\nkubectl rollout restart deployment/${dep.name} -n ${dep.ns}   # after changing the locker`,
    };
  },
};
