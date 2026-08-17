# Visual refresh — "cards on a board"

**This file lives at `docs/design/visual-refresh-2026-08-14.md`**, alongside
`docs/design/PR-looks-maxx.md`. They are cited elsewhere as `design/…`; there is no
top-level `design/` directory, and both paths mean these two files.

> **READ §10 FIRST.** §1–§9 are the round-one proposal, kept because they record
> *why* each decision was made. **Round two ("looks maxx") changed several of the
> values below, and §10 is what actually shipped.** Where the two disagree, §10
> wins — the stale numbers have been corrected in place and marked, so citing §1
> gives you the shipped value either way.

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
are the compartments you lift out.** The distinguishing move was going to be
§3's time-tinted shadow; that was CUT after the device review, so what carries
the identity now is the tray itself plus the restraint around it — which is the
more honest answer for a screen whose job is answering "did I take it?".

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
/* CORRECTED to the shipped values — round two deepened every step and added a
   fourth. Round one's numbers are in §10.1 with the reason they were replaced. */
--lift-1: 0 1px 2px rgba(15,28,90,.06), 0 4px 14px rgba(15,28,90,.07);   /* resting card */
--lift-2: 0 2px 6px rgba(15,28,90,.08), 0 14px 34px rgba(15,28,90,.12);  /* raised: focused dose, sheet */
--lift-3: 0 4px 10px rgba(15,28,90,.10), 0 24px 56px rgba(15,28,90,.18); /* overlay: dialog, gate, nav pill */
```

**Four steps, not three:** board → `card-lift` → `card-raised` → `card-overlay`.
The press state is `press-sink`, which drops to `--lift-1` rather than to `none`
— see §10.4 for why it may only go on something that rests at an elevation.

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
  load-bearing, `--primary` for tints, rings and the logo.
  - **Value corrected 2026-08-17: `#CC3D64` → `#BC385C`**, on an explicit unfreeze.
    The old figure quoted here — 4.75:1 — was true only against a WHITE CARD. On the
    system's other grounds it measured 4.32 (`--surface-sunk`), 4.29
    (`--background`) and 3.97 (`--board`), so pink text on the tray was below the
    floor by construction and the number in this spec was quietly misleading. The
    new value passes everywhere: **5.45 / 4.96 / 4.92 / 4.56**, with white on it at
    5.44:1 so buttons hold. Hover moved with it (`#BD2F58` → `#AE2B51`).
    Dark mode's `--primary-strong` is hand-tuned separately and unaffected.
- **Slot tints stay surfaces**, never interactive, never text without `-ink`.
- ~~**Slot-tinted shadows** — the board's shadow taking a slot hue by time of
  day.~~ **CUT after the device review.** It was the most distinctive idea here
  and it is parked, not deleted: the app already reads calm, and the honest
  reading is that tinted shadows would have added atmosphere to a screen whose
  job is answering "did I take it?". Worth revisiting in a polish pass with
  fresh eyes; it needs a reason beyond being interesting.
- **Vault folder covers were already on tokens.** `folder-carousel` derives every
  cover from `var(--category-N)` by index and holds no hex at all — see the §8.1
  correction. Nothing to do; the audit item was written from expectation rather
  than from the file.
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
| Page title (`.title-page`) | 30 / 800, 34 at ≥640px | foreground |
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

**Auth (stage 3)** — the sign-in screens keep their own `--auth-radial` ground
rather than the board: they are the one place in the app that is not a working
surface, and pulling them onto the tray would make signing in look like a task.
What they take from the system is the parts that were inconsistent — inputs
become WELLS (`surface-sunk`, receiving content rather than being another white
plane with a line round it), the logo plate drops `shadow-xl` for `--lift-2`, and
radii join the three-step scale.

## 8. Flagged, NOT done here (needs logic, not presentation)

1. ~~**Vault folder colours are hardcoded per folder in component state.**~~
   **WRONG — checked in stage 3 and there was nothing to fix.** `folder-carousel`
   already derives every cover from `var(--category-N)` by index, and the file
   contains no hex at all. The flag was written from the spec's expectation
   rather than from the code, which is exactly the mistake §8 exists to prevent.
2. **The reliability banner's heading is mono** because it was styled as a
   structural label. Changing it to Inter is presentation; changing what it says
   is copy, and it was rewritten yesterday, so it is left alone.
3. ~~**Dark mode is re-derived in stage 2**, from the same elevation system —
   shadows barely read on navy, so the dark board separates by *lightness step*
   instead.~~ **Superseded. Dark is HAND-TUNED, not derived** — see §10.2. A
   derivation was attempted and produced a navy that read as "light mode with the
   lights off"; the shipped answer is a near-black OLED ground where the cards are
   the light source. Leaving the old sentence here would tell a future session to
   re-derive it, which is precisely the revert §10 exists to prevent.

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

---

# 10. ROUND TWO — "looks maxx". What actually shipped.

Round one was correct and **invisible**: the user's verdict on the deployed
preview was that it read as barely different from the app it replaced. A system
nobody can see is not doing its job. Round two amplified it and, in doing so,
changed things §1–§9 had already written down — which is why this section
exists and why it outranks them.

**Everything here is FROZEN** (CLAUDE.md, "DESIGN DNA — FROZEN 2026-08-15").
Changing a token, a type size, an elevation step, a radius or a motion timing
needs an explicit unfreeze from the maintainer, stated as such. Recording what
shipped is not an unfreeze; this section changes no code.

## 10.1 Elevation — four steps, each one visible

Round one's `--lift-1: … 0 2px 8px …/.05` and `--lift-2: … 0 8px 24px …/.08`
were replaced because at arm's length they were indistinguishable from each
other and from a flat card. Shipped values are in §1, corrected. The ladder:

| Step | Class | Used by |
|---|---|---|
| ground | *(none — the board)* | the tray itself |
| card | `.card-lift` | resting cards |
| raised | `.card-raised` | focused dose, sheets |
| overlay | `.card-overlay` | dialogs, the dose gate, the nav pill |

Still two layers (contact + diffuse), still no borders on cards. A border
survives only where it is a **boundary**: input outlines, dividers, focus rings.

**Gradient grounds** were added for the two cards that carry the app —
`--ground-hero` (due-now dose) and `--ground-hydration` (the tumbler). Both are
derived from hues already in the palette: the hero is the *same pink* at two
opacities, so the one-accent rule holds rather than being bent.

## 10.2 Dark is HAND-TUNED, and near-black

Not a derivation, not a proportional dim. Near-black OLED ground; **the cards
are the light**, which is the same figure/ground relationship as day rather than
its inverse.

```
--board: #070B1E;  --surface: #131A3A;  --surface-sunk: #0C1229;
--lift-1: 0 0 0 1px rgba(255,255,255,.07);
--lift-2: 0 0 0 1px rgba(255,255,255,.11), 0 10px 30px rgba(0,0,0,.5);
--lift-3: 0 0 0 1px rgba(255,255,255,.14), 0 20px 52px rgba(0,0,0,.65);
```

Separation is a **lightness step plus a hairline ring**, because a shadow barely
reads on a near-black ground.

**Highlights are fractions of the room's light.** On dark they drop hard while
shades *deepen* — that is the rule, and it is not symmetric. It is why
`--glass-*` and `--pocket-*` are tokens rather than literals.

**Two lessons, both paid for:**

- **Anything hardcoded in a component slips straight through a token
  re-derivation.** The tumbler glass and the dose-strip pockets stayed lit for a
  white page after dark was otherwise correct, because their highlights were
  literals in JSX.
- **Contrast is COMPUTED, never eyeballed.** `--muted-foreground` was simply
  undefined in `.dark`, so it inherited the light value and every piece of
  secondary text in the app measured **2.74:1**. Nothing looked obviously wrong.
  Fixed to `#98A3C0` (6.74:1 on a card, 7.75:1 on the board, 6.91:1 on the hero
  gradient). Compute the ratio whenever a colour changes.

## 10.3 `@layer components` is load-bearing, not housekeeping

Everything this project writes in `globals.css` **outside** a layer is
UNLAYERED, and **unlayered CSS beats Tailwind utilities at equal specificity**.

This is the single most expensive finding of the whole redesign. An unlayered
`.card-lift { background: var(--surface) }` silently outranked every `bg-*`
utility on the same element. It rendered the nav pill **grey through two failed
fixes** — including an inline style, which is why the mechanism was wrongly
ruled out — and it also ate 37 `shadow-*`, 2 `rounded-*`, and would have left
the redesigned Vault folder with one square corner and a stray CSS tab.

**Any new component class goes inside `@layer components`.** No exceptions.

## 10.4 Motion — the full shipped set

Round one's table (§6) still holds for press, lift, stagger and page. Added:

| Move | Detail |
|---|---|
| `page-enter` | 250ms `--ease-out`, keyed on pathname so it re-runs per navigation |
| `numeral-tick` | 260ms, for a hero count changing after a dose is answered |
| `check-draw` | 340ms stroke-dashoffset on the SVG **path**, 60ms delay |
| nav pill | `translateX` only — the pill slides between tabs |
| `press-sink` | `--lift-1` + `scale(.982)`, 120ms `--ease-standard` |

`.stagger-in` caps at six: items 1–6 step 40ms apart, item 7 onward appears
immediately. Everything is ≤400ms and transform/opacity only.

**`press-sink` belongs ONLY to elements that rest at an elevation.** It resolves
*to* `--lift-1`, so on a tinted borderless row it makes the row **lift** under
the finger. And never on a non-interactive `<div>` — `:active` fires there too,
rendering a press on something that does not respond.

`prefers-reduced-motion` is a **real branch**: transforms and animations off,
opacity kept. Not a shortened duration.

## 10.5 Type

`.title-page` 30/800 (34 at ≥640px), `.title-section` 20/700, `.numeral-hero`
44/800 tabular, `.numeral-lg` 28/800 tabular. Tight tracking on the large sizes
is what separates *composed* from merely *enlarged*.

**Mono is for VALUES ONLY** — times, counts, codes, structural labels, the
wordmark. Never a sentence. Round one fixed this app-wide and **two violations
still survived**, both in places a tag selector could not reach: the auth
headline (outside the `(dashboard)` group, styled by class) and the wizard's
private `CARD_SHADOW` constant — a second elevation system, close enough to
`--lift-1` to look right and separate enough to drift. If a third turns up it
will be somewhere similar.

## 10.6 Deliberate exceptions and standing refusals

These are decisions, not oversights. **Do not "fix" them.**

- **Dose-strip pockets stay skeuomorphic.** The round-two brief asked for them
  to be flattened into "a cleaner progress language"; **refused after reading
  them.** The dome is a SECOND INFORMATION CHANNEL — domed means the pill is
  still in the pocket (upcoming, due now, missed), pressed-in means the pocket
  was emptied (taken, skipped). That is why "missed" keeps its dome rather than
  borrowing the emptied look. Flattening would leave colour and a glyph carrying
  state alone, and this app's audience includes people with age-related colour
  vision changes. "Skeuomorphic" is not the test; whether the shape is doing a
  job is. The Vault folders were rightly de-skeuomorphised (a drawn tab carried
  nothing) and these were rightly not. Any future replacement must carry state
  in form *before* the domes come out.
- **Auth keeps its own `--auth-radial` world.** It is the one place in the app
  that is not a working surface; pulling it onto the tray would make signing in
  look like a task.
- **`--hydration-*` is scoped to water** — the only exception to the one-accent
  rule, so a glass of water is never mistaken for a dose. Use `--hydration-ink`
  for any text; the raw hue is ~2.6:1 on paper.
- **The emergency card stays a solid danger fill.** A stranger reads it on a
  locked phone.
- **`motion-design`'s "always include an ambient layer" is a STANDING REFUSAL** —
  four times now. An ambient layer is a looping idle animation, and nothing in
  this app may move for attention. Remi's idle bob and the all-taken celebration
  are the two carve-outs, and the bob must keep its reduced-motion branch.

## 10.7 Elderly

Excluded from the entire redesign. Where it owns a file it was not touched by any
design commit; where markup is shared, every change sits inside an `!isElderly`
branch.

**The honest check is `git log <base>..HEAD -- <elderly file>`, not a diff** — the
i18n work legitimately edits those files, so a raw diff no longer proves anything.
