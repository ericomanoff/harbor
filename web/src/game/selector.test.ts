import { describe, expect, it } from 'vitest';
import type { Pod, Service } from '../store/cluster';
import { matchesSelector, podsForService, servicesForPod } from './selector';

const pod = (ns: string, name: string, labels: Record<string, string>): Pod => ({ ns, name, node: 'n', phase: 'Running', ready: true, restarts: 0, created: 'x', labels, containers: [] });
const svc = (ns: string, name: string, selector: Record<string, string>): Service => ({ ns, name, type: 'ClusterIP', clusterIP: '1.2.3.4', ports: [], selector });

describe('selector', () => {
  it('requires every selector key to match', () => {
    expect(matchesSelector({ app: 'web', tier: 'fe' }, { app: 'web' })).toBe(true);
    expect(matchesSelector({ app: 'web' }, { app: 'web', tier: 'fe' })).toBe(false);
    expect(matchesSelector({ app: 'api' }, { app: 'web' })).toBe(false);
    expect(matchesSelector({ app: 'web' }, {})).toBe(false);
  });
  it('links services and pods within a namespace only', () => {
    const pods = [pod('a', 'web-1', { app: 'web' }), pod('a', 'api-1', { app: 'api' }), pod('b', 'web-x', { app: 'web' })];
    const services = [svc('a', 'web', { app: 'web' }), svc('b', 'web', { app: 'web' }), svc('a', 'none', {})];
    expect(podsForService(services[0]!, pods).map((p) => p.name)).toEqual(['web-1']);
    expect(servicesForPod(pods[0]!, services)).toEqual(['a/web']);
    expect(servicesForPod(pods[1]!, services)).toEqual([]);
  });
});
