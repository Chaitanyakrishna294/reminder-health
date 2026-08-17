# design: full-app conformance against the frozen language

> Paste as the PR body. Open at:
> https://github.com/Chaitanyakrishna294/reminder-health/compare/main...design/conformance

Presentation only. No behaviour, schema, RPC or bridge change anywhere in it.

Full findings: [`docs/design/conformance-audit.md`](docs/design/conformance-audit.md)

---

## Where it landed

Every surface read; every violation of a written rule fixed. **Three items remain
open and none of them is a defect left standing:** a token change the freeze
reserves to you (D1), a disclosure about a fix that unavoidably reaches elderly
(D2), and two server components elderly can reach where no branch exists to guard
(D6).

Four things I first flagged as "too big to decide alone" were over-caution on my
part and are now closed — two fixed, two PASSed with the reasoning recorded. The
clearest was the `dose-orbit` 40s rotation: the recorded exception list is CLOSED,
that animation was not on it, so §6 applied to it like anything else.

## The three findings worth reading

**1. Two unlayered CSS rules were silently discarding declared type, app-wide.**
`.font-mono` and `h1…h6` sat outside any `@layer`, so per §10.3 they beat every
`tracking-*` utility. A label written `tracking-[0.14em]` rendered at
**−0.11px** instead of **+1.54px** — the wrong *sign*. Negative tracking on
uppercase, on every caps micro-label in the app, in a product for ageing
eyesight.

Layering `.font-mono` alone did **not** fix it: the measurement moved to
−0.198px because the `h1…h6` rule took over as the winner. Two rules, found one
at a time, only because I re-measured after each change instead of assuming the
first worked.

**2. Nine idle animations, six on Today** — the screen opened most often. A
greeting sun pulsing forever, a bouncing send icon, pulsing sparkles, a throbbing
escalation badge, a "scanner line" sweeping the QR tile, a pulsing success check.

Reading each one changed the answer three times: `NavPending`, `medication-card`'s
busy state and the loading skeletons use the *same class* and were **kept**,
because they respond to the user. A blanket strip would have deleted three
legitimate loading indicators.

**3. Routes outside `(dashboard)` never inherited the board.** `/install` and
`/link-account` each invented a `#f8fafc` ground and their own card — one with a
border and a shadow that computed to fully *transparent*, i.e. a bordered
rectangle at zero elevation.

Then the tail: **~150 off-scale radii** across 20 files, classified by what each
element *is* rather than by its class name (the same `rounded-2xl` was a panel,
an input and a button inside one file), plus pink `text-primary` where CLAUDE.md
names `--primary-strong`, and hardcoded colours that could not follow the theme.

## Elderly

Excluded throughout, and it needed work rather than avoidance. The radius
commonly sat *outside* the `isElderly` ternary while the sizing sat inside, so a
straight swap would have changed elderly silently. Every such site is now fully
branch-guarded: `SettingsRow`, the account and connections tiles, both day-rail
tiles, the exit dialog, the edit-form input, all four vault dialogs.

The vault dialogs were sharpest — their elderly arms added `border-2` whose
colour came from the base `border-border`, so deleting the base would have left
elderly with a `currentColor` border.

**One exception: the `@layer` fix is global CSS and reaches elderly.** Flagged
below rather than buried.

## Recorded exceptions — kept, on purpose

Auth's radial ground and blob colours · the dose-strip domes as an a11y state
channel · the emergency card's solid danger fill · `/welcome`'s palette · Remi's
idle bob. The auth case is worth noting: the exception covers the *ground*, while
§7 says the opposite about their radii ("join the three-step scale") — so
skipping those screens wholesale would also have been wrong.

## Waiting on you

1. **`--primary-strong` fails 4.5:1 off white** — 4.75 on a card, 4.32 on a well,
   4.29 on the background, 3.97 on the board. Every pink-text fix here improved
   2.68 → 4.29–4.39 and still sits under the floor.
2. **The `@layer` fix reaches elderly** — a stylesheet cannot be mode-guarded.
3. **Care+ and admin-diagnostics run deliberate parallel visual languages** —
   `luxe.ts` documents Care+ as "intentionally always-dark". Its one clear §6
   breach (`luxeSheen … infinite`) is fixed; swapping the *palette* for system
   tokens would be a redesign, and that half stays yours.
4. **`/settings/help` and `/settings/display` are blocked** — server components
   elderly can reach, so `useUiMode` is unavailable and there is no branch to
   guard. Either accept the change (neither page has ever had elderly-specific
   styling) or extract the card into a client component, which is structural
   rather than presentational and so out of scope here.

**Closed since the first draft:** the `dose-orbit` rotation and `luxeSheen` are
removed (§6, and neither was on the closed exception list); loading indicators
PASS as feedback — verified against the global
`prefers-reduced-motion` rule at `globals.css:758` that stills every animation in
the app; and the document viewer's `bg-white` PASSES as content rather than
chrome.

## Verification

Rendered, not reasoned. Public routes measured directly in the built output;
auth-gated surfaces through a temporary harness route (untracked, removed before
push). Computed values before and after; contrast computed, never eyeballed.

Two limits stated plainly: the vault dialogs need component state to open, so what
was verified is that the classes resolve to the intended values — not that each
dialog looks right; and `/install`'s install button only mounts when the browser
fires `beforeinstallprompt`.
