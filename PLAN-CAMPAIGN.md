# Harbor Academy: levels that teach Kubernetes

Status: plan, 2026-10-08. Builds on `PLAN.md` (architecture) and
`PLAN-HARBOR.md` (the naval look). Nothing here changes the backend contract
for existing features; it adds a level engine, a glossary, and campaign
content.

Decisions taken with the owner:
- The current harbor stays exactly as it is and becomes **Open Harbor**: a
  demo level with features already configured, for people who know
  Kubernetes and want to explore the interface.
- Beginner levels run in a **simulated harbor** (staged, deterministic, no
  cluster needed) and can be **replayed for real** against the connected
  cluster. Vendor campaigns (FortiAIGate) run on a real cluster only.
- Learners build solutions with the **shop forms first**; every level
  reveals the **YAML and kubectl equivalent** ("Ship's manifest"). Later
  levels may require editing YAML.
- Levels unlock in order, award **1-3 stars**, and can be replayed in a
  **challenge mode** without bubbles. Progress is saved by the backend.
- The **FortiAIGate campaign** is authored from the vendor guide in the
  campaign format now; it cannot be verified here (GPU nodes, licensed
  images).
- **Tooltips** over every nautical term and every Kubernetes/Helm term,
  backed by one glossary.

---

## 1. Beginner concepts and their naval scenarios

Eight core levels, in the order a newcomer meets the ideas, plus two
intermediate levels that reuse what the harbor already draws. Each level
has an event (the problem), a solution the learner builds, a replay (the
same event, now handled), and a summary that maps naval → Kubernetes →
the DevOps situation it stands for.

| # | Concept | Level title | The event | What the learner builds | Replay, now handled |
|---|---|---|---|---|---|
| 1 | Pods and containers | A ship and its cargo | A lone ship (a bare pod) hits a reef and sinks; its cargo (containers) is lost and nothing replaces it | Nothing yet: learners inspect the ship, read its log, see the crates, and *recall* it; the lesson is what a pod is and that pods are mortal | A second lone ship sinks; the harbor master points out nobody rebuilt it — setting up level 2 |
| 2 | Deployments and ReplicaSets | The shipyard | Same reef, same sinking | A shipyard (Deployment) with 1 replica for that cargo | The ship sinks; the shipyard launches a replacement by itself ("desired state") |
| 3 | Scaling | Storm season | A storm (traffic surge) overwhelms the single ship: it goes NotReady, lighthouse beams flicker | Launch ships until 3 are moored (replicas 3) | The storm returns; three ships ride it out; a hint that autoscaling (HPA) exists |
| 4 | Health probes | Lookouts | A ship keeps sailing with a broken hull: the lighthouse still sends traffic to it and visitors get nothing | Readiness and liveness lookouts on the shipyard (new form fields: probe path/port) | The hull breaks again: readiness drops it from the beams, liveness sinks and relaunches it |
| 5 | Services | The lighthouse | Ships change berths and names after every relaunch; a courier (another pod) keeps sailing to a ship that is gone | A lighthouse (Service) whose selector matches the fleet's ensign (labels) | Ships get replaced; the courier follows the beam and always arrives |
| 6 | Ingress | The harbor mouth | Traders outside the breakwater cannot reach the lighthouse at all | A gate (Ingress) with a host and path to the lighthouse; TLS for a gold chain | Traders arrive through the gate; wrong host, wrong path shown bouncing off |
| 7 | ConfigMaps and Secrets | Sealed orders | A ship sails with the wrong orders baked into its hull (config in the image); changing them means rebuilding every ship | A chart locker (ConfigMap) and a sealed envelope (Secret) mounted or set as env on the shipyard (new forms) | Orders change at the locker; ships relaunch with the new orders, nothing rebuilt |
| 8 | Requests and limits | Berths and cargo | A greedy ship fills every berth (no requests set, one pod hogs a node); another ship stays Pending forever; a third overloads and is OOM-sunk | Set requests and limits on the shipyard (form fields exist for requests; add limits) | Ships get fair berths; the scheduler finds room; the hog is capped |
| 9 | Namespaces and labels | Fleets and ensigns | Two crews' ships are mixed in one basin; a lighthouse guides the wrong crew's ships | A second namespace (fleet) and correct ensigns (labels) so selectors match only their own | Each lighthouse guides its own crew; the Fleets filter shows one at a time |
| 10 | Rolling updates and rollback | Refit at sea | A refit (new image) ships a broken hull; the fleet is sinking one by one | Roll back the shipyard (new action: Roll back refit), then refit with a fixed image and maxUnavailable 0 | The next refit replaces ships one at a time; a bad one is rolled back with one click |

Two more are natural follow-ups once tankers and fleets exist: StatefulSets
and volumes ("Tanks that remember"), Jobs and CronJobs ("The fishing
calendar"). They are intermediate and belong to a second campaign.

Each level's **summary card** has three columns and a manifest:

| Naval | Kubernetes | In practice |
|---|---|---|
| e.g. "The shipyard relaunched the ship because it keeps 1 ship as its desired state" | "A Deployment's ReplicaSet reconciles `spec.replicas` against running pods" | "A web pod crashed at 3 a.m.; nobody paged, the Deployment replaced it" |

plus the YAML the forms produced and the kubectl command that would do the
same, with the naval term beside each Kubernetes field.

## 2. The level flow

```
Harbor Select ─▶ Level intro ─▶ Event (staged) ─▶ Problem bubble
   ▲                                                   │
   │                                        Guided steps (interactive,
   │                                        hints, "Ship's manifest")
   │                                                   │
   │                              Goal met? (pure evaluator over the store)
   │                                                   │
   │                                 Replay event ─▶ handled ─▶ SUCCESS
   │                                                   │
   └── Next level ◀── Summary card (naval / k8s / DevOps, YAML, kubectl)
```

- **Intro**: the harbor master sets the scene in one bubble; the level's
  harbor is loaded (a fixture snapshot, smaller than the demo).
- **Event**: a scripted sequence of stream messages with timing (simulated)
  or a staged incident on the real cluster (section 4). Visuals already
  exist for most: sinking, fire, NotReady, Pending, beams.
- **Guided steps**: the tour engine, reused as is, with `waitFor` goals.
  Hints are optional bubbles that cost a star.
- **Goal**: a pure predicate over the store (`goal(store) => boolean`),
  unit-tested with fixtures, so levels cannot be passed by accident.
- **Replay**: the same event script; the harbor now copes. The learner
  watches; the harbor master narrates what the configuration did.
- **Success**: fireworks from the breakwater, ship's bell, flags, a
  "HARBOR SECURED" banner, stars popping in one by one, par time shown.
- **Summary**: the card above, a Next level button, Replay and Challenge.
- **Challenge mode**: same level, no bubbles, timer; 3 stars = no hints,
  under par.
- **Real replay**: "Do it for real" runs the level against the connected
  cluster: the incident is staged through the backend (section 4) and the
  learner uses the same forms; the goal evaluator reads the live store.

## 3. Engine architecture

Nothing in the store, layout, entities or HUD changes shape; the engine
drives them the way the tour and the training harbor already do.

- `web/src/levels/` (new):
  - `types.ts`: `Level` definition (id, concept, title, intro, fixture,
    event script, steps, goal, replay, summary, par time, glossary terms).
  - `director.ts`: plays an event script into the store (simulated) or
    calls stage endpoints (real); pure timing helpers tested with fake
    timers.
  - `goals.ts`: evaluators per level, pure, tested.
  - `levelRunner.ts`: the state machine above, built on `TourEngine`.
  - `success.ts`: the celebration (particles + DOM banner + sound).
  - `summaryCard.ts`: DOM card with the three columns and the manifest.
  - `manifest.ts`: turns a form request into YAML + kubectl text (pure,
    tested; also shown in forms as "Ship's manifest" from now on).
  - `beginner/*.ts`: one file per level: fixture, scripts, steps, summary.
- `web/src/screens/harborSelect.ts` (new): the screen after the splash:
  Open Harbor (demo), Your cluster, Harbor Academy (level list with stars
  and lock state), Expeditions (vendor campaigns). Deep links keep working
  (`?demo`, `?level=academy/3`, plain `/` goes to the live harbor when a
  cluster answers).
- Training simulator (`tour/training.ts`) grows to cover what levels need:
  probes (readiness drops a ship from beams), ConfigMap/Secret objects,
  limits and OOM, rollouts with a bad image, a courier pod that targets a
  ship by name vs by service.
- Progress: backend `~/.config/harbor/progress.json` behind `GET/PUT
  /api/progress` (per level: stars, best time, hints used, completed at);
  localStorage fallback when there is no backend (demo-only page).

## 4. Backend additions

- **Stage endpoints** for real-cluster replays, a fixed whitelist so the
  UI can only stage known incidents: `POST /api/stage/{incident}` with
  `{ns, name}`: `sink-pod` (delete a pod), `break-hull` (patch a pod's
  container to fail its probe or exit), `storm` (create a load-generator
  pod against a service for N seconds), `bad-refit` (set a Deployment
  image to a tag that crashes), `hog` (a pod with no requests that burns
  CPU), `cordon`/`uncordon` a node (NotReady look-alike). Each is
  implemented with client-go, labelled `harbor.dev/staged=true`, and
  cleaned up by `POST /api/stage/cleanup`.
- **New create forms and endpoints**: ConfigMap and Secret (key/value
  editor; mount or env on a shipyard), probes and limits fields on the
  Deployment/StatefulSet forms, Deployment rollback (`rollout undo`), and a
  `strategy` field (maxUnavailable/maxSurge).
- **Pod events and reason** are already streamed; the level engine uses
  them for "why is it Pending" bubbles.
- **Progress** storage (above) and **campaign loader** (section 6).

## 5. Glossary and tooltips

One dictionary, `web/src/glossary/terms.ts`: for every naval term the
matching Kubernetes term, a one-line meaning, a longer note, and the real
docs link; and the same for every Kubernetes/Helm term the UI utters
(Deployment, ReplicaSet, pod, container, node, namespace, label, selector,
Service, ClusterIP, NodePort, LoadBalancer, Ingress, TLS, ConfigMap,
Secret, request, limit, probe, rollout, revision, StatefulSet, DaemonSet,
Job, CronJob, PVC, StorageClass, Helm, chart, release, repository, values,
revision, context, kubeconfig, …).

- **Auto-markup**: a pass over the text nodes of HUD cards, toasts, forms,
  tour and level bubbles, summaries and the log wraps whole-word matches in
  `<abbr class="term" data-term>`; first occurrence per element gets the
  dotted underline so bodies of text are not peppered. The pass runs when
  those elements are (re)rendered, from one helper, so new UI gets it free.
- **Tooltip**: hover (and keyboard focus) shows a small cream card: the
  pair ("Shipyard = Deployment"), the one-liner, and "Learn more". Click
  opens the **Glossary** overlay (G key, rail button) at that entry with
  both languages, the longer note, where it appears on the map, and the
  docs link.
- **Map labels**: hovering a ship, shipyard, lighthouse, gate, anchorage or
  dock shows the same tooltip for its kind (pointer hit-test already
  exists for clicks).
- **Both-languages switch** in settings: show the Kubernetes term in
  parentheses after naval terms everywhere, for people who know Kubernetes.
- **Coverage test**: a Vitest scan of the UI string sources (HUD, forms,
  tour, levels) that fails when a known naval term lacks a glossary entry.

## 6. Campaign format and the FortiAIGate expedition

Vendor campaigns are data, not code: `campaigns/<id>/campaign.yaml` loaded
by the backend (`GET /api/campaigns`) from `~/.config/harbor/campaigns` and
an embedded `campaigns/` folder. A campaign is a list of levels; each level
is a list of steps of a few fixed kinds, all run against the real cluster:

```yaml
id: fortiaigate
title: FortiAIGate expedition
source: https://docs.fortinet.com/document/fortiaigate/8.0.1/...
levels:
  - id: validate
    title: Survey the harbor
    steps:
      - kind: check          # a backend probe; shown as a checklist line
        probe: kube-version  # >= 1.25
      - kind: check
        probe: node-arch     # linux/amd64
      - kind: check
        probe: node-label    # a GPU label on at least one node
        args: { label: nvidia.com/gpu.present=true }
      - kind: check
        probe: ingress-controller
      - kind: check
        probe: storage-class-rwx
      - kind: instruct       # text, links, optional image
        text: "Each worker node needs ... (from the guide)"
  - id: cargo
    title: Load the cargo
    steps:
      - kind: form
        form: secret         # registry pull secret, prefilled keys
      - kind: check
        probe: image-pullable
        args: { image: "{{ values.image }}", secret: fortiaigate-registry }
  - id: course
    title: Chart the course
    steps:
      - kind: values         # values.yaml editor with required keys
        chart: fortiaigate   # a local chart path or repo/name
        required: [image.repository, image.tag, ingress.host, storage.size]
  - id: papers
    title: Papers, please
    steps:
      - kind: form
        form: configmap      # licenses, one key per node
  - id: launch
    title: Launch
    steps:
      - kind: helm-install
        release: fortiaigate
        namespace: fortiaigate
      - kind: check
        probe: release-deployed
      - kind: check
        probe: pvc-bound
      - kind: check
        probe: pods-ready
        args: { namespace: fortiaigate }
  - id: gate
    title: Open the gate
    steps:
      - kind: check
        probe: ingress-address
      - kind: check
        probe: http          # the backend fetches the UI URL
        args: { url: "https://{{ values.ingress.host }}/" }
  - id: refit
    title: Refit
    steps:
      - kind: helm-upgrade
      - kind: check
        probe: release-revision
        args: { min: 2 }
```

Step kinds: `instruct`, `check` (a named backend probe from a whitelist),
`form` (one of the shop forms, prefilled), `values` (chart values editor
with required keys), `helm-install`, `helm-upgrade`, `wait` (a goal over
the store). Levels in a campaign have the same success animation and a
summary that quotes the guide section.

The FortiAIGate expedition mirrors the guide's seven steps: prepare and
validate the environment, prepare the image, configure the chart, configure
the license, deploy, access, upgrade. Its prerequisites (Kubernetes
≥ 1.25 on linux/amd64, a CNI, an ingress controller, an RWX StorageClass or
PersistentVolumes, GPU worker nodes with NVIDIA L4/A10/A100, licenses
mapped to nodes, images pushed to a registry) become `check` probes, and
its values (image repository/tag/pull secret, GPU enablement, storage,
ingress class/host/annotations, TLS, license node mapping) become the
required keys of the `values` step. It can be authored and dry-run against
the campaign loader here; a real run needs a GPU cluster and Fortinet
images.

## 7. Phases

| Phase | Scope | Size |
|---|---|---|
| G0 | **Done 2026-10-08.** Glossary and tooltips: 41-entry dictionary (`web/src/glossary/terms.ts`), auto-markup of HUD, tour and overlay text by a MutationObserver (inputs, logs and code skipped; idempotent; first occurrence per element underlined), hover/focus tooltip with the pair and one-liner, click or G opens the glossary overlay with search and docs links, map hover shows the kind's entry, a both-languages switch in settings, a coverage test that fails when a UI term lacks an entry, an e2e spec | 1 session |
| C0 | **Done 2026-10-08.** Harbor Select overlay (Academy rail button, `?academy`, `?level=academy/N` deep links; Open Harbor, your cluster, level list with stars and locks), progress endpoints `GET/PUT /api/progress` backed by `~/.config/harbor/progress.json` (`-progress` flag; localStorage mirror for the demo harbor), level types, script director with a fake-timer test, goal evaluators, the tour's bubble extracted into `tour/bubbleUI.ts` with a Hint button, `levels/runner.ts` on the tour engine (fixture into the training simulator, hints counted, stars = done + no hints + under par), fireworks + HARBOR SECURED banner with stars popping in, summary card (naval / Kubernetes / on the job, YAML with harbor notes, kubectl), "Ship's manifest" live YAML in the shipyard form, levels 1 and 2, e2e `levels.spec.ts` | 2 sessions |
| C1 | Levels 3-5 (scaling, probes, services): probe fields on forms, courier pod in the simulator, storm script | 1-2 sessions |
| C2 | Levels 6-8 (ingress, config/secrets, requests/limits): ConfigMap/Secret forms and endpoints, limits fields, OOM and Pending staging | 2 sessions |
| C3 | Levels 9-10 (namespaces/labels, rollouts): rollback action and strategy fields, Fleets integration | 1 session |
| C4 | Stars, par times, challenge mode, real-cluster replays with the stage endpoints and cleanup | 1-2 sessions |
| C5 | Campaign loader and format, probes whitelist, FortiAIGate expedition authored from the guide, dry-run against a mock | 2 sessions |

Order of value: G0 first (it improves everything, including Open Harbor),
then C0 so there is a playable level early, then content.

## 8. Testing

- Unit: goal evaluators, event scripts (director with fake timers),
  manifest/YAML generation, glossary coverage, star rules.
- E2E: one Playwright spec per level playing it through in simulated mode
  (the tour spec is the template); a real-mode spec for level 2 and 3 on
  kind using the stage endpoints; visual snapshots of the success screen,
  a summary card, a tooltip and the glossary.
- Content review: a `?level=` deep link opens any level directly for
  proofreading its bubbles and summary.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Simulation drifting from real Kubernetes behaviour | Every level has a real-mode replay; the simulator is tested against recorded real streams for the staged incidents |
| Levels teach the metaphor instead of Kubernetes | The summary and manifest always show the real terms and YAML; the both-languages switch; glossary on every term |
| Staging incidents on a real cluster is destructive | Whitelisted incidents, only on objects harbor created or the learner chose, all labelled and cleaned up; never on system namespaces |
| Vendor campaign cannot be verified here | Dry-run mode validates the campaign file and runs probes against a mock; the first real run is documented as a manual checklist |
