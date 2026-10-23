# Toasts at the bottom right, above the health panel

Status: done 2026-10-23 with PLAN-HUBER.md. One change from the design:
instead of the bubble reserving room for three toasts, the bubble has
priority and the toast column takes what is left between it and the panel
(`--captain-bottom`, published by the dock each tick), clipping its oldest
lines first, so the bubble never jumps and keeps its full height; with no
level running all four toasts show.

## 1. The problem

Toasts ("Ship launched: nginx-7d9-z1", "Harbor master online", "LOW
POWER") stack above the selection card at the bottom centre. They sit on
the map, next to the thing the player is working with, and they share the
column that slides left to clear the cluster panel, so a burst of toasts
makes the centre of the screen busy at exactly the moment a card is open.

## 2. The design

- The toasts move into the **bottom-right stack**, right-aligned, directly
  **above the HEALTH / CAPACITY panel**. Newest at the bottom, nearest the
  panel; older ones push up and fade as now (4.5 s, four at most).
- They become **compact, one-line notices**: 12 px text, 28 px tall,
  ellipsis past 360 px, so the column never widens past the panel and a
  stack of three is about 100 px. Warnings keep the red tint.
- The **bottom-centre column holds only the selection card**. Its
  room-keeping is unchanged in arithmetic but now measures the whole
  bottom-right stack (panel plus any toasts) so a toast never meets the
  card either; the panel's fold is unchanged.
- Until PLAN-HUBER.md moves the zoom rail to the top right, the order of
  the stack from the bottom is panel, zoom rail, toasts. Once the rail
  moves, toasts sit directly on the panel, which is what was asked.
- **Huber's bubble reserves the room.** Three toasts above the panel take
  about 100 px, and the bubble must not reach them, so its cap keeps that
  room whether or not a toast is showing (a cap that shrank when a toast
  arrived would jump while the learner is reading). With the rail moved,
  the cap is `calc(100vh - 300px)`.

What that does to the bubble (compared with PLAN-HUBER.md's numbers):

| Window height | Today | PLAN-HUBER alone | with toasts reserved |
|---|---|---|---|
| 760 px | 440 px | 550 px | 460 px |
| 700 px | 380 px | 490 px | 400 px |

So the right edge is shared by Huber, the toasts and the panel, and the
toasts cost the bubble most of what moving the rail gained. Two ways to
keep the bubble tall are in the questions.

Layout at 1280 by 760 (after PLAN-HUBER):

```
┌ badge ──────────────────────── ⚙ ＋ ⌂ － 🔕  (portrait) ┐
│ rail                                        Huber       │
│                   the harbor               ┌ bubble ─┐  │
│                                            │ …       │  │
│                                            └─────────┘  │
│                                      Ship launched: …   │
│                                      Harbor master on…  │
│ Shop Charts   ┌ selection card ┐   ┌ HEALTH / CAPACITY ┐│
└─────────────────────────────────────────────────────────┘
```

## 3. Changes

- `web/index.html`: `.toasts` moves from `.hud-bottom-center` to the top
  of `.hud-bottom-right`.
- `web/src/hud/hud.css`: the toast column right-aligned with a 360 px cap
  and the compact toast style; `.hud-bottom-center` loses its toast gap;
  the bubble cap reserves the toast room.
- `web/src/hud/panelRoom.ts`: measures `.hud-bottom-right` (the stack)
  rather than `.cluster` alone for the left edge, and watches it for
  mutations so a toast arriving re-measures.
- `web/src/hud/toasts.ts`: unchanged (same TTL and cap).
- Text: welcome tour step that mentions toasts, glossary `where` lines
  that say "bottom centre", README; `dock.spec.ts` gains a toast burst
  (three announcements) and asserts the card, the toasts and the bubble
  stay apart; visual baseline of the demo harbor refreshed.

## 4. Size

Half a session.

## 5. Questions

1. **Room for how many toasts**: three (recommended: a burst from a
   level's Launch step is usually two or three), or two, which gives the
   bubble 30 px back?
2. **Keep the bubble tall anyway?** Two options if 460 px is too short:
   (a) hide toasts while a level step is showing a long text, since Huber
   narrates the same events, or (b) let the toasts sit at the bottom right
   only when no level runs, and above the selection card during a level.
   Recommended: neither for now, keep one rule, revisit after using it.
3. **Order until the rail moves**: toasts above the rail row (recommended,
   so the panel and rail stay a block), or between the rail and the panel?
