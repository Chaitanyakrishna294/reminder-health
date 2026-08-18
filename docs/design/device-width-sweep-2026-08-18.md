# Device-width sweep — 2026-08-18

The testing-phase pass described in
[VERIFY_DEVICE_WIDTH.md](../VERIFY_DEVICE_WIDTH.md): page-level fit at
**375×812** (the floor) and **320px** (the smallest Android still in use), across
every route. Element-level conformance was already checked in the 2026-08-17
audit — this is the other half, and the two find different things.

**Status: public routes DONE (9) and FIXED. Dose gate DONE via harness.
Authed routes PENDING (25)** — see [What is not covered yet](#what-is-not-covered-yet).

## How it was run

Driven through Chrome's DevTools Protocol from a Node script with no
dependencies (Node 22 ships `fetch` and `WebSocket`). Worth knowing for the next
sweep, because two obvious approaches do not work here:

- **An iframe harness cannot work.** The app sends `X-Frame-Options: DENY` and
  `frame-ancestors 'none'`, so no page can host another route in a frame.
- **The in-app browser pane hung repeatedly** on this many navigations. CDP was
  the reliable path.
- Each route is navigated, given ~2.2s for hydration and the density script, then
  measured. The cookie notice is pre-acknowledged via
  `Page.addScriptToEvaluateOnNewDocument`, so pages are measured in their
  **steady state** rather than on a first visit.

## Read this before trusting the offender list

**The snippet's "wider than viewport" list is full of false positives here, and
they are by design.** Every auth-world screen hangs `aria-hidden` blurred blobs
off the edges (`-left-12`, `-right-16`) inside an `overflow-hidden` parent. They
report as `left: -56` / `right: 439` and they are *clipped*, not visible.

The reliable signal is **`documentScrollsHorizontally`**. If that is false, an
off-edge element is decorative and contained. Check it first, then read the
offender list.

## Results — 375×812 and 320px

| route | h-scroll 375 | h-scroll 320 | vertical overflow (375) | verdict |
|---|---|---|---|---|
| `/welcome` | no | no | 0px | fits |
| `/login` | no | no | **61px** | **overflows** |
| `/register` | no | no | **103px** | **overflows** |
| `/forgot-password` | no | no | 0px | fits |
| `/install` | no | no | 0px | fits |
| `/privacy` | no | no | 4347px | long document — scrolling is correct |
| `/terms` | no | no | 3017px | long document — scrolling is correct |
| `/disclaimer` | no | no | 787px | long document — scrolling is correct |
| `/update-password` | no | — | (redirects to `/login`) | — |

**No route pans sideways at either width.** That is the headline pass.

## Findings

### 1. `/login` and `/register` break the layout's own fit rule

`(auth)/layout.tsx` states: *"at 375x812 the whole login screen — through the
trust strip's Terms links — must fit WITHOUT scrolling (mockup parity)."* It does
not. Measured with the cookie notice dismissed:

| | 375×812 | 320×812 |
|---|---|---|
| `/login` | **+61px** | +75px |
| `/register` | **+103px** | +117px |

Height budget at 375 (`/login`): header 64 · main 616 · footer 194 = 874 vs 812.

**These are floors, not the real numbers.** Turnstile did not render under
headless, so a real device adds the widget (~65–72px) on top — call it ~126px
over on `/login`.

**Not caused by the auth pass.** Those changes altered no heights: the cookie
inset resolves to 0px once dismissed, and the rest was colour, copy and
hand-off wiring.

### 2. The 11px captions — deferred here from the contrast audit, and they do not stand alone

Six elements per auth screen sit at **11px** against `project-a11y`'s 12px
caption floor — wider than the audit recorded, which named only the legal links:

- `Your health, our care` (header tagline)
- `Privacy Policy` · `Terms of Service` · `Medical Disclaimer` and their two `·`
  separators (trust strip)

`/welcome` has one, its own trust line.

**This is why it was right to defer.** Raising 11 → 12px adds height to a screen
that is already 61px over its stated budget. The type size and the height budget
are ONE problem; fixing the font alone makes finding 1 worse.

### 3. The install prompt's minimise button is 24×24

`Minimize install suggestion` measures 24×24 on **every** page, against the 44px
floor. The `Install` button beside it is 36px tall. Both are app-wide.

### 4. The register consent checkbox is 16×16

The age + terms checkbox — the one a new user must tick to create an account —
is a 16×16 target.

### 5. `Back to Sign In` on `/forgot-password` is Title Case

A `ux-copy` sentence-case violation. The same string was fixed in `register`
during the auth pass; this instance was missed.

## The dose gate — measured via harness, and the regression it guards is holding

The gate only renders behind auth with a dose outstanding, which is why three
fixes once shipped to it without the screen being looked at. Measured by mounting
the real component with fabricated props (four medications at one instant) inside
a wrapper that deliberately reproduces the dashboard's `page-enter` **transform**
and a 2472px-tall document — the exact conditions that once made `fixed inset-0`
measure 3000px on a 764px viewport.

| | 375×812 | 320×812 |
|---|---|---|
| `parentIsBody` (portalled) | yes | yes |
| gate rect | 375×812 at (0,0) | 320×812 at (0,0) |
| `isViewportSized` | **true** | **true** |
| transformed ancestors | none | none |
| internal overflow | **0px** | **33px** |
| primary "Taken" button | 44px, on screen | 44px, on screen |

**The containing-block regression is closed and stays closed**: the document was
2472px tall and the gate still measured exactly 812. That is the check worth
re-running after any change to the gate or to `page-enter`.

**Finding — at 320px a four-dose gate overflows its own box by 33px** and scrolls
internally. It degrades gracefully (the primary action stays on screen at
`bottom: 333`), but the last row of a four-medication handful sits below the fold
on the narrowest Android.

**False positive to expect:** the detector reports a 96px "inner scroller" on both
widths. That is the decorative `pointer-events-none absolute inset-0
overflow-hidden` backdrop layer, not content.

### Harness hygiene

Two things cost a wrong turn:

- **A folder starting with `_` is a PRIVATE folder in the App Router and is not
  routed at all.** `app/__gate-harness/` built without complaint and served the
  previous page; the measurement looked plausible and was of the wrong screen
  (the giveaway was `docScrollHeight: 812` against a 2400px spacer). Name a
  harness `zz-gate-harness`, not `__gate-harness`.
- **The cookie notice is also `position: fixed` at `z-[100]` and full width**, so
  a "find the full-width fixed overlay" selector finds it first. Exclude
  `[aria-label="Cookie notice"]` explicitly.

The harness was deleted immediately after measuring. It must never be committed:
a merge to `main` auto-deploys, so a diagnostic route left in the tree ships.

## What is not covered yet

The 25 authed routes — dashboard, medications, health vault, care circle, and the
eleven settings pages. **That is where the earlier regressions actually lived**
(dashboard cut off at the left edge, nav showing 4 of 5 icons), and the 320px
nav check needs them specifically.

Three automated ways in were tried and all are closed:

- **Guest sign-in headlessly** — the Supabase project enforces CAPTCHA
  server-side, so `signInAnonymously` is rejected without a real Turnstile token,
  and headless Chrome does not render the widget. Building without the site key
  does not help; the rejection is server-side.
- **Driving the maintainer's real Chrome** — no browser extension connected.
- **Reusing an existing in-app session** — expired.

So the authed half needs a human sign-in **in the Claude Browser pane
specifically** — the surface these tools drive. A sign-in in the maintainer's own
Chrome or on the phone does not help: each is a separate cookie jar, and the
Chrome extension is not connected. Checked and still signed out at the time of
writing: `reminder-health.vercel.app`, `reminder-health-refresh.vercel.app`.

## Fixed in this phase

All five findings above are resolved, in two commits:

- Install banner's dismiss 24×24 → **44×44**; its Install button 36 → 44px.
- Register's consent checkbox given its own **44×44** hit area around a 22px box
  (the wrapping label always made the sentence tappable, so the effective target
  was never 16px — but the visible box was, and that is what a thumb aims at).
  Negative margins keep the row at 68px, so it costs nothing in the height budget.
- `Back to Sign In` → `Back to sign in` in `forgot-password` **and**
  `update-password` — grepping the pattern found a second instance the sweep had
  not reached.
- **The auth screens now obey their own 375×812 rule**, and the captions sit at
  the 12px floor. Correction to the original plan worth recording: the brief was
  to budget ~70px for Turnstile *on top of* the measured overflow, but the
  widget's 72px slot was **already inside** those numbers — so the gap was ~65px
  on `/login`, not ~135px, and designing for the larger figure would have cut far
  more than the screen needed.

Measured after, steady state (notice dismissed):

| route | 375×812 | 320px |
|---|---|---|
| `/login` | **fits** (was +61) | **fits** (was +75) |
| `/register` | **fits** (was +103) | +19px — accepted, see below |
| `/welcome` | **fits** | **fits** |
| `/forgot-password` | **fits** | **fits** |
| `/update-password` | **fits** | **fits** |

Most of the height came from the footer mascot yielding rather than holding —
`max-h-[9vh]` + `object-contain`, the same treatment `/welcome`'s art received.
130px → 73px, scaling further on shorter screens. It is decorative and
`aria-hidden`, so it is the right thing to spend before touching spacing.

### Known states, not defects

- **`/register` scrolls 19px at 320px.** Accepted 2026-08-18: a six-field form on
  the narrowest width may scroll. 375×812 is the rule; 320 is the courtesy pass.
- **Every auth screen scrolls on a FIRST visit** (~88–120px) while the cookie
  notice is up. That is the notice reserving its own height so it covers nothing;
  it self-resolves on dismiss and never hides an action.

### Still open

- **`Forgot password?` is a 16px-tall target** on `/login` and `/update-password`
  — a standalone link, so the inline-sentence exemption does not apply. Approved
  for the next batch; re-verify the height budget afterwards, since giving it a
  44px hit area may add a few pixels.
