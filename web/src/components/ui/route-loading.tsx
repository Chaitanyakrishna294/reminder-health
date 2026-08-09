'use client';

import { useEffect, useState } from 'react';
import LoadingMark from './loading-mark';

/**
 * The loading state Next renders while a route's server component streams in.
 *
 * DELAYED on purpose. Rendering a spinner from the first frame meant every tap showed
 * a loading flash — including pages that arrive near-instantly from the router cache /
 * service worker — which makes fast pages FEEL slow ("flash of loading"). So this
 * renders nothing for the first 300ms: a page that arrives inside that window paints
 * as if it were instant, and the spinner only ever appears on a genuinely slow load,
 * where silence would read as a dead tap.
 *
 * 300ms is the conventional threshold: under it, people perceive a pause as
 * instantaneous continuation; over it, they start needing evidence something is
 * happening.
 *
 * One component rather than a spinner pasted into ten `loading.tsx` files, so the
 * loading behaviour cannot drift from route to route.
 */
export default function RouteLoading({
  label,
  delayMs = 300,
}: {
  label: string;
  delayMs?: number;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  if (!show) return null;

  return (
    <div
      className="w-full mt-16 flex flex-col items-center gap-4 animate-fade-in"
      role="status"
      aria-live="polite"
    >
      {/* The launch screen's clock→pill mark, looping — one loading idea app-wide
          instead of a stock spinner. text-primary measures 2.9:1 on our surfaces;
          -strong is the variant that carries. Reduced motion is handled inside the
          mark (it holds the resolved pill instead of moving). */}
      <LoadingMark size={48} className="text-primary-strong" />
      <p className="text-sm text-muted-foreground font-semibold">{label}</p>
    </div>
  );
}
