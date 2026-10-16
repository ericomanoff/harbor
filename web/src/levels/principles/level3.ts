import { mode, selection } from '../../app';
import { ledger } from '../../game/ledger';
import { nsKey } from '../../store/cluster';
import { as, simulate } from '../../tour/training';
import { academyHarbor, lighthouse, shipyard } from '../advanced/fixture';
import { readyShips, shipyardAfloat } from '../goals';
import type { Level } from '../types';

const overlayOpen = (id: string): boolean => document.getElementById(id)?.hidden === false;
const actors = (): Set<string> => new Set(ledger.entries.filter((e) => e.dir === 'change').map((e) => e.who));

/** Principle 3: everything talks only through the API server. */
export const level3: Level = {
  id: 'principles/3',
  number: 3,
  title: 'One door',
  concept: 'Everything talks only through the API server',
  terms: ['harbor-master', 'crd', 'operator', 'api-client'],
  parSeconds: 360,
  fixture: () => academyHarbor({ services: [lighthouse('courier', 'courier')] }),
  steps: (ctx) => {
    const NS = ctx.ns;
    // The tide table: a custom resource, and the tide keeper that reads it.
    const tide = { highWater: 3, keeper: false, applied: 0 };
    let keeperTimer: ReturnType<typeof setInterval> | undefined;
    const keep = (): void => {
      if (!tide.keeper) return;
      const dep = ctx.store.deployments.get(nsKey(NS, 'courier'));
      if (!dep || dep.replicas === tide.highWater) return;
      ledger.add({ who: 'the tide keeper', what: `loop: TideTable highWater ${tide.highWater}, courier replicas ${dep.replicas}, scale`, dir: 'change' });
      as('the tide keeper', () => simulate('PATCH', `/api/deployments/${NS}/courier/scale`, { replicas: tide.highWater }));
    };
    const stopKeeper = (): void => { if (keeperTimer) clearInterval(keeperTimer); keeperTimer = undefined; };
    const papersOfTide = (): string => `apiVersion: harbor.dev/v1\nkind: TideTable\nmetadata:\n  name: courier-tide\n  namespace: ${NS}\nspec:\n  shipyard: courier\n  highWater: ${tide.highWater}\nstatus:\n  keeper: ${tide.keeper ? 'posted' : 'none'}`;
    return [
      {
        id: 'build',
        onEnter: () => { selection.clear(); ledger.clear(); },
        title: 'Watch who writes',
        text: 'Build a courier shipyard (Shop, Shipyard, a site, name courier, fleet harbor) and keep an eye on the ledger. You will write once. Then other hands write: the Deployment controller creates ships, the scheduler picks their islands, the kubelet reports them running.',
        cta: 'Build shipyard courier in fleet harbor',
        hint: `Shop → Shipyard → click green land → namespace ${NS}, name courier, BUILD.`,
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => shipyardAfloat(ctx.store, NS) === 'courier' && mode.current !== 'place',
      },
      {
        id: 'ledger',
        title: 'Four hands, one door',
        text: 'Open the Ledger. Your POST, then entries by the Deployment controller, the scheduler and the kubelet. None of them called another: each read the API server and wrote to it. That is the only door, and every actor uses the same one.',
        cta: 'Open the Ledger and find all four writers',
        anchor: { kind: 'dom', selector: '#hud [data-rail=ledger]', placement: 'right' },
        waitFor: () => overlayOpen('ledger') && ['you', 'the Deployment controller', 'the scheduler', 'the kubelet'].every((a) => actors().has(a)),
      },
      {
        id: 'crd',
        onEnter: () => { ledger.add({ who: 'you', what: 'POST /apis/harbor.dev/v1/tidetables (a kind the API server was just taught)', dir: 'request' }); },
        title: 'A kind of your own',
        text: 'Because there is one door, you can teach the API server a new kind and it will store it like any other. Here is a TideTable: spec.highWater says how many courier ships the tide needs. Read its papers. Nothing happens: no controller watches TideTables yet.',
        action: { label: 'Papers of the TideTable', run: async () => ({ ok: true, message: papersOfTide() }) },
        anchor: { kind: 'none' },
      },
      {
        id: 'keeper',
        title: 'Post a tide keeper',
        text: 'A tide keeper is a controller for TideTables: it loops, reads highWater, and scales the courier shipyard to match. A CRD plus a controller is called an operator, and it uses exactly the mechanism a Deployment uses. Post one.',
        cta: 'Press Post a tide keeper',
        action: { label: 'Post a tide keeper', run: async () => { tide.keeper = true; stopKeeper(); keeperTimer = setInterval(keep, 1200); keep(); return { ok: true, message: 'tide keeper posted: watching TideTables' }; } },
        anchor: { kind: 'none' },
        waitFor: () => tide.keeper && (ctx.store.deployments.get(nsKey(NS, 'courier'))?.replicas ?? 0) === 3 && readyShips(ctx.store, NS, 'courier') >= 3,
      },
      {
        id: 'edit',
        title: 'Change the tide',
        text: 'Raise highWater to 5. You write to the TideTable only; the tide keeper reads it and writes to the Deployment; the Deployment controller launches ships. Three hands, one door, and you only touched your own kind.',
        cta: 'Set highWater to 5 and watch five ships moor',
        action: { label: 'Set highWater: 5', run: async () => { tide.highWater = 5; tide.applied++; ledger.add({ who: 'you', what: 'PATCH TideTable courier-tide highWater=5', dir: 'request' }); return { ok: true, message: papersOfTide() }; } },
        anchor: { kind: 'map', key: `b:${nsKey(NS, 'courier')}`, placement: 'bottom' },
        waitFor: () => tide.highWater === 5 && readyShips(ctx.store, NS, 'courier') >= 5,
      },
      {
        id: 'dismiss',
        title: 'Dismiss the keeper',
        text: 'Dismiss the tide keeper, then set highWater to 2. The TideTable is stored, your write succeeded, and nothing moves: a record with no controller is just a record. Post the keeper again and the gap closes.',
        cta: 'Dismiss, set highWater 2, post again',
        action: { label: tide.keeper ? 'Dismiss the tide keeper' : 'Post a tide keeper', run: async () => {
          if (tide.keeper) { tide.keeper = false; stopKeeper(); tide.highWater = 2; ledger.add({ who: 'you', what: 'PATCH TideTable courier-tide highWater=2 (no keeper listening)', dir: 'request' }); return { ok: true, message: 'keeper dismissed; highWater set to 2; nothing moves. Press again to post the keeper.' }; }
          tide.keeper = true; keeperTimer = setInterval(keep, 1200); keep(); return { ok: true, message: 'tide keeper posted again' };
        } },
        anchor: { kind: 'map', key: `b:${nsKey(NS, 'courier')}`, placement: 'bottom' },
        waitFor: () => tide.keeper && tide.highWater === 2 && (ctx.store.deployments.get(nsKey(NS, 'courier'))?.replicas ?? 0) === 2,
      },
      {
        id: 'lesson',
        onEnter: () => stopKeeper(),
        onLeave: () => stopKeeper(),
        title: 'Extensible by construction',
        text: 'The scheduler, the kubelet, every controller, kubectl, your CI pipeline and this harbor are all API clients. Nothing calls anything else directly. Add a kind (a CRD) and a loop (a controller) and you have an operator that is as first-class as Deployments.',
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: () => ({
    naval: 'You wrote once; the Deployment controller, the scheduler and the kubelet each wrote through the same door. A TideTable, a kind the harbor master was just taught, sat idle until a tide keeper looped over it; then your writes to the tide moved the fleet.',
    kubernetes: 'The API server is the only way in: every component and every tool reads and writes objects through it, and etcd behind it is the only store. CustomResourceDefinitions add kinds; a controller watching them makes an operator. Deployments work the same way, which is why operators are first-class.',
    devops: 'A team needed per-tenant databases. Instead of a provisioning script nobody could re-run safely, they wrote a Database CRD and a small operator that reconciles it. Creating a tenant became kubectl apply of one object, and the same GitOps pipeline that deploys apps now deploys databases.',
    manifest: 'apiVersion: harbor.dev/v1\nkind: TideTable            # a custom resource\nmetadata:\n  name: courier-tide\n  namespace: harbor\nspec:\n  shipyard: courier\n  highWater: 5             # the tide keeper reconciles courier replicas to this',
    kubectl: 'kubectl api-resources            # every kind the API server knows, built in or added\nkubectl get crd                  # the kinds that were added\nkubectl explain tidetable.spec   # the schema of a custom kind\nkubectl get --raw /apis/apps/v1  # the same door kubectl uses',
  }),
};
