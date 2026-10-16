import { selection } from '../../app';
import { ledger } from '../../game/ledger';
import { nsKey } from '../../store/cluster';
import { controllers, failNode, reconcileAll, restoreNode } from '../../tour/training';
import { academyHarbor, lighthouse, podEvent, shipyard } from '../advanced/fixture';
import { readyShips } from '../goals';
import type { Level } from '../types';

const overlayOpen = (id: string): boolean => document.getElementById(id)?.hidden === false;

/** Principle 2: controllers reconcile; they do not execute. */
export const level2: Level = {
  id: 'principles/2',
  number: 2,
  title: 'The loop',
  concept: 'Controllers reconcile, they do not execute',
  terms: ['controller', 'reconcile', 'level-triggered', 'self-healing'],
  parSeconds: 300,
  fixture: () => {
    const y = shipyard('courier', 3);
    return academyHarbor({ deployments: [y.deployment], pods: y.pods, services: [lighthouse('courier', 'courier')] });
  },
  steps: (ctx) => {
    const NS = ctx.ns;
    const yard = nsKey(NS, 'courier');
    let chosen = false;
    let ticked = false;
    const tick = (): void => {
      const rs = reconcileAll();
      for (const r of rs) ledger.add({ who: 'the Deployment controller', what: `loop: ${r.name} observed ${r.observed}, desired ${r.desired}, ${r.action}`, dir: 'change' });
    };
    return [
      {
        id: 'intro',
        onEnter: () => { selection.clear(); tick(); },
        title: 'A loop, not a to-do list',
        text: 'The Deployment controller does not carry out orders. It loops: observe how many ships the courier shipyard has, compare with spec.replicas, take one step to close the gap, repeat. Open the Ledger: the loop just ran and found nothing to do.',
        cta: 'Open the Ledger',
        anchor: { kind: 'dom', selector: '#hud [data-rail=ledger]', placement: 'right' },
        waitFor: () => overlayOpen('ledger'),
      },
      {
        id: 'blackout',
        onEnter: () => {
          controllers.paused = true;
          ledger.add({ who: 'the Deployment controller', what: 'watch lost: no news from the API server', dir: 'change' });
          const ships = [...ctx.store.pods.values()].filter((p) => p.ns === NS && p.deployment === 'courier').slice(0, 2);
          ships.forEach((s, i) => {
            ctx.play([{ at: 800 + i * 1200, msg: podEvent(s, 'Warning', 'Reef', `${s.name} struck the reef`) }]);
            setTimeout(() => ctx.sink(s), 1000 + i * 1200);
          });
        },
        title: 'The controller goes deaf',
        text: 'Now the controller loses its watch: for a while no event reaches it. Two ships strike the reef meanwhile. Nothing is launched; the controller heard nothing. Close the ledger and look at the shallows.',
        anchor: { kind: 'map', key: `unit-of:${NS}/courier`, placement: 'top' },
        waitFor: () => !overlayOpen('ledger') && readyShips(ctx.store, NS, 'courier') <= 1,
      },
      {
        id: 'predict',
        title: 'What happens when it hears again?',
        text: 'The events that announced the sinkings are gone; the controller never saw them. Its watch is about to come back. Predict what happens.',
        choices: [
          { text: 'It missed the events, so the ships stay sunk', correct: false, explain: 'That would be edge-triggered: acting only on events. Kubernetes controllers are not.' },
          { text: 'The next loop sees 1 ship against 3 and launches 2', correct: true, explain: 'Right. The loop compares state, not events: it is level-triggered.' },
          { text: 'The API server replays the missed events to it', correct: false, explain: 'There is no replay queue to depend on; the watch simply resumes and the loop looks at what is.' },
        ],
        onChoice: (ok) => { if (ok) chosen = true; },
        anchor: { kind: 'none' },
        waitFor: () => chosen,
      },
      {
        id: 'resume',
        onEnter: () => {
          controllers.paused = false;
          ledger.add({ who: 'the Deployment controller', what: 'watch restored', dir: 'change' });
          setTimeout(() => { tick(); ticked = true; }, 800);
        },
        title: 'Level-triggered',
        text: 'The watch is back. The next loop reads the current state, 1 against 3, and launches two. No event was needed; the gap itself was enough. That is what level-triggered means.',
        anchor: { kind: 'map', key: `b:${yard}`, placement: 'bottom' },
        waitFor: () => ticked && readyShips(ctx.store, NS, 'courier') >= 3,
      },
      {
        id: 'node',
        onEnter: () => {
          selection.clear();
          setTimeout(() => failNode('harbor-worker'), 800);
        },
        title: 'An island goes dark',
        text: 'Harder: the harbor-worker island goes NotReady with ships on it. The node controller marks the ships lost; the Deployment loop sees the gap and launches replacements on the island that is left. Nobody pressed anything.',
        anchor: { kind: 'map', key: 'dock:harbor-worker', placement: 'bottom' },
        waitFor: () => ctx.store.nodes.get('harbor-worker')?.ready === false && readyShips(ctx.store, NS, 'courier') >= 3 && [...ctx.store.pods.values()].every((p) => p.ns !== NS || p.deployment !== 'courier' || p.node !== 'harbor-worker'),
      },
      {
        id: 'lesson',
        onEnter: () => restoreNode('harbor-worker'),
        title: 'Self-healing falls out of the design',
        text: 'Each controller watches one kind and runs the same loop: observe, compare, act, repeat. Because it compares state rather than reacting to events, a missed event or a dead node is just another gap to close. Nobody bolted self-healing on.',
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: () => ({
    naval: 'The courier shipyard\'s controller went deaf while two ships sank, then heard again and launched two: it compared what is with what should be. When an island went dark it did the same, without an order from anyone.',
    kubernetes: 'A controller watches one kind of object and reconciles: observe actual state, compare with spec, take one step, repeat. It is level-triggered: missed events do not matter, because the next loop reads the current state. Node failure, eviction and crashes are all gaps the loop closes.',
    devops: 'The controller manager was restarted during a cluster upgrade while a node was being replaced. Nothing was lost: on restart every controller resynced, saw pods missing and recreated them. Teams that build their own operators follow the same rule: reconcile from state, never from a queue of events.',
    kubectl: 'kubectl get rs -n harbor -w            # the ReplicaSet counts as the loop acts\nkubectl get events -n harbor --sort-by=.lastTimestamp\nkubectl describe deploy courier -n harbor   # conditions written by the loop',
  }),
};
