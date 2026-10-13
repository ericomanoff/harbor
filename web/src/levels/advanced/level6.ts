import { createDeployment, createService } from '../../api/client';
import { selection } from '../../app';
import { nsKey } from '../../store/cluster';
import { gateFor } from '../goals';
import { ingressKubectl, ingressYaml } from '../manifest';
import type { Level, ScriptedMessage } from '../types';
import { academyHarbor, lighthouse, shipyard } from './fixture';

const overlayOpen = (id: string): boolean => document.getElementById(id)?.hidden === false;
const svcEvent = (ns: string, type: 'Warning' | 'Normal', reason: string, message: string): ScriptedMessage['msg'] => ({ type: 'added', kind: 'Event', obj: { ns, kind: 'Service', name: 'courier', type, reason, message, ts: new Date().toISOString() } });

/** Level 6: an Ingress lets traffic from outside the cluster reach a Service. */
export const level6: Level = {
  id: 'advanced/6',
  number: 6,
  title: 'The harbor mouth',
  concept: 'Ingress (host and path routing from outside)',
  terms: ['gate', 'chain', 'lighthouse', 'breakwater'],
  practises: 'Two crews',
  parSeconds: 180,
  fixture: () => {
    const y = shipyard('courier', 2);
    return academyHarbor({ deployments: [y.deployment], pods: y.pods, services: [lighthouse('courier', 'courier')] });
  },
  real: {
    setup: async (ctx) => {
      await ctx.stage('found');
      await createDeployment({ ns: ctx.ns, name: 'courier', image: 'nginx:1.27-alpine', replicas: 2, port: 80 });
      await createService({ ns: ctx.ns, name: 'courier', selector: { app: 'courier' }, port: 80 });
    },
    ready: (ctx) => ctx.store.services.has(nsKey(ctx.ns, 'courier')),
  },
  steps: (ctx) => {
    const NS = ctx.ns;
    let gate = '';
    return [
      {
        id: 'intro',
        onEnter: () => {
          selection.clear();
          ctx.play([{ at: 1200, msg: svcEvent(NS, 'Warning', 'NoGate', 'shop.example: traders outside the breakwater cannot reach the lighthouse') }, { at: 4200, msg: svcEvent(NS, 'Warning', 'NoGate', 'connection refused from outside for shop.example') }]);
        },
        title: 'Traders outside the breakwater',
        text: 'Inside the harbor the courier lighthouse works: any ship can follow its beam. But a ClusterIP lighthouse shines only inside the breakwater. Traders out at sea, the users of your shop, see nothing at all.',
        anchor: { kind: 'map', key: `s:${nsKey(NS, 'courier')}`, placement: 'bottom' },
      },
      {
        id: 'shop',
        title: 'Open a gate',
        text: 'A gate at the harbor mouth is an Ingress: it lets outside traffic in by host name and path and sends it to a lighthouse. A gold chain on the gate is TLS.',
        cta: 'Open the Shop',
        hint: 'The green Shop button is at the bottom left; the Gate card is under Harbor.',
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => overlayOpen('shop'),
      },
      {
        id: 'card',
        title: 'The Gate card',
        cta: 'Press Open on the Gate card',
        text: 'The Gate card opens an Ingress.',
        anchor: { kind: 'dom', selector: '#shop [data-card=gate]', placement: 'top' },
        waitFor: () => overlayOpen('gate-form'),
      },
      {
        id: 'form',
        title: 'Host, path, lighthouse',
        text: `Fleet ${NS}, name shop. HOST shop.example is the name traders will use; PATH / means everything under it. LIGHTHOUSE courier on port 80 is where the gate sends them. Tick TLS for the gold chain.`,
        cta: 'Fill it in and press OPEN GATE',
        hint: `Namespace ${NS}, name shop, host shop.example, path /, lighthouse courier, port 80.`,
        anchor: { kind: 'dom', selector: '#gate-form .panel', placement: 'left' },
        waitFor: () => {
          const g = gateFor(ctx.store, NS, 'courier');
          if (g) gate = g;
          return !!g;
        },
      },
      {
        id: 'again',
        onEnter: () => {
          selection.clear();
          const ing = ctx.store.ingresses.get(nsKey(NS, gate));
          const host = ing?.rules[0]?.host || '*';
          const ev = (type: 'Warning' | 'Normal', reason: string, message: string): ScriptedMessage['msg'] => ({ type: 'added', kind: 'Event', obj: { ns: NS, kind: 'Ingress', name: gate, type, reason, message, ts: new Date().toISOString() } });
          ctx.play([
            { at: 800, msg: ev('Normal', 'TraderArrived', `GET ${ing?.tls ? 'https' : 'http'}://${host}/ → lighthouse courier → a courier ship`) },
            { at: 2300, msg: ev('Normal', 'TraderArrived', `GET ${host}/checkout → lighthouse courier`) },
            { at: 3800, msg: ev('Warning', 'Bounced', 'GET other.example/ → no rule for that host (404)') },
            { at: 5300, msg: ev('Normal', 'TraderArrived', `GET ${host}/ → courier, the other ship this time`) },
          ]);
        },
        title: 'Traders come in',
        text: 'Watch the harbor log: traders arrive through your gate by host and path and are handed to the lighthouse, which spreads them over the courier ships. A trader asking for a host with no rule bounces off the gate.',
        anchor: { kind: 'map', key: `g:${nsKey(NS, gate || 'shop')}`, placement: 'top' },
      },
      {
        id: 'lesson',
        title: 'The gate and its keeper',
        text: 'An Ingress is only rules: host and path to Service and port. An ingress controller (nginx, traefik, a cloud load balancer) is the gatekeeper that enforces them; without one the gate is a plan. TLS lives on the Ingress too, with a Secret holding the certificate.',
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: (store) => {
    const ing = [...store.ingresses.values()].find((i) => (i.ns === 'harbor' || i.ns.startsWith('harbor-academy')) && i.rules.some((r) => r.service === 'courier'));
    const rule = ing?.rules.find((r) => r.service === 'courier');
    const req = { ns: ing?.ns ?? 'harbor', name: ing?.name ?? 'shop', host: rule?.host || 'shop.example', path: rule?.path || '/', service: 'courier', port: rule?.port || '80', tls: ing?.tls ?? true, ...(ing?.class ? { class: ing.class } : {}) };
    return {
      naval: `The ${req.name} gate opens the breakwater for ${req.host}: traders sailing in by that name and path are sent to the courier lighthouse${req.tls ? ', under a gold chain' : ''}. Other names bounce off.`,
      kubernetes: 'An Ingress maps host and path rules to Services; an ingress controller implements them with a real proxy and reports addresses in status. TLS is terminated at the controller using a Secret named on the Ingress. Services stay ClusterIP; only the gate faces outside.',
      devops: 'The team exposed each microservice with its own LoadBalancer and got a bill for twelve cloud load balancers. One Ingress with a path per service, behind one controller, replaced them all and added TLS in one place.',
      manifest: ingressYaml(req),
      kubectl: `${ingressKubectl(req)}\nkubectl get ingress -n ${req.ns}   # ADDRESS appears once a controller claims it`,
    };
  },
};
