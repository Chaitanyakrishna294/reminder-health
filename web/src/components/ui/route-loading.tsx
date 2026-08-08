'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

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
      {/* text-primary measures 2.9:1 on our surfaces; -strong is the variant that
          carries. `motion-reduce:animate-none` leaves a static mark rather than
          spinning for anyone who has asked the OS for less motion. */}
      <Loader2 className="w-8 h-8 text-primary-strong animate-spin motion-reduce:animate-none" aria-hidden />
      <p className="text-sm text-muted-foreground font-semibold">{label}</p>
    </div>
  );
}
