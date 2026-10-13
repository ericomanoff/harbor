import { mode, selection } from '../../app';
import { nsKey } from '../../store/cluster';
import { podGone, relaunched, shipyardAfloat } from '../goals';
import { deploymentKubectl, deploymentYaml } from '../manifest';
import type { Level } from '../types';
import { academyHarbor, loneShip, reefScript } from './fixture';

const overlayOpen = (id: string): boolean => document.getElementById(id)?.hidden === false;

/** Level 2: a Deployment keeps the ships you asked for afloat. */
export const level2: Level = {
  id: 'advanced/2',
  number: 2,
  title: 'The shipyard',
  concept: 'Deployments and ReplicaSets',
  terms: ['shipyard', 'launch-queue', 'ship', 'sunk'],
  practises: 'Desired state, Reconcile',
  parSeconds: 180,
  fixture: () => academyHarbor({ pods: [loneShip('courier')] }),
  real: {
    setup: async (ctx) => {
      await ctx.stage('found');
      await ctx.stage('lone-ship', { name: 'courier' });
    },
    ready: (ctx) => ctx.store.pods.get(nsKey(ctx.ns, 'courier'))?.ready === true,
  },
  steps: (ctx) => {
    const NS = ctx.ns;
    const courier = nsKey(NS, 'courier');
    let yard = '';
    let sunk = '';
    return [
      {
        id: 'reef',
        onEnter: () => {
          selection.clear();
          const pod = ctx.store.pods.get(courier);
          if (!pod) return;
          if (ctx.mode === 'sim') ctx.play(reefScript(pod).map((s) => ({ ...s, at: s.at + 2500 })));
          else setTimeout(() => ctx.sink(pod), 2500);
        },
        title: 'Same reef, same sea',
        text: `The courier is back, alone again${ctx.mode === 'real' ? ` in the ${NS} fleet of your own cluster` : ''}, and the reef has not moved. This time you will give the harbor a way to replace it: a shipyard. In Kubernetes that is a Deployment.`,
        anchor: { kind: 'map', key: `u:${courier}`, placement: 'top' },
        waitFor: () => podGone(ctx.store, courier),
      },
      {
        id: 'shop',
        title: 'Build a shipyard',
        text: 'A shipyard keeps a number of ships afloat: you say how many, it launches and replaces them. Shipyards are built from the Shop.',
        cta: 'Open the Shop',
        hint: 'The green Shop button is at the bottom left.',
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => overlayOpen('shop'),
      },
      {
        id: 'card',
        title: 'The shipyard card',
        text: 'The Shop lists what the harbor can build. The Shipyard card is a Deployment; the tanker terminal beside it is a StatefulSet, for another day.',
        cta: 'Press Build on the Shipyard card',
        anchor: { kind: 'dom', selector: '#shop [data-card=shipyard]', placement: 'top' },
        waitFor: () => mode.current === 'place',
      },
      {
        id: 'site',
        title: 'Choose a site',
        text: 'A shipyard stands on land. Move over an island; the footprint turns green where it fits.',
        cta: 'Click a green site on the island',
        hint: 'Click near the top of an island, above the shallows where ships moor.',
        anchor: { kind: 'map', key: `dock:${ctx.mode === 'sim' ? 'harbor-worker' : [...ctx.store.nodes.keys()][0] ?? ''}`, placement: 'bottom' },
        waitFor: () => overlayOpen('build-form'),
      },
      {
        id: 'form',
        title: "The ship's manifest",
        text: `This form is the Deployment manifest. Fleet ${NS}, name courier, 1 unit: one ship to keep afloat. The image is the cargo. Open Ship's manifest at the bottom to see the YAML these fields become.`,
        cta: 'Fill it in and press BUILD',
        hint: `Namespace ${NS}, name courier, units 1${ctx.mode === 'sim' ? '. Any image will do in the training harbor.' : ', and keep the nginx image: it must really pull.'}`,
        anchor: { kind: 'dom', selector: '#build-form .panel', placement: 'left' },
        waitFor: () => {
          const name = shipyardAfloat(ctx.store, NS);
          if (name) yard = name;
          return !!name;
        },
      },
      {
        id: 'relaunch',
        onEnter: () => {
          selection.clear();
          const ship = [...ctx.store.pods.values()].find((p) => p.ns === NS && p.deployment === yard);
          if (!ship) return;
          sunk = ship.name;
          ctx.play([{ at: 1500, msg: { type: 'added', kind: 'Event', obj: { ns: NS, kind: 'Pod', name: ship.name, type: 'Warning', reason: 'Reef', message: `${ship.name} struck the reef`, ts: new Date().toISOString() } } }]);
          setTimeout(() => ctx.sink(ship), 1800);
        },
        title: 'The reef again',
        text: 'Your shipyard launched a ship from its slipway. Now watch the reef take it, and watch what the shipyard does about it.',
        anchor: { kind: 'map', key: `unit-of:${NS}/${yard || 'courier'}`, placement: 'top' },
        waitFor: () => !!yard && !!sunk && relaunched(ctx.store, NS, yard, sunk),
      },
      {
        id: 'lesson',
        onEnter: () => selection.clear(),
        title: 'Desired state',
        text: 'The shipyard noticed one ship short of the one you asked for and launched another, without you. That is a Deployment: you declare how many replicas you want; its ReplicaSet keeps that true for as long as the harbor stands.',
        anchor: { kind: 'map', key: `b:${NS}/${yard || 'courier'}`, placement: 'bottom' },
      },
    ];
  },
  summary: (store) => {
    const d = [...store.deployments.values()].find((x) => x.ns === 'harbor' || x.ns.startsWith('harbor-academy'));
    const req = d ? { ns: d.ns, name: d.name, image: d.image, replicas: d.replicas } : { ns: 'harbor', name: 'courier', image: 'nginx:1.27-alpine', replicas: 1 };
    return {
      naval: `The ${req.name} shipyard keeps ${req.replicas} ship afloat. When the reef sank it, the shipyard launched a replacement from its slipway by itself.`,
      kubernetes: 'A Deployment declares spec.replicas copies of a pod template. Its ReplicaSet watches the pods it owns and creates or deletes them until the count matches: the desired state is reconciled continuously.',
      devops: 'The web pod crashed at 3 a.m. Nobody was paged, because the Deployment replaced it within seconds; the on-call engineer read about it in the morning from the events.',
      manifest: deploymentYaml(req),
      kubectl: `${deploymentKubectl(req)}\nkubectl get deploy,rs,pods -n ${req.ns}`,
    };
  },
};
