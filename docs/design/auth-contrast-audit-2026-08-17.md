# Auth-world contrast audit — 2026-08-17

Prompted by an external audit (designmeter) of the public root, which flagged
"light-on-pink legibility". That flag is **correct, and worse than it looked** —
it is a dark-mode failure, not a light-mode one, and the light-mode screenshot the
tool would have graded is mostly fine.

**Nothing in this document has been applied to the auth palette.** The hardcoded
`/welcome` palette is a recorded exception under the design freeze
(`CLAUDE.md` → DESIGN DNA), so every contrast change below is a **proposal**
awaiting the maintainer's explicit unfreeze. Two things *were* fixed, and only
because they are not the auth palette — see [Applied](#applied) at the end.

## Method

Measured on the rendered pages, not derived from the source, because the source
does not say what the browser computes:

- Colours resolved by painting them onto a 1×1 canvas over a known base and
  reading the pixel back. **This matters:** Tailwind v4 emits alpha utilities as
  `color-mix(in oklab, … )`, which an `rgba?\(` regex silently drops. The first
  run of this sweep saw 3 of 13 elements and reported a false failure for that
  reason.
- Grounds composited up the ancestor chain from the deepest opaque layer, so
  translucent inks are measured against what is actually behind them.
- A gradient ancestor (`--auth-radial`) fans out into one candidate per colour
  stop and the **worst stop** is reported.
- The element's **own** background counts as its ground — a filled button's label
  sits on the button, not on the panel behind it.
- Thresholds: 4.5:1 normal text, 3:1 large (≥24px, or ≥18.66px at weight ≥700).
- Dark mode set the way the app sets it (`localStorage.theme = 'dark'` + reload).
  Toggling `.dark` at runtime does **not** reliably repaint — an earlier run
  produced dark numbers identical to light and was discarded.

Viewport 375×812 unless stated.

## `/welcome` — light

| Pairing | Ink on ground | Ratio | Verdict |
|---|---|---|---|
| Headline "Never miss a dose" (36px) | `#0F1C5A` on `#F59FB4` | **7.87:1** | pass |
| Subtitle (15px) | `#0F1C5A/80` → `#3D366C` | **5.41:1** | pass |
| Primary button label (18px bold) | `#FFFFFF` on `#CC3D64` | **4.75:1** | pass |
| Guest action (16px bold) | `#0F1C5A/85` → `#323068` | **5.97:1** | pass |
| Sign-in row (15px) | `#0F1C5A/85` → `#323068` | **5.97:1** | pass |
| Trust line (11px) | `#0F1C5A/80` → `#3D366C` | **5.41:1** | pass |
| Email placeholder (16px) | `#64748B` on `#FFFFFF` | **4.76:1** | pass |
| Guest error (12px) | `#7A1029` on `#F59FB4` | **5.43:1** | pass |
| Captcha hint (11px) | `#0F1C5A/75` → `#493D71` | **4.82:1** | pass |
| ~~Divider "or" (14px bold)~~ | `#0F1C5A/70` → `#544375` | ~~4.30:1~~ | **removed** — the divider is gone with the hierarchy rework |
| Captcha-state "Back" (13px) | `#0F1C5A/70` → `#544375` | **4.30:1** | **FAIL** (needs 4.5) |

The file's own comment claiming contrast is "fixed by construction" is **true in
light mode**. One failure survives, in the captcha state only.

## `/welcome` — dark: 6 failures, and this is the flagged one

The pink sheet is hardcoded `bg-[#F59FB4]` and is **not** in the dark override
list, but `globals.css` carries this compatibility shim:

```css
:root.dark [class*="text-[#0F1C5A]"],
:root.dark [class*="text-[#0F172A]"] { color: var(--foreground) !important; }
```

`[class*=…]` is a substring match, so it also matches `text-[#0F1C5A]/80` and the
`<section>` that sets the sheet's inherited ink. The result: **the ink inverts to
near-white while the hardcoded grounds stay put.**

| Pairing | Ink on ground | Ratio | Verdict |
|---|---|---|---|
| **Typed email in the white field** | `#EAF0FF` on `#FFFFFF` | **1.14:1** | **FAIL** — the address you just typed is essentially invisible |
| Headline (36px, needs 3.0) | `#EAF0FF` on `#F59FB4` | **1.75:1** | **FAIL** |
| Subtitle | `#EAF0FF` on `#F59FB4` | **1.75:1** | **FAIL** |
| Guest action | `#EAF0FF` on `#F59FB4` | **1.75:1** | **FAIL** |
| Sign-in row | `#EAF0FF` on `#F59FB4` | **1.75:1** | **FAIL** |
| Trust line | `#EAF0FF` on `#F59FB4` | **1.75:1** | **FAIL** |
| Primary button label | `#FFFFFF` on `#CC3D64` | **4.75:1** | pass — it sets `text-white` explicitly, so the shim never touches it |

The exception as recorded says the poster "must not re-skin in dark mode". **The
shim means it already does**, halfway: ink re-skins, grounds do not. So this is
not a request to change the exception — it is a request to make the exception
true.

## `/login` and `/register` — token-based, both themes

| Pairing | Light | Dark | Verdict |
|---|---|---|---|
| Input placeholders (`--muted-foreground/60` on `--surface-sunk`) | **2.51:1** | **4.01:1** | **FAIL** both |
| Footer legal links, 11px (`--muted-foreground/80` on `--card`) | **3.93:1** | 4.79:1 | **FAIL** light |
| Headline / labels (`--foreground`) | 14.01:1 | — | pass |
| Body + "Forgot password?" (`--muted-foreground`) | 5.52:1 | — | pass |
| Primary button (`--primary-strong-foreground` on `--primary-strong`) | 5.44:1 | — | pass |
| "Email me a sign-in code" / cross-links (`--primary-strong`) | 4.84:1 | — | pass |
| Register consent links (`--primary-strong`) | 4.84:1 | — | pass |

These are **not** the hardcoded exception — they are ordinary tokens, and the
placeholder failure reaches every form in the app that uses the shared
`inputClass`, not just auth.

## Proposals, with measured after-values

### A. Stop the dark ink shim reaching the poster — **recommended, fixes 6 of 8**

Scope the shim so it cannot rewrite a surface that owns its palette. Mark the
poster (`data-fixed-palette` on `/welcome`'s root) and exclude it:

```css
:root.dark [class*="text-[#0F1C5A]"]:not([data-fixed-palette] *),
:root.dark [class*="text-[#0F172A]"]:not([data-fixed-palette] *) { … }
```

| | before | after |
|---|---|---|
| Typed email on the white field | 1.14:1 | **15.74:1** |
| Headline (needs 3.0) | 1.75:1 | **7.87:1** |
| Subtitle / trust line | 1.75:1 | **5.40:1** |
| Guest / sign-in row | 1.75:1 | **6.01:1** |

This restores the stated intent rather than adding a second palette, and it costs
one attribute plus two `:not()`s. Worth checking what else the shim is currently
load-bearing for before it ships — it is a migration leftover, so the honest
follow-up is deleting it once nothing needs it.

### B. Input placeholders — needs a decision, not just a number

`placeholder:text-muted-foreground/60` → light needs **/90 (4.54:1)** to pass;
/70 is 3.02:1 and /80 is 3.68:1, so nothing gentle clears the bar. Dark passes
from /70 (5.02:1).

The trade-off is real: at /90 the placeholder is nearly as dark as a typed value,
which weakens the one cue distinguishing "hint" from "content". The better answer
is probably a dedicated `--placeholder` token tuned per theme rather than an
opacity on `--muted-foreground`. Flagging rather than picking, since this reaches
every form in the app.

### C. Footer legal links — drop the opacity

`text-muted-foreground/80` → `text-muted-foreground` at 11px: light **3.93:1 →
6.20:1**, dark 4.79 → 6.61:1. No visual cost worth defending; they are already
the quietest text on the screen.

### D. Captcha-state "Back" button — one character

`#0F1C5A/70` → `/75`: **4.30:1 → 4.82:1**.

## Applied

Two fixes landed in this pass because neither is the auth palette:

1. **Cookie notice pink text** was `text-primary` (`#F26B8A`), measuring
   **2.90:1** on the white card — the exact failure `project-a11y` names and the
   project's third occurrence. Now `text-primary-strong`: **5.44:1**. Its "Got it"
   button also went 36px → 44px, and 12px body → 13px.
2. **The `/welcome` "or" divider** (4.30:1) is gone, not recoloured — the
   hierarchy rework removed the divider it lived in, since it was separating two
   actions of equal weight and there is now one primary.

`/welcome` in **light** now measures **0 failures across 13 pairings**.

## Not a finding

The inline "Privacy Policy" / "Terms" links inside the cookie sentence measure
16px tall, under the 44px floor. Left as-is deliberately: WCAG 2.2 SC 2.5.8
exempts targets inline in a sentence, and padding them to 44px in wrapping body
copy makes adjacent lines' hit areas overlap. The sheet's actual control ("Got
it") is 44px.
