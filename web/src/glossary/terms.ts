/**
 * The one glossary: every Kubernetes or Helm concept the harbor shows, the
 * nautical word it is drawn as, and the other way round. UI text is marked
 * up from this; tooltips and the glossary panel read from it.
 *
 * Voice: Kubernetes first. `concept` explains the real thing for someone
 * who has never used it, `useCase` names a situation where it matters, and
 * `inHarbor` is the one sentence that mentions the game.
 */
export interface Term {
  id: string;
  /** Naval words and phrases (first is canonical). */
  naval: string[];
  /** Kubernetes / Helm words (first is canonical). Empty for pure harbor UI words. */
  k8s: string[];
  /** One or two sentences on the Kubernetes concept; no harbor words. */
  concept: string;
  /** One sentence: the situation in which the concept matters. */
  useCase?: string;
  /** One sentence mapping the concept to the game. */
  inHarbor: string;
  /** Extra depth for the glossary panel. */
  detail?: string;
  /** Where it appears on the map. */
  where?: string;
  docs?: string;
}

const K8S = 'https://kubernetes.io/docs/concepts';
const HELM = 'https://helm.sh/docs';

export const TERMS: Term[] = [
  { id: 'harbor', naval: ['harbor', 'theater'], k8s: ['cluster', 'context', 'kubeconfig context'],
    concept: 'A cluster is a set of machines (nodes) managed by one control plane that runs your containers. A kubeconfig file names the clusters you can talk to; the current context picks one.',
    useCase: 'You meet contexts the moment you have more than one cluster, such as dev and production, and must be sure which one kubectl is pointed at.',
    inHarbor: 'The whole harbor is one cluster; the badge shows its context and lets you sail to another.',
    where: 'The badge, top left.', docs: `${K8S}/overview/components/` },
  { id: 'harbor-master', naval: ['harbor master'], k8s: ['control plane', 'API server'],
    concept: 'The control plane is the brain of a cluster: the API server stores what you asked for, the scheduler picks nodes for pods, and controllers keep reconciling reality toward the desired state.',
    useCase: 'Every kubectl command talks to the API server; when a pod you deleted comes back, a controller on the control plane did that.',
    inHarbor: 'The harbor master voices the control plane and runs the tour and the academy.',
    docs: `${K8S}/overview/components/#control-plane-components` },
  { id: 'dock', naval: ['dock', 'island', 'docks', 'islands'], k8s: ['node', 'nodes', 'worker node'],
    concept: 'A node is a machine, virtual or physical, that runs pods. Its kubelet reports health and capacity; a node is Ready when the kubelet is healthy and NotReady when it stops answering.',
    useCase: 'You look at nodes when pods will not schedule, when a machine is being drained for maintenance, or when capacity runs out.',
    inHarbor: 'Each island is a node; a dark island with a red beacon is NotReady, and island size follows allocatable CPU.',
    where: 'Every island on the map.', docs: `${K8S}/architecture/nodes/` },
  { id: 'berths', naval: ['berths', 'berth'], k8s: ['allocatable CPU', 'CPU request', 'allocatable'],
    concept: 'Each node advertises allocatable CPU. Pods reserve some of it with requests, and the scheduler only places a pod on a node with enough unreserved CPU left.',
    useCase: 'When a pod sits Pending with "insufficient cpu", the cluster has no node whose free allocatable CPU covers its request.',
    inHarbor: 'The BERTHS bar is CPU requests over allocatable across ready islands.',
    where: 'The BERTHS bar, top right.', docs: `${K8S}/configuration/manage-resources-containers/` },
  { id: 'cargo-bar', naval: ['cargo'], k8s: ['memory request', 'memory'],
    concept: 'Memory works like CPU: nodes advertise allocatable memory, pods reserve some with requests, and the scheduler fits requests into what is free.',
    useCase: 'A node that is out of allocatable memory leaves new pods Pending; a pod that uses more than its limit is OOM-killed.',
    inHarbor: 'The CARGO bar is memory requests over allocatable; on a ship, cargo also means its containers.',
    where: 'The CARGO bar; crates on deck.', docs: `${K8S}/configuration/manage-resources-containers/` },
  { id: 'crew', naval: ['crew'], k8s: ['ready pods', 'pods ready'],
    concept: 'A pod is Ready when every container in it passes its readiness check; only Ready pods receive traffic from a Service.',
    useCase: 'A rollout or an outage shows up first as the ready count dropping below the pod count.',
    inHarbor: 'The CREW bar counts ready pods over all the pods you can see.',
    where: 'The CREW bar.' },
  { id: 'ship', naval: ['ship', 'ships', 'vessel'], k8s: ['pod', 'pods'],
    concept: 'A pod is the smallest thing Kubernetes runs: one or more containers that share a network address and storage and live and die together. Pods are disposable; when one is deleted it is not restarted unless a controller owns it.',
    useCase: 'You run a bare pod to try an image or debug; everything that must stay up runs through a Deployment, StatefulSet, DaemonSet or Job instead.',
    inHarbor: 'A ship is a pod; each crate on deck is a container, and a lone ship with no shipyard is never replaced.',
    where: 'Moored in the shallows below each quay.', docs: `${K8S}/workloads/pods/` },
  { id: 'cargo-crate', naval: ['crate', 'crates'], k8s: ['container', 'containers', 'image'],
    concept: 'A container is one process running from an image, which packages the program and its dependencies. A pod can hold several containers that share its network and volumes.',
    useCase: 'You add a second container for a sidecar, such as a log shipper or a proxy, that must sit next to the main process.',
    inHarbor: 'Each crate on a ship\'s deck is a container.',
    where: 'Crates on a ship\'s deck.', docs: `${K8S}/containers/` },
  { id: 'shipyard', naval: ['shipyard', 'shipyards', 'slipway'], k8s: ['Deployment', 'Deployments'],
    concept: 'A Deployment declares how many copies of a pod you want and which image they run. Its controller keeps that many running, replaces any that die, and rolls out new versions gradually.',
    useCase: 'Use it for anything stateless that should survive crashes and node failures and be updated without downtime: web servers, APIs, workers.',
    inHarbor: 'A shipyard is a Deployment; Launch ship and Scrap one change its replicas.',
    where: 'On the land of an island.', docs: `${K8S}/workloads/controllers/deployment/` },
  { id: 'launch-queue', naval: ['launch queue', 'dry dock'], k8s: ['ReplicaSet', 'ReplicaSets'],
    concept: 'A ReplicaSet keeps an exact number of identical pods running. A Deployment owns one ReplicaSet per version of its pod template and moves pods between them during a rollout.',
    useCase: 'You see ReplicaSets in kubectl get rs after a rollout: the new one scaled up, the old ones kept at zero for rollback.',
    inHarbor: 'Ships from an old ReplicaSet look weathered until the refit replaces them.',
    docs: `${K8S}/workloads/controllers/replicaset/` },
  { id: 'launch', naval: ['launch ship', 'launch', 'scrap one', 'scrap'], k8s: ['scale', 'replicas', 'scaling'],
    concept: 'Scaling sets how many replicas a workload keeps. Scaling up creates pods; scaling down terminates some, and a pod-deletion-cost annotation can say which go first.',
    useCase: 'You scale up before a traffic peak or when latency climbs, and down to save money; an autoscaler can do both from metrics.',
    inHarbor: 'Launch ship and Scrap one scale a shipyard; scrapping a chosen ship marks that pod to go first.',
    docs: `${K8S}/workloads/controllers/deployment/#scaling-a-deployment` },
  { id: 'refit', naval: ['refit', 'refit ship'], k8s: ['rollout', 'rolling update', 'restart'],
    concept: 'Changing a Deployment\'s pod template starts a rollout: a new ReplicaSet launches pods while the old one retires them, keeping within maxUnavailable and maxSurge so service continues.',
    useCase: 'Every new image version is a rollout; you set maxUnavailable to 0 when the fleet must never shrink, and a readiness probe so bad pods stop it.',
    inHarbor: 'Refit shipyard starts a rollout; Refit ship on one pod deletes it so the controller replaces it.',
    docs: `${K8S}/workloads/controllers/deployment/#updating-a-deployment` },
  { id: 'rollback', naval: ['roll back', 'rollback'], k8s: ['rollback', 'revision', 'revisions'],
    concept: 'Deployments and Helm releases keep a history of revisions. A rollback makes an earlier revision current again, as a new rollout.',
    useCase: 'A deploy ships a broken build and pods crash-loop; rollout undo restores the previous version in seconds while you find the bug.',
    inHarbor: 'Roll back refit on a shipyard is kubectl rollout undo; on an anchorage it is helm rollback.',
    docs: `${K8S}/workloads/controllers/deployment/#rolling-back-a-deployment` },
  { id: 'sunk', naval: ['sunk', 'sinks', 'sinking', 'ship sunk'], k8s: ['deleted pod', 'terminated', 'Terminating'],
    concept: 'Pods end when you delete them, when a controller scales down, when a node drains or dies, or when the kubelet evicts them. A Terminating pod gets a grace period to stop.',
    useCase: 'Node maintenance drains every pod on it; whether your service notices depends on whether a controller relaunches them elsewhere.',
    inHarbor: 'A sunk ship is a deleted pod; a shipyard launches a replacement, a lone ship is gone.',
    docs: `${K8S}/workloads/pods/pod-lifecycle/` },
  { id: 'burning', naval: ['burning', 'on fire', 'under attack'], k8s: ['CrashLoopBackOff', 'crash loop', 'crash-looping'],
    concept: 'CrashLoopBackOff means the container starts, exits almost at once, and Kubernetes restarts it with growing delays. The pod is Running but never Ready.',
    useCase: 'You meet it after a bad image, a missing config key or a dependency that is down; the pod\'s logs and events say which.',
    inHarbor: 'A burning ship is crash-looping (also ImagePullBackOff and OOMKilled); Ship\'s log shows why.',
    docs: `${K8S}/workloads/pods/pod-lifecycle/#container-states` },
  { id: 'pending', naval: ['bare hull', 'hull in dry dock'], k8s: ['Pending'],
    concept: 'A Pending pod has been accepted but is not running yet: no node has room for its requests, a volume is not bound, or its image is still pulling.',
    useCase: 'A pod that stays Pending for minutes is usually a resource request no node can satisfy; kubectl describe pod shows the scheduler\'s reason.',
    inHarbor: 'A bare hull in the open sea is a Pending pod waiting for a berth.',
    docs: `${K8S}/workloads/pods/pod-lifecycle/#pod-phase` },
  { id: 'ships-log', naval: ["ship's log", 'log'], k8s: ['logs', 'pod logs'],
    concept: 'Container logs are whatever the process writes to stdout and stderr; kubectl logs reads them, per container, with a tail and a follow option.',
    useCase: 'Logs are the first thing to read when a pod crash-loops or answers errors.',
    inHarbor: "Ship's log on a ship's card tails its container logs.",
    docs: `${K8S}/cluster-administration/logging/` },
  { id: 'lighthouse', naval: ['lighthouse', 'lighthouses'], k8s: ['Service', 'Services'],
    concept: 'A Service gives a changing set of pods one stable name and IP, chosen by label selector, and load-balances between the ready ones inside the cluster. ClusterIP is internal; NodePort and LoadBalancer open it outward.',
    useCase: 'Use it whenever something needs to reach pods by a name that outlives restarts and rollouts, such as a frontend calling an API.',
    inHarbor: 'A lighthouse is a Service; its beam shows the pods its selector matches.',
    where: 'Near the ships it guides.', docs: `${K8S}/services-networking/service/` },
  { id: 'beam', naval: ['beam', 'beams'], k8s: ['selector', 'endpoints'],
    concept: 'A Service\'s selector is a set of labels; every Ready pod carrying those labels becomes one of its endpoints, kept current by the control plane as pods come and go.',
    useCase: 'A Service with no endpoints means its selector matches no ready pod: a label typo, or pods failing readiness.',
    inHarbor: 'Beams run from a lighthouse to each pod its selector matches.',
    docs: `${K8S}/overview/working-with-objects/labels/` },
  { id: 'gate', naval: ['gate', 'gates', 'harbor mouth'], k8s: ['Ingress', 'Ingresses'],
    concept: 'An Ingress holds HTTP routing rules, host and path to Service and port, that an ingress controller enforces with a real proxy. Without a controller the rules do nothing.',
    useCase: 'Use it to publish several services on one address with TLS in one place instead of a cloud load balancer each.',
    inHarbor: 'A gate in the breakwater is an Ingress; select it to see the channels to its lighthouses.',
    where: 'In the south breakwater.', docs: `${K8S}/services-networking/ingress/` },
  { id: 'chain', naval: ['gold chain', 'chain'], k8s: ['TLS'],
    concept: 'TLS on an Ingress terminates HTTPS at the ingress controller, using a certificate stored in a Secret named on the Ingress.',
    useCase: 'Any site users log into needs it; cert-manager can issue and renew the certificate automatically.',
    inHarbor: 'A gold chain on a gate means its Ingress has TLS.',
    docs: `${K8S}/services-networking/ingress/#tls` },
  { id: 'anchorage', naval: ['anchorage', 'anchorages', 'mooring boom', 'boom'], k8s: ['release', 'Helm release', 'releases'],
    concept: 'A Helm release is one installation of a chart with a set of values: everything it created, tracked together with a revision history for upgrade and rollback.',
    useCase: 'Installing a database, an ingress controller or a monitoring stack is usually one Helm release rather than dozens of hand-written manifests.',
    inHarbor: 'An anchorage boom surrounds the workloads one release installed; its card upgrades, rolls back or uninstalls it.',
    where: 'A rope of buoys around shipyards.', docs: `${HELM}/intro/using_helm/` },
  { id: 'chart', naval: ['chart', 'charts', 'nautical chart'], k8s: ['Helm chart', 'chart'],
    concept: 'A Helm chart is a packaged, parameterised set of Kubernetes manifests: templates plus default values that render into real objects at install time.',
    useCase: 'Use charts to install third-party software the way its authors intended, and to ship your own app the same way to every environment.',
    inHarbor: 'The Charts button opens the chart table to pick a chart to install.',
    docs: `${HELM}/topics/charts/` },
  { id: 'chart-library', naval: ['chart library', 'chart libraries'], k8s: ['Helm repository', 'repository', 'repo'],
    concept: 'A Helm repository is an index of charts and versions served over HTTP; helm repo add registers one so its charts can be searched and installed.',
    useCase: 'Most vendors publish a repository; adding it is the first step of any chart-based install.',
    inHarbor: 'Chart libraries under REPOS are Helm repositories; the harbor reads Helm\'s own repository config.',
    docs: `${HELM}/topics/chart_repository/` },
  { id: 'values', naval: ['sailing orders', 'values'], k8s: ['values', 'values.yaml'],
    concept: 'Values are the settings of a chart: a YAML document that fills in its templates. Every chart comes with defaults; you override the ones that matter at install or upgrade.',
    useCase: 'The same chart deployed to staging and production differs only in its values files, which belong in version control.',
    inHarbor: 'The install form shows the chart\'s default values to edit before deploying.',
    docs: `${HELM}/chart_template_guide/values_files/` },
  { id: 'weigh-anchor', naval: ['weigh anchor', 'anchor weighed'], k8s: ['uninstall', 'helm uninstall'],
    concept: 'helm uninstall deletes every object a release created and, unless told to keep it, its revision history.',
    useCase: 'Remove a trial install cleanly, or tear down an environment, without hunting for the objects a chart made.',
    inHarbor: 'Weigh anchor on an anchorage uninstalls the release; it asks twice.',
    docs: `${HELM}/helm/helm_uninstall/` },
  { id: 'namespace', naval: ['fleet', 'fleets', 'clan'], k8s: ['namespace', 'namespaces'],
    concept: 'A namespace partitions a cluster: names are unique within it, Services resolve as name.namespace, and quotas, access rules and network policies attach to it.',
    useCase: 'Give each team or environment its own namespace so names cannot clash and access and quotas can differ.',
    inHarbor: 'A fleet is a namespace; its ships fly one ensign colour, and the Fleets filter shows chosen fleets only.',
    docs: `${K8S}/overview/working-with-objects/namespaces/` },
  { id: 'label', naval: ['ensign', 'ensigns'], k8s: ['label', 'labels'],
    concept: 'Labels are key/value tags on any object. Selectors on Services, Deployments and kubectl -l pick objects by label, so labels are how things find each other.',
    useCase: 'Two apps that share a label end up behind the same Service by accident; a consistent label scheme such as app and tier prevents it.',
    inHarbor: 'A ship\'s ensign is its labels; a lighthouse beam reaches the ships whose ensign matches its selector.',
    docs: `${K8S}/overview/working-with-objects/labels/` },
  { id: 'system-fleets', naval: ['system fleets', 'system namespaces'], k8s: ['kube-system'],
    concept: 'kube-system, kube-public, kube-node-lease and similar namespaces hold the cluster\'s own components: DNS, the network plugin, the scheduler on some clusters.',
    useCase: 'You look there when cluster DNS or networking misbehaves, and otherwise leave it alone.',
    inHarbor: 'System fleets are hidden by default; show them from Fleets or Settings.',
    docs: `${K8S}/overview/working-with-objects/namespaces/#initial-namespaces` },
  { id: 'tanker-terminal', naval: ['tanker terminal', 'tanker terminals', 'terminal'], k8s: ['StatefulSet', 'StatefulSets'],
    concept: 'A StatefulSet runs pods with stable identities: numbered names (db-0, db-1), a stable network name through a headless Service, and optionally a persistent volume per pod that follows its number.',
    useCase: 'Use it for databases, queues and anything clustered where each member must keep its name and its data across restarts.',
    inHarbor: 'A tanker terminal is a StatefulSet; its tankers carry hull numbers and tanks.',
    where: 'A grey apron with a tank farm.', docs: `${K8S}/workloads/controllers/statefulset/` },
  { id: 'tanker', naval: ['tanker', 'tankers', 'hull number'], k8s: ['StatefulSet pod', 'ordinal'],
    concept: 'Each StatefulSet pod has an ordinal that survives relaunches; its name, DNS entry and volume follow the ordinal, and scaling down retires the highest first.',
    useCase: 'A database replica restarted on another node comes back as the same member with the same data because the ordinal binds it to its volume.',
    inHarbor: 'A tanker is a StatefulSet pod; its hull number is the ordinal.',
    docs: `${K8S}/workloads/controllers/statefulset/#pod-identity` },
  { id: 'tank', naval: ['tank', 'storage per tanker', 'storage'], k8s: ['PersistentVolumeClaim', 'PVC', 'volume', 'StorageClass'],
    concept: 'A PersistentVolumeClaim asks for storage of a size and class; a StorageClass provisions a PersistentVolume to bind to it, and the data outlives any pod that mounts it.',
    useCase: 'Anything that must not lose data on restart, from a database to uploaded files, mounts a claim instead of writing inside the container.',
    inHarbor: 'Storage per tanker on the terminal form becomes one claim per StatefulSet pod.',
    docs: `${K8S}/storage/persistent-volumes/` },
  { id: 'tug', naval: ['tugboat', 'tugboats', 'tug company', 'tug'], k8s: ['DaemonSet', 'DaemonSets'],
    concept: 'A DaemonSet runs one pod on every node (or every node matching a selector) and adds one when a node joins. It is not scaled; it follows the nodes.',
    useCase: 'Use it for per-node agents: log shippers, monitoring agents, network plugins, storage drivers.',
    inHarbor: 'A tug company is a DaemonSet with one tugboat on every island.',
    docs: `${K8S}/workloads/controllers/daemonset/` },
  { id: 'fleet-job', naval: ['fishing fleet', 'fishing boat', 'fishing boats', 'catch', 'catches'], k8s: ['Job', 'Jobs', 'completions', 'parallelism'],
    concept: 'A Job runs pods until a number of them succeed (completions), up to so many at once (parallelism), retrying failures up to backoffLimit. A CronJob creates Jobs on a schedule.',
    useCase: 'Use it for batch work with an end: a database migration, a nightly report, a one-off data fix.',
    inHarbor: 'A fishing fleet is a Job; boats come home grey when their catch is landed.',
    docs: `${K8S}/workloads/controllers/job/` },
  { id: 'lookouts', naval: ['lookouts', 'lookout'], k8s: ['probe', 'probes', 'readiness probe', 'liveness probe'],
    concept: 'Probes are health checks the kubelet runs on a container: readiness decides whether it receives traffic, liveness whether it is restarted, and a startup probe protects slow starts.',
    useCase: 'Use them on every service pod so a hung process is restarted and a slow start keeps traffic away until it is ready.',
    inHarbor: 'Lookouts on a shipyard are its readiness and liveness probes.',
    docs: `${K8S}/configuration/liveness-readiness-startup-probes/` },
  { id: 'configmap', naval: ['chart locker', 'sealed orders', 'orders'], k8s: ['ConfigMap', 'ConfigMaps'],
    concept: 'A ConfigMap holds plain configuration as key/value pairs outside the image. Pods read it as environment variables or mounted files, so settings change without a rebuild.',
    useCase: 'One image, many environments: the database URL, feature flags and log level live in a ConfigMap per environment.',
    inHarbor: 'The chart locker from Sealed orders is a ConfigMap; a shipyard can read it under SEALED ORDERS.',
    docs: `${K8S}/configuration/configmap/` },
  { id: 'secret', naval: ['sealed envelope', 'sealed envelopes'], k8s: ['Secret', 'Secrets'],
    concept: 'A Secret holds sensitive values such as passwords, tokens and certificates. It is base64-encoded, not encrypted, so access control and encryption at rest matter.',
    useCase: 'Registry credentials, database passwords and TLS certificates all belong in Secrets rather than in images or ConfigMaps.',
    inHarbor: 'A sealed envelope from Sealed orders is a Secret; its contents never come back to the browser.',
    docs: `${K8S}/configuration/secret/` },
  { id: 'limits', naval: ['cargo limit', 'limits', 'requests'], k8s: ['resource limits', 'resource requests', 'limit', 'request'],
    concept: 'Requests are what the scheduler reserves for a container on a node; limits are the most it may use, with CPU throttled and memory OOM-killed beyond them.',
    useCase: 'Set both on every workload so one greedy pod cannot starve its neighbours and your pods always find a node that can really hold them.',
    inHarbor: 'CPU/UNIT and MEM/UNIT on the shipyard form are requests; CPU LIMIT and MEM LIMIT are limits.',
    docs: `${K8S}/configuration/manage-resources-containers/` },
  { id: 'greedy', naval: ['greedy ship', 'greedy', 'hog'], k8s: ['BestEffort', 'no requests', 'OOMKilled'],
    concept: 'A pod with no requests is BestEffort: scheduled anywhere, counted as using nothing, first to be evicted. With no limits it can use a whole node until the kernel OOM-kills it.',
    useCase: 'A batch job with no limits eats a node\'s memory and takes unrelated services down with it; a LimitRange can set defaults for a namespace.',
    inHarbor: 'A greedy ship has no requests or limits and grabs every berth it can.',
    docs: `${K8S}/configuration/manage-resources-containers/#how-pods-with-resource-limits-are-run` },
  { id: 'storm', naval: ['storm', 'storm of traders', 'storm season'], k8s: ['HorizontalPodAutoscaler', 'HPA', 'autoscaler', 'traffic surge'],
    concept: 'A HorizontalPodAutoscaler changes a workload\'s replicas automatically, between a minimum and maximum, from CPU, memory or custom metrics.',
    useCase: 'Traffic that peaks at predictable or unpredictable times, such as a newsletter send, is handled by scaling out and back in without anyone on call.',
    inHarbor: 'A storm is a traffic surge that overloads too few ships; launching more is scaling.',
    docs: `${K8S}/tasks/run-application/horizontal-pod-autoscale/` },
  { id: 'trader', naval: ['trader', 'traders', 'courier'], k8s: ['client', 'client pod', 'consumer'],
    concept: 'A client is anything that calls your pods: another pod, a user, a job. Clients should address a Service name, which is stable, rather than a pod name or IP, which changes.',
    useCase: 'A frontend configured with a pod IP breaks after every rollout; configured with the Service name it never notices.',
    inHarbor: 'Traders are clients; a trader sailing to a ship by name is lost when the ship is replaced.',
    docs: `${K8S}/services-networking/service/#discovering-services` },
  { id: 'quay', naval: ['quay', 'moored', 'moor'], k8s: ['scheduled', 'running on a node'],
    concept: 'The scheduler binds each pod to one node by matching its requests and constraints against what nodes offer; from then on that node\'s kubelet runs it.',
    useCase: 'Node selectors, affinities and taints steer scheduling when a pod needs a GPU, SSDs or a particular zone.',
    inHarbor: 'A moored ship is scheduled on the island whose quay it sits below.',
    docs: `${K8S}/scheduling-eviction/kube-scheduler/` },
  { id: 'signal-flags', naval: ['signal flags', 'announcement'], k8s: ['Event', 'Events', 'Warning event'],
    concept: 'Kubernetes records Events for objects: Normal ones like Scheduled and Pulled, Warning ones like BackOff, FailedScheduling and Unhealthy. They are kept for about an hour.',
    useCase: 'kubectl describe shows an object\'s events; they are the quickest answer to "why is this pod not running".',
    inHarbor: 'Toasts are cluster Events; a Warning flashes the ship or structure it names, and the Log keeps recent ones.',
    docs: `${K8S}/cluster-administration/manage-deployment/` },
  { id: 'breakwater', naval: ['breakwater', 'open sea'], k8s: [],
    concept: 'The breakwater is the edge of the map. The open sea strip outside the islands holds pods that have no node: unschedulable, or on a node the harbor cannot see.',
    inHarbor: 'Gates open in the breakwater; Pending ships wait in the open sea.',
    where: 'The ring of rocks.' },
  { id: 'expedition', naval: ['expedition', 'expeditions'], k8s: [],
    concept: 'An expedition is a vendor deployment guide played as levels on your own cluster: instructions, checks against the cluster, prefilled forms, chart values with required keys, and Helm installs or upgrades.',
    inHarbor: 'The FortiAIGate expedition is built in; add your own as campaign.yaml under ~/.config/harbor/campaigns.' },
  { id: 'training-harbor', naval: ['training harbor'], k8s: [],
    concept: 'The training harbor is a simulated cluster used by the tour and the academy; every command is answered by a simulator and nothing touches a real cluster.',
    inHarbor: 'The link chip reads demo while you are in it.' },
  { id: 'open-harbor', naval: ['open harbor', 'demo harbor'], k8s: [],
    concept: 'Open Harbor is the demo level: a built-in cluster with shipyards, lighthouses, a gate, an anchorage and every workload kind, mutating by itself so there is always something happening.',
    inHarbor: 'Pick it from Harbor Select to explore the interface freely.' },
];

const byAlias = new Map<string, Term>();
for (const t of TERMS) for (const a of [...t.naval, ...t.k8s]) byAlias.set(a.toLowerCase(), t);

/** Looks a word or phrase up, case-insensitively. */
export function termFor(alias: string): Term | undefined {
  return byAlias.get(alias.toLowerCase());
}

export function termById(id: string): Term | undefined {
  return TERMS.find((t) => t.id === id);
}

/** Every alias, longest first, so phrases win over their words. */
export const ALIASES: string[] = [...byAlias.keys()].sort((a, b) => b.length - a.length);

/** Is this alias one of the naval words (as opposed to a Kubernetes word)? */
export function isNavalAlias(alias: string): boolean {
  const t = byAlias.get(alias.toLowerCase());
  return !!t && t.naval.some((n) => n.toLowerCase() === alias.toLowerCase());
}

/** The Kubernetes name to show beside a naval term, if any. */
export function pairOf(t: Term): string | undefined {
  return t.k8s[0];
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Title of an entry: the Kubernetes term first, the harbor word after it ("Deployment · shipyard"). */
export function titleOf(t: Term): string {
  const k = pairOf(t);
  return k ? `${k} · ${t.naval[0]!}` : cap(t.naval[0]!);
}

/** True for words that exist only in the game (no Kubernetes concept behind them). */
export const isHarborOnly = (t: Term): boolean => t.k8s.length === 0;
