import type { CreateDeploymentRequest } from '../api/client';

/** The YAML a shipyard form produces, annotated with harbor words. */
export function deploymentYaml(req: CreateDeploymentRequest): string {
  const lines = [
    'apiVersion: apps/v1',
    'kind: Deployment            # the shipyard',
    'metadata:',
    `  name: ${req.name}`,
    `  namespace: ${req.ns}      # its fleet`,
    'spec:',
    `  replicas: ${req.replicas}              # ships to keep afloat`,
    '  selector:',
    '    matchLabels:',
    `      app: ${req.name}`,
    '  template:                 # the ship design',
    '    metadata:',
    '      labels:',
    `        app: ${req.name}    # the ensign`,
    '    spec:',
    '      containers:           # the cargo',
    `        - name: ${req.name}`,
    `          image: ${req.image}`,
  ];
  if (req.port) lines.push('          ports:', `            - containerPort: ${req.port}`);
  lines.push('          resources:', '            requests:         # the berth it reserves', `              cpu: ${req.cpuRequest ?? '50m'}`, `              memory: ${req.memRequest ?? '64Mi'}`);
  return lines.join('\n');
}

/** The one-line kubectl that does the same (minus requests and port). */
export function deploymentKubectl(req: CreateDeploymentRequest): string {
  return `kubectl create deployment ${req.name} --image=${req.image} --replicas=${req.replicas} -n ${req.ns}`;
}
