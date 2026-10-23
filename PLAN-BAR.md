# A tooltip on the shipyard's readiness bar

Status: done 2026-10-23. A small follow-up to the flag tooltip: the bar
above every shipyard and tanker terminal gets a hover of its own.

## 1. What the bar is

The bar over a structure is `status.availableReplicas / spec.replicas`:
ships moored over ships wanted. Green when all are ready, amber when
some are, red when none are and at least one is wanted. It fills to 100%
during a rollout once the new ships are ready; the REFIT tag beside the
hull is what says a rollout is still running. None of that is explained
anywhere a learner can hover.

## 2. The design

- **Hover the bar** (its hit-rectangle is the bar's drawn area, 80 by 8
  px, with 4 px of slack above and below) and the glossary tooltip opens
  on a new entry **`readiness-bar`** ("ready replicas · ships moored"),
  Kubernetes first: what available replicas means, when it lags
  (rollouts, crash loops, probes), and the harbor line about the colours.
- The tooltip's title carries the live numbers as the subject, the way the
  flag carries the fleet: `ready replicas · ships moored 2/3`, and when a
  rollout is in progress the subject gains `· refit 1/3` so the REFIT tag is
  explained in the same breath.
- Same tooltip on a **tanker terminal**'s bar (ready over desired for a
  StatefulSet), with the subject naming tankers instead of ships.
- The hit-test runs only on hover, like the flag; a click on the bar
  selects the structure as a click anywhere on it does today, so nothing
  about clicking changes.
- Priority when hovers overlap: flag, then bar, then the structure itself,
  because the flag and bar are small targets sitting over the structure.

## 3. Changes

- `web/src/entities/Shipyard.ts`: `barRect()` returning the bar's world
  rectangle.
- `web/src/scenes/MapScene.ts`: `keyAt(…, hover)` checks `b.barRect()`
  after the flag and returns `bar:<ns/name>`; `worldRectOf()` resolves it.
- `web/src/hud/hud.ts`: `hoverTip()` maps `bar:` to `readiness-bar` and
  builds the subject from the structure's model (`available/replicas`,
  plus `refit updated/replicas` when `updated < replicas`).
- `web/src/glossary/terms.ts`: the `readiness-bar` entry; the `crew` entry
  points at it ("the same fraction, per shipyard").
- `e2e/glossary.spec.ts`: hover the nginx shipyard's bar and assert the
  subject reads `3/3`.
- No visual change, so no baseline refresh.

## 4. Size

Under an hour; one commit.

## 5. Decisions

None needed. The only choice, whether the bar should be clickable to open
Papers (where the two numbers live), I recommend against: the structure
click already opens its card, and Papers is one button from there.
