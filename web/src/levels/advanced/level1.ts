import { selection } from '../../app';
import { nsKey } from '../../store/cluster';
import { podGone } from '../goals';
import type { Level } from '../types';
import { academyHarbor, loneShip, reefScript } from './fixture';

const overlayOpen = (id: string): boolean => document.getElementById(id)?.hidden === false;

/** Level 1: a pod is a ship; its containers are the cargo; pods are mortal. */
export const level1: Level = {
  id: 'advanced/1',
  number: 1,
  title: 'A ship and its cargo',
  concept: 'Pods and containers',
  terms: ['ship', 'cargo-crate', 'ships-log', 'sunk'],
  practises: 'Desired state',
  parSeconds: 120,
  fixture: () => academyHarbor({ pods: [loneShip('courier')] }),
  steps: (ctx) => {
    const courier = nsKey('harbor', 'courier');
    let second = loneShip('courier-2');
    return [
      {
        id: 'intro',
        title: 'Welcome aboard',
        text: 'This small harbor is yours to learn in: the Advanced K8s expedition, one hands-on idea per level. One lone ship is moored at the harbor-worker island. In Kubernetes a ship is a pod: the smallest thing the cluster runs. Nothing you do here touches a real cluster.',
        anchor: { kind: 'dom', selector: '#hud [data-badge]', placement: 'bottom' },
      },
      {
        id: 'ship',
        onEnter: () => selection.clear(),
        title: 'Ships are pods',
        text: 'Find the lone ship and select it. The card shows what the pod is: where it is moored (its node), whether it is ready, and how many times it restarted.',
        cta: 'Click the lone ship',
        hint: 'It sits in the shallows just below the harbor-worker island, on the right.',
        anchor: { kind: 'map', key: `u:${courier}`, placement: 'top' },
        waitFor: () => selection.keys.has(`u:${courier}`),
      },
      {
        id: 'cargo',
        title: 'Cargo is containers',
        text: 'Each crate on deck is a container: one process, running one image. This ship carries two: the courier itself and a log-shipper beside it. They share the ship: one network address, one deck.',
        cta: "Press Ship's log to read the cargo's output",
        hint: "Ship's log is the first button on the selection card.",
        anchor: { kind: 'dom', selector: '#hud .selection', placement: 'top' },
        waitFor: () => overlayOpen('logs'),
      },
      {
        id: 'log',
        title: "The ship's log",
        text: 'This is kubectl logs: whatever the container printed. When a ship misbehaves, the log is the first place to look. Close it when you have read it.',
        cta: 'Close the log',
        anchor: { kind: 'dom', selector: '#logs .panel', placement: 'left' },
        waitFor: () => !overlayOpen('logs'),
      },
      {
        id: 'reef',
        onEnter: () => {
          selection.clear();
          const pod = ctx.store.pods.get(courier);
          if (pod) ctx.play(reefScript(pod));
        },
        title: 'A reef!',
        text: 'The courier has struck the reef. Watch the ship go down. A pod that dies is simply gone, cargo and all.',
        anchor: { kind: 'map', key: `u:${courier}`, placement: 'top' },
        waitFor: () => podGone(ctx.store, courier),
      },
      {
        id: 'mortal',
        onEnter: () => {
          second = loneShip('courier-2');
          ctx.play([
            { at: 0, msg: { type: 'modified', kind: 'Pod', obj: { ...second, node: '', phase: 'Pending', ready: false } } },
            { at: 1400, msg: { type: 'modified', kind: 'Pod', obj: second } },
          ]);
        },
        title: 'Pods are mortal',
        text: 'Nobody rebuilt the courier: a bare pod has no one looking after it. I am sending out a second lone ship by hand so you can see it happen again.',
        anchor: { kind: 'map', key: 'dock:harbor-worker', placement: 'bottom' },
      },
      {
        id: 'again',
        onEnter: () => {
          const pod = ctx.store.pods.get(nsKey('harbor', 'courier-2')) ?? second;
          ctx.play(reefScript(pod).map((s) => ({ ...s, at: s.at + 1200 })));
        },
        title: 'The same reef',
        text: 'Same reef, same ending. The second courier sinks and, again, nothing replaces it. Someone would have to notice at 3 a.m. and launch a new one by hand.',
        anchor: { kind: 'map', key: `u:${nsKey('harbor', 'courier-2')}`, placement: 'top' },
        waitFor: () => podGone(ctx.store, nsKey('harbor', 'courier-2')),
      },
      {
        id: 'lesson',
        title: 'What a pod is',
        text: 'A pod is one or more containers that sail together and die together. Kubernetes never resurrects a dead pod; something else has to ask for a new one. That something is the shipyard, and it is the next lesson.',
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: () => ({
    naval: 'A lone ship carried two crates of cargo. It struck the reef and sank; the harbor had nobody to launch another, so the cargo stayed lost.',
    kubernetes: 'A Pod runs one or more containers that share a network namespace and lifecycle. Pods are ephemeral: when one terminates it is not restarted unless a controller (a Deployment, StatefulSet, DaemonSet or Job) owns it.',
    devops: 'A developer ran a bare pod with kubectl run to host a service. The node was drained for maintenance, the pod was evicted, and the service was down until someone noticed and ran the command again.',
    manifest: [
      'apiVersion: v1',
      'kind: Pod                    # a ship',
      'metadata:',
      '  name: courier',
      '  namespace: harbor          # its fleet',
      'spec:',
      '  containers:                # the cargo',
      '    - name: courier          # a crate',
      '      image: ghcr.io/example/courier:1.0',
      '    - name: log-shipper      # another crate',
      '      image: fluent/fluent-bit:3.0',
    ].join('\n'),
    kubectl: 'kubectl run courier --image=ghcr.io/example/courier:1.0 -n harbor\nkubectl logs courier -c courier -n harbor',
  }),
};
