# Glossary tooltips: Kubernetes first

Status: done 2026-10-12 (T0, T1 and T2 in one pass; decisions taken as recommended: `Deployment · shipyard` titles, three-line tooltips, both splits). Changes the content and layout of the glossary
(`web/src/glossary/`), nothing else. The current entries explain the game
("A shipyard is a Deployment: it keeps the number of ships you asked for
afloat") and treat Kubernetes as the translation. The owner wants the
reverse: every tooltip explains the real Kubernetes concept, gives a use
case where it matters, and ends with one sentence on how the harbor shows
it.

## 1. What a tooltip will say

Hovering any underlined word (naval or Kubernetes) shows, in this order:

1. **Title**: the Kubernetes term, with the harbor word after it:
   `Deployment · shipyard`. For harbor-only words (training harbor, Open
   Harbor, expedition, breakwater) the title is the harbor word alone.
2. **Concept**: one or two sentences on what the thing is in Kubernetes,
   written for someone who has never used it. No harbor words.
3. **Use case**: one sentence starting with "Use it when…" or "You meet it
   when…": the situation in which the concept matters.
4. **In the harbor**: one sentence, visually quieter, mapping it to the game.
5. "Click for more" as today.

Worked examples (final wording is written in phase T1):

| Term | Concept | Use case | In the harbor |
|---|---|---|---|
| Deployment · shipyard | A Deployment declares how many copies of a pod you want and which image they run; its controller keeps that many running and replaces any that die, and rolls out new versions gradually. | Use it for anything stateless that should survive crashes and node failures and be updated without downtime: web servers, APIs, workers. | A shipyard is a Deployment; Launch ship and Scrap one change its replicas. |
| Service · lighthouse | A Service gives a changing set of pods one stable name and IP, chosen by label selector, and load-balances between them inside the cluster. | Use it whenever something needs to reach pods by a name that outlives restarts and rollouts, such as a frontend calling an API. | A lighthouse is a Service; its beam shows the pods its selector matches. |
| probe · lookouts | Probes are health checks the kubelet runs on a container: readiness decides whether it receives traffic, liveness whether it is restarted. | Use them on every service pod so a hung process is restarted and a slow start keeps traffic away until it is ready. | Lookouts on a shipyard are its readiness and liveness probes. |
| CrashLoopBackOff · burning | The container keeps exiting right after start and Kubernetes restarts it with growing delays; the pod is Running but not Ready. | You meet it after a bad image, a missing config key or a failing dependency; the pod's logs and events say which. | A burning ship is crash-looping; Ship's log shows why. |

The glossary panel (click, or G) gets the same order with a longer concept
paragraph, the use case, the harbor sentence, "On the map" and the docs
link. Its list shows `Deployment · shipyard`, sorted by the Kubernetes
term; harbor-only entries sort last under "Harbor words". Search still
matches both languages.

## 2. Content rules

- Concept first, always about Kubernetes or Helm. A reader who ignores the
  last line should learn the real thing.
- Use case names a concrete situation, not a definition in other words.
- The harbor line is the only place game words appear, and it is one
  sentence.
- Terms that are purely game UI (training harbor, Open Harbor, expedition,
  breakwater, quay, signal flags) keep a short game explanation and no use
  case; they are the exceptions, not the pattern.
- Entries that bundle two concepts today are split where the use cases
  differ: `ensign` (namespace + labels) becomes `namespace` and `label`;
  `limits` (requests + limits) stays one entry because the use case is one
  sentence; `sealed-orders` splits into `configmap` and `secret`.
- Every entry keeps its docs link; concept text must agree with the docs.

## 3. Changes

- `terms.ts`: `Term` gains `concept`, `useCase?`, `inHarbor`; `short` and
  `long` go away (the tooltip shows `concept` + `useCase` + `inHarbor`, the
  panel shows the same with a `detail?` paragraph for extra depth where the
  current `long` had more). Aliases and ids are unchanged except the two
  splits above, so markup, levels (`terms: [...]`) and the coverage test
  keep working; the level term lists are updated for the splits.
- `tooltip.ts`: new title rule (Kubernetes first), three lines instead of
  one, a max width so two sentences wrap well; `pairLine` becomes
  `titleOf`.
- `panel.ts`: same order, list sorted by Kubernetes term, harbor-only group
  at the end.
- `hud.css`: tooltip width and the quieter "In the harbor" line.
- "Both languages" setting: unchanged (shows the Kubernetes term inline).
- Tests: `markup.test.ts` coverage check extended to require `concept` and
  `inHarbor` on every entry and `useCase` on every entry with a Kubernetes
  term; `glossary.spec.ts` asserts the tooltip shows the Kubernetes title
  and three lines; visual baseline for a tooltip added to `visual.spec.ts`.
- README's glossary paragraph.

## 4. Phases

| Phase | Scope | Size |
|---|---|---|
| T0 | Schema and rendering: `Term` fields, tooltip and panel layout, tests updated, two entries rewritten as the pattern (Deployment, Service) | half a session |
| T1 | Rewrite all 45 entries (47 after the splits) in the new voice; review against the docs links | one session |
| T2 | Level summaries: no change in structure, but their "In Kubernetes" column is checked for consistency with the new glossary wording | small |

## 5. Decisions needed

1. Title form: `Deployment · shipyard` (recommended) or `Deployment (shipyard)`.
2. Tooltip length: three short lines (recommended; about 50 words) or
   concept only in the tooltip with use case in the panel.
3. Splits: do `ensign` and `sealed-orders` split as proposed (recommended),
   or stay bundled.
