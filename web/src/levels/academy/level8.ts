import { selection } from '../../app';
import { nsKey, type Pod } from '../../store/cluster';
import { cappedShipyard } from '../goals';
import { deploymentYaml } from '../manifest';
import type { Level, ScriptedMessage } from '../types';
import { academyHarbor, podEvent, shipyard } from './fixture';

const overlayOpen = (id: string): boolean => document.getElementById(id)?.hidden === false;

/** Level 8: requests reserve a berth, limits cap the cargo. */
export const level8: Level = {
  id: 'academy/8',
  number: 8,
  title: 'Berths and cargo',
  concept: 'Resource requests and limits',
  terms: ['berths', 'cargo-bar', 'limits', 'greedy', 'pending'],
  parSeconds: 240,
  fixture: () => {
    const hog = shipyard('hog', 1, { image: 'ghcr.io/example/miner:latest' });
    delete (hog.deployment as { requests?: string }).requests;
    const courier = shipyard('courier', 1);
    const waiting: Pod = { ...courier.pods[0]!, node: '', phase: 'Pending', ready: false };
    const snap = academyHarbor({ deployments: [hog.deployment, courier.deployment], pods: [...hog.pods, waiting] });
    // The hog has taken every berth on the worker island; the control plane is full of its own tugs.
    snap.nodes = [
      { name: 'harbor-control-plane', ready: true, cpuAlloc: 2000, memAlloc: 4 * 1024 ** 3, cpuReq: 1900, memReq: 3.5 * 1024 ** 3, labels: {} },
      { name: 'harbor-worker', ready: true, cpuAlloc: 2000, memAlloc: 4 * 1024 ** 3, cpuReq: 2000, memReq: 4 * 1024 ** 3, labels: {} },
    ];
    return snap;
  },
  steps: (ctx) => {
    const hogKey = nsKey('harbor', 'hog');
    const node = (cpuReq: number, memReq: number): ScriptedMessage['msg'] => ({ type: 'modified', kind: 'Node', obj: { name: 'harbor-worker', ready: true, cpuAlloc: 2000, memAlloc: 4 * 1024 ** 3, cpuReq, memReq, labels: {} } });
    let yard = '';
    return [
      {
        id: 'intro',
        onEnter: () => {
          selection.clear();
          const c = ctx.store.pods.get(nsKey('harbor', 'courier-a'));
          if (c) ctx.play([{ at: 1000, msg: podEvent(c, 'Warning', 'FailedScheduling', '0/2 docks have a free berth: insufficient cpu, insufficient memory') }]);
        },
        title: 'A greedy ship',
        text: 'The hog sets no requests and no limits, so it grabs every berth and all the cargo space on the harbor-worker island. The courier waits in the open sea, Pending: no dock has a berth left for it. Look at BERTHS and CARGO, top right.',
        anchor: { kind: 'map', key: 'unit-of:harbor/courier', placement: 'top' },
      },
      {
        id: 'oom',
        onEnter: () => {
          const h = ctx.store.pods.get(nsKey('harbor', 'hog-a'));
          if (!h) return;
          ctx.play([
            { at: 500, msg: podEvent(h, 'Warning', 'OOMKilled', 'hog used all 4 GiB on the dock and was sunk by the harbor') },
            { at: 600, msg: { type: 'modified', kind: 'Pod', obj: { ...h, ready: false, reason: 'OOMKilled', restarts: h.restarts + 1 } } },
            { at: 3200, msg: { type: 'modified', kind: 'Pod', obj: { ...h, ready: true, restarts: h.restarts + 1 } } },
          ]);
        },
        title: 'Overloaded and sunk',
        text: 'Worse: with no cap on its cargo the hog just took every byte of memory on the dock and the harbor sank it (OOMKilled). It relaunches, grabs everything again, and the cycle repeats while the courier still waits.',
        anchor: { kind: 'map', key: 'unit-of:harbor/hog', placement: 'top' },
      },
      {
        id: 'sell',
        onEnter: () => selection.clear(),
        title: 'Retire the hog',
        text: 'Requests and limits are part of the ship design, so they live on the shipyard. Sell the hog shipyard first; you will rebuild it with a fair berth.',
        cta: 'Sell the hog shipyard',
        hint: 'Click the hog shipyard on the harbor-worker island, press Sell shipyard, then press it again to confirm.',
        anchor: { kind: 'map', key: `b:${hogKey}`, placement: 'bottom' },
        waitFor: () => !ctx.store.deployments.has(hogKey),
      },
      {
        id: 'berth',
        onEnter: () => {
          const c = ctx.store.pods.get(nsKey('harbor', 'courier-a'));
          const script: ScriptedMessage[] = [{ at: 300, msg: node(50, 64 * 1024 ** 2) }];
          if (c) {
            script.push({ at: 900, msg: podEvent(c, 'Normal', 'Scheduled', 'berth found on harbor-worker') });
            script.push({ at: 1000, msg: { type: 'modified', kind: 'Pod', obj: { ...c, node: 'harbor-worker', phase: 'Running', ready: true } } });
          }
          ctx.play(script);
        },
        title: 'The courier moors',
        text: 'With the hog gone the berths are free and the courier is scheduled at once. Now rebuild the hog so it can only take its share: Shop, Shipyard, a site, then the form.',
        cta: 'Open the Shop and build a shipyard',
        hint: 'Shop → Shipyard → click green land on an island.',
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => overlayOpen('build-form'),
      },
      {
        id: 'form',
        title: 'A fair berth and a cargo cap',
        text: 'Name hog. CPU/UNIT 250m and MEM/UNIT 64Mi are the requests: the berth the scheduler reserves. CPU LIMIT 500m and MEM LIMIT 128Mi are the cap: more CPU is throttled, more memory is sunk, and only this ship pays for it.',
        cta: 'Set requests and limits, then BUILD',
        hint: 'Namespace harbor, name hog, CPU 250m, MEM 64Mi, CPU LIMIT 500m, MEM LIMIT 128Mi.',
        anchor: { kind: 'dom', selector: '#build-form .panel', placement: 'left' },
        waitFor: () => {
          const name = cappedShipyard(ctx.store, 'harbor');
          if (name) yard = name;
          return !!name;
        },
      },
      {
        id: 'again',
        onEnter: () => {
          selection.clear();
          const h = [...ctx.store.pods.values()].find((p) => p.ns === 'harbor' && p.deployment === yard && p.ready);
          if (!h) return;
          ctx.play([
            { at: 400, msg: node(300, 128 * 1024 ** 2) },
            { at: 1200, msg: podEvent(h, 'Normal', 'Throttled', `${h.name} hit its cpu limit; slowed, the dock stays calm`) },
            { at: 3000, msg: podEvent(h, 'Warning', 'OOMKilled', `${h.name} went past its memory limit and was restarted; the courier never noticed`) },
            { at: 3100, msg: { type: 'modified', kind: 'Pod', obj: { ...h, ready: false, reason: 'OOMKilled', restarts: h.restarts + 1 } } },
            { at: 5000, msg: { type: 'modified', kind: 'Pod', obj: { ...h, ready: true, restarts: h.restarts + 1 } } },
          ]);
        },
        title: 'The hog tries again',
        text: 'The rebuilt hog tries to grab everything. Its CPU is throttled at the limit, and when it goes past its memory limit only it is restarted; the courier keeps its berth, the dock stays up. The bars show both ships fitting.',
        anchor: { kind: 'map', key: `unit-of:harbor/${yard || 'hog'}`, placement: 'top' },
      },
      {
        id: 'lesson',
        title: 'Requests and limits',
        text: 'Requests are what the scheduler reserves for you: set them honestly and your pod always finds a node that can hold it. Limits are the most you may use: CPU over the limit is throttled, memory over the limit is OOM-killed. Set both; a LimitRange can set defaults for a whole namespace.',
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: (store) => {
    const d = [...store.deployments.values()].find((x) => x.ns === 'harbor' && x.limits);
    const pick = (s: string | undefined, what: 'cpu' | 'mem', dflt: string): string => s?.match(new RegExp(`${what} (\\S+)`))?.[1] ?? dflt;
    const req = { ns: 'harbor', name: d?.name ?? 'hog', image: d?.image ?? 'ghcr.io/example/miner:latest', replicas: d?.replicas ?? 1, cpuRequest: pick(d?.requests, 'cpu', '250m'), memRequest: pick(d?.requests, 'mem', '64Mi'), cpuLimit: pick(d?.limits, 'cpu', '500m'), memLimit: pick(d?.limits, 'mem', '128Mi') };
    return {
      naval: `The ${req.name} shipyard now reserves a berth of ${req.cpuRequest} CPU and ${req.memRequest} per ship and caps its cargo at ${req.cpuLimit} and ${req.memLimit}. The courier got its berth back and keeps it.`,
      kubernetes: 'requests are used for scheduling (node allocatable minus requests must fit) and for fair CPU shares; limits are enforced by the kubelet: CPU is throttled, memory is OOM-killed. A pod with requests equal to limits is Guaranteed; with none it is BestEffort and first to be evicted.',
      devops: 'A batch job with no limits ate a node\'s memory every night and took the API down with it. Requests got the API a guaranteed berth; limits on the job made it the only thing that died when it misbehaved.',
      manifest: deploymentYaml(req),
      kubectl: `kubectl set resources deployment/${req.name} --requests=cpu=${req.cpuRequest},memory=${req.memRequest} --limits=cpu=${req.cpuLimit},memory=${req.memLimit} -n harbor\nkubectl describe node harbor-worker | grep -A6 'Allocated resources'\nkubectl top pods -n harbor   # needs metrics-server`,
    };
  },
};
