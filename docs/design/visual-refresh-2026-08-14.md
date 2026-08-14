# Visual refresh — "cards on a board"

**Stage 1 proposal.** Branch `design/visual-refresh`. Nothing merges without approval.
Elderly is **excluded** — approved as-is and untouched by every rule below.

Presentation only. No backend, schema, RPC, bridge or behaviour changes; anything
that would need one is flagged in §8 rather than smuggled in.

---

## 0. Domain exploration (interface-design full flow)

**Domain.** The dosette box and its compartments · the bedside table at 3am ·
the chemist's paper slip · the blister strip emptying across a week · a daughter
checking on her mother from another city · the medicine cupboard with labels
facing out · the clinic waiting room.

**Color world.** Prescription-pad off-white · blister-foil grey · the brand's
pink · clinic-ink navy · bedside-lamp amber · night indigo · the sky blue of a
glass of water.

**Signature — the tray.** A dosette box is compartments sitting *in* a tray. That
is exactly the "cards on a board" language, and it is why it fits this product
rather than being a generic Material trend: **the board is the tray, the cards
are the compartments you lift out.** The tell that it is ours and not anyone
else's is §3 — the card's shadow is *tinted by the time of day*, so a morning
screen and a midnight screen have different light falling on them without a
single fill changing.

**Rejecting three defaults.**

| Default | Replaced by |
|---|---|
| `1px solid` border on every card | Two-layer soft shadow on a deepened board (§1) |
| `font-mono` on page titles and headings | Inter with real weight hierarchy; mono demoted to labels/numbers/times (§4) |
| Ad-hoc radii (24/16/12/8 mixed by feel) | One three-step scale, 20/14/10 (§2) |

**The swap test.** Swap the shadow system for borders and the whole thing
collapses back to today's app — which is the point: the elevation *is* the
refresh, not decoration on top of it.

---

## 1. Elevation — the board and the cards

Today every surface is `bg-card` + `border-border`, so a page is a set of
outlined rectangles on a flat ground. Nothing is above anything; the border is
doing work that light should do.

```
--board:        #EFE9EE   /* paper, deepened ~4% — the tray */
--surface:      #FFFFFF   /* a card */
--surface-sunk: #F7F3F6   /* inputs and wells: receive content, sit BELOW the card */
```

**Two layers, always.** A contact shadow for the edge, a diffuse one for the
float. One layer alone reads as a drop shadow from 2009; two read as an object.

```
--lift-1: 0 1px 2px rgba(15,28,90,.05), 0 2px 8px rgba(15,28,90,.05);   /* resting card */
--lift-2: 0 2px 4px rgba(15,28,90,.06), 0 8px 24px rgba(15,28,90,.08);  /* raised: gate, dialog, focused dose */
--lift-0: none                                                          /* pressed — the card meets the board */
```

**No hard borders on cards.** A border survives only where it is a *boundary*
rather than an edge: input outlines, table rules, the focus ring.

**Squint test.** Blur the page: you should see soft blocks floating on a warm
ground, with nothing jumping. If any edge is the first thing you see, it is too
strong.

## 2. Radius — one scale, three steps

`20` cards and sheets · `14` buttons, inputs, chips · `10` swatches, badges,
small controls.

**Concentric rule:** a child's radius = parent's − its inset. A 20 card with 16
padding holds a 14 button correctly; two 20s nested is the single most common
thing that makes a UI feel slightly wrong.

Today's `rounded-3xl` (24) on cards *and* on 40px chips is the defect this fixes.

## 3. Colour — audit and the one-accent rule

- **Mind pink stays the single accent.** `--primary-strong` for anything
  load-bearing (4.75:1), `--primary` for tints, rings and the logo. Unchanged.
- **Slot tints stay surfaces**, never interactive, never text without `-ink`.
  **New, and this is the signature:** the board's shadow takes a slot-tinted hue
  — `--lift-tint` swaps the shadow's colour by time of day. Morning shadows lean
  warm, night shadows lean indigo. Surfaces stay neutral; only the *light*
  changes. It is the one thing on this list another app could not have copied.
- **Vault folder browns/purples → tokens.** `--category-1..4` already exist and
  are already documented as identity-not-status. The Vault's hardcoded hex moves
  onto them, which is a token fix, not a palette change.
- **`--hydration-*` stays scoped** to water. Unchanged, and still the only
  exception.

## 4. Type — mono demoted, Inter given a hierarchy

**This is our own constitution, currently violated.** `ux-copy` says uppercase
mono is for *structural labels only, never sentences* — and page titles,
section headings and the reliability banner are all mono today.

**Mono keeps:** uppercase micro-labels, numbers, times, counts, the version line,
code-like values (connect codes). Everything mono is a *value*, never a sentence.

**Inter takes:** every title, heading, sentence, and button.

Scale at 1.25 from a 15px body (project-a11y's floor), rounded to the 8pt grid
where it lands near it:

| Role | Size / weight | Colour |
|---|---|---|
| Page title | 28 / 800 | foreground |
| Section heading | 20 / 700 | foreground |
| Card title | 17 / 700 | foreground |
| Body | 15 / 500 | foreground |
| Secondary | 15 / 500 | muted-foreground |
| Label (mono, caps) | 11 / 600, `.06em` | muted-foreground |
| Number | inherits, 700, `tabular-nums` | — |

Hierarchy comes from **weight + colour first, size second** — three tiers at one
size beats two sizes two points apart.

## 5. Spacing — strict 8pt

`4 · 8 · 16 · 24 · 32 · 48`. 12 survives only as an *inset* half-step inside
components (a chip's horizontal padding); it never spaces two blocks.

Card padding `16` compact / `24` roomy. Gap between cards `16`. Gap between
groups `32`. No more `space-y-5`, `p-3.5`, `mt-2.5`, `gap-2.5` — all present
today, all off-grid.

## 6. Motion — sub-400ms, nothing idle

| Move | Duration | Ease |
|---|---|---|
| Card press | 120ms | `cubic-bezier(.4,0,.2,1)` |
| Card lift (hover/focus) | 160ms | same |
| List stagger-in | 220ms, 40ms apart, max 6 items | `cubic-bezier(.22,1,.36,1)` |
| Page transition | 240ms fade + 8px rise | same |
| Sheet / dialog | 260ms | same |

- **Press = `--lift-0` + `scale(.985)`.** The card meets the board. Cheaper and
  more physical than a colour change, and it is one composited property.
- **Stagger caps at six.** A 20-item list that cascades for two seconds is an
  animation the user waits out. Items past six appear immediately.
- **Nothing idle-animates.** The calm rule stands: motion is feedback, never
  attention-seeking. `motion-design`'s "always include an ambient layer" is
  **refused** for the same reason as the water tumbler.
- **`prefers-reduced-motion`: transforms and stagger off, opacity kept.** A real
  branch, not a shorter duration.

## 7. The three proof screens

**Today** — the board is most visible here: dose cards genuinely float, the
focused dose takes `--lift-2`, the day rail loses its outline. Page title moves
to Inter 28/800.

**Medications** — the list becomes cards on the board with a 6-item stagger;
sticky search sits on the board, not in a bordered bar.

**Settings hub** — grouped rows become a single card per group with hairline
*internal* dividers only. The group titles are the one place mono earns its
keep, as micro-labels.

## 8. Flagged, NOT done here (needs logic, not presentation)

1. **Vault folder colours are hardcoded per folder in component state**, not
   read from a token map. Moving them to `--category-*` is a data-shape change to
   how a folder stores its colour — flagged, not smuggled in.
2. **The reliability banner's heading is mono** because it was styled as a
   structural label. Changing it to Inter is presentation; changing what it says
   is copy, and it was rewritten yesterday, so it is left alone.
3. **Dark mode is re-derived in stage 2**, from the same elevation system —
   shadows barely read on navy, so the dark board separates by *lightness step*
   instead. Doing it in stage 1 would double the review surface.

## 9. Skills — verdicts (per CLAUDE.md policy)

| Skill | Verdict |
|---|---|
| `interface-design` | **Applied, full flow including the direction phase.** Its domain exploration produced the tray/signature framing in §0 that the brief's "cards on a board" was already reaching for. |
| `motion-design` | **Applied for timing craft only.** Its ambient-layer rule refused again (§6) — third time, and it is now a standing refusal rather than a per-task one. |
| `ux-copy` | Floor. Drove §4 — the mono violation is its rule, not a taste call. |
| `project-a11y` | Floor. 44px targets, 4.5:1, 15px body minimum, `:focus-visible` kept on every surface touched. |
| `canvas-design` (registry) | **Rejected.** Static poster/PDF art. Not product UI. |
| `theme-factory` (registry) | **Rejected, and it would have been harmful.** It applies one of ten preset palettes; our tokens are locked and evolve rather than get replaced — the brief says so explicitly. |
| `frontend-design` (installed) | **Not invoked.** Overlaps `interface-design`, which CLAUDE.md already designates as primary for product UI. Running both invites two directions for one screen. |
