# 1st Principles: the first expedition

Status: plan, 2026-10-13. Builds on the level engine from `PLAN-CAMPAIGN.md`
(runner, bubbles, goals, stars, challenge mode, real-cluster staging).
Six levels, one principle each, in the order the owner gave. The beginner
academy teaches the objects; First Principles teaches why Kubernetes is
built the way it is, using the same harbor.

## 0. The two principles this serves

1. **Harbor is a Kubernetes GUI.** Run it on a machine with a cluster, see
   the cluster, change it from the GUI. Every feature below (Papers, the
   ledger, Apply manifest, Change ensign) is a GUI feature first, useful on
   a real cluster with no expedition open; expeditions only script them.
2. **Harbor contains a library of training Expeditions**, authored over
   time. Three to start, in this order on Harbor Select:
   1. **1st Principles**: six levels, one per principle, teaching a
      brand-new user why Kubernetes is built the way it is and what that
      means in practice.
   2. **Advanced K8s**: the ten existing hands-on levels (objects and
      operations), each labelled with the principle it practises.
   3. **FortiAIGate on K8s**: how to deploy FortiAIGate on Kubernetes.

"Expedition" is the one word for a training; the "Harbor Academy" name
retires. Harbor Select shows the GUI entry points (Open Harbor, your
cluster) and then the Expeditions library. Code expeditions (1st
Principles, Advanced K8s) and `campaign.yaml` expeditions (FortiAIGate,
user-authored)
share one registry and one `Expedition` interface (id, title, tagline,
source?, levels, origin: builtin-code | builtin-yaml | user-yaml); progress
keys are `<expedition>/<level>`.

**Two code expeditions** (owner's decision): 1st Principles holds the six
principle levels, in the order given, and nothing else. The existing
beginner levels become the **Advanced K8s** expedition (ids `advanced/1`
… `advanced/10`, same order as today), each labelled with the principle it
practises (section 2). Their fixtures, goals and simulator mechanics are
unchanged; their bubbles gain one line tying them back to their principle.
Progress recorded under the old `academy/N` keys is migrated to
`advanced/N` on first load.

1st Principles lives in code (`web/src/levels/principles/`): every level
needs scripted events and the simulator, which the YAML format deliberately
does not offer. Levels run in the training simulator; those marked below
also get a FOR REAL plan on the connected cluster.

## 1. What the harbor must be able to show first

Four product features carry the six lessons. They are useful in Open
Harbor and on a real cluster regardless of the campaign.

| Feature | What it is | Why the campaign needs it |
|---|---|---|
| **Ship's papers** (spec vs status) | A "Papers" action on every card opens the object's YAML as two columns: `spec` (what you asked for) and `status` (what the cluster reports), live, with the diff highlighted when they disagree (replicas 3 vs available 2). Backend: `GET /api/objects/{kind}/{ns}/{name}` returning the two documents; the simulator renders them from the store. | Level 1 (spec and status are the whole model), level 2 (watch status catch up to spec), level 5 (status shows the new pod IP). |
| **Apply a manifest** | A Shop card "Apply manifest": paste YAML, see the diff against what exists, apply. Backend: `POST /api/apply` doing server-side apply with a field manager `harbor`, restricted to the kinds the harbor already creates (Deployment, Service, Ingress, ConfigMap, Secret, Namespace, StatefulSet, Job). Applying the same manifest twice reports "no change". The simulator applies the same kinds into the store. | Level 1 (apply is idempotent; the manifest is the desired state; GitOps), level 6 (what app teams write). |
| **The ledger** (API traffic) | A panel on the left rail ("Ledger"): every request the harbor made (`POST /api/deployments courier`), every object change the stream delivered, and who caused it (you, the Deployment controller, the scheduler, the kubelet, Helm), as one time-ordered list. On a real cluster the "who" comes from `managedFields` managers and the Event source; in the simulator the engine stamps it. | Level 2 (watch the loop: observe, compare, act), level 3 (every actor writes through the same API; nothing calls anything else). |
| **Change ensign** (relabel) | A "Change ensign" action on a ship (pod) and on a shipyard template: edit labels. Backend: `PATCH /api/pods/{ns}/{name}/labels` (merge patch on metadata.labels) and the same for a Deployment's template. The simulator updates labels and lets its controllers react. | Level 4 (relabel a pod: it leaves the Service's beam *and* the ReplicaSet launches a replacement, because selection is by label, not ownership; canary by shared labels). |

Smaller additions: a "Tide table" custom resource and toy controller in the
simulator (level 3); a staged `cordon`/`drain` incident on real clusters
and a NotReady island script in the simulator (level 5); ResourceQuota and
LimitRange shown as a "harbor authority" notice on the fleet, plus a
simulated admission denial (level 6); glossary entries for every new term.

## 2. The six levels

The six levels of 1st Principles, in order. Every level keeps the shape:
event, guided fix with hints, the event again now handled, HARBOR SECURED,
summary card (harbor / Kubernetes / on the job, YAML, kubectl). Par times 4
to 6 minutes.

The Advanced K8s expedition keeps today's ten levels and order; each shows
the principle it practises on Harbor Select and in its intro bubble:

| # | Level | Practises |
|---|---|---|
| 1 | A ship and its cargo | 1 Desired state |
| 2 | The shipyard | 1 Desired state, 2 Reconcile |
| 3 | Storm season (scaling) | 2 Reconcile |
| 4 | Lookouts (probes) | 2 Reconcile, 5 Cattle |
| 5 | The lighthouse (Services) | 4 Labels, 5 Cattle |
| 6 | The harbor mouth (Ingress) | 6 Two crews |
| 7 | Sealed orders (ConfigMaps/Secrets) | 3 One door |
| 8 | Berths and cargo (requests/limits) | 5 Cattle |
| 9 | Fleets and ensigns (namespaces/labels) | 4 Labels, 6 Two crews |
| 10 | Refit at sea (rollouts/rollback) | 4 Labels |

### 1. The harbor master's ledger (declarative desired state)

- **Scene**: the courier shipyard, 3 ships. The learner opens its Papers:
  `spec.replicas: 3`, `status.availableReplicas: 3`. Two documents, one
  object.
- **Event**: the harbor master "orders" a fourth ship the imperative way:
  a lone ship appears, then the learner is told to try it again; nothing
  remembers the order, and when that ship sinks nobody rebuilds it.
- **Guided fix**: open Apply manifest, paste the shipyard manifest with
  `replicas: 4`, apply. Watch spec change first, status follow. Apply the
  same manifest again: "no change". Edit replicas to 2, apply: ships
  retire. The ledger shows that every one of these was a write to the API
  server, which stored it (etcd) before anything moved.
- **Replay**: a ship sinks; status drops to 3, spec still says 4, a ship is
  launched. The record, not the command, is what persists.
- **Summary**: spec and status; apply is idempotent; "your manifests are
  the desired state" is why GitOps works: a repo of manifests applied on
  every change. kubectl: `kubectl apply -f`, `kubectl get deploy -o yaml`,
  `kubectl diff -f`.

### 2. The loop (controllers reconcile)

- **Scene**: same shipyard, and the ledger open beside it, now showing the
  Deployment controller's loop as ticks: *observed 3/3, desired 3, nothing
  to do*.
- **Event**: the harbor master cuts the harbor's "news" for a while (the
  simulator drops stream events; on a real cluster the bubble explains
  that this is a thought experiment) and sinks two ships during the
  blackout. No event arrived. When the news returns, the next tick still
  sees 1/3 against 3 and launches two. Level-triggered, not edge-triggered.
- **Guided fix**: there is nothing to build; the learner is asked to
  predict (a three-choice bubble: "the controller missed it, ships stay
  sunk" / "the next loop sees the gap" / "the API server replays the
  events") before the news returns. Wrong guesses cost a star, like hints.
- **Replay**: an island goes NotReady with ships on it; the loop observes
  the pods gone, launches replacements elsewhere, without anyone pressing
  anything. "Self-healing falls out of the design."
- **Summary**: observe, compare, take one step, repeat; one controller per
  kind; what "level-triggered" means in practice (a crashed controller
  catches up when restarted). kubectl: `kubectl get events -w`,
  `kubectl rollout status`.

### 3. One door (everything goes through the API server)

- **Scene**: the ledger shows actors as columns: you (the harbor), the
  scheduler, the kubelet on each island, the Deployment controller, Helm.
  Build a shipyard and watch the writes: you create the Deployment; the
  controller creates a ReplicaSet and pods; the scheduler writes
  `spec.nodeName`; the kubelet writes `status`. Nobody called anybody; all
  of them read and wrote one API.
- **Event**: the harbor master introduces a "tide table" the harbor never
  heard of: a custom kind (`TideTable`, a CRD in the simulator) with a
  spec (`highWater: 3`) and no controller; it sits there, stored,
  doing nothing. "The API server will store any kind you teach it."
- **Guided fix**: the learner switches on the tide controller (a toggle on
  the tide table's card: "Post a tide keeper"). It is a loop like any
  other: it watches TideTables and scales the courier shipyard to
  `highWater`. The learner edits `highWater`, the fleet follows.
- **Replay**: the learner sells the tide keeper; edits to the tide table are
  stored but nothing happens; posts it again, the gap closes. An operator
  is a CRD plus a controller, first-class.
- **Summary**: the API server is the only door; the ledger as proof;
  CRDs and operators use exactly the Deployment mechanism; why CI, GitOps
  tools and dashboards (this harbor included) are all just API clients.
  kubectl: `kubectl api-resources`, `kubectl get crd`, `kubectl explain`.
  On a real cluster this level is simulator-only (installing a CRD is a
  platform decision), with a note on how to try it with a real operator.

### 4. Ensigns, not ropes (composition by labels)

- **Scene**: the courier shipyard (`app=courier`, 3 ships) and its
  lighthouse. Papers on a ship shows `metadata.labels` and `ownerReferences`
  (the ReplicaSet); Papers on the lighthouse shows `spec.selector` and no
  list of pods at all.
- **Event**: the learner uses Change ensign on one ship: `app=courier` to
  `app=retired`. Two things happen at once: the beam drops the ship, and
  the ReplicaSet launches a new one, because its selector no longer matches
  either. The relabelled ship sails on alone, orphaned. Nothing was
  "detached"; a label changed and two selectors re-evaluated.
- **Guided fix**: build a second shipyard `courier-canary` with 1 ship whose
  template carries both `app=courier` and `track=canary`. The lighthouse
  beam now reaches 4 ships; a quarter of traders go to the canary. Then a
  blue/green: a lighthouse selecting `track=blue`, a second shipyard with
  `track=green`, and Change ensign on the lighthouse's selector to flip
  all traffic at once.
- **Replay**: Refit the canary to a broken image: only the canary burns,
  the beam still has 3 good ships; roll it back. Same primitives, three
  deployment strategies.
- **Summary**: Deployment manages ReplicaSets manages Pods (ownership),
  Service selects Pods (labels); why loose joins allow canary, blue/green
  and rolling updates with no new primitives; the orphan pod as a
  debugging tell. kubectl: `kubectl label`, `kubectl get pods -l`,
  `kubectl get endpoints`.

### 5. Cattle, not pets (assume failure)

- **Scene**: a courier ship with a trader addressing it by pod IP (Papers
  shows `status.podIP`). A tanker terminal `ledger-db` with a tank, 1
  tanker, and a lighthouse.
- **Event**: the harbor master drains an island (cordon + drain on a real
  cluster; the simulator marks it NotReady and evicts). The courier ship
  relaunches elsewhere with a new IP: the trader is lost. The tanker
  relaunches as `ledger-db-0` on another island and its tank follows it:
  the data is intact.
- **Guided fix**: point the trader at the lighthouse (a Change destination
  action on the trader, or the level-5 beginner mechanic); add readiness
  and liveness lookouts; set requests and limits; give the shipyard a
  graceful-shutdown grace (a new `terminationGracePeriodSeconds` field on
  the form, with a note on SIGTERM); confirm there is no local state (the
  Papers show no volumes on the courier).
- **Replay**: drain again. Traders never notice: the lighthouse re-aims, the
  lookouts gate traffic, the ships stop gracefully, the tanker keeps its
  name and tank.
- **Summary**: pods are disposable and IPs change; Services, PVCs and
  StatefulSets are the stable abstractions on top; the checklist for an
  app that tolerates it (probes, graceful shutdown, requests and limits,
  no local state). kubectl: `kubectl drain`, `kubectl uncordon`,
  `kubectl get pvc`.

### 6. Two crews (separation of concerns)

- **Scene**: the harbor has a *harbor authority* now: on each fleet's card a
  notice lists what the platform provides and enforces: StorageClasses,
  IngressClasses, a ResourceQuota (e.g. 2 CPU, 4 GiB, 10 pods), a
  LimitRange (defaults for ships that set nothing), a network policy
  ("ships may only talk to their own fleet's lighthouses"), and an admission
  rule ("every ship must carry a `team` ensign").
- **Event**: the learner, as the app team, builds a shipyard with 6 ships:
  the quota refuses the sixth (Pending with a quota event), a ship without
  the `team` label is refused outright by admission, and a ship with no
  requests gets the LimitRange defaults stamped onto it (Papers shows
  requests it never wrote).
- **Guided fix**: the learner fixes what is theirs to fix: labels, replica
  count, requests. Then the harbor master switches hats: as the platform
  team, raise the quota (a platform form the app team cannot open), add an
  IngressClass, and watch the gate the app team opened start working.
- **Replay**: the app team deploys again, within the rules, without asking
  anyone; the platform changes a StorageClass default and no app manifest
  changes.
- **Summary**: who writes what (Deployments, Services, ConfigMaps vs
  StorageClasses, IngressClasses, quotas, policies, admission); API
  boundaries matching organisational boundaries; RBAC as the lock on the
  door. kubectl: `kubectl get resourcequota`, `kubectl describe
  limitrange`, `kubectl auth can-i`. Real mode: quotas and LimitRanges are
  staged in the academy namespace (`stage` gains `quota`); admission is
  simulator-only unless a ValidatingAdmissionPolicy is present (checked by
  a probe).

## 3. Engine and backend changes

- `web/src/levels/principles/` with `index.ts`, `fixture.ts` and six level
  files; a `TRAININGS` registry (`web/src/levels/library.ts`) listing the
  academy, First Principles and then the YAML expeditions from the backend,
  in that order; Harbor Select renders one group per training from it;
  `?level=principles/3` deep links; the summary card's Next walks the
  training the level belongs to.
- Bubble: a **choice step** (`choices: [{text, correct}]`) for level 2's
  prediction, rendered as pills; a wrong choice counts like a hint.
- Simulator (`tour/training.ts`): controller loop ticks surfaced to the
  ledger; a stream blackout switch; node NotReady with eviction; label
  patches re-evaluating selectors and ReplicaSet ownership; TideTable kind
  and controller; ResourceQuota, LimitRange and admission rules per
  namespace; server-side apply over the store.
- Backend (all whitelisted, all tested with the fake clientset):
  `GET /api/objects/{kind}/{ns}/{name}` (spec/status YAML),
  `POST /api/apply` (server-side apply, allowed kinds only, dry-run flag
  for the diff), `PATCH /api/pods/{ns}/{name}/labels`,
  `PATCH /api/deployments/{ns}/{name}/labels` (template labels), ledger
  attribution from `managedFields` on the wire models (`manager` field on
  Deployment and Pod), stage incidents `cordon`, `uncordon`, `drain`,
  `quota`, `limitrange`, and probes `admission-policy`, `resourcequota`.
- HUD: Papers action on every card, Ledger rail button and panel, Change
  ensign action, Apply manifest shop card, `terminationGracePeriodSeconds`
  on the shipyard form, harbor authority notice on fleet cards.
- Glossary (Kubernetes-first voice): desired state, spec, status, etcd,
  apply, GitOps, controller, reconcile, level-triggered, API server (expand),
  CRD, operator, ownerReferences, canary, blue/green, cordon, drain,
  eviction, graceful shutdown, pod IP, ResourceQuota, LimitRange, admission,
  NetworkPolicy, RBAC.
- Tests: Vitest for goals, simulator controllers, apply diff, label
  re-evaluation; e2e `principles.spec.ts` playing all six levels in the
  simulator; `principles-real.spec.ts` for levels 1 and 5 on kind; Go tests
  for the new endpoints; visual baselines for the Papers and Ledger panels.

## 4. Phases

| Phase | Scope | Size |
|---|---|---|
| F0 | **Done 2026-10-13.** Papers (`GET /api/objects/{kind}/{ns}/{name}`, spec beside status with lagging lines marked, managers), Apply manifest (`POST /api/apply`, server-side apply with field manager `harbor`, whitelisted kinds, dry-run diff, "unchanged" on re-apply; shop card), the Ledger (rail button; your writes and every stream change attributed from `managedFields` on a real cluster or stamped by the simulator: the Deployment controller, the scheduler, the kubelet), Change ensign (`PATCH …/labels` on pods and Deployment templates; selector labels protected; a relabelled pod is orphaned and replaced in the simulator), `managers`/`templateLabels` on the wire models, choice steps in the bubble, the Expeditions library (`levels/library.ts`: 1st Principles, Advanced K8s, then YAML expeditions; `academy/N` progress migrated to `advanced/N`; `?expeditions`, `?level=advanced/N`). Found and fixed: Open Harbor's API calls reached the connected cluster; every call is now simulated in `?demo` | 2 sessions |
| F1 | **Done 2026-10-13.** Levels 1 "The harbor master's ledger" (Papers, an order by hand that is forgotten, apply 4 / apply again unchanged / apply 2, the record outlives a sunk ship), 2 "The loop" (the controller's loop in the ledger, a watch blackout while two ships sink, a three-choice prediction with a star at stake, resume closes the gap, a NotReady island relaunches elsewhere), 3 "One door" (your write and the controller's, the scheduler's and the kubelet's in the ledger; a TideTable custom resource; a tide keeper operator posted, edited, dismissed, posted again). Simulator: pausable controllers, `reconcile`/`reconcileAll`, node failure and restore, actor attribution. Twelve glossary entries (desired state, spec, status, apply, etcd, GitOps, controller, reconcile, level-triggered, self-healing, CRD, operator, API client). Fixed on the way: a button whose label contains a glossary alias got marked up and clicks opened the glossary; the map-hover tooltip could catch clicks; the bubble pushed off the selection card could cover the step's own anchor; glossary search ranks name matches first | 2 sessions |
| F2 | Levels 4-6 (labels, cattle, two crews): canary/blue-green mechanics, drain staging, harbor authority with quota, LimitRange and admission | 2 sessions |
| F2b | Advanced K8s: today's ten levels re-homed as `advanced/N` with their principle line, progress migrated from `academy/N`; FortiAIGate on K8s third in the library | half a session |
| F3 | Glossary entries, README, real-mode e2e, visual baselines; progress migration from `academy/N` keys | 1 session |

## 5. Decisions needed

1. **Settled**: three expeditions in this order: 1st Principles (six
   levels), Advanced K8s (today's ten), FortiAIGate on K8s.
2. **Scope of real mode**: principle levels 1, 2, 4 and 5 for real
   (recommended; 3 and 6 stay simulator-only because CRDs and admission
   policies are platform changes). The folded beginner levels keep their
   existing real plans.
3. **Apply manifest on real clusters**: allow it (recommended, with the
   kind whitelist and a dry-run diff shown before applying), or keep it to
   the simulator.
4. **Principle level 2's prediction step**: the three-choice bubble with a
   star at stake (recommended), or plain narration.
