package kube

import (
	"context"
	"fmt"
	"log"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	netv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	appslisters "k8s.io/client-go/listers/apps/v1"
	batchlisters "k8s.io/client-go/listers/batch/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	netlisters "k8s.io/client-go/listers/networking/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

const (
	byNodeIndex = "byNode"
	resyncEvery = 10 * time.Minute
	// Events older than this at the time we see them are history, not news.
	eventFreshness = 2 * time.Minute
)

// Watcher runs shared informers for one cluster, converts changes to wire
// models and publishes them to a Hub. Snapshot reads straight from the
// informer caches.
type Watcher struct {
	Context string

	client  kubernetes.Interface
	hub     *Hub
	factory informers.SharedInformerFactory

	nodes        corelisters.NodeLister
	namespaces   corelisters.NamespaceLister
	services     corelisters.ServiceLister
	pods         corelisters.PodLister
	podIndexer   cache.Indexer
	deployments  appslisters.DeploymentLister
	replicasets  appslisters.ReplicaSetLister
	statefulsets appslisters.StatefulSetLister
	daemonsets   appslisters.DaemonSetLister
	jobs         batchlisters.JobLister
	ingresses    netlisters.IngressLister

	// Helm release secrets live in their own factory so the label selector
	// does not narrow the other informers.
	helmFactory informers.SharedInformerFactory
	secrets     corelisters.SecretLister

	synced   atomic.Bool
	stop     chan struct{}
	stopOnce sync.Once
}

// NewWatcher wires informers and handlers but does not start them.
func NewWatcher(contextName string, client kubernetes.Interface, hub *Hub) *Watcher {
	f := informers.NewSharedInformerFactory(client, resyncEvery)
	w := &Watcher{
		Context: contextName,
		client:  client,
		hub:     hub,
		factory: f,
		stop:    make(chan struct{}),
	}

	nodeInf := f.Core().V1().Nodes()
	nsInf := f.Core().V1().Namespaces()
	podInf := f.Core().V1().Pods()
	depInf := f.Apps().V1().Deployments()
	rsInf := f.Apps().V1().ReplicaSets()
	evInf := f.Core().V1().Events()
	svcInf := f.Core().V1().Services()
	ssInf := f.Apps().V1().StatefulSets()
	dsInf := f.Apps().V1().DaemonSets()
	jobInf := f.Batch().V1().Jobs()
	ingInf := f.Networking().V1().Ingresses()

	if err := podInf.Informer().AddIndexers(cache.Indexers{byNodeIndex: podNodeIndex}); err != nil {
		panic(err) // only fails if the index name is already registered
	}

	w.nodes = nodeInf.Lister()
	w.namespaces = nsInf.Lister()
	w.pods = podInf.Lister()
	w.podIndexer = podInf.Informer().GetIndexer()
	w.deployments = depInf.Lister()
	w.replicasets = rsInf.Lister()
	w.services = svcInf.Lister()
	w.statefulsets = ssInf.Lister()
	w.daemonsets = dsInf.Lister()
	w.jobs = jobInf.Lister()
	w.ingresses = ingInf.Lister()

	addHandlers(nodeInf.Informer(), w.onNode, w.onNodeDeleted)
	addHandlers(nsInf.Informer(), w.onNamespace, w.onNamespaceDeleted)
	addHandlers(depInf.Informer(), w.onDeployment, w.onDeploymentDeleted)
	addHandlers(podInf.Informer(), w.onPod, w.onPodDeleted)
	addHandlers(svcInf.Informer(), w.onService, w.onServiceDeleted)
	addHandlers(ingInf.Informer(), func(i *netv1.Ingress) { w.publish(gen.WsMessageTypeModified, ConvertIngress(i)) }, func(i *netv1.Ingress) {
		w.publish(gen.WsMessageTypeDeleted, gen.Ingress{Ns: i.Namespace, Name: i.Name, Hosts: []string{}, Rules: []gen.IngressRule{}, Addresses: []string{}})
	})
	addHandlers(ssInf.Informer(), func(ss *appsv1.StatefulSet) { w.onWorkload(ConvertStatefulSet(ss)) }, func(ss *appsv1.StatefulSet) { w.onWorkloadDeleted(gen.WorkloadKindStatefulSet, ss.Namespace, ss.Name) })
	addHandlers(dsInf.Informer(), func(ds *appsv1.DaemonSet) { w.onWorkload(ConvertDaemonSet(ds)) }, func(ds *appsv1.DaemonSet) { w.onWorkloadDeleted(gen.WorkloadKindDaemonSet, ds.Namespace, ds.Name) })
	addHandlers(jobInf.Informer(), func(j *batchv1.Job) { w.onWorkload(ConvertJob(j)) }, func(j *batchv1.Job) { w.onWorkloadDeleted(gen.WorkloadKindJob, j.Namespace, j.Name) })
	_, _ = podInf.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		UpdateFunc: func(oldObj, _ any) { w.onPodMoved(oldObj) },
	})
	_, _ = rsInf.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    w.onReplicaSetAdded,
		UpdateFunc: func(_, obj any) { w.republishOwner(obj) },
	})
	_, _ = evInf.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    w.onEvent,
		UpdateFunc: func(_, obj any) { w.onEvent(obj) },
	})

	w.helmFactory = informers.NewSharedInformerFactoryWithOptions(client, resyncEvery,
		informers.WithTweakListOptions(func(o *metav1.ListOptions) { o.LabelSelector = HelmSecretSelector }))
	secInf := w.helmFactory.Core().V1().Secrets()
	w.secrets = secInf.Lister()
	addHandlers(secInf.Informer(), w.onHelmSecret, w.onHelmSecret)
	return w
}

// addHandlers registers upsert/delete callbacks that unwrap tombstones.
func addHandlers[T any](inf cache.SharedIndexInformer, upsert func(T), del func(T)) {
	_, _ = inf.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj any) {
			if v, ok := obj.(T); ok {
				upsert(v)
			}
		},
		UpdateFunc: func(_, obj any) {
			if v, ok := obj.(T); ok {
				upsert(v)
			}
		},
		DeleteFunc: func(obj any) {
			if ts, ok := obj.(cache.DeletedFinalStateUnknown); ok {
				obj = ts.Obj
			}
			if v, ok := obj.(T); ok {
				del(v)
			}
		},
	})
}

func podNodeIndex(obj any) ([]string, error) {
	p, ok := obj.(*corev1.Pod)
	if !ok || p.Spec.NodeName == "" {
		return nil, nil
	}
	return []string{p.Spec.NodeName}, nil
}

// Start runs the informers and blocks until every cache has synced or ctx
// ends. A context deadline is the only way out when RBAC denies a list.
func (w *Watcher) Start(ctx context.Context) error {
	w.factory.Start(w.stop)
	w.helmFactory.Start(w.stop)
	done := make(chan map[string]bool, 1)
	go func() {
		res := map[string]bool{}
		for typ, ok := range w.factory.WaitForCacheSync(w.stop) {
			res[typ.String()] = ok
		}
		for typ, ok := range w.helmFactory.WaitForCacheSync(w.stop) {
			res["helm:"+typ.String()] = ok
		}
		done <- res
	}()
	select {
	case <-ctx.Done():
		w.Stop()
		return fmt.Errorf("waiting for informer sync: %w", ctx.Err())
	case res := <-done:
		for typ, ok := range res {
			if !ok {
				w.Stop()
				return fmt.Errorf("informer for %s failed to sync", typ)
			}
		}
	}
	w.synced.Store(true)
	return nil
}

// Client returns the clientset this watcher reads with; writes go through it too.
func (w *Watcher) Client() kubernetes.Interface { return w.client }

// Stop halts the informers. Safe to call more than once.
func (w *Watcher) Stop() {
	w.stopOnce.Do(func() {
		close(w.stop)
		w.factory.Shutdown()
		w.helmFactory.Shutdown()
	})
}

// Snapshot returns the whole cluster state from the caches, sorted so the
// output is stable.
func (w *Watcher) Snapshot() gen.Snapshot {
	snap := gen.Snapshot{
		Context:     w.Context,
		Nodes:       []gen.Node{},
		Namespaces:  []gen.Namespace{},
		Deployments: []gen.Deployment{},
		Pods:        []gen.Pod{},
		Releases:    []gen.HelmRelease{},
		Services:    []gen.Service{},
		Workloads:   []gen.Workload{},
		Ingresses:   []gen.Ingress{},
	}
	if ings, err := w.ingresses.List(labels.Everything()); err == nil {
		for _, i := range ings {
			snap.Ingresses = append(snap.Ingresses, ConvertIngress(i))
		}
	}
	if sss, err := w.statefulsets.List(labels.Everything()); err == nil {
		for _, ss := range sss {
			snap.Workloads = append(snap.Workloads, ConvertStatefulSet(ss))
		}
	}
	if dss, err := w.daemonsets.List(labels.Everything()); err == nil {
		for _, ds := range dss {
			snap.Workloads = append(snap.Workloads, ConvertDaemonSet(ds))
		}
	}
	if jobs, err := w.jobs.List(labels.Everything()); err == nil {
		for _, j := range jobs {
			snap.Workloads = append(snap.Workloads, ConvertJob(j))
		}
	}
	if svcs, err := w.services.List(labels.Everything()); err == nil {
		for _, s := range svcs {
			snap.Services = append(snap.Services, ConvertService(s))
		}
	}
	if nodes, err := w.nodes.List(labels.Everything()); err == nil {
		for _, n := range nodes {
			snap.Nodes = append(snap.Nodes, ConvertNode(n, w.podsOnNode(n.Name)))
		}
	}
	if nss, err := w.namespaces.List(labels.Everything()); err == nil {
		for _, ns := range nss {
			snap.Namespaces = append(snap.Namespaces, ConvertNamespace(ns))
		}
	}
	if deps, err := w.deployments.List(labels.Everything()); err == nil {
		for _, d := range deps {
			snap.Deployments = append(snap.Deployments, w.convertDeployment(d))
		}
	}
	if pods, err := w.pods.List(labels.Everything()); err == nil {
		for _, p := range pods {
			snap.Pods = append(snap.Pods, w.convertPod(p))
		}
	}
	snap.Releases = w.releases()
	sort.Slice(snap.Nodes, func(i, j int) bool { return snap.Nodes[i].Name < snap.Nodes[j].Name })
	sort.Slice(snap.Namespaces, func(i, j int) bool { return snap.Namespaces[i].Name < snap.Namespaces[j].Name })
	sort.Slice(snap.Deployments, func(i, j int) bool {
		a, b := snap.Deployments[i], snap.Deployments[j]
		return a.Ns < b.Ns || (a.Ns == b.Ns && a.Name < b.Name)
	})
	sort.Slice(snap.Pods, func(i, j int) bool {
		a, b := snap.Pods[i], snap.Pods[j]
		return a.Ns < b.Ns || (a.Ns == b.Ns && a.Name < b.Name)
	})
	sort.Slice(snap.Services, func(i, j int) bool {
		a, b := snap.Services[i], snap.Services[j]
		return a.Ns < b.Ns || (a.Ns == b.Ns && a.Name < b.Name)
	})
	sort.Slice(snap.Ingresses, func(i, j int) bool {
		a, b := snap.Ingresses[i], snap.Ingresses[j]
		return a.Ns < b.Ns || (a.Ns == b.Ns && a.Name < b.Name)
	})
	sort.Slice(snap.Workloads, func(i, j int) bool {
		a, b := snap.Workloads[i], snap.Workloads[j]
		return a.Kind < b.Kind || (a.Kind == b.Kind && (a.Ns < b.Ns || (a.Ns == b.Ns && a.Name < b.Name)))
	})
	return snap
}

// releases folds every Helm storage secret down to the newest revision per
// release, sorted by namespace and name.
func (w *Watcher) releases() []gen.HelmRelease {
	secs, err := w.secrets.List(labels.Everything())
	if err != nil {
		return []gen.HelmRelease{}
	}
	latest := map[string]gen.HelmRelease{}
	for _, s := range secs {
		r, ok := ConvertHelmSecret(s)
		if !ok {
			continue
		}
		key := r.Ns + "/" + r.Name
		if cur, seen := latest[key]; !seen || r.Revision > cur.Revision {
			latest[key] = r
		}
	}
	out := make([]gen.HelmRelease, 0, len(latest))
	for _, r := range latest {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Ns < out[j].Ns || (out[i].Ns == out[j].Ns && out[i].Name < out[j].Name)
	})
	return out
}

// onHelmSecret republishes the release a storage secret belongs to, or its
// deletion when no revision of it remains.
func (w *Watcher) onHelmSecret(s *corev1.Secret) {
	r, ok := ConvertHelmSecret(s)
	if !ok {
		return
	}
	for _, cur := range w.releases() {
		if cur.Ns == r.Ns && cur.Name == r.Name {
			w.publish(gen.WsMessageTypeModified, cur)
			return
		}
	}
	w.publish(gen.WsMessageTypeDeleted, gen.HelmRelease{Ns: r.Ns, Name: r.Name, Revision: r.Revision, Status: "uninstalled"})
}

func (w *Watcher) podsOnNode(name string) []*corev1.Pod {
	objs, err := w.podIndexer.ByIndex(byNodeIndex, name)
	if err != nil {
		return nil
	}
	pods := make([]*corev1.Pod, 0, len(objs))
	for _, o := range objs {
		if p, ok := o.(*corev1.Pod); ok {
			pods = append(pods, p)
		}
	}
	return pods
}

func (w *Watcher) deploymentFor(p *corev1.Pod) string {
	rsName := OwnerOfKind(p.OwnerReferences, "ReplicaSet")
	if rsName == "" {
		return ""
	}
	rs, err := w.replicasets.ReplicaSets(p.Namespace).Get(rsName)
	if err != nil {
		return ""
	}
	return OwnerOfKind(rs.OwnerReferences, "Deployment")
}

func (w *Watcher) convertPod(p *corev1.Pod) gen.Pod {
	return ConvertPod(p, w.deploymentFor(p))
}

// convertDeployment adds the current ReplicaSet so the map can tell a
// rollout's new units from the old ones.
func (w *Watcher) convertDeployment(d *appsv1.Deployment) gen.Deployment {
	out := ConvertDeployment(d)
	sets, err := w.replicasets.ReplicaSets(d.Namespace).List(labels.Everything())
	if err == nil {
		if rs := CurrentReplicaSet(d, sets); rs != "" {
			out.CurrentRS = &rs
		}
	}
	return out
}

// republishOwner re-emits the Deployment owning a changed ReplicaSet.
func (w *Watcher) republishOwner(obj any) {
	rs, ok := obj.(*appsv1.ReplicaSet)
	if !ok {
		return
	}
	name := OwnerOfKind(rs.OwnerReferences, "Deployment")
	if name == "" {
		return
	}
	if d, err := w.deployments.Deployments(rs.Namespace).Get(name); err == nil {
		w.onDeployment(d)
	}
}

// publish drops changes seen before the initial sync: clients get those via
// Snapshot, and replaying thousands of adds would only flood them.
func (w *Watcher) publish(t gen.WsMessageType, v any) {
	if !w.synced.Load() {
		return
	}
	w.hub.Publish(NewMessage(t, v))
}

func (w *Watcher) onNode(n *corev1.Node) {
	w.publish(gen.WsMessageTypeModified, ConvertNode(n, w.podsOnNode(n.Name)))
}

func (w *Watcher) onNodeDeleted(n *corev1.Node) {
	w.publish(gen.WsMessageTypeDeleted, gen.Node{Name: n.Name, Labels: map[string]string{}})
}

// republishNode recomputes a node's request totals after a pod change.
func (w *Watcher) republishNode(name string) {
	if name == "" {
		return
	}
	n, err := w.nodes.Get(name)
	if err != nil {
		return
	}
	w.onNode(n)
}

func (w *Watcher) onWorkload(wl gen.Workload) {
	w.publish(gen.WsMessageTypeModified, wl)
}

func (w *Watcher) onWorkloadDeleted(kind gen.WorkloadKind, ns, name string) {
	w.publish(gen.WsMessageTypeDeleted, gen.Workload{Kind: kind, Ns: ns, Name: name, Conditions: []gen.Condition{}})
}

func (w *Watcher) onService(svc *corev1.Service) {
	w.publish(gen.WsMessageTypeModified, ConvertService(svc))
}

func (w *Watcher) onServiceDeleted(svc *corev1.Service) {
	w.publish(gen.WsMessageTypeDeleted, gen.Service{Ns: svc.Namespace, Name: svc.Name, Ports: []gen.ServicePort{}, Selector: map[string]string{}})
}

func (w *Watcher) onNamespace(ns *corev1.Namespace) {
	w.publish(gen.WsMessageTypeModified, ConvertNamespace(ns))
}

func (w *Watcher) onNamespaceDeleted(ns *corev1.Namespace) {
	w.publish(gen.WsMessageTypeDeleted, gen.Namespace{Name: ns.Name})
}

func (w *Watcher) onDeployment(d *appsv1.Deployment) {
	w.publish(gen.WsMessageTypeModified, w.convertDeployment(d))
}

func (w *Watcher) onDeploymentDeleted(d *appsv1.Deployment) {
	w.publish(gen.WsMessageTypeDeleted, gen.Deployment{Ns: d.Namespace, Name: d.Name, Conditions: []gen.Condition{}})
}

func (w *Watcher) onPod(p *corev1.Pod) {
	w.publish(gen.WsMessageTypeModified, w.convertPod(p))
	w.republishNode(p.Spec.NodeName)
}

// onPodMoved handles the rare case of a pod's node changing between updates
// (only possible via binding), so the old node's totals are corrected too.
func (w *Watcher) onPodMoved(oldObj any) {
	old, ok := oldObj.(*corev1.Pod)
	if !ok || old.Spec.NodeName == "" {
		return
	}
	if cur, err := w.pods.Pods(old.Namespace).Get(old.Name); err == nil && cur.Spec.NodeName == old.Spec.NodeName {
		return
	}
	w.republishNode(old.Spec.NodeName)
}

func (w *Watcher) onPodDeleted(p *corev1.Pod) {
	w.publish(gen.WsMessageTypeDeleted, gen.Pod{Ns: p.Namespace, Name: p.Name, Node: p.Spec.NodeName, Phase: "Deleted", Labels: map[string]string{}, Containers: []string{}})
	w.republishNode(p.Spec.NodeName)
}

// onReplicaSetAdded republishes the pods of a ReplicaSet that arrived after
// its pods did, so their Deployment field gets resolved.
func (w *Watcher) onReplicaSetAdded(obj any) {
	rs, ok := obj.(*appsv1.ReplicaSet)
	if !ok || !w.synced.Load() {
		return
	}
	pods, err := w.pods.Pods(rs.Namespace).List(labels.Everything())
	if err != nil {
		return
	}
	for _, p := range pods {
		if OwnerOfKind(p.OwnerReferences, "ReplicaSet") == rs.Name {
			w.publish(gen.WsMessageTypeModified, w.convertPod(p))
		}
	}
	w.republishOwner(rs)
}

func (w *Watcher) onEvent(obj any) {
	e, ok := obj.(*corev1.Event)
	if !ok {
		return
	}
	if time.Since(EventTime(e)) > eventFreshness {
		return
	}
	w.publish(gen.WsMessageTypeAdded, ConvertEvent(e))
}

// Ping verifies the API server answers before informers are started, so a
// bad context fails in a second with a clear error instead of a sync timeout.
func Ping(ctx context.Context, client kubernetes.Interface) error {
	done := make(chan error, 1)
	go func() {
		_, err := client.Discovery().ServerVersion()
		done <- err
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-done:
		if err != nil {
			log.Printf("kube: ping failed: %v", err)
		}
		return err
	}
}
