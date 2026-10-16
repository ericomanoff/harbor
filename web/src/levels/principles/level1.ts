import { selection } from '../../app';
import { ledger } from '../../game/ledger';
import { nsKey, type Pod } from '../../store/cluster';
import { as } from '../../tour/training';
import { academyHarbor, lighthouse, podEvent, shipyard } from '../advanced/fixture';
import { readyShips, relaunched } from '../goals';
import { deploymentYaml } from '../manifest';
import type { Level } from '../types';

const overlayOpen = (id: string): boolean => document.getElementById(id)?.hidden === false;
const applies = (): number => ledger.entries.filter((e) => e.dir === 'request' && e.what === 'POST /api/apply').length;

export const MANIFEST = (replicas: number): string => deploymentYaml({ ns: 'harbor', name: 'courier', image: 'ghcr.io/example/courier:1.0', replicas, port: 80 }).replace(/ +#.*$/gm, '');

/** Principle 1: declarative desired state, stored in one place. */
export const level1: Level = {
  id: 'principles/1',
  number: 1,
  title: "The harbor master's ledger",
  concept: 'Declarative desired state, stored in one place',
  terms: ['desired-state', 'spec', 'status', 'apply', 'etcd', 'gitops'],
  parSeconds: 360,
  fixture: () => {
    const y = shipyard('courier', 3);
    return academyHarbor({ deployments: [y.deployment], pods: y.pods, services: [lighthouse('courier', 'courier')] });
  },
  steps: (ctx) => {
    const NS = ctx.ns;
    const yard = nsKey(NS, 'courier');
    let baseline = 0;
    let sunk = '';
    const extra = (): Pod => ({ ns: NS, name: 'courier-by-hand', node: 'harbor-worker', phase: 'Running', ready: true, restarts: 0, created: new Date().toISOString(), labels: { app: 'courier-by-hand' }, containers: ['courier'] });
    return [
      {
        id: 'papers',
        onEnter: () => selection.clear(),
        title: 'Two documents, one object',
        text: 'Every object in Kubernetes is a record with two halves: spec, what you asked for, and status, what the cluster reports. Select the courier shipyard and open its Papers to see both.',
        cta: 'Select the courier shipyard and press Papers',
        hint: 'Click the shipyard on the harbor-worker island, then the Papers button on its card.',
        anchor: { kind: 'map', key: `b:${yard}`, placement: 'bottom' },
        waitFor: () => overlayOpen('papers'),
      },
      {
        id: 'read',
        title: 'spec and status agree',
        text: 'spec.replicas says 3; status.availableReplicas says 3. The record is stored in the API server (in etcd); nothing else holds the truth. Close the papers when you have seen both columns.',
        anchor: { kind: 'dom', selector: '#papers .panel', placement: 'left' },
        waitFor: () => !overlayOpen('papers'),
      },
      {
        id: 'imperative',
        onEnter: () => {
          const p = extra();
          as('you', () => ctx.store.apply({ type: 'modified', kind: 'Pod', obj: p }));
          ctx.play([{ at: 2500, msg: podEvent(p, 'Warning', 'Reef', 'courier-by-hand struck the reef') }, { at: 2600, msg: { type: 'deleted', kind: 'Pod', obj: p } }]);
        },
        title: 'An order, not a record',
        text: 'The old way: the harbor master shouts "one more ship!" and a ship is launched by hand. Nothing wrote that wish down. Watch what happens when the reef takes it: nobody rebuilds it, because no record says it should exist.',
        anchor: { kind: 'map', key: `u:${nsKey(NS, 'courier-by-hand')}`, placement: 'top' },
        waitFor: () => !ctx.store.pods.has(nsKey(NS, 'courier-by-hand')),
      },
      {
        id: 'apply4',
        onEnter: () => { baseline = applies(); },
        title: 'Write the wish down',
        text: 'Now the Kubernetes way: declare what should exist. Open the Shop, pick Apply manifest, and apply the courier shipyard with replicas: 4. The manifest is already filled in; change the number and press APPLY.',
        cta: 'Apply the manifest with replicas: 4',
        hint: 'Shop → Apply manifest → change replicas to 4 → APPLY. Preview first if you like: it shows the diff.',
        action: { label: 'Open Apply manifest', run: async () => { const { openApplyForm } = await import('../../ui/applyForm'); openApplyForm({ manifest: MANIFEST(3) }); } },
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => applies() > baseline && (ctx.store.deployments.get(yard)?.replicas ?? 0) === 4,
      },
      {
        id: 'watch',
        title: 'spec leads, status follows',
        text: 'You wrote a record; the cluster is catching up. Open the Papers again: spec.replicas is 4 at once, status.availableReplicas climbs to 4 when the fourth ship moors. The record changed first; the harbor followed.',
        cta: 'Open Papers and watch status reach 4',
        anchor: { kind: 'map', key: `b:${yard}`, placement: 'bottom' },
        waitFor: () => readyShips(ctx.store, NS, 'courier') >= 4 && overlayOpen('papers'),
      },
      {
        id: 'again',
        onEnter: () => { baseline = applies(); },
        title: 'Apply it again',
        text: 'Apply the very same manifest a second time. Nothing changes, and the harbor master says so: apply is idempotent. You can run it a hundred times; the record stays the record.',
        cta: 'Apply the same manifest again (expect "unchanged")',
        hint: 'Shop → Apply manifest, leave replicas at 4, APPLY.',
        action: { label: 'Open Apply manifest', run: async () => { const { openApplyForm } = await import('../../ui/applyForm'); openApplyForm({ manifest: MANIFEST(4) }); } },
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => applies() > baseline && (ctx.store.deployments.get(yard)?.replicas ?? 0) === 4 && !overlayOpen('apply-form'),
      },
      {
        id: 'apply2',
        onEnter: () => { baseline = applies(); },
        title: 'Change the record, not the ships',
        text: 'To have fewer ships you do not scrap ships; you change the record. Apply replicas: 2 and watch two ships retire. Every change so far was one write to the API server; the ledger has them all.',
        cta: 'Apply the manifest with replicas: 2',
        action: { label: 'Open Apply manifest', run: async () => { const { openApplyForm } = await import('../../ui/applyForm'); openApplyForm({ manifest: MANIFEST(4) }); } },
        anchor: { kind: 'dom', selector: '#hud [data-rail=ledger]', placement: 'right' },
        waitFor: () => applies() > baseline && (ctx.store.deployments.get(yard)?.replicas ?? 0) === 2 && readyShips(ctx.store, NS, 'courier') <= 2,
      },
      {
        id: 'replay',
        onEnter: () => {
          selection.clear();
          const ship = [...ctx.store.pods.values()].find((p) => p.ns === NS && p.deployment === 'courier' && p.ready);
          if (!ship) return;
          sunk = ship.name;
          ctx.play([{ at: 1200, msg: podEvent(ship, 'Warning', 'Reef', `${ship.name} struck the reef`) }]);
          setTimeout(() => ctx.sink(ship), 1500);
        },
        title: 'The record outlives the ship',
        text: 'The reef again. Status drops to 1 while spec still says 2, and a ship is launched to close the gap. The record, not the command, is what persists.',
        anchor: { kind: 'map', key: `unit-of:${NS}/courier`, placement: 'top' },
        waitFor: () => !!sunk && relaunched(ctx.store, NS, 'courier', sunk),
      },
      {
        id: 'lesson',
        title: 'Your manifests are the desired state',
        text: 'You never told Kubernetes to do anything; you wrote what should exist and it kept the harbor matching. That is why a repository of manifests, applied on every change, can be the whole deployment system: GitOps falls straight out of this principle.',
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: (store) => {
    const d = [...store.deployments.values()].find((x) => x.name === 'courier');
    const req = { ns: d?.ns ?? 'harbor', name: 'courier', image: d?.image ?? 'ghcr.io/example/courier:1.0', replicas: d?.replicas ?? 2, port: 80 };
    return {
      naval: 'The courier shipyard has a record in the harbor master\'s ledger: spec says how many ships should exist, status says how many do. Orders shouted by hand are forgotten; the record is kept and the harbor keeps matching it.',
      kubernetes: 'Every object has spec (desired) and status (observed), stored by the API server in etcd. kubectl apply writes the desired state; applying the same manifest again changes nothing. Controllers move status toward spec; you never issue commands, you update the record.',
      devops: 'A team kept its manifests in a Git repository and ran apply from CI on every merge. When a node died at night the Deployment relaunched the pods; when someone hand-edited a replica count, the next apply put it back. The repository was the source of truth, not the cluster.',
      manifest: deploymentYaml(req),
      kubectl: `kubectl apply -f courier.yaml        # write the desired state (idempotent)\nkubectl diff -f courier.yaml         # what would change\nkubectl get deploy courier -n ${req.ns} -o yaml   # spec and status, one object`,
    };
  },
};
