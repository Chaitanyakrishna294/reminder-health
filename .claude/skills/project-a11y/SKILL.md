---
name: project-a11y
description: Re-MIND-eЯ's accessibility floor, tuned for elderly users. Use on ANY UI change — new or edited components, styling, tokens, layouts, icons, the native alarm screen. Enforces 44px touch targets, 4.5:1 contrast (mind-ink not mind for pink text), 28px elderly icons, light mode always, arm's-length type sizes, and visible focus. For formal WCAG 2.2 conformance use the a11y-specialist-skills pack instead.
---

# Accessibility floor for Re-MIND-eЯ

Not generic WCAG advice — the specific failures this codebase has already had, and
the ones its audience will hit. The primary user may be 70, holding the phone at
arm's length, in a dim room, possibly anxious about a dose they just missed.

Apply to every UI change, web and native.

## 1. Touch targets: 44px minimum

- Every interactive element: **≥44px in both dimensions**, including icon-only
  buttons, "Change to Skipped" links, and dismissal affordances.
- A small icon inside a large target is fine — size the *target*, not the glyph
  (`min-h-11` with padding, not a 16px button).
- The alarm screen's actions are larger still (52px+): it is answered half asleep.

## 2. Contrast: 4.5:1 minimum for text

**This project has shipped contrast failures twice. Check, don't estimate.**

- **Pink text uses `--primary-strong` (`#CC3D64`), never `--primary` (`#F26B8A`).**
  White on `#F26B8A` is 2.9:1 — it failed on every primary CTA, and again on the
  alarm's Taken button.
- **Slot tints are SURFACE colours.** For slot-coloured text use the `-ink`
  variants (`--slot-morning-ink` etc.). `#E8A44E` on paper is ~1.9:1.
- Status tints follow the same split: `--success`/`--warning`/`--danger` are fills;
  `-strong` variants are the text-on-tint versions.
- White `-foreground` tokens are legible **only on a solid fill**. On a `/10`–`/15`
  tint they vanish.
- Never rely on colour alone: pair every status with an icon **and** a word. The
  rail's verdict chips do this deliberately.

## 3. Elderly mode

- **Icons 28px** (default 20px, 24px in dose cards) — with the 44px target intact.
- **Light mode always.** Elderly mode never renders dark, regardless of the
  Settings toggle. See CLAUDE.md's theme policy.
- Larger type scale as a **multiplier of the same scale**, not a second set of
  decisions.
- Stronger contrast, more spacing, fewer elements per screen.
- One question per screen where a flow allows it.

## 4. Type sizes: readable at arm's length

- Body text never below 15px in normal mode, 18px in elderly.
- Captions/metadata never below 12px normal, 14px elderly.
- `tabular-nums` on every number that changes — times, counts, streaks — so digits
  do not shift as they update.
- `text-wrap: balance` on headings; keep running text near 65 characters.

## 5. Focus and motion

- **Every interactive element has a visible `:focus-visible` state.** Outline with
  offset, never `outline: none` without a replacement.
- Respect `prefers-reduced-motion` — animation is decoration, never the only signal.
- Motion never adds wait time (launch rule).

## 6. Semantics

- Decorative elements get `aria-hidden` — the day rail's spine encodes time of day,
  which the slot label already states in words.
- Icon-only buttons need an accessible name.
- Status changes that matter (a dose recorded) should reach a screen reader.
- Real `<button>`/`<a>`, not clickable `<div>`s.

## Checklist before finishing any UI change

1. Every target ≥44px?
2. Every text/background pair ≥4.5:1 — **pink text using `-strong`, slot text using
   `-ink`**?
3. Status conveyed by icon + word, not colour alone?
4. Elderly: 28px icons, light mode, larger type?
5. `:focus-visible` on everything interactive?
6. Decorative things `aria-hidden`; icon-only buttons named?
