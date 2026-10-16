import { selection } from '../../app';
import { nsKey, type Pod, type Workload } from '../../store/cluster';
import { failNode, restoreNode } from '../../tour/training';
import { academyHarbor, lighthouse, podEvent, shipyard } from '../advanced/fixture';
import { lighthouseFor, lookoutsShipyard, readyShips } from '../goals';
import { fakeIP } from '../../tour/papers';
import { deploymentYaml } from '../manifest';
import type { Level } from '../types';

/** Principle 5: cattle, not pets; assume failure. */
export const level5: Level = {
  id: 'principles/5',
  number: 5,
  title: 'Cattle, not pets',
  concept: 'Assume failure: disposable pods, stable abstractions',
  terms: ['pod-ip', 'drain', 'graceful-shutdown', 'lighthouse', 'tank', 'tanker-terminal', 'lookouts', 'limits'],
  parSeconds: 420,
  fixture: () => {
    const y = shipyard('courier', 1);
    const trader: Pod = { ns: 'harbor', name: 'trader', node: 'harbor-control-plane', phase: 'Running', ready: true, restarts: 0, created: new Date().toISOString(), labels: { app: 'trader' }, containers: ['trader'] };
    const db: Workload = { kind: 'StatefulSet', ns: 'harbor', name: 'ledger-db', image: 'postgres:16', desired: 1, ready: 1, conditions: [] };
    const tanker: Pod = { ns: 'harbor', name: 'ledger-db-0', node: 'harbor-worker', phase: 'Running', ready: true, restarts: 0, created: new Date().toISOString(), ownerKind: 'StatefulSet', ownerName: 'ledger-db', labels: { app: 'ledger-db' }, containers: ['postgres'] };
    const snap = academyHarbor({ deployments: [y.deployment], pods: [...y.pods, trader, tanker], services: [lighthouse('ledger-db', 'ledger-db')] });
    snap.workloads = [db];
    return snap;
  },
  steps: (ctx) => {
    const NS = ctx.ns;
    const traderKey = nsKey(NS, 'trader');
    const courierShip = (): Pod | undefined => [...ctx.store.pods.values()].find((p) => p.ns === NS && p.deployment === 'courier');
    let oldIP = '';
    let oldName = '';
    let yard = '';
    const drain = (node: string): void => {
      if (ctx.mode === 'real') void ctx.stage('drain', { node });
      else failNode(node);
    };
    const undrain = (node: string): void => {
      if (ctx.mode === 'real') void ctx.stage('uncordon', { node });
      else restoreNode(node);
    };
    return [
      {
        id: 'pet',
        onEnter: () => {
          selection.clear();
          const s = courierShip();
          if (s) { oldName = s.name; oldIP = fakeIP(s.name); }
        },
        title: 'A trader with a pet',
        text: `The trader carries the courier ship's address: ${oldIP || 'its pod IP'}. Open the courier ship's Papers and find status.podIP: that number belongs to this one ship and dies with it. Beside it, the ledger-db tanker keeps its name, ledger-db-0, and its tank.`,
        cta: 'Read the courier ship\'s Papers (status.podIP)',
        anchor: { kind: 'map', key: `unit-of:${NS}/courier`, placement: 'top' },
        waitFor: () => document.getElementById('papers')?.hidden === false && (document.querySelector('#papers pre.status')?.textContent ?? '').includes('podIP'),
      },
      {
        id: 'drain',
        onEnter: () => {
          const t = ctx.store.pods.get(traderKey);
          setTimeout(() => drain('harbor-worker'), 1200);
          if (t) ctx.play([{ at: 3800, msg: podEvent(t, 'Warning', 'NoRoute', `${oldIP}: no route to host (the ship it named is gone)`) }, { at: 3900, msg: { type: 'modified', kind: 'Pod', obj: { ...t, ready: false, reason: 'NoRoute' } } }]);
        },
        title: 'The island is drained',
        text: 'The harbor master drains the harbor-worker island for maintenance. The courier ship relaunches elsewhere with a new name and a new IP; the trader is lost. The tanker relaunches too, as ledger-db-0 again, on another island, with its tank following: its data is intact.',
        anchor: { kind: 'map', key: 'dock:harbor-worker', placement: 'bottom' },
        waitFor: () => {
          const s = courierShip();
          const t = ctx.store.pods.get(traderKey);
          return !!s && s.name !== oldName && s.ready && t?.ready === false && (ctx.store.pods.get(nsKey(NS, 'ledger-db-0'))?.node ?? 'harbor-worker') !== 'harbor-worker';
        },
      },
      {
        id: 'lighthouse',
        onEnter: () => { undrain('harbor-worker'); selection.clear(); },
        title: 'A stable name on top',
        text: 'Pods are disposable; the system gives you something stable to hold instead. Light a lighthouse for the courier fleet: a name and address that outlive any ship. Then the trader can be pointed at it.',
        cta: 'Light lighthouse courier guiding the courier shipyard',
        hint: `Shop → Lighthouse → namespace ${NS}, name courier, ships to guide: courier, LIGHT.`,
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => lighthouseFor(ctx.store, NS, 'courier') === 'courier',
      },
      {
        id: 'repoint',
        onEnter: () => {
          const t = ctx.store.pods.get(traderKey);
          if (t) ctx.play([{ at: 500, msg: podEvent(t, 'Normal', 'Resolved', `courier.${NS}.svc: following the beam`) }, { at: 600, msg: { type: 'modified', kind: 'Pod', obj: { ...t, ready: true, reason: undefined as never } } }]);
        },
        title: 'Design for the drain',
        text: 'The trader now sails to the lighthouse. The rest is the ship\'s own design: rebuild the courier shipyard so each ship tolerates being replaced. Sell the old shipyard, then build courier again with lookouts (/ready, /healthz), a port, requests and limits, and GRACE 10 seconds so a ship can finish its last delivery after SIGTERM.',
        cta: 'Rebuild courier with lookouts, port 80, limits and grace 10',
        hint: `Sell shipyard courier (twice). Shop → Shipyard → green land → namespace ${NS}, name courier, port 80, CPU LIMIT 200m, MEM LIMIT 128Mi, readiness /ready, liveness /healthz, GRACE 10, BUILD.`,
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => {
          const name = lookoutsShipyard(ctx.store, NS);
          const d = name ? ctx.store.deployments.get(nsKey(NS, name)) : undefined;
          if (d && d.limits && d.gracePeriod === 10) yard = name!;
          return !!yard;
        },
      },
      {
        id: 'again',
        onEnter: () => {
          selection.clear();
          setTimeout(() => drain('harbor-worker'), 1000);
          const t = ctx.store.pods.get(traderKey);
          if (t) ctx.play([{ at: 2800, msg: podEvent(t, 'Normal', 'Resolved', 'courier beam swung to the new ship; delivery continues') }]);
        },
        title: 'Drain it again',
        text: 'The island is drained a second time. The ship stops gracefully, the lookouts keep traders away until the new ship is ready, the beam swings, and the trader never notices. The tanker comes back as ledger-db-0 with its tank, as before.',
        anchor: { kind: 'map', key: 'dock:harbor-worker', placement: 'bottom' },
        waitFor: () => ctx.store.pods.get(traderKey)?.ready === true && readyShips(ctx.store, NS, yard || 'courier') >= 1 && [...ctx.store.pods.values()].every((p) => p.ns !== NS || p.node !== 'harbor-worker' || !p.ready),
      },
      {
        id: 'lesson',
        onEnter: () => undrain('harbor-worker'),
        title: 'Cattle, not pets',
        text: 'Pods get new IPs and nodes go away, so the platform offers stable abstractions on top: Services for network identity, PersistentVolumeClaims for storage that outlives a pod, StatefulSets when identity truly matters. Your side of the bargain: health probes, graceful shutdown, requests and limits, and no state inside the pod.',
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: (store) => {
    const d = [...store.deployments.values()].find((x) => x.name === 'courier' && x.limits);
    const req = { ns: d?.ns ?? 'harbor', name: 'courier', image: d?.image ?? 'ghcr.io/example/courier:1.0', replicas: d?.replicas ?? 1, port: 80, readinessPath: '/ready', livenessPath: '/healthz', cpuLimit: '200m', memLimit: '128Mi', terminationGracePeriodSeconds: 10 };
    return {
      naval: 'A trader that held a ship\'s own address was lost when the island drained; the tanker came back as ledger-db-0 with its tank. A lighthouse gave the fleet a stable name, and a rebuilt shipyard with lookouts, limits and a grace period made the next drain invisible.',
      kubernetes: 'Pods are ephemeral and their IPs change; nodes are drained and replaced. Services give stable DNS and IPs, PersistentVolumeClaims keep data past any pod, StatefulSets keep names and volumes per ordinal. Apps must tolerate replacement: readiness and liveness probes, SIGTERM handling within terminationGracePeriodSeconds, resource requests and limits, no local state.',
      devops: 'A cluster upgrade drained every node in turn. Services that followed the rules rolled through unnoticed; one that cached state in the pod and hard-coded a peer IP lost data and paged the on-call. The fix was the checklist, not the upgrade.',
      manifest: deploymentYaml(req),
      kubectl: `kubectl drain harbor-worker --ignore-daemonsets --delete-emptydir-data\nkubectl get pods -n ${req.ns} -o wide -w     # new names, new IPs, new nodes\nkubectl get pvc -n ${req.ns}               # the tank stays Bound\nkubectl uncordon harbor-worker`,
    };
  },
};
