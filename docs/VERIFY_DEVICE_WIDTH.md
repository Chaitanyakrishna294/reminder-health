# Device-width layout check

**The gap this closes.** The 2026-08-17 conformance audit verified computed styles
per element — radius, colour, shadow, contrast — on ~250 sites, and every one
passed. It verified nothing about whether the PAGE fits a phone. A screen can be
perfectly tokenised and still overflow its viewport, clip a nav icon, or push
content off the left edge, and none of the per-element checks will say a word.

So: **element checks and page checks are different checks.** Run both.

## The snippet

Paste into `javascript_tool` (or devtools) with the viewport at **375×812**, on the
screen under test. It reports every element wider than the viewport, anything
positioned off-screen, and whether the document scrolls horizontally at all.

```js
(() => {
  const W = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && cs.visibility === 'hidden') continue;
    // Off the left edge, off the right edge, or wider than the screen.
    if (r.left < -1 || r.right > W + 1 || r.width > W + 1) {
      bad.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 60),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
      });
    }
  }
  return JSON.stringify({
    viewportWidth: W,
    documentScrollsHorizontally: document.documentElement.scrollWidth > W + 1,
    scrollWidth: document.documentElement.scrollWidth,
    offendersOutermostFirst: bad.slice(0, 12),
    totalOffenders: bad.length,
  }, null, 2);
})()
```

**Reading it.** `documentScrollsHorizontally: true` is a fail on its own — a phone
screen must not pan sideways. `left < 0` is content cut off the LEFT edge, which
is the one users describe as "the header is chopped". Work outermost-first: the
first offender in the list is usually the cause and the rest are its children.

## Fit check for full-screen surfaces

For anything that must fit one screen without scrolling — the dose gate, the
refill gate, elderly Today:

```js
(() => {
  const g = document.querySelector('[data-med-gate]') || document.body.firstElementChild;
  const r = g.getBoundingClientRect();
  const inner = g.querySelector('.relative.flex-1') || g.firstElementChild;
  return JSON.stringify({
    viewport: { w: innerWidth, h: innerHeight },
    surface: { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width) },
    isViewportSized: Math.abs(r.height - innerHeight) < 2,
    contentHeight: inner ? inner.scrollHeight : null,
    overflows: g.scrollHeight > g.clientHeight + 2,
  }, null, 2);
})()
```

`isViewportSized: false` on a `fixed inset-0` element means an ancestor has a
transform and has become its containing block — see CLAUDE.md, "`position: fixed`
IS NOT VIEWPORT-RELATIVE". That is what made the dose gate measure 3000px tall on
a 764px viewport, and it presents as a spacing bug, not a positioning one.

## Where to run it

Public routes directly. Auth-gated screens need a temporary harness route
rendering the real component with fabricated props — see CLAUDE.md, "SEE THE
SCREEN BEFORE FIXING IT". **Delete the harness before deploying**; Vercel ships
the working tree.

Run at **375×812** as the floor. Also worth a pass at 320px wide (the smallest
Android still in use) for anything with five or more inline targets — the nav is
the obvious one.
