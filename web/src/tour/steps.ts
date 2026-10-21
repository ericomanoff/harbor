import { mode, selection, store } from '../app';
import { nsKey } from '../store/cluster';
import type { TourStep } from './engine';

/**
 * The welcome tour, told by the harbor master. Runs in the training harbor
 * (demo data), so the nginx shipyard, db terminal, lighthouses and the
 * outpost anchorage always exist.
 */
export function tourSteps(): TourStep[] {
  const nginx = nsKey('sandbox', 'nginx');
  return [
    {
      id: 'welcome',
      title: 'Ahoy, harbor master!',
      text: 'Welcome aboard. This harbor is a Kubernetes cluster: islands are nodes, shipyards are Deployments, ships are pods. The badge shows which harbor you are in; click it any time to sail to another. We are in a training harbor now, so nothing you do here touches a real cluster.',
      anchor: { kind: 'dom', selector: '#hud [data-badge]', placement: 'bottom' },
    },
    {
      id: 'docks',
      title: 'Islands are nodes',
      text: 'Each island is a node. Shipyards stand on the land; ships moor in the shallows below the quay. An island that goes dark with a red beacon is a node that is NotReady.',
      anchor: { kind: 'map', key: 'dock:harbor-worker', placement: 'bottom' },
    },
    {
      id: 'shipyard',
      onEnter: () => selection.clear(),
      title: 'Shipyards are Deployments',
      text: 'A shipyard launches ships. Its flag carries the namespace colour and the bar above it shows ships moored over ships wanted.',
      cta: 'Click the nginx shipyard',
      anchor: { kind: 'map', key: `b:${nginx}`, placement: 'bottom' },
      waitFor: () => selection.keys.has(`b:${nginx}`),
    },
    {
      id: 'launch',
      title: 'The selection card',
      text: 'Whatever you select gets a card with its details and actions. Launch ship adds a replica, Scrap one removes one, Sell shipyard deletes the Deployment (it asks twice).',
      cta: 'Press Launch ship',
      anchor: { kind: 'dom', selector: '#hud .selection', placement: 'top' },
      waitFor: () => (store.deployments.get(nginx)?.replicas ?? 0) >= 4,
    },
    {
      id: 'ship',
      onEnter: () => selection.clear(),
      title: 'Ships are pods',
      text: 'Watch the new ship sail from the slipway to its berth. Each crate on deck is a container.',
      cta: 'Click any ship',
      anchor: { kind: 'map', key: 'unit-of:sandbox/nginx', placement: 'top' },
      waitFor: () => [...selection.keys].some((k) => k.startsWith('u:')),
    },
    {
      id: 'states',
      title: 'Reading a ship',
      text: 'A burning ship is crash-looping. A bare hull in dry dock is Pending. Weathered sails mean an old rollout. On the card: Ship’s log tails its logs, Refit replaces it, Scrap retires exactly that pod.',
      anchor: { kind: 'dom', selector: '#hud .selection', placement: 'top' },
    },
    {
      id: 'kinds',
      title: 'Tankers, tugs and fishing boats',
      text: 'Long tankers with hull numbers are StatefulSet pods, launched from a tanker terminal. Small tugboats are DaemonSet pods, one per dock. Fishing boats are Job pods; they come home when the catch is landed.',
      anchor: { kind: 'map', key: 'u:sandbox/db-1', placement: 'top' },
    },
    {
      id: 'lighthouse',
      onEnter: () => selection.clear(),
      title: 'Lighthouses are Services',
      text: 'A lighthouse routes traffic. Select it, or any ship, to see the beams between a Service and the pods its selector matches.',
      cta: 'Click the nginx lighthouse',
      anchor: { kind: 'map', key: `s:${nginx}`, placement: 'top' },
      waitFor: () => selection.keys.has(`s:${nginx}`),
    },
    {
      id: 'gate',
      title: 'The harbor mouth',
      text: 'Gates in the breakwater are Ingresses: the only way in from the open sea. Select a gate to see the channels to the lighthouses it routes to; a gold chain means TLS.',
      anchor: { kind: 'map', key: 'g:sandbox/shop', placement: 'top' },
    },
    {
      id: 'anchorage',
      title: 'Anchorages are Helm releases',
      text: 'A mooring boom of buoys surrounds everything a Helm release installed. Its nameplate opens a card to Upgrade, Roll back or Weigh anchor. The Charts button is the chart table: libraries, charts and every release.',
      anchor: { kind: 'map', key: 'r:sandbox/outpost', placement: 'bottom' },
    },
    {
      id: 'bars',
      title: 'Harbor health and capacity',
      text: 'The cluster panel, top right: HEALTH is docks ready (nodes) and ships ready (pods), with the fleets filter; CAPACITY is BERTHS, CPU requested over allocatable on ready nodes, and CARGO, the same for memory. When berths run short the harbor master will tell you.',
      anchor: { kind: 'dom', selector: '#hud .cluster', placement: 'left' },
    },
    {
      id: 'shop',
      title: 'Building',
      text: 'New structures come from the Shop: shipyards and tanker terminals to build, fishing fleets to send out, gates to open, and charts from the libraries you add.',
      cta: 'Open the Shop',
      anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
      waitFor: () => !document.getElementById('shop')?.hidden,
    },
    {
      id: 'place',
      title: 'Placing a shipyard',
      text: 'Press Build on the Shipyard card, then click a free slipway on an island (the land rows). Green means clear, red means blocked. A form asks for the image and how many ships to launch.',
      cta: 'Build, then click green land',
      anchor: { kind: 'dom', selector: '#shop [data-card=shipyard]', placement: 'top' },
      waitFor: () => mode.current === 'place' || !document.getElementById('build-form')?.hidden,
    },
    {
      id: 'rails',
      title: 'Around the harbor',
      text: 'Map opens the chart table minimap, Log the harbor log, Find locates anything by name, Fleets filters namespaces; Expeditions, top centre, opens the training library. Keys: B build, T charts, E expeditions, C change harbor, / find, F fleets, M sound, H home, Tab cycle, Esc cancel. Drag a shipyard to move it; right-drag pans; the wheel zooms.',
      anchor: { kind: 'dom', selector: '#hud .hud-left-rail', placement: 'right' },
      onEnter: () => {
        if (mode.current === 'place') mode.set('idle');
        document.querySelector<HTMLButtonElement>('#build-form button[data-cancel]')?.click();
        document.querySelector<HTMLButtonElement>('#shop button[data-close]')?.click();
      },
    },
    {
      id: 'done',
      title: 'Fair winds',
      text: 'That is the harbor. Replay this tour any time from the Help button. Sailing back to your real harbor now.',
      anchor: { kind: 'dom', selector: '#hud [data-rail=help]', placement: 'right' },
    },
  ];
}
