# Design conformance audit — 2026-08-17

Every surface in the app, read against
[`visual-refresh-2026-08-14.md`](visual-refresh-2026-08-14.md) (§10 authoritative),
[`PR-looks-maxx.md`](PR-looks-maxx.md) and CLAUDE.md's design sections.

Branch `design/conformance`, 29 commits. **Presentation only** — no behaviour,
schema, RPC or bridge change anywhere in it.

## A correction to an earlier version of this file

An earlier draft of this document claimed the sweep was complete. **It was not,
and the way it was wrong is worth recording.** I had audited the PAGES on the
screen map and missed much of the COMPONENT LAYER they compose from — the exact
failure the brief warns about ("helper components hide violations"). A full-tree
scan afterwards found **~60 more off-scale radii** in files I had never opened:
the dose gate, the refill gate, the missed-dose strip, the nav rail, and six
pieces of shared chrome that appear on many surfaces at once.

The lesson is the brief's own: a per-file check of the files you thought of is
not a sweep. The closing check here is a **full-tree scan**, not a list of
surfaces I remembered to visit.

## Status: CLOSED — 2026-08-17

Every surface audited, every violation of a written rule resolved, and both
outstanding decisions returned by the maintainer.

- **D1 — APPLIED.** Unfreeze granted for one token. `--primary-strong`
  `#CC3D64` → `#BC385C`, hover `#BD2F58` → `#AE2B51`. Verified in the rendered
  build: pink text is now **5.03:1** where it was 2.68 before this branch and
  4.39 mid-way through it, and white-on-accent buttons are **5.44:1**.
- **D2 — closed as a disclosure.** Not a defect; the fix is in and it
  unavoidably reaches elderly because a stylesheet cannot be mode-guarded.
- **D6 — ACCEPTED DEVIATION.** `/settings/help` keeps its old card. See below.

The freeze worked exactly as designed here: a measured problem, a computed
answer, an explicit authorization, and the change recorded in the spec and here
in the same commit as the code.

Four items I had originally flagged (D3, D4, D5's animation, D7) turned out to be
over-caution on my part and are now resolved — two as fixes, two as PASSes with
the reasoning recorded. The detail is at the bottom.

## What was actually wrong

Three findings were worth more than the line count.

**1. Two unlayered CSS rules were silently discarding declared type, app-wide.**
`.font-mono` and `h1…h6` sat outside any `@layer`, so per §10.3 they beat every
Tailwind `tracking-*` utility. A label written `font-mono uppercase
tracking-[0.14em]` rendered at **−0.11px** instead of the declared **+1.54px** —
the wrong *sign*. Negative tracking on uppercase, in a product for ageing
eyesight, on every caps micro-label in the app. Layering `.font-mono` alone did
not fix it; the measurement moved to −0.198px because the `h1…h6` rule took over
as the winner. Found only by re-measuring after each change. → `6d85c48`

**2. Nine idle animations, six of them on Today** — the screen opened most
often. A greeting sun pulsing forever, a bouncing send icon, pulsing sparkles, a
throbbing escalation badge, a "scanner line" sweeping the QR tile on
/link-account, a pulsing success check. §6 is absolute: motion is feedback,
never attention. → `01ba12e`, `aac546a`, `b9ede19`

**3. Routes outside `(dashboard)` never inherited the board.** `/install` and
`/link-account` each painted their own `#f8fafc` ground and built their own
card — one of which had a border with a shadow that computed to fully
*transparent*, i.e. a bordered rectangle at zero elevation. → `fe77f27`,
`aac546a`

Then the long tail: **~150 off-scale radii** across 20 files, classified by what
each element *is* rather than by its class name — the same `rounded-2xl` was a
panel, an input and a button in one file. Plus pink `text-primary` on text where
CLAUDE.md names `--primary-strong`, and hardcoded colours that could not follow
the theme.

## Surfaces

| Surface | Status | Commit |
|---|---|---|
| Today (dashboard-client-view) | FIXED — 7 idle animations, hardcoded stroke | `01ba12e`, `bd1573a` |
| Day rail | FIXED — 4 radii, tiles branch-guarded | `2b06987` |
| Dose strip | **PASS** — domes are the recorded a11y channel, untouched | — |
| Week strip | PASS | — |
| Medications list | FIXED — 6 radii | `4c2faca` |
| Wizard (medications/new) | FIXED — 10 radii, mechanics untouched | `24b0621` |
| Edit form | FIXED — 13 radii, input branch-guarded | `24b0621` |
| Schedule planner | FIXED — 4 radii | `5966283` |
| Health vault | FIXED — 24 radii, 4 dialogs onto the overlay step | `cfc07a5` |
| Care circle (index) | **PASS** — already on `card-lift` from looks-maxx | — |
| Care circle · manage | FIXED — radii, pink text | `fa1efd8` |
| Care circle · requests | FIXED — radii | `fa1efd8` |
| Care circle · patient console | FIXED — radii, idle pulse | `fa1efd8`, `b9ede19` |
| Notifications | FIXED — 3 radii | `4c2faca` |
| Water settings | **PASS** | — |
| Water tumbler | **PASS** — touch-only motion, real reduced-motion branch | — |
| Settings hub + rows | FIXED — tile radius, branch-guarded | `6d85c48` |
| Settings · account | FIXED — 9 radii | `5966283` |
| Settings · connections | FIXED — 7 radii | `5966283` |
| Settings · notifications | **PASS** | — |
| Settings · language / legal / setup-guide | **PASS** | — |
| Settings · help | **ACCEPTED DEVIATION** — keeps its card, see D6 | — |
| Settings · display | FIXED — toggle branch-guarded (was never blocked) | `44a6c85` |
| Auth · login / register / forgot / update-password | FIXED — 11 radii | `3d2247a` |
| Welcome | FIXED earlier (mono) — palette is a recorded won't-fix | `f0ae9d1` |
| Legal (privacy / terms / disclaimer) | FIXED — pink text 2.68:1, radii | `5e4470c` |
| Install | FIXED — ground, card, mono labels | `fe77f27` |
| Link account | FIXED — 2 idle animations, ground, card | `aac546a` |
| Emergency | FIXED — radius only; solid danger fill is the recorded exception | `3d2247a` |
| Medical profile | FIXED — radii, pink text | `4c2faca` |
| Save account | FIXED — hardcoded input bg, title scale | `e407bd8` |
| Exit dialog | FIXED — radius, branch-guarded | `3d2247a` |
| Guide tour | FIXED — 3 radii | `3d2247a` |
| Button primitive (`ui/button.tsx`) | FIXED — all three sizes off-scale | `e407bd8` |
| Global CSS layering | FIXED — two unlayered rules | `6d85c48` |
| Care+ (card, hub, voice) | FIXED — infinite sheen removed; palette flagged (D5) | `bd1573a` |
| Admin diagnostics | **FLAGGED** — internal console, own palette (D5) | — |

## Elderly

Excluded throughout, and it took real work rather than avoidance. Where markup
is shared, the radius commonly sat *outside* the `isElderly` ternary while the
sizing sat inside — so a straight swap would have changed elderly silently.
Every such site is now fully branch-guarded, elderly arm first:
`SettingsRow`, the account and connections icon tiles, both day-rail slot tiles,
the exit dialog button, the edit-form input, and all four vault dialogs.

The vault dialogs were the sharpest case: their elderly arms added `border-2`
whose *colour* came from the base `border-border`, so deleting the base border
would have left elderly with a `currentColor` border. Each is now a complete
ternary.

**One known exception, and it is D2 below:** the `@layer` fix is global CSS and
therefore reaches elderly.

## The decisions, and how they closed

**D1 · APPLIED — `--primary-strong` did not meet 4.5:1 off white.** Measured before:

| ground | ratio | |
|---|---|---|
| `--surface` (white card) | 4.75:1 | pass |
| `--surface-sunk` | 4.32:1 | fail |
| `--background` | 4.29:1 | fail |
| `--board` | 3.97:1 | fail |

§3 says "`--primary-strong` for anything load-bearing (4.75:1)" — true on cards,
false everywhere else. Every pink-text fix in this branch improved 2.68 → 4.29–4.39
and still sits under the floor.

**The answer is computed, so this costs you a yes rather than an investigation.**
Holding the hue and scaling lightness only — so it is the same pink, not a new
one — the value that clears 4.5:1 on the WORST ground is **`#BC385C`**, about 8%
darker:

| ground | `#CC3D64` today | `#BC385C` |
|---|---|---|
| `--surface` (white card) | 4.75:1 pass | **5.45:1** pass |
| `--surface-sunk` | 4.32:1 fail | **4.96:1** pass |
| `--background` | 4.29:1 fail | **4.92:1** pass |
| `--board` | 3.97:1 fail | **4.56:1** pass |

White text on it measures 5.45:1, so `bg-primary-strong` buttons keep their
contrast too. One token, one line, and every pink-text site in this branch goes
from "improved" to "passing".

It is still a TOKEN CHANGE, so it needs your explicit unfreeze and I have not
applied it. The alternatives remain: rule that pink text only appears on white
cards, or accept the gap.

**D2 · NOT AN OPEN VIOLATION — a disclosure.** Listed here so it is not
discovered later, not because anything is outstanding. The unlayered-CSS defect
is FIXED; the fix is global CSS and therefore also reaches elderly, because a
stylesheet cannot be branch-guarded by mode. I judged silently-discarded styles
the worse outcome, since negative tracking on uppercase hurts elderly readers
most. Nothing to do unless you disagree.

**D3 · RESOLVED — the `dose-orbit` 40s rotation is gone.** Initially flagged as
too big to decide alone. On re-reading, that was over-caution: the recorded
exception list is CLOSED (auth's radial ground, the dose-strip domes, water's
blue, Remi's bob) and this was not on it, so §6 applies to it like anything else.
Only the rotation was removed — the circular arrangement, status colours, hover
inspection and pause-on-inspect intent all survive, because none of them needed
the spin. → `bd1573a`

**D4 · RESOLVED, and it is a PASS.** Loading skeletons and `loading-mark` are
feedback about pending state, which is exactly what §6 permits — the same reading
that kept `NavPending` (pulses only while a navigation is in flight) and
`medication-card` (only while `isBusy`). Verified rather than asserted: a global
`@media (prefers-reduced-motion: reduce) { * { animation-iteration-count: 1
!important; animation-duration: 0s !important } }` at `globals.css:758` stills
every animation in the app, and `loading-mark` carries its own branch as well.

**D5 · PARTLY RESOLVED.** The one unambiguous §6 breach is fixed: `sheenStyle`'s
`luxeSheen 5s ease-in-out infinite` is gone and the highlight is now static.
**Still yours:** the always-dark palette itself. `lib/billing/luxe.ts` documents
Care+ as "intentionally always-dark (a self-contained premium theme)" and
admin-diagnostics is server-gated to `ADMIN_EMAILS` with its own `--con-*`
console palette. Swapping either for system tokens is a redesign, not
conformance. → `bd1573a`

**D6 · `/settings/help` — one page, and there IS a mechanism.** (Display turned
out not to be blocked at all: it has a client view that already takes
`isElderly`, and it is fixed.) Help carries the same bordered `rounded-3xl` card
and 16px tile fixed everywhere else, but it is a **server** component, so
`useUiMode` is unavailable and there is no React branch to guard with.

**Correction to what I first wrote here:** I said no guard existed. One does.
`density-context` stamps `data-density` on `<html>` and elderly is one of its
values, so a CSS rule scoped to `[data-density="elderly"]` can restore elderly's
exact previous look without a hook — presentation only, no structural change.

I have NOT applied it, because of a caveat you should weigh rather than inherit:
that attribute is set in an effect, and the pre-paint script "cannot know about
elderly" (CLAUDE.md). So elderly would render the new card for one frame before
the stamp corrects it. On a help page that is minor; it is still a flash shown to
the audience least able to shrug it off, to fix a radius.

**DECIDED: leave it. This is an ACCEPTED DEVIATION, not an oversight — do not
"fix" it later.**

The maintainer's reasoning, recorded so it survives: changing elderly's rendering
violates the standing exclusion, and the CSS-guard route buys conformance at the
cost of a first-frame flash shown to the audience least able to shrug it off. For
a 24px radius on a help page, **the cure costs more than the disease.**

So `/settings/help` keeps its bordered `rounded-3xl` card and 16px tile. It is
the one surface in the app deliberately off the radius scale, and the reason is
that the only available fixes are each worse than the deviation.

**D7 · RESOLVED, and it is a PASS.** `bg-white` on the vault's PDF/document viewer
panes is the CONTENT, not chrome — a scanned page is white because paper is
white, and §10.2 is about colours that should follow the theme. Same reasoning as
the black-on-white QR mock on /link-account.

## Closing scan — 2026-08-17

A full-tree `grep` for `rounded-3xl | rounded-2xl | rounded-[28px]` across every
`.tsx` in `web/src` returns **zero** results that are not one of:

- an **elderly arm** of a branch-guarded ternary (vault dialogs ×3, `SettingsRow`,
  account and connections tiles, both day-rail tiles, exit dialog, edit-form
  input, save-account input, `empty-state`, `ELDERLY_SIZES` in `button.tsx`);
- a **loading skeleton** (D4 — feedback, not idle motion);
- **`/settings/help`** (D6 — blocked);
- a **recorded exception surface** (`/welcome`, Care+, admin-diagnostics,
  elderly-today);
- **the water tumbler's `rounded-[28px]`**, kept deliberately: that radius draws
  the GLASS, and the test CLAUDE.md applies to the dose-strip domes is whether
  the shape is doing a job, not whether it is on the scale;
- a **comment** in this branch's own code.

Same scan for idle motion (`animate-pulse|bounce|ping`, `infinite`) returns only
Remi's bob, the loading indicators, and comments.

Same scan for hardcoded colour (`bg-[#`, `text-[#`, raw Tailwind palette names)
returns only the auth radial world and `/welcome` — both recorded exceptions —
plus the document-viewer white (D7) and Care+'s luxe palette (D5).

## How this was verified

Rendered, not reasoned — the rule that the dose gate cost four rounds to learn.
Public routes were measured directly in the built output; auth-gated client
surfaces through a temporary harness route (untracked, never committed). Computed
`getComputedStyle` values before and after, and contrast computed rather than
eyeballed wherever a colour changed.

Two limits stated plainly: the vault's dialogs need component state to open, so
what was verified there is that the classes resolve to the intended values, not
that each dialog looks right; and `/install`'s install button only mounts when the
browser fires `beforeinstallprompt`, which this one does not.
