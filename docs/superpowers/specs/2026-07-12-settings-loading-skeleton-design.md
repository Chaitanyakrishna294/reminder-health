# Settings Page Loading Indicator — Design Spec

**Date:** 2026-07-12
**Status:** Approved design, implementing directly (scope too small for a separate plan)
**Related:** `web/src/app/(dashboard)/settings/page.tsx`, `web/src/app/(dashboard)/care-circle/requests/page.tsx:236-239` (established loading-spinner pattern), `docs/superpowers/specs/2026-07-12-nav-loading-indicator-design.md` (the nav-icon spin this complements)

## Problem

The nav-icon spin (shipped in `db6759a`) gives feedback that a tap registered,
but once the transition starts, the main content area still shows nothing
until Settings' data finishes loading (~1s, even after parallelizing its
queries in `aa31b58`). The nav-icon design spec explicitly deferred this exact
gap as "a reasonable future addition."

## Goal / non-goals

**Goal:** Settings shows a centered loading spinner in the main content area
from the moment navigation starts until its data is ready.

**Non-goals:** Not applying this to the other four dashboard pages (user
chose Settings-only, unlike the nav-icon fix). Not building a skeleton that
mirrors the page's card layout (user chose a simple spinner over a skeleton).
Not touching `page.tsx` itself.

## Approach

**Chosen: Next.js `loading.tsx` route convention.** A `loading.tsx` placed
next to `page.tsx` in the same route segment is automatically wrapped by
Next.js in a Suspense boundary around that segment — shown the instant
navigation starts, swapped for the real content once the server component's
data resolves. No wiring, no new dependency.

**File:** `web/src/app/(dashboard)/settings/loading.tsx`, matching the
existing loading-spinner convention already used in this codebase
(`care-circle/requests/page.tsx:236-239` — same icon, same classes, same
layout), with copy specific to Settings:

```tsx
import { Loader2 } from 'lucide-react';

export default function SettingsLoading() {
  return (
    <div className="max-w-2xl mx-auto mt-16 flex flex-col items-center gap-4">
      <Loader2 className="w-8 h-8 text-primary animate-spin" />
      <p className="text-sm text-muted-foreground font-semibold">Loading settings...</p>
    </div>
  );
}
```

**Interaction with the nav-icon spin:** the two indicators hand off rather
than overlap for the full wait. The nav icon spins from tap until Next.js
begins rendering the new route segment — which, once this `loading.tsx`
exists, happens almost immediately (showing the fallback counts as the route
starting to render). This spinner then covers the remaining wait while
Settings' data streams in. This is the intended, correct behavior for two
independently-scoped indicators, not a regression of the nav-icon fix.

## Testing

Manual only (matches this app's established convention for UI changes):
navigate to Settings and confirm this spinner appears before the real content
does, and that nothing else on the page changes.
