import type { CreateDeploymentRequest, CreateServiceRequest } from '../api/client';

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
  if (req.readinessPath) lines.push('          readinessProbe:   # a lookout: may this ship take traders?', '            httpGet:', `              path: ${req.readinessPath}`, `              port: ${req.port ?? 80}`, '            periodSeconds: 5');
  if (req.livenessPath) lines.push('          livenessProbe:    # a lookout: is this ship still alive?', '            httpGet:', `              path: ${req.livenessPath}`, `              port: ${req.port ?? 80}`, '            periodSeconds: 10');
  lines.push('          resources:', '            requests:         # the berth it reserves', `              cpu: ${req.cpuRequest ?? '50m'}`, `              memory: ${req.memRequest ?? '64Mi'}`);
  return lines.join('\n');
}

/** The one-line kubectl that does the same (minus requests and port). */
export function deploymentKubectl(req: CreateDeploymentRequest): string {
  return `kubectl create deployment ${req.name} --image=${req.image} --replicas=${req.replicas} -n ${req.ns}`;
}

/** The YAML a lighthouse form produces. */
export function serviceYaml(req: CreateServiceRequest): string {
  const lines = [
    'apiVersion: v1',
    'kind: Service               # the lighthouse',
    'metadata:',
    `  name: ${req.name}`,
    `  namespace: ${req.ns}`,
    'spec:',
    `  type: ${req.type ?? 'ClusterIP'}`,
    '  selector:                 # which ships the beam reaches',
    ...Object.entries(req.selector).map(([k, v]) => `    ${k}: ${v}`),
    '  ports:',
    `    - port: ${req.port}             # where traders knock`,
    `      targetPort: ${req.targetPort ?? req.port}       # the ship's own hatch`,
  ];
  return lines.join('\n');
}

export function serviceKubectl(req: CreateServiceRequest): string {
  const sel = Object.entries(req.selector).map(([k, v]) => `${k}=${v}`).join(',');
  const app = req.selector['app'];
  return app && Object.keys(req.selector).length === 1
    ? `kubectl expose deployment ${app} --name=${req.name} --port=${req.port} --target-port=${req.targetPort ?? req.port} -n ${req.ns}`
    : `kubectl create service clusterip ${req.name} --tcp=${req.port}:${req.targetPort ?? req.port} -n ${req.ns}  # then set selector ${sel}`;
}
