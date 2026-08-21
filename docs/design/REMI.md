# Remi — the character constitution

Frozen 2026-08-20 after three review rounds. **This file is the authority.** The
art is not re-decided per screen, per session, or per taste; changing anything
below needs an explicit unfreeze from the maintainer, stated as such.

**Shipped and VERIFIED ON HARDWARE 2026-08-21** — the maintainer walked every
placement on production from the device: the 42px welcome wave judged at arm's
length (the size the rejection ledger's whole argument turns on), the exit dialog,
the celebration, empty states, all three guided tours at maximum system font, the
dose gate including elderly, dark mode, the offline page in airplane mode, and the
dark + elderly + Telugu combination. All pass. That matters more than a screenshot
approval: the two size-conditional floors below exist precisely because a detail
sized as a fraction of the art disappears at 42px, and the only instrument that
settles whether the wave still reads is a person holding a phone.

The design chapter closed on those verdicts. Note the scope — this is the ART and
its placements. It says nothing about the alarm-core behaviour debt in
[VERIFICATION_CLOSE_2026-08.md](../VERIFICATION_CLOSE_2026-08.md), which is
still open.

Remi appears to **celebrate and to comfort**. Never on a missed dose, never on an
alarm, never to scold. That is the rule the placement registry exists to enforce.

---

## The five frozen laws

### 1 · The palette — five colours, hex-exact

| role | hex | used for |
|---|---|---|
| body | `#F26B8A` | the brain silhouette and the wave arm |
| folds / mouth | `#CC3D64` | the two lobe folds, every mouth, the sleep z's |
| blush | `#FDEEF2` | the two cheek ovals |
| eye ink | `#0F1C5A` | eye pills and closed-eye arcs |
| shine | `#FFFFFF` | one highlight per open eye |

**No sixth colour, ever.** The palette *is* the character — this is why golden
eyes and star eyes were rejected. Enforceable by grep: any hex in the art that is
not one of these five is a defect.

### 2 · The body silhouette — 10 lobes, frozen

Anchor geometry, 512 × 512 canvas, character **376 × 326** (ratio 1.153 : 1),
centred at 256, 256 — spans x 68…444, y 93…419.

```
core     ellipse cx 256 cy 256 rx 150 ry 120
lobes    r 68 at (256,161) (182,179) (136,227) (136,285) (182,333)
                (256,351) (330,333) (376,285) (376,227) (330,179)
folds    stroke 8.3 (2.2% body width), round caps, UPPER LOBES ONLY
         M174.7 137.6 Q146.9 143.9 140.6 171.7
         M337.3 137.6 Q365.1 143.9 371.4 171.7
```

**The folds never enter the face.** They sit at x 140–175 and 337–371, entirely
outside the eye columns, with 38.7 units of clearance above the eyes.

> The original wording was "ending at least one eye-height above the eye line".
> When the eyes grew to 32% in v3 that arithmetic stopped being satisfiable
> (it would demand ending above y 158.2; the folds end at 171.7). The rule is
> therefore recorded as what it was always protecting: **a horizontal exclusion**
> — nothing between or above the eyes within the face zone.

### 3 · Sticker-flat rendering

Flat fills only. **No gradients, no shadows, no gloss, no outlines, no texture,
no filters, no masks, no patterns.** Round caps on every stroke. Transparent
background.

### 4 · The silhouette test

Every expression must remain readable as Remi when filled with a single flat
colour, at every registry size. Run it on any new expression before it ships.
`waving` gets its own silhouette test, because it is the only variant permitted
to modify the outline.

### 5 · Dark mode — identical art, blush at 45%

**Same art. No plate, no alternate palette, no second asset.** The one change is
the blush layer dropping to **45% opacity** on the OLED ground.

The blush is a *highlight*, and this project's dark rule is that highlights are
fractions of the room's light — they drop on dark while shades deepen. Left at
full strength the near-white blush reads as a hotspot, which is exactly the
failure the water tumbler and the dose-strip pockets had. Reducing alpha keeps
law 1 intact: same colour, less of it.

A plate behind Remi was considered and rejected — it adds a shape the silhouette
test does not cover, and reads as a badge. Pink separates from near-black unaided.

---

## Anchor face values

Every expression is a variation on these. Percentages are of the body box.

```
eye height   104.3   (32% body height)
eye width     57.4   (55% eye height)
gap           57.4   (1.0 eye widths) → centres 114.8 apart
eye centres   x 198.6 / 313.4 · y 262.5 (52% body height — below middle,
                                          which is the baby proportion)
shine         r 9.76 (34% eye width) at (−12.6, −29.2) from the eye centre
mouth stroke  9.5    (fold stroke × 1.15)
mouth y       318.7  (eye bottom + 4)
blush         centres x 131.95 / 380.05 · y 290 · rx 33 · ry 18.15
              (66% of body width apart — at 78% the ovals clipped the outline
               and read as slipping off)
```

---

## The expressions

### happy — exit dialog

```
eye     h 104.3 (32% body h) · w 57.4 · gap 57.4 · cy 262.5
lids    open pill
pupil   centred
shine   r 9.76 (34% eye w) at −12.6, −29.2
mouth   arc · w 75.2 (20% body w) · depth 19.6 · stroke 9.5 · y 318.7
blush   rx 33 · ry 18.15 (100%) · dark 45%
folds   base, both lobes
tilt    none
outline frozen
```

The anchor. Every other face is measured against this one.

### waving — welcome

`happy`'s face, plus the one permitted silhouette modification.

```
arm     limb  M398 205 C430 201 447 184 451 155 · stroke 26 · round cap
        hand  circle cx 451 cy 150 r 22 (mitten, no fingers)
        reach 61.5 units from silhouette edge to mitten tip = 16.4% body width
        z-order: drawn BEFORE the body fill, so the limb root is covered by the
                 body and the arm reads attached rather than stuck on
                 (root 398,205 lies inside the r-68 lobe at 376,227)
```

Everything else identical to `happy`.

### proud — celebration · care-circle moments

```
eyes    closed ∩ · w 57.4 · arc depth 16.1 · stroke 8.3
shine   none — there is no ink to shine on
mouth   arc · w 100.3 (26.7% body w) · depth 26 · corners lifted 7 · y 318.7
blush   rx 39.6 · ry 21.78 (120%) · dark 45%
folds   base · tilt none · outline frozen
```

Arc depth is 20% deeper than the first attempt so the closed-happy is
unmistakable rather than reading flat.

### peaceful — empty states · offline comfort

```
eyes    resting ⌣ · w 71.75 (125% — longer than open eyes) · sat 10 lower
        arc depth 8.7 (gentler than proud, deliberately) · stroke 8.3
shine   none
mouth   arc · w 37.6 (10% body w) · depth 9.8 · y 318.7
blush   rx 26.4 · ry 14.52 (80%) · dark 45%
folds   base
tilt    4° on the FACE LAYER ONLY — the body never tilts
outline frozen
```

Longer, lower, gentler lids are what separate this from `proud`. An earlier pass
had them *deeper* than proud, which is why the two read alike.

### curious — guide tour

```
eyes    open pill · h 104.3 · w 57.4 · shifted up-left 8.6 (15% eye width)
shine   r 9.76, following the pupils
mouth   "o" · r 13.16 (7% body w) · stroke 9.5 · y 306.7 (lifted toward the eyes)
blush   rx 33 · ry 18.15 (100%) · dark 45%
folds   LEFT LOBE RAISED 15 — the eyebrow effect without an eyebrow
tilt    none · outline frozen
```

### peaceful-sleep — bedtime empty state · **APPROVED, UNWIRED**

`peaceful` exactly, plus two z marks:

```
zeds    stroke #CC3D64 · width 8.3 · round caps and joins
        M450 168 L474 168 L450 192 L474 192
        M481 130 L499 130 L481 148 L499 148
        outside the silhouette (body edge at that height is 425.1) and inside
        the canvas (rightmost point 499 of 512)
```

**Wire this only if a bedtime empty state exists.** It does not today.

Closed-*resting* eyes read as asleep. The cut `sleepy` variant used half-lowered
lids, which risked reading drowsy or sedated — not a look a medication app can
afford.

---

## Size-conditional rules

Two, and only two. Both exist because a detail sized as a fraction of the art
disappears when the art is 42px.

### The shine floor

| render size | shine r | rendered |
|---|---|---|
| > 120 | 9.76 | natural |
| ≤ 120 | 11.2 | 5.25px at 120 |
| ≤ 56 | 11.2 | 2.45px |
| ≤ 42 | 12.2 | 2.00px |

### The arm floor — `waving` only

| render size | limb stroke | mitten r | rendered |
|---|---|---|---|
| > 56 | 26 | 22 | 8.9px / 15.1px at 176 |
| ≤ 56 | 34 | 25 | 3.7px / 5.5px |
| ≤ 42 | 42 | 28 | 3.5px / 4.6px |

The arm **thickens rather than disappears**. Hiding the limb at small sizes was
tried and rejected: it leaves the mitten floating detached from the body, which
is worse than a chunky arm. At 42px the gesture simplifies to a raised bump,
which still reads as waving.

> **Why the art is inline SVG and not `<img src="…svg">`.** Both rules above, and
> the dark blush rule, need CSS or computed values to reach *inside* the art. An
> `<img>` is opaque to the page, so the blush would sit at full strength on OLED —
> the exact failure law 5 exists to prevent. Inline rendering is therefore forced
> by the frozen laws, not chosen for convenience.

---

## Rejection ledger

Recorded so they do not return.

| rejected | reason |
|---|---|
| **love** | Warmth was carried by blush 150% + widest smile, but it read as `proud` with more blush — a variant that is not distinct is a maintenance cost with no expressive gain. |
| **sleepy** | Half-lowered lids risked reading drowsy or sedated. In a medication app that is an unaffordable ambiguity. `peaceful-sleep` covers the moment with closed-resting eyes instead. |
| **surprised** | Doubling the shine put it at 68% of eye width — a lot of white in a face whose charm is elsewhere — and "alerting but not scary" is too narrow a target to hit reliably. A mascot that looks alarmed is worse than no mascot. |
| **thinking** | Up-right gaze plus a flat-line mouth read as distracted rather than considering. Loading states do not need a face. |
| **wink** | Charming in isolation, but playful-confirmation moments are not in the approved list of moments, so it had nowhere to live. |
| **golden / star eyes** | Breaks law 1. The palette *is* the character; a sixth colour for one expression trades the whole system for one moment. |
| **"!" marks** | Reads as warning or error. Remi never alarms — that is the entire premise of the placement rule. |

---

## Placement

Placement is a registry, not a convention:
`web/src/components/dashboard/mascot-slots.ts`. A new slot is a design decision
and is made there, on purpose. Elderly mode narrows to **welcome, celebration and
offline only**.

**`landing` added 2026-08-21** — the public landing page's hero, `waving` at 120
(148 elderly). Same greeting as `welcome` and the same expression; what differs is
only the room. The auth shell gives Remi 42px beside a form, while a landing hero
is a screen with nothing else competing, which is exactly the condition that earns
the character its place. At 120 the wave renders at its natural stroke, clear of
the arm floor that exists to rescue it at 42. It is a SEPARATE slot rather than a
larger `welcome` because the two can drift: shrinking the auth greeting must never
shrink the hero.

Offline is the one moment with no registry entry, and deliberately so: the offline
page is `android-app/.../assets/offline.html`, which renders when nothing can be
fetched and therefore hand-inlines the `peaceful` art at 120 rather than importing
a component. Keep that copy in step with the geometry above if it ever changes.
The `careCircleMoment` slot was deleted the same day (2026-08-21) — it had never
had a caller.

**Remi must never appear on a missed-dose or alarm surface.** If a surface asks
the patient about a dose they may have missed, Remi does not belong on it.

### The dose gate: no mascot, by constitutional rule

Ruled 2026-08-21. `med-due-gate.tsx` was the one placement outside the registry —
Remi sat inside the overdue ring with the face chosen by lateness, computing a
`concerned` look once a dose was thirty minutes late. That is scolding, and it is
the one thing this character is defined not to do.

The three options were: drop Remi from the gate, keep the legacy art there as a
documented exception, or design a gate-specific expression under a fresh unfreeze.
**The first was chosen. The other two are closed.**

The lateness ring and the frosted lens behind it went with the art, because both
existed to frame and seat the mascot — leaving them would have left an empty
donut where the character had been. Nothing was lost with them: the exact figure
is spelled out in the chip below (icon, text and tint), and each row of the list
view already carries its own time and missed state as text. The gate's own comment
had already shrunk the art once "so the name can lead"; removing it finishes that
sentence, and the drug name is now the first thing on a screen whose only job is
naming a drug.

This ruling is also what let the legacy PNG path be deleted outright — the gate
was its last caller. `BrainMascot` now renders inline SVG with no branch, and
`web/public/mascot/` keeps only the four scene illustrations (`welcome-mascot`,
`login-hero`, `login-peek`, `refill-gate-mascot`), which are not Remi placements.
