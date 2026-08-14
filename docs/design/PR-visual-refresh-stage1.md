# design: visual refresh — "cards on a board" (stage 1)

> Paste this as the PR body. Open it at:
> https://github.com/Chaitanyakrishna294/reminder-health/compare/main...design/visual-refresh
> (`gh` is not installed on this machine, so the PR could not be opened from the CLI.)

**Draft — stage 1 only.** Design language + three proof screens. Stage 2 (rollout to
every remaining surface) waits on approval of this.

**Preview:** https://reminder-health-5720h56ia-chaitanya-krishnas-projects-397d3a53.vercel.app

**Spec:** [`docs/design/visual-refresh-2026-08-14.md`](visual-refresh-2026-08-14.md) —
read this first; the PR is that spec made true on three screens.

---

## ⚠️ No before/after screenshots, and I will not fake them

The Browser pane in my environment has been unable to composite frames for this
entire session — `screenshot` times out with "the pane is not displayed", and
clicks fail the same way. I also will not sign in to capture the authed screens,
because that would mean creating an account.

So **the preview URL is the artifact, not images**, and everything below is
visually unverified. `tsc` and `next build` are clean and every route renders,
but whether this *looks* right is exactly what you are being asked to judge — and
I have not seen it either.

Cheapest path to images in this description: screenshot the preview on your
phone and drop them in. That also captures them at the density that matters.

---

## What changed

**The signature (from interface-design's domain pass).** A dosette box is
compartments sitting *in* a tray. The board is the tray; the cards are the
compartments. That is why this reads as ours rather than as a generic Material
trend, and why cards lose their borders — a border was doing work that light
should do.

**Elevation.** `--board` (paper deepened ~4%), `--surface`, `--surface-sunk`, and
two-layer shadows. Two layers always: a contact shadow for the edge, a diffuse
one for the float. One alone reads as a 2009 drop shadow; two read as an object.

**Type — the constitution violation, fixed at its source.** One CSS rule put the
mono face on `h1`–`h6`, which is every page title and section heading in the app.
That is a direct breach of `ux-copy`, which reserves uppercase mono for
structural labels and **never** sentences. Headings now take Inter and build
hierarchy from weight and colour. Mono keeps badges, metrics, times and nav
labels — every one a **value**, never a sentence.

**Radius.** One three-step scale (20/14/10) with the concentric rule stated.
Fixes `rounded-3xl` currently sitting on both a card *and* a 40px chip.

**Motion.** Press = the card meets the board (shadow → none + `scale(.985)`), one
composited transform, 120ms. Stagger **capped at six** — a twenty-item list that
cascades for two seconds is an animation the user waits out. Nothing
idle-animates; `prefers-reduced-motion` is a real branch, not a shorter duration.

## Skill verdicts (per CLAUDE.md policy)

| Skill | Verdict |
|---|---|
| `interface-design` | Applied, full flow including the direction phase |
| `motion-design` | Timing craft only. Ambient-layer rule **refused** — third time, now standing rather than per-task |
| `ux-copy` / `project-a11y` | Floors. The mono fix is `ux-copy`'s rule, not a taste call |
| `canvas-design` (registry) | **Rejected** — static poster/PDF art, not product UI |
| `theme-factory` (registry) | **Rejected, and it would have been harmful** — it applies one of ten preset palettes, and the brief says tokens *evolve* rather than get replaced |
| `frontend-design` (installed) | **Not invoked** — overlaps `interface-design`, which CLAUDE.md designates primary for product UI. Two directions for one screen |

## Flagged, NOT done (needs logic, not presentation)

1. **Vault folder colours are hardcoded in component state**, not read from a
   token map. Moving them onto `--category-*` is a data-shape change to how a
   folder stores its colour.
2. **Dark mode is re-derived in stage 2.** Tokens are in place; shadows barely
   read on navy, so the dark board separates by lightness step instead. Doing it
   now would double the review surface.
3. **The reliability banner heading stays mono** — it was styled as a structural
   label, and its copy was rewritten yesterday, so it is left alone.

## Constraints held

Mind pink is still the only accent · slot tints are still surfaces ·
`--hydration-*` is still scoped to water · 44px targets · 4.5:1 floor · light
default · **the elderly branch is untouched**.
