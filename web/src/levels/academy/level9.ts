import { selection, settings } from '../../app';
import { nsKey, type Pod } from '../../store/cluster';
import { lighthouseFor, shipyardAfloat } from '../goals';
import type { Level, ScriptedMessage } from '../types';
import { academyHarbor, lighthouse, podEvent, shipyard } from './fixture';

const overlayOpen = (id: string): boolean => document.getElementById(id)?.hidden === false;

/** Level 9: namespaces separate crews; labels are the ensigns selectors read. */
export const level9: Level = {
  id: 'academy/9',
  number: 9,
  title: 'Fleets and ensigns',
  concept: 'Namespaces and labels',
  terms: ['ensign', 'lighthouse', 'beam', 'system-fleets'],
  parSeconds: 300,
  fixture: () => {
    const courier = shipyard('courier', 2);
    const ferry = shipyard('ferry', 1, { image: 'ghcr.io/example/ferry:3.1' });
    // The ferry crew copied the courier manifest and kept its ensign.
    const impostor: Pod[] = ferry.pods.map((p) => ({ ...p, labels: { app: 'courier' } }));
    return academyHarbor({ deployments: [courier.deployment, ferry.deployment], pods: [...courier.pods, ...impostor], services: [lighthouse('courier', 'courier')] });
  },
  steps: (ctx) => {
    const FLEET = 'ferry';
    let beacon = '';
    const ferryEvent = (type: 'Warning' | 'Normal', reason: string, message: string): ScriptedMessage['msg'] => ({ type: 'added', kind: 'Event', obj: { ns: 'harbor', kind: 'Service', name: 'courier', type, reason, message, ts: new Date().toISOString() } });
    return [
      {
        id: 'intro',
        onEnter: () => {
          selection.clear();
          ctx.play([{ at: 1000, msg: ferryEvent('Warning', 'WrongShip', 'a courier trader was sent to ferry-a: it flies the courier ensign') }, { at: 3500, msg: ferryEvent('Warning', 'WrongShip', 'another trader landed on the ferry; the beam cannot tell the crews apart') }]);
        },
        title: 'Two crews, one basin',
        text: 'The courier crew and the ferry crew share the harbor fleet. The ferry crew copied the courier manifest and kept its ensign, app=courier. The courier lighthouse reads ensigns, so its beam reaches the ferry too: traders for the courier end up on a ferry.',
        anchor: { kind: 'map', key: `s:${nsKey('harbor', 'courier')}`, placement: 'bottom' },
      },
      {
        id: 'shop',
        title: 'Found a fleet',
        text: 'Crews that must not be confused get their own fleet: a namespace. Names, ensigns and lighthouses live inside a fleet; a lighthouse in one fleet never reads ensigns in another. Found the ferry fleet from the Shop.',
        cta: 'Open the Shop',
        hint: 'The green Shop button is at the bottom left; New fleet is under Harbor.',
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => overlayOpen('shop'),
      },
      {
        id: 'card',
        title: 'New fleet',
        cta: 'Press Found on the New fleet card',
        text: 'The New fleet card creates a namespace.',
        anchor: { kind: 'dom', selector: '#shop [data-card=fleet-ns]', placement: 'top' },
        waitFor: () => overlayOpen('fleet-form'),
      },
      {
        id: 'found',
        title: 'Name the fleet',
        cta: 'Name it ferry and press FOUND',
        text: 'A fleet needs only a name. It gets its own ensign colour on the map.',
        hint: 'Type ferry and press FOUND.',
        anchor: { kind: 'dom', selector: '#fleet-form .panel', placement: 'left' },
        waitFor: () => ctx.store.namespaces.has(FLEET),
      },
      {
        id: 'move',
        onEnter: () => selection.clear(),
        title: 'Move the ferry crew',
        text: 'Build the ferry shipyard in its own fleet: Shop, Shipyard, a site, then NAMESPACE ferry and name ferry. Its ships will fly app=ferry, in the ferry fleet, where no courier lighthouse can see them.',
        cta: 'Build shipyard ferry in fleet ferry',
        hint: 'Shop → Shipyard → click green land → namespace ferry, name ferry, BUILD.',
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => shipyardAfloat(ctx.store, FLEET) === 'ferry',
      },
      {
        id: 'light',
        onEnter: () => selection.clear(),
        title: 'Their own lighthouse',
        text: 'Traders for the ferry need a beam of their own. Light a lighthouse in the ferry fleet that guides the ferry shipyard.',
        cta: 'Light lighthouse ferry in fleet ferry',
        hint: 'Shop → Lighthouse → namespace ferry, name ferry, ships to guide: ferry (shipyard), LIGHT.',
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => {
          const b = lighthouseFor(ctx.store, FLEET, 'ferry');
          if (b) beacon = b;
          return !!b;
        },
      },
      {
        id: 'retire',
        onEnter: () => selection.clear(),
        title: 'Retire the impostor',
        text: 'The old ferry shipyard in the harbor fleet still flies the courier ensign. Sell it; the courier beam will reach couriers only.',
        cta: 'Sell the ferry shipyard in fleet harbor',
        hint: 'Click the ferry shipyard on the harbor-worker island, press Sell shipyard, then press it again to confirm.',
        anchor: { kind: 'map', key: `b:${nsKey('harbor', 'ferry')}`, placement: 'bottom' },
        waitFor: () => !ctx.store.deployments.has(nsKey('harbor', 'ferry')),
      },
      {
        id: 'again',
        onEnter: () => {
          selection.clear();
          const ferryShip = [...ctx.store.pods.values()].find((p) => p.ns === FLEET && p.deployment === 'ferry');
          const script: ScriptedMessage[] = [
            { at: 600, msg: ferryEvent('Normal', 'TraderArrived', 'courier trader → courier-a (app=courier, fleet harbor)') },
            { at: 2000, msg: ferryEvent('Normal', 'TraderArrived', 'courier trader → courier-b: only couriers in the beam now') },
          ];
          if (ferryShip) script.push({ at: 3400, msg: podEvent(ferryShip, 'Normal', 'TraderArrived', `ferry trader → ${beacon} lighthouse (fleet ferry) → ${ferryShip.name}`) });
          ctx.play(script);
        },
        title: 'Each beam its own crew',
        text: 'Watch the log: courier traders reach couriers, ferry traders reach the ferry through its own lighthouse. Two fleets, two ensigns, no confusion. Fleets also keep names apart: a shipyard called ferry can exist in both.',
        anchor: { kind: 'map', key: `s:${nsKey(FLEET, beacon || 'ferry')}`, placement: 'bottom' },
      },
      {
        id: 'filter',
        title: 'One fleet at a time',
        text: 'The Fleets filter shows chosen fleets only, which is how you keep a busy harbor readable. Hide the harbor fleet for a moment and only the ferry fleet stays on the map.',
        cta: 'Open Fleets and untick harbor',
        hint: 'Press the Fleets button on the left rail (or F), then untick harbor.',
        anchor: { kind: 'dom', selector: '#hud [data-rail=fleets]', placement: 'right' },
        waitFor: () => settings.hiddenNamespaces.has('harbor'),
      },
      {
        id: 'lesson',
        onEnter: () => {
          settings.hiddenNamespaces.clear();
          settings.changed.emit();
        },
        title: 'Namespaces and labels',
        text: 'A namespace scopes names, Services and most policy (quotas, RBAC, network policy); it is the unit teams and environments are split by. Labels are free-form tags; selectors on Services, Deployments and kubectl -l read them, so keep them honest and consistent.',
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: () => ({
    naval: 'The ferry crew got its own fleet with its own ensign and lighthouse. The courier beam reaches couriers only, the ferry beam reaches ferries only, and the Fleets filter shows one crew at a time.',
    kubernetes: 'Namespaces partition a cluster: names are unique within one, Services resolve as name.namespace.svc, and quotas, RBAC and NetworkPolicies attach to them. Labels are key/value tags; selectors match them exactly, so two apps sharing a label share a Service by accident.',
    devops: 'Two teams deployed into default with app=web on both. The checkout Service started load-balancing to the marketing site. Separate namespaces (and a label convention) ended it, and gave each team its own quota and access.',
    manifest: [
      'apiVersion: v1',
      'kind: Namespace             # a fleet',
      'metadata:',
      '  name: ferry',
      '---',
      'apiVersion: v1',
      'kind: Service               # a lighthouse, scoped to its fleet',
      'metadata:',
      '  name: ferry',
      '  namespace: ferry',
      'spec:',
      '  selector:',
      '    app: ferry              # the ensign it reads',
      '  ports:',
      '    - port: 80',
    ].join('\n'),
    kubectl: 'kubectl create namespace ferry\nkubectl get pods -A -l app=courier     # every ship flying that ensign, in any fleet\nkubectl get svc -n ferry\nkubectl config set-context --current --namespace=ferry',
  }),
};
