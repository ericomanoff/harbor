import { describe, expect, it } from 'vitest';
import { deploymentKubectl, deploymentYaml } from './manifest';

describe('manifest', () => {
  it('renders a Deployment with harbor notes', () => {
    const y = deploymentYaml({ ns: 'harbor', name: 'cargo-runner', image: 'nginx:1.27-alpine', replicas: 2, port: 80 });
    expect(y).toContain('kind: Deployment');
    expect(y).toContain('replicas: 2');
    expect(y).toContain('app: cargo-runner');
    expect(y).toContain('containerPort: 80');
    expect(y).toContain('# the shipyard');
    expect(deploymentKubectl({ ns: 'harbor', name: 'cargo-runner', image: 'nginx', replicas: 1 })).toBe('kubectl create deployment cargo-runner --image=nginx --replicas=1 -n harbor');
  });
});
