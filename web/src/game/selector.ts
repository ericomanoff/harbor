import type { Ingress, Pod, Service } from '../store/cluster';
import { nsKey } from '../store/cluster';

/** Kubernetes equality selector: every selector key must match the labels. */
export function matchesSelector(labels: Record<string, string>, selector: Record<string, string>): boolean {
  const keys = Object.keys(selector);
  if (keys.length === 0) return false; // a selector-less Service routes nowhere
  return keys.every((k) => labels[k] === selector[k]);
}

/** Pods in the Service's namespace that its selector routes to. */
export function podsForService(svc: Service, pods: Iterable<Pod>): Pod[] {
  const out: Pod[] = [];
  for (const p of pods) if (p.ns === svc.ns && matchesSelector(p.labels, svc.selector)) out.push(p);
  return out;
}

/** Services that route to the pod, by key "ns/name". */
export function servicesForPod(pod: Pod, services: Iterable<Service>): string[] {
  const out: string[] = [];
  for (const s of services) if (s.ns === pod.ns && matchesSelector(pod.labels, s.selector)) out.push(nsKey(s.ns, s.name));
  return out;
}

/** Service keys ("ns/name") a gate channels traffic to, deduplicated, in rule order. */
export function servicesForIngress(ing: Ingress): string[] {
  const out: string[] = [];
  for (const r of ing.rules) {
    const k = nsKey(ing.ns, r.service);
    if (r.service && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Gates whose rules point at the service. */
export function ingressesForService(svc: Service, ingresses: Iterable<Ingress>): string[] {
  const out: string[] = [];
  for (const i of ingresses) if (i.ns === svc.ns && i.rules.some((r) => r.service === svc.name)) out.push(nsKey(i.ns, i.name));
  return out;
}
