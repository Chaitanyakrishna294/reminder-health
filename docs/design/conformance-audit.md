# Design conformance audit — 2026-08-17

Every surface in the app, read against
[`visual-refresh-2026-08-14.md`](visual-refresh-2026-08-14.md) (§10 authoritative),
[`PR-looks-maxx.md`](PR-looks-maxx.md) and CLAUDE.md's design sections.

Branch `design/conformance`, 14 commits. **Presentation only** — no behaviour,
schema, RPC or bridge change anywhere in it.

## The honest headline

**This is not a clean sweep, and it should not be filed as one.** Every surface
has been audited, and the mechanical violation classes are closed. What remains
is **seven decisions that are yours**, not work I have left undone — each one
either needs an unfreeze, or would change elderly, or would redesign a surface
rather than conform it. They are listed at the bottom with the evidence.

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
| Today (dashboard-client-view) | FIXED — 6 idle animations, hardcoded stroke | `01ba12e` |
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
| Settings · help | **BLOCKED** — see D6 | — |
| Settings · display | **BLOCKED** — see D6 | — |
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
| Care+ (card, hub, voice) | **FLAGGED** — see D5 | — |
| Admin diagnostics | **FLAGGED** — see D5 | — |

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

## Decisions waiting on you

**D1 · `--primary-strong` does not meet 4.5:1 off white.** Measured:

| ground | ratio | |
|---|---|---|
| `--surface` (white card) | 4.75:1 | pass |
| `--surface-sunk` | 4.32:1 | fail |
| `--background` | 4.29:1 | fail |
| `--board` | 3.97:1 | fail |

§3 says "`--primary-strong` for anything load-bearing (4.75:1)" — true on cards,
false everywhere else. Every pink-text fix in this branch improved 2.68 → 4.29–4.39
and still sits under the floor. Options: darken the token, rule that pink text
only appears on white, or accept it. All three are token decisions.

**D2 · The `@layer` fix reaches elderly.** A stylesheet cannot be branch-guarded
by mode. I judged silently-discarded styles the worse outcome, since negative
tracking on caps hurts elderly readers most — but it is a change to elderly and
you should confirm it.

**D3 · The `dose-orbit` 40s infinite rotation** (dashboard-client-view ~L1425).
The largest idle motion left in the app. By §6 it should go; it is also
deliberately built (it pauses on the active event), and stripping it is closer to
deleting the concept than restyling it. **Left running.**

**D4 · Loading skeletons use `animate-pulse`** (vault ×3, medication list,
call-schedule, dashboard skeleton). Arguably feedback about pending state rather
than decoration. **Left as-is.** Note the same class *is* legitimate elsewhere and
was deliberately kept: `NavPending` pulses only while a navigation is in flight,
and `medication-card` only while `isBusy`.

**D5 · Care+ and admin-diagnostics run parallel visual languages, on purpose.**
`lib/billing/luxe.ts` documents Care+ as "intentionally always-dark (a
self-contained premium theme)"; admin-diagnostics is server-gated to
`ADMIN_EMAILS` with its own `--con-*` console palette. Conforming either is a
redesign, not conformance. Care+ does contain one clear §6 breach —
`sheenStyle`'s `luxeSheen 5s ease-in-out infinite`. **Untouched, both.**

**D6 · `/settings/help` and `/settings/display` are blocked.** They carry the
same bordered `rounded-3xl` card and 16px tile fixed everywhere else, but they
are **server** components that elderly can reach, so there is no branch to guard
and any fix changes elderly's rendering.

**D7 · `bg-white` on the vault's PDF/document viewer panes.** A white page behind
a scanned document is arguably the content, not a theme colour. **Left as-is.**

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
