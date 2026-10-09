import type { CreateDeploymentRequest, CreateIngressRequest, CreateOrdersRequest, CreateServiceRequest } from '../api/client';

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
  if (req.orders?.length) {
    lines.push('          envFrom:              # sealed orders, read at launch');
    for (const o of req.orders) lines.push(`            - ${o.kind === 'Secret' ? 'secretRef' : 'configMapRef'}:`, `                name: ${o.name}`);
  }
  lines.push('          resources:', '            requests:         # the berth it reserves', `              cpu: ${req.cpuRequest ?? '50m'}`, `              memory: ${req.memRequest ?? '64Mi'}`);
  if (req.cpuLimit || req.memLimit) {
    lines.push('            limits:           # the cargo cap');
    if (req.cpuLimit) lines.push(`              cpu: ${req.cpuLimit}`);
    if (req.memLimit) lines.push(`              memory: ${req.memLimit}`);
  }
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

/** The YAML a sealed-orders form produces (Secret values shown as the form typed them). */
export function ordersYaml(req: CreateOrdersRequest): string {
  const lines = ['apiVersion: v1', `kind: ${req.kind}${req.kind === 'Secret' ? '               # a sealed envelope' : '            # the chart locker'}`, 'metadata:', `  name: ${req.name}`, `  namespace: ${req.ns}`];
  if (req.kind === 'Secret') lines.push('type: Opaque', 'stringData:                 # stored base64-encoded, not encrypted');
  else lines.push('data:');
  for (const [k, v] of Object.entries(req.data)) lines.push(`  ${k}: ${JSON.stringify(v)}`);
  return lines.join('\n');
}

export function ordersKubectl(req: CreateOrdersRequest): string {
  const lits = Object.entries(req.data).map(([k, v]) => `--from-literal=${k}=${v}`).join(' ');
  return `kubectl create ${req.kind === 'Secret' ? 'secret generic' : 'configmap'} ${req.name} ${lits} -n ${req.ns}`;
}

/** The YAML a gate form produces. */
export function ingressYaml(req: CreateIngressRequest): string {
  const lines = ['apiVersion: networking.k8s.io/v1', 'kind: Ingress               # the gate at the harbor mouth', 'metadata:', `  name: ${req.name}`, `  namespace: ${req.ns}`, 'spec:'];
  if (req.class) lines.push(`  ingressClassName: ${req.class}`);
  if (req.tls) lines.push('  tls:                      # the gold chain', `    - hosts: [${req.host ?? '"*"'}]`, ...(req.tlsSecret ? [`      secretName: ${req.tlsSecret}`] : []));
  lines.push('  rules:');
  lines.push(`    - ${req.host ? `host: ${req.host}` : 'http:'}`);
  if (req.host) lines.push('      http:');
  lines.push('        paths:', `          - path: ${req.path ?? '/'}`, '            pathType: Prefix', '            backend:', '              service:          # the lighthouse behind the gate', `                name: ${req.service}`, '                port:', `                  ${/^\d+$/.test(req.port) ? 'number' : 'name'}: ${req.port}`);
  return lines.join('\n');
}

export function ingressKubectl(req: CreateIngressRequest): string {
  return `kubectl create ingress ${req.name} --rule="${req.host ?? ''}${req.path ?? '/'}*=${req.service}:${req.port}${req.tls ? ',tls' : ''}"${req.class ? ` --class=${req.class}` : ''} -n ${req.ns}`;
}
