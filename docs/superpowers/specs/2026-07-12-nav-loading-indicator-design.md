# Nav Icon Loading Indicator — Design Spec

**Date:** 2026-07-12
**Status:** Approved design, pending implementation plan
**Related:** `web/src/components/layout/dashboard-main-layout.tsx`, `perf(web): parallelize settings page's independent Supabase queries` (commit `aa31b58`)

## Problem

Tapping a bottom-nav icon (desktop left rail or mobile floating dock) gives no
feedback that anything happened until the new page finishes rendering. This is
most noticeable on `/settings`, which is deliberately excluded from
`shouldPrefetch` (`dashboard-main-layout.tsx:148-151`) and — even after
parallelizing its Supabase queries in `aa31b58` — still takes roughly a second
to load. During that second the old page just sits there, unchanged, and a
user has no way to tell whether their tap registered.

The same gap applies to any other nav destination on a slow connection:
prefetching hides most of the latency in normal conditions, but a bad network
can make any of the five destinations feel unresponsive, not just Settings.

## Goal / non-goals

**Goal:** The instant a nav icon is tapped, it visibly spins until the
destination page is ready to display, then stops. This applies uniformly to
all five bottom-nav items (Dashboard, Medications, Scheduler, Health Vault,
Settings) in both the desktop rail and the mobile floating dock, so whichever
one happens to be slow — for any reason, not just Settings' known cold-fetch
cost — gives feedback.

**Non-goals (explicitly deferred, not rejected):**
- No global top-of-page progress bar. The spin lives on the tapped icon
  itself, where the user's attention already is.
- No `loading.tsx` route-level skeleton screens. A reasonable future addition
  (it would let the new page render a skeleton the instant navigation starts,
  rather than staying on the old page until data is ready), but out of scope
  for this fix.
- No change to `shouldPrefetch`'s allowlist or to any data-fetching code. This
  is a pure feedback layer on top of existing navigation.

## Approach

**Chosen: a small reusable `NavIcon` component using Next.js's `useLinkStatus()`,
applied to all five nav items.**

`useLinkStatus()` is a Next.js hook that reports `{ pending: boolean }` for the
nearest ancestor `<Link>`, true from the moment that link is clicked until the
navigated-to page is ready to swap in. It must be called from a component that
renders as a descendant of `<Link>` — which every nav icon already does, since
each item's icon renders inside its own `<Link>` in both the desktop rail
(`dashboard-main-layout.tsx` around line 210) and the mobile dock (around line
248).

**Component** (defined locally in `dashboard-main-layout.tsx` — this app has no
shared icon-wrapper file this belongs in, and a five-line component used in
one file doesn't warrant a new one):

```tsx
function NavIcon({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  const { pending } = useLinkStatus();
  return <Icon className={`w-5 h-5 ${pending ? 'animate-spin' : ''}`} />;
}
```

**Three edits, all in the same file:**
1. `getNavItems()` currently builds each item's `icon` as a pre-rendered
   element (e.g. `<LayoutDashboard className="w-5 h-5" />`). Change all five
   to bare component references (e.g. `icon: LayoutDashboard`) so `NavIcon`
   controls the className itself.
2. Desktop rail: `<span>{item.icon}</span>` → `<span><NavIcon icon={item.icon} /></span>`.
3. Mobile dock: `<span className={...}>{item.icon}</span>` →
   `<span className={...}><NavIcon icon={item.icon} /></span>` — the outer
   span and its elderly-mode text-size classes are unchanged; they don't
   affect the SVG icon's own explicit `w-5 h-5` sizing.

**Behavior:** prefetched destinations (Dashboard, Medications, Scheduler,
Health Vault) will typically resolve fast enough that the spin is barely
visible — Next.js swaps the page before a human would register the animation.
Settings (not prefetched, ~1s load) will visibly spin every time. Any
destination slowed by network conditions will spin for as long as it takes,
automatically, with no per-page logic required.

**Error handling:** none needed. `useLinkStatus` has no failure mode of its
own; if a navigation ever errors, Next.js's existing error handling takes
over and `pending` resolves to `false` once the transition settles.

## Testing

No component-test framework exists in this app for React UI (established
precedent). Verification is manual, via the browser preview: tap each of the
five nav icons and confirm it spins from tap until the destination renders,
confirm Settings visibly spins for its ~1s load, and confirm no other visual
or functional change to the nav (active-state highlighting, tooltips, elderly
mode sizing all unchanged).
