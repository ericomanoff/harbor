import { mode, selection } from '../../app';
import { nsKey } from '../../store/cluster';
import { academyHarbor, lighthouse, podEvent, shipyard } from '../advanced/fixture';
import { crashShips, lighthouseAimedAt, readyShips, shipsWithLabels } from '../goals';
import type { Level } from '../types';

const overlayOpen = (id: string): boolean => document.getElementById(id)?.hidden === false;

/** Principle 4: small composable primitives, loosely joined by labels. */
export const level4: Level = {
  id: 'principles/4',
  number: 4,
  title: 'Ensigns, not ropes',
  concept: 'Small composable primitives, loosely joined by labels',
  terms: ['label', 'beam', 'owner-reference', 'canary', 'blue-green', 'launch-queue'],
  parSeconds: 420,
  fixture: () => {
    const y = shipyard('courier', 3);
    return academyHarbor({ deployments: [y.deployment], pods: y.pods, services: [lighthouse('courier', 'courier')] });
  },
  steps: (ctx) => {
    const NS = ctx.ns;
    const yard = nsKey(NS, 'courier');
    const beam = nsKey(NS, 'courier');
    let relabelled = '';
    let before: string[] = [];
    return [
      {
        id: 'papers',
        onEnter: () => selection.clear(),
        title: 'Who holds whom',
        text: 'Open a courier ship\'s Papers. Its metadata has ownerReferences: a ReplicaSet owns it. Now open the lighthouse\'s Papers: spec.selector names labels, and there is no list of ships at all. The shipyard holds its ships by a rope; the lighthouse only reads ensigns.',
        cta: 'Read the Papers of a ship, then of the courier lighthouse',
        hint: 'Click a courier ship, press Papers, close; click the lighthouse, press Papers.',
        anchor: { kind: 'map', key: `s:${beam}`, placement: 'top' },
        waitFor: () => overlayOpen('papers') && document.querySelector('#papers h2 .obj')?.textContent?.startsWith('Service') === true,
      },
      {
        id: 'relabel',
        onEnter: () => { before = [...ctx.store.pods.values()].filter((p) => p.ns === NS && p.deployment === 'courier').map((p) => p.name); },
        title: 'Change one ensign',
        text: 'Pick one courier ship and change its ensign from app=courier to app=retired. Watch two things happen at once: the beam drops it, and the shipyard launches a replacement. Nothing was cut loose; a label changed and two selectors re-evaluated.',
        cta: 'Change a courier ship\'s ensign to app=retired',
        hint: 'Click a courier ship, press Change ensign, type app=retired, HOIST.',
        anchor: { kind: 'map', key: `unit-of:${NS}/courier`, placement: 'top' },
        waitFor: () => {
          const orphan = [...ctx.store.pods.values()].find((p) => p.ns === NS && p.labels['app'] === 'retired');
          if (orphan) relabelled = orphan.name;
          return !!orphan && !orphan.deployment && readyShips(ctx.store, NS, 'courier') >= 3 && [...ctx.store.pods.values()].some((p) => p.ns === NS && p.deployment === 'courier' && !before.includes(p.name));
        },
      },
      {
        id: 'orphan',
        title: 'An orphan tells a story',
        text: `${relabelled || 'The relabelled ship'} sails on alone: no shipyard owns it, no beam reaches it, and it costs a berth. On a real cluster an orphan pod like this is a debugging tell: a label got changed by hand. Scrap it.`,
        cta: 'Scrap the retired ship',
        hint: 'Click the retired ship and press Scrap ship twice (it has no shipyard, so it just goes).',
        anchor: { kind: 'map', key: `u:${nsKey(NS, relabelled || 'courier-a')}`, placement: 'top' },
        waitFor: () => !!relabelled && !ctx.store.pods.has(nsKey(NS, relabelled)),
      },
      {
        id: 'canary',
        onEnter: () => selection.clear(),
        title: 'A canary by ensign',
        text: 'Because the beam reads ensigns, a second shipyard can sail under the same one. Build courier-canary with 1 unit and EXTRA ENSIGN track=canary; its ships fly app=courier-canary, so also give them app=courier? No: the beam wants app=courier, and app is the shipyard\'s own name. Use the lighthouse\'s other key instead: re-aim the beam to track=stable, then launch the canary with track=canary.',
        cta: 'Re-aim the courier beam to track=stable',
        hint: 'Click the lighthouse, press Re-aim beam, type track=stable, RE-AIM. The beam will reach nobody for a moment.',
        anchor: { kind: 'map', key: `s:${beam}`, placement: 'bottom' },
        waitFor: () => lighthouseAimedAt(ctx.store, NS, { track: 'stable' }) === 'courier',
      },
      {
        id: 'stable',
        title: 'Hoist the stable ensign',
        text: 'The beam reaches nobody: no ship flies track=stable yet. Change the courier shipyard\'s ensign (the labels it paints on new ships) to add track=stable, then refit it so the ships are rebuilt with the new ensign.',
        cta: 'Shipyard courier: Change ensign track=stable, then Refit',
        hint: 'Click the courier shipyard → Change ensign → app=courier, track=stable → HOIST. Then Refit shipyard with the same image: the rollout repaints every ship.',
        anchor: { kind: 'map', key: `b:${yard}`, placement: 'bottom' },
        waitFor: () => shipsWithLabels(ctx.store, NS, { app: 'courier', track: 'stable' }) >= 3,
      },
      {
        id: 'launch-canary',
        onEnter: () => { mode.set('idle'); selection.clear(); },
        title: 'Launch the canary',
        text: 'Now build shipyard courier-canary: 1 unit, EXTRA ENSIGN track=stable. Its ship flies track=stable too, so the beam reaches 4 ships and a quarter of the traders try the canary. Same lighthouse, same shipyards, no new primitive.',
        cta: 'Build courier-canary (1 unit, extra ensign track=stable)',
        hint: `Shop → Shipyard → green land → namespace ${NS}, name courier-canary, units 1, EXTRA ENSIGN track=stable, BUILD.`,
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => shipsWithLabels(ctx.store, NS, { app: 'courier-canary', track: 'stable' }) >= 1 && readyShips(ctx.store, NS, 'courier') >= 3,
      },
      {
        id: 'bad-canary',
        onEnter: () => {
          selection.clear();
          const c = [...ctx.store.pods.values()].find((p) => p.ns === NS && p.deployment === 'courier-canary');
          if (c) ctx.play([{ at: 600, msg: podEvent(c, 'Warning', 'Canary', 'the canary refit is next; only it will burn') }]);
        },
        title: 'When the canary burns',
        text: 'Refit courier-canary to a broken image (anything ending :broken). Only the canary catches fire; the beam still has three good ships, and the traders mostly never notice. Then roll the canary back.',
        cta: 'Refit courier-canary to a :broken image, then Roll back refit',
        hint: 'Click courier-canary → Refit shipyard → image ghcr.io/example/courier:broken → REFIT. Watch it burn, then Roll back refit (press twice).',
        anchor: { kind: 'map', key: `b:${nsKey(NS, 'courier-canary')}`, placement: 'bottom' },
        waitFor: () => (ctx.store.deployments.get(nsKey(NS, 'courier-canary'))?.revision ?? 1) >= 3 && crashShips(ctx.store, NS, 'courier-canary') === 0 && readyShips(ctx.store, NS, 'courier-canary') >= 1,
      },
      {
        id: 'bluegreen',
        onEnter: () => selection.clear(),
        title: 'Blue and green',
        text: 'One more shape from the same bricks: re-aim the beam to track=canary. Every trader now goes to the canary and none to the old fleet: that is a blue/green switch, done by changing one selector. Re-aim it back to track=stable to switch back.',
        cta: 'Re-aim the courier beam to track=canary, then back to track=stable',
        hint: 'Lighthouse → Re-aim beam → track=canary → RE-AIM; then again with track=stable.',
        anchor: { kind: 'map', key: `s:${beam}`, placement: 'bottom' },
        waitFor: (() => { let flipped = false; return () => { if (lighthouseAimedAt(ctx.store, NS, { track: 'canary' })) flipped = true; return flipped && lighthouseAimedAt(ctx.store, NS, { track: 'stable' }) === 'courier'; }; })(),
      },
      {
        id: 'lesson',
        title: 'Loosely joined',
        text: 'A Deployment owns ReplicaSets, which own Pods: that is a rope (ownerReferences). A Service owns nothing; it selects by label. Composition through labels, not hard references, is why rolling updates, canaries and blue/green all come from the same three primitives.',
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: () => ({
    naval: 'Changing one ship\'s ensign dropped it from the beam and made the shipyard launch another. A canary shipyard sailed under the stable ensign and took a quarter of the traders; when it burned, the beam still had three good ships. Re-aiming the beam flipped every trader at once.',
    kubernetes: 'Deployments manage ReplicaSets manage Pods through ownerReferences; Services select Pods by label and own none. Because selection is by label, a second Deployment can join a Service (canary), a Service can be re-pointed by editing its selector (blue/green), and a rollout replaces pods one ReplicaSet at a time, all with the same objects.',
    devops: 'A team shipped a risky change to 1 of 4 replicas by giving a second Deployment the same labels and watching its error rate. When it misbehaved they scaled it to zero; traffic never left the stable pods. No mesh, no feature flags, just labels.',
    manifest: 'apiVersion: v1\nkind: Service\nmetadata:\n  name: courier\n  namespace: harbor\nspec:\n  selector:\n    track: stable          # whoever flies this ensign is in the beam\n  ports:\n    - port: 80\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: courier-canary\n  namespace: harbor\nspec:\n  replicas: 1\n  selector:\n    matchLabels:\n      app: courier-canary\n  template:\n    metadata:\n      labels:\n        app: courier-canary\n        track: stable        # joins the beam beside the stable fleet',
    kubectl: 'kubectl label pod courier-a app=retired --overwrite -n harbor   # watch the ReplicaSet replace it\nkubectl get endpoints courier -n harbor                            # the beam\nkubectl patch svc courier -n harbor -p \'{"spec":{"selector":{"track":"canary"}}}\'   # blue/green',
  }),
};
