'use client';

import { useEffect, useState } from 'react';

/**
 * Skeleton shown while the dashboard's server component streams in.
 *
 * The dashboard is the ONLY route that gets one. A skeleton is a promise about the
 * shape of what is coming, so it is worth building where the layout is fixed and
 * information-dense enough that the promise is useful — and misleading everywhere the
 * shape depends on data (a medication list with three rows vs thirty). Every other
 * route keeps the looping brand mark in `route-loading.tsx`.
 *
 * DELAYED 300ms, exactly like RouteLoading, and for the same reason: rendering from
 * the first frame means every tap flashes a skeleton, including pages that arrive
 * instantly from the router cache, which makes fast navigation FEEL slower. Under
 * 300ms people read a pause as instantaneous continuation.
 *
 * The blocks mirror `dashboard-client-view`'s real mobile order — greeting, dose
 * strip, the day rail, then the compliance + care circle pair — so the swap to real
 * content lands things roughly where the eye already expects them instead of
 * reshuffling the page. Sizes are approximate on purpose; a skeleton that chases exact
 * heights breaks every time the layout is touched.
 *
 * Re-ordered when the hero card was retired and the pair moved below Today (redesign
 * §03). A skeleton that promises a card the page no longer has is worse than none: it
 * reshuffles at exactly the moment it exists to prevent reshuffling.
 */
export default function DashboardSkeleton({ delayMs = 300 }: { delayMs?: number }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  if (!show) return null;

  return (
    <div
      className="space-y-8 w-full animate-fade-in"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {/* One label for the whole thing. Without it a screen reader gets a page of
          decorative boxes and no indication that anything is loading. */}
      <span className="sr-only">Loading your dashboard…</span>

      {/* Greeting: avatar + two lines */}
      <div className="flex items-center gap-3" aria-hidden>
        <Block className="w-10 h-10 rounded-full" />
        <div className="space-y-2">
          <Block className="w-40 h-4" />
          <Block className="w-52 h-3" />
        </div>
      </div>

      {/* Dose strip: eyebrow + count, then the pockets. First real content on the
          page now that the hero card is gone. */}
      <div aria-hidden>
        <div className="flex items-baseline justify-between px-1">
          <Block className="w-28 h-3" />
          <Block className="w-24 h-3" />
        </div>
        <div className="mt-2 px-1 flex gap-2">
          {[0, 1, 2, 3].map(i => (
            <Block key={i} className="w-[68px] h-[78px] rounded-[18px] shrink-0" />
          ))}
        </div>
      </div>

      {/* Today's schedule heading, then the day rail: a slot header and its cards,
          twice. The narrow block is the slot eyebrow, indented past the spine. */}
      <div className="space-y-3" aria-hidden>
        <div className="px-1 space-y-2">
          <Block className="w-44 h-5" />
          <Block className="w-60 h-3" />
        </div>
        {[0, 1].map(g => (
          <div key={g} className="pl-9 space-y-2">
            <Block className="w-24 h-4" />
            <Block className="w-full h-[66px] rounded-2xl" />
            <Block className="w-full h-[66px] rounded-2xl" />
          </div>
        ))}
      </div>

      {/* Compliance ring + care circle, side by side at the same 1.1fr/1fr split.
          Below Today now, not above it. */}
      <div className="grid grid-cols-[1.1fr_1fr] gap-3 sm:gap-6" aria-hidden>
        <Block className="h-[210px] rounded-3xl" />
        <Block className="h-[210px] rounded-3xl" />
      </div>
    </div>
  );
}

/** One shimmering placeholder.
 *
 *  A tint of the INK, not `bg-muted`. `--muted` is #EEF4FB against a #F7F5FA page —
 *  a difference of about 20/255 per channel — and `animate-pulse` then dips it to 50%
 *  opacity, so the first version of this skeleton rendered a completely blank screen.
 *  Verified: 16 blocks in the DOM, nothing visible.
 *
 *  `foreground/12` is a wash of the theme's text colour, so it darkens the page in
 *  light mode and lightens it in dark, and it never collapses into the background in
 *  either. The global prefers-reduced-motion rule stills the pulse. */
function Block({ className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`bg-foreground/12 rounded-lg animate-pulse ${className}`} {...rest} />;
}
