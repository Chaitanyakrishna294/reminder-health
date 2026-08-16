# design: looks maxx — the language, applied to every surface

> Paste as the PR body. Open at:
> https://github.com/Chaitanyakrishna294/reminder-health/compare/main...design/looks-maxx
> (`gh` is not installed on this machine.)

**Preview:** https://reminder-health-refresh.vercel.app

Presentation only. No behaviour, schema, RPC or bridge changes.

---

## ⚠️ Unverified visually, and I will not pretend otherwise

The Browser pane in my environment cannot composite frames, and I will not sign
in to capture authed screens because that means creating an account. **Every
build is green and every route renders — but whether it LOOKS right is exactly
what this PR is asking, and I have not seen it.** Screenshots, if you want them
in here, are quickest taken on your phone from the preview.

## What this PR does

Takes the "cards on a board" language from round one — which read as barely
different — and makes it visible, then applies it everywhere.

**The system:** four visibly distinct elevation steps · near-black hand-tuned
dark · hero numerals · `title-page` scale · the motion set (stagger, press-sink,
page-enter, check-draw, numeral-tick, the sliding nav pill).

**The surfaces:** Today's due-now hero · the 56px header with a type wordmark ·
Vault folders · Care Circle · Notifications · wizard · water tumbler · auth ·
legal · emergency · the dose strip.

**The mascot:** the slot registry is finally used rather than bypassed, gains the
`welcome` and `celebration` moments the map always named, and Remi's idle bob
stops ignoring `prefers-reduced-motion`.

## The four findings worth reading

1. **Unlayered CSS beats Tailwind utilities.** `globals.css` declared no `@layer`
   of its own, so `.card-lift`'s background silently outranked every `bg-*` on the
   same element. This is what rendered the nav pill grey through **two** failed
   fixes — including an inline style, which is why I wrongly ruled it out. It also
   ate 37 `shadow-*` and 2 `rounded-*`, and would have left the redesigned Vault
   folder with one square corner and a stray CSS tab.

2. **Hardcoded colour slips straight through a dark-mode re-derivation.** Round
   one's dark mode re-derived itself correctly from tokens; the tumbler glass and
   the dose-strip pockets stayed lit for a white page because their highlights
   were literals. Dark is not a proportional dim — highlights drop hard while
   shades *deepen*.

3. **`press-sink` inverts on a surface with no resting elevation.** It resolves to
   `lift-1` on `:active`, so on the tinted notification rows it would make them
   *lift* under the finger. Withheld there and on non-interactive `<div>` panels,
   where `:active` fires anyway and would render a press on something that does
   not respond.

4. **Two mono violations survived the app-wide fix** — the auth headline (outside
   `(dashboard)`, styled by class not tag) and the wizard's private `CARD_SHADOW`
   constant, a second elevation system close enough to `--lift-1` to look right and
   separate enough to drift.

## Corrections I owe

- **Hero numerals were reported as shipped and were not.** A blind string replace
  matched nothing and I did not verify. Fixed, and it is why "never report a visual
  as shipped without it in the rendered build" is now process.
- **I claimed the layer bug could not explain the grey pill.** It did.
- **The Vault folder-colour flag was wrong** — covers were already token-derived.

## Elderly

Excluded throughout. Where it owns files it was not touched by any design commit;
where markup is shared every change sits inside an `!isElderly` branch. Verify
with `git log main..HEAD -- web/src/components/dashboard/elderly-today.tsx` — the
only commits are the i18n work, which legitimately edits it. A raw diff is no
longer the right check.

## Also in here

- Sentry gated to real production deploys (`VERCEL_ENV` before `NODE_ENV`, so
  previews stop reporting too).
- **The design DNA freeze** in CLAUDE.md: tokens, type, elevation and motion are
  frozen, and changing them needs an explicit unfreeze rather than a drive-by edit.
- Two i18n files swept into an early commit by `git add -A` — kept at your call,
  and now load-bearing anyway.

## Still open after merge

- Dose-strip pockets are tokenised for dark but **not redesigned** into the
  cleaner progress language the round-two brief sketched.
- Week-strip date pills untouched.
- Remi's final art: slots are correct, the PNGs are yours to generate.
