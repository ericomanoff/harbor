import type { Pod, Service } from '../store/cluster';
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
