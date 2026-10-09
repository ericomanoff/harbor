import { describe, expect, it } from 'vitest';
import { deploymentKubectl, deploymentYaml, serviceKubectl, serviceYaml } from './manifest';

describe('manifest', () => {
  it('renders a Deployment with harbor notes', () => {
    const y = deploymentYaml({ ns: 'harbor', name: 'cargo-runner', image: 'nginx:1.27-alpine', replicas: 2, port: 80 });
    expect(y).toContain('kind: Deployment');
    expect(y).toContain('replicas: 2');
    expect(y).toContain('app: cargo-runner');
    expect(y).toContain('containerPort: 80');
    expect(y).toContain('# the shipyard');
    const probed = deploymentYaml({ ns: 'harbor', name: 'c', image: 'x', replicas: 1, port: 8080, readinessPath: '/ready', livenessPath: '/healthz' });
    expect(probed).toContain('readinessProbe');
    expect(probed).toContain('path: /healthz');
    expect(deploymentKubectl({ ns: 'harbor', name: 'cargo-runner', image: 'nginx', replicas: 1 })).toBe('kubectl create deployment cargo-runner --image=nginx --replicas=1 -n harbor');
  });
  it('renders a Service and the expose command', () => {
    const req = { ns: 'harbor', name: 'courier', selector: { app: 'courier' }, port: 80, targetPort: 8080 };
    expect(serviceYaml(req)).toContain('kind: Service');
    expect(serviceYaml(req)).toContain('    app: courier');
    expect(serviceKubectl(req)).toBe('kubectl expose deployment courier --name=courier --port=80 --target-port=8080 -n harbor');
    expect(serviceKubectl({ ...req, selector: { tier: 'web' } })).toContain('kubectl create service clusterip');
  });
});
