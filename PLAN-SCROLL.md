# Speech bubbles for talk, scrolls for orders

Status: done 2026-10-23 (all four decisions as recommended). A styling change to the HTML overlays; no gameplay or API change.

## 1. The problem

Every HTML surface in Harbor is the same cream card with an olive border
and green pill buttons: the glossary tooltip, the harbor master's welcome
tour, Captain Huber's expedition dock, the toasts, and also the Shipyard
form, Light a lighthouse, Found a fleet, Apply a manifest and the rest.
A player cannot tell at a glance whether the thing in front of them is
someone *talking to them* (safe to read, dismiss, ignore) or a form that
will *write to the cluster* when they press the button. The two kinds
should look like two different objects.

## 2. The design

Two registers, nothing in between:

**Speech** stays exactly as it is: the rounded cream card with the
pointer tail, the video-game text bubble. It is for anything that
explains, narrates or reports and never writes to the cluster:

| Surface | Where |
| --- | --- |
| Glossary tooltip and glossary panel | `#term-tip`, `#glossary` |
| Harbor master (welcome tour) and Captain Huber (expeditions) | `#captain` dock |
| Toasts, the Harbor master online chip | `#hud .toasts` |
| Challenge board and success banner | `#challenge`, `#success` |
| Splash and harbor select | `#splash`, `#mission` |
| Selection card (the facts about what is selected) | `#hud .selection` |

**Scroll** is new: parchment, ink and a quill, the written order you hand
to the harbor authority. It is for every overlay whose button changes
the cluster:

| Form | Overlay |
| --- | --- |
| Shipyard (build), Refit shipyard | `#build-form`, `#refit-form` |
| Send out a fleet (Job) | `#job-form` |
| Found a fleet (Namespace) | `#fleet-form` |
| Sealed orders (ConfigMap/Secret) | `#orders-form` |
| Light a lighthouse (Service), Open a gate (Ingress) | `#lighthouse-form`, `#gate-form` |
| Change ensign (labels) | `#ensign-form` |
| Apply a manifest | `#apply-form` |
| Shop drawer (buy a structure) and Tech tree (helm install) | `#shop`, `#tech` |

Read-only panels (Harbor log, Unit intel, The ledger, Papers, Chart
table, Locate, Radar filter, Settings, Expeditions) are records, not
orders and not speech. They keep the plain cream card for now; they are
already visually distinct from both once the scroll exists. Settings and
Radar filter change the app, not the cluster, so they stay cards.

### What a scroll looks like

- **Parchment**: a warm paper ground (`#efe0bd` to `#e3cf9f`, a faint
  mottling from two layered radial gradients, no image asset), a thin
  sepia ink rule for a border (`1.5px #5a3b1a`), corner radius 4 px
  instead of 14. Top and bottom edges are **rolled**: two pseudo-elements
  draw a darker wooden rod with a cylinder gradient and a drop shadow, so
  the form reads as an unrolled scroll. The overlay dim behind it stays.
- **Lettering**: a period face for the heading and field labels. Bundle
  *IM Fell English* and *IM Fell English SC* (OFL, like Nunito) under
  `public/fonts`, fallback Georgia. The heading (SHIPYARD, LIGHT A
  LIGHTHOUSE) is set in Fell small caps in sepia ink; field labels in
  Fell SC at 11 px. **Field values keep Nunito**: image tags, names and
  resource strings must stay legible, and the YAML manifest stays
  monospace.
- **Fields as ruled lines**: inputs and selects lose their white boxes
  and sit on the parchment with a single ink baseline (`border-bottom:
  1.5px solid #5a3b1a`), darkening on focus; invalid turns the line red
  as today. Number and select controls keep a faint parchment tint so
  their affordance survives.
- **The quill**: a quill glyph (inline SVG, sepia) in the top-right of
  the heading, where `.where` sits now. The pointer over an input is a
  small quill cursor (inline SVG `cursor: url(...) 2 22, text`), so
  writing on the scroll feels like writing. No animation; nothing to
  reduce for `prefers-reduced-motion`.
- **Buttons**: the submit button becomes a **wax seal**, a dark red
  circle (`#9c2a1e`, inset highlight, embossed anchor glyph) with the
  verb beside it in Fell SC: `⚓ BUILD`, `⚓ LIGHT`, `⚓ APPLY`. The
  button element, its text and its `type=submit` are unchanged so every
  e2e selector still finds it. Cancel becomes plain sepia text, `Tear
  up`, no pill, still `data-cancel`. Secondary buttons inside scrolls
  (the row `add`, pickers, tabs) are small ink-bordered parchment
  buttons.
- **Errors** are an ink blot: red-brown text with a small blot glyph,
  same `.err` element.
- **Ship's manifest** `<details>` is a folded attachment pinned to the
  scroll: a slightly darker parchment strip with a dog-eared corner.
- **The shop drawer** gets the parchment ground and rolled ends across
  the full width; its structure cards keep their art but take the sepia
  rule and a wax-seal BUY. **The tech tree** panel gets the full scroll
  treatment; its charts list stays a list.

### Where the registers meet

- The selection card's **action buttons** (Change ensign, Re-aim beam,
  Scuttle, Refit) open scrolls. They keep their pill shape but gain a
  small quill glyph before the label, so every button that leads to a
  scroll says so. Captain Huber's CTA and tour buttons do not change.
- While a scroll is open the dock still folds to the left (the
  `body.captain-open` rule), so the bubble and the scroll are visible
  together and the contrast is seen, not just described.

## 3. Changes

- `web/public/fonts/`: IM Fell English and IM Fell English SC TTFs plus
  their OFL file; `@font-face` in `hud.css` beside Nunito.
- `web/src/hud/hud.css`: new tokens (`--parchment`, `--parchment-dark`,
  `--sepia`, `--wax`, `--font-scroll`); the quill cursor data URI.
- `web/src/style.css`: a `.panel.scroll` block overriding the panel,
  heading, label, input, select, textarea, error, details and button
  rules; `.overlay.bottom .drawer.scroll` for the shop. The base `.panel`
  rules are untouched, so every read-only panel and every bubble is
  unaffected.
- `web/index.html`: `scroll` added to the `panel` class of the nine write
  forms, the tech tree panel and the shop drawer.
- `web/src/hud/hud.ts`: the selection actions that open a form carry
  `data-scroll` so the quill glyph can be drawn by CSS, nothing else.
- Buttons keep their text and data attributes; no spec selector
  changes. `web/e2e/visual.spec.ts` gains one screenshot, the Shipyard
  scroll open over the demo harbor with the harbor master's dock folded
  beside it (`scroll-shipyard.png`), and the baselines are refreshed
  with `make test-visual-update`.
- `web/src/glossary/terms.ts`: the entry that explains the harbor
  authority gains one in-harbor line: orders are written on a scroll and
  sealed; what the harbor master and Captain Huber say is a bubble.

## 4. Size

One session: half for the scroll CSS and fonts, a quarter for the shop
and tech tree, a quarter for the wax seal, quill cursor and the visual
baseline.

## 5. Decisions

1. Period face: IM Fell English (recommended; worn 17th-century letter,
   OFL, readable at 11 px) or Pirata One (louder, blackletter) or none,
   using Georgia.
2. Which surfaces become scrolls: the nine write forms plus shop and
   tech tree (recommended) or every overlay including the read-only
   panels.
3. Submit button: wax seal with the verb beside it (recommended) or the
   existing green pill in sepia.
4. Quill cursor over inputs: yes (recommended) or the normal text caret.
