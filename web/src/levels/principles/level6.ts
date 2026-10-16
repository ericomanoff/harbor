import { selection } from '../../app';
import { ledger } from '../../game/ledger';
import { nsKey } from '../../store/cluster';
import { authorities } from '../../tour/training';
import { academyHarbor, lighthouse } from '../advanced/fixture';
import { gateFor, readyShips, shipsWithLabels } from '../goals';
import type { Level } from '../types';

/** Principle 6: separation of concerns between who writes what. */
export const level6: Level = {
  id: 'principles/6',
  number: 6,
  title: 'Two crews',
  concept: 'Separation of concerns between who writes what',
  terms: ['resource-quota', 'limit-range', 'admission', 'ingress-class', 'rbac', 'platform-team'],
  parSeconds: 420,
  fixture: () => academyHarbor({ services: [lighthouse('courier', 'courier')] }),
  steps: (ctx) => {
    const NS = ctx.ns;
    const authority = { quota: { pods: 5, cpu: 2, mem: 2 }, limitRange: { cpuRequest: '100m', memRequest: '64Mi', cpuLimit: '500m', memLimit: '256Mi' }, requireLabel: 'team' };
    const quotaEvents = (): number => ctx.store.events.filter((e) => e.ns === NS && e.reason === 'FailedCreate' && /quota/.test(e.message)).length;
    let refusals = 0;
    let gateName = '';
    return [
      {
        id: 'authority',
        onEnter: () => {
          selection.clear();
          if (ctx.mode === 'real') void ctx.stage('quota');
          else authorities.set(NS, { quota: authority.quota, limitRange: authority.limitRange, requireLabel: authority.requireLabel });
          ledger.add({ who: 'the platform team', what: `ResourceQuota, LimitRange and an admission rule posted on fleet ${NS}`, dir: 'change' });
        },
        title: 'The harbor authority',
        text: `This fleet has an authority now, posted by the platform team: a quota of ${authority.quota.pods} ships, ${authority.quota.cpu} CPU and ${authority.quota.mem}Gi of requests; defaults of ${authority.limitRange.cpuRequest}/${authority.limitRange.memRequest} for ships that set nothing; and a rule that every ship must carry a team ensign. You are the app team. Try to build a shipyard called courier with 6 units, CPU/UNIT and MEM/UNIT left empty, and no extra ensign.`,
        cta: 'Build shipyard courier, 6 units, empty CPU/MEM, no extra ensign (expect a refusal)',
        hint: `Shop → Shipyard → green land → namespace ${NS}, name courier, units 6, clear CPU/UNIT and MEM/UNIT, BUILD. Read the error.`,
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => { const err = document.querySelector('#build-form .err'); if (err && !(err as HTMLElement).hidden && /admission refused/.test(err.textContent ?? '')) refusals++; return refusals > 0; },
      },
      {
        id: 'label',
        title: 'Refused at the door',
        text: 'Admission refused the shipyard before anything was stored: no team ensign. Admission control is the platform team\'s gate on every write. Add EXTRA ENSIGN team=cargo and build again with 6 units.',
        cta: 'Build courier again with team=cargo, 6 units',
        hint: 'Same form: EXTRA ENSIGN team=cargo, units 6, BUILD.',
        anchor: { kind: 'dom', selector: '#build-form .panel', placement: 'left' },
        waitFor: () => shipsWithLabels(ctx.store, NS, { app: 'courier', team: 'cargo' }) >= 1 && (ctx.store.deployments.get(nsKey(NS, 'courier'))?.replicas ?? 0) === 6,
      },
      {
        id: 'quota',
        title: 'Stopped by the quota',
        text: 'Five ships moored, the sixth was refused: the quota counts ships and requests across the whole fleet. Open the Log to see the FailedCreate event. Your side of the fix is to ask for what the fleet allows: scrap one so spec says 5.',
        cta: 'Open the Log, then Scrap one on the courier shipyard',
        hint: 'Press Log on the left rail; then click the courier shipyard and press Scrap one.',
        anchor: { kind: 'map', key: `b:${nsKey(NS, 'courier')}`, placement: 'bottom' },
        waitFor: () => quotaEvents() > 0 && (ctx.store.deployments.get(nsKey(NS, 'courier'))?.replicas ?? 0) === 5 && readyShips(ctx.store, NS, 'courier') >= 5,
      },
      {
        id: 'defaults',
        onEnter: () => selection.clear(),
        title: 'Defaults you never wrote',
        text: 'Open the shipyard\'s card: requests say 100m and 64Mi, limits 500m and 256Mi. You set none of them; the LimitRange stamped the platform team\'s defaults onto your ships. The app team writes Deployments and Services; the platform team writes the rules those live under.',
        cta: 'Select the courier shipyard and read its berth line',
        anchor: { kind: 'map', key: `b:${nsKey(NS, 'courier')}`, placement: 'bottom' },
        waitFor: () => selection.keys.has(`b:${nsKey(NS, 'courier')}`) && /100m/.test(ctx.store.deployments.get(nsKey(NS, 'courier'))?.requests ?? ''),
      },
      {
        id: 'gate',
        onEnter: () => selection.clear(),
        title: 'A gate needs a keeper',
        text: 'Open a gate for the courier lighthouse (host courier.example). The app team writes the Ingress; whether any traders come through depends on an IngressClass and a controller the platform team provides. Set CLASS to harbor-nginx, the class the authority offers.',
        cta: 'Open gate courier-gate, host courier.example, class harbor-nginx',
        hint: `Shop → Gate → namespace ${NS}, name courier-gate, host courier.example, lighthouse courier, class harbor-nginx, OPEN GATE.`,
        anchor: { kind: 'dom', selector: '#hud [data-shop-open]', placement: 'top' },
        waitFor: () => { const g = gateFor(ctx.store, NS, 'courier'); if (g) gateName = g; return !!g && ctx.store.ingresses.get(nsKey(NS, g))?.class === 'harbor-nginx'; },
      },
      {
        id: 'platform',
        onEnter: () => {
          const ing = ctx.store.ingresses.get(nsKey(NS, gateName));
          ledger.add({ who: 'the platform team', what: `IngressClass harbor-nginx claimed ${gateName}; ResourceQuota ${NS} raised to 8 pods`, dir: 'change' });
          if (ctx.mode === 'sim') {
            const a = authorities.get(NS);
            if (a?.quota) a.quota.pods = 8;
            if (ing) setTimeout(() => ctx.store.apply({ type: 'modified', kind: 'Ingress', obj: { ...ing, addresses: ['10.96.0.7'] } }), 800);
          }
        },
        title: 'The other crew\'s turn',
        text: 'Now the platform team acts, in forms you cannot open: the ingress controller for class harbor-nginx claims your gate and gives it an address, and the quota is raised to 8 ships. Nothing in your manifests changed. Launch two more ships to use the room.',
        cta: 'Launch ship twice on courier (to 7)',
        hint: 'Click the courier shipyard and press Launch ship twice.',
        anchor: { kind: 'map', key: `b:${nsKey(NS, 'courier')}`, placement: 'bottom' },
        waitFor: () => (ctx.store.deployments.get(nsKey(NS, 'courier'))?.replicas ?? 0) >= 7 && readyShips(ctx.store, NS, 'courier') >= 7,
      },
      {
        id: 'lesson',
        title: 'Boundaries that match the org',
        text: 'App teams write Deployments, Services, ConfigMaps, Ingresses. Platform teams provide StorageClasses, IngressClasses, quotas, LimitRanges, network policies and admission control, and RBAC decides who may write which kind. The API boundaries match the organisation, which is why this scaled in enterprises.',
        anchor: { kind: 'none' },
      },
    ];
  },
  summary: () => ({
    naval: 'The harbor authority refused a shipyard with no team ensign at the door, held the fleet to five ships, and stamped berths onto ships that asked for none. The app team fixed what was theirs; the platform crew claimed the gate and raised the quota without touching a single app manifest.',
    kubernetes: 'ResourceQuota caps a namespace\'s pods and requests; LimitRange sets defaults and bounds per container; admission control (ValidatingAdmissionPolicy, webhooks) accepts or refuses every write; IngressClass and StorageClass name what the platform provides; RBAC grants each team the kinds it may write.',
    devops: 'An enterprise gave each product team a namespace with a quota, a LimitRange and a policy requiring a cost-centre label. Teams deployed without tickets; the platform team changed the ingress controller and the default StorageClass twice a year and no team noticed.',
    manifest: 'apiVersion: v1\nkind: ResourceQuota             # written by the platform team\nmetadata:\n  name: harbor-authority\n  namespace: harbor\nspec:\n  hard:\n    pods: "5"\n    requests.cpu: "2"\n    requests.memory: 2Gi\n---\napiVersion: v1\nkind: LimitRange\nmetadata:\n  name: harbor-authority\n  namespace: harbor\nspec:\n  limits:\n    - type: Container\n      defaultRequest: { cpu: 100m, memory: 64Mi }\n      default: { cpu: 500m, memory: 256Mi }',
    kubectl: 'kubectl get resourcequota -n harbor\nkubectl describe limitrange harbor-authority -n harbor\nkubectl get ingressclass\nkubectl auth can-i create deployments -n harbor   # the app team\nkubectl auth can-i create resourcequotas -n harbor   # usually no',
  }),
};
