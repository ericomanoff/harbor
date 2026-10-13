import { inDemoHarbor } from '../api/client';
import { store } from '../app';
import { training } from '../tour/training';
import { actorName, describeChange, ledger } from './ledger';

/**
 * Feeds the ledger from the store: every object change the stream delivers,
 * attributed to its last field manager on a real cluster, or to the actor
 * the simulator stamped in the training harbor.
 */
export function startLedgerFeed(): () => void {
  return store.subscribe((e) => {
    if (e.type === 'snapshot' || e.type === 'event') return;
    const name = e.key.includes('/') ? e.key.split('/').slice(-1)[0]! : e.key;
    const kind = { node: 'Node', namespace: 'Namespace', deployment: 'Deployment', pod: 'Pod', release: 'HelmRelease', service: 'Service', workload: 'Workload', ingress: 'Ingress' }[e.type];
    let who = 'the cluster';
    if (training.active || inDemoHarbor()) who = ledger.actor;
    else if (e.op === 'upsert') {
      const obj = e.type === 'pod' ? store.pods.get(e.key) : e.type === 'deployment' ? store.deployments.get(e.key) : undefined;
      const managers = (obj as { managers?: string[] } | undefined)?.managers;
      who = actorName(managers?.[managers.length - 1]);
    }
    ledger.add({ who, what: describeChange(kind, name, e.op), kind, name, dir: 'change' });
  });
}
