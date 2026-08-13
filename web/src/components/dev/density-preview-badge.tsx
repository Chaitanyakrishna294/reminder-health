'use client';

/**
 * Says out loud that `?preview=` is forcing a density, and offers the way out.
 *
 * The override is sticky for the session so you can actually WALK the app layout
 * rather than re-appending a query param to every URL. Sticky invisible state is
 * a trap, though — you would set it once, forget, and later conclude the browser
 * layout had lost its analytics column. So the stickiness and the badge ship
 * together; neither is correct without the other.
 *
 * Renders nothing when no override is set, which is every real user.
 */

import { useDensity } from '@/context/density-context';
import { Eye } from 'lucide-react';

export default function DensityPreviewBadge() {
  const { override, density, clearOverride } = useDensity();
  if (!override) return null;

  return (
    <div
      className="fixed left-3 z-[120] bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] lg:bottom-4"
      role="status"
    >
      <div className="flex items-center gap-2 rounded-full border border-border bg-card/95 backdrop-blur px-3 py-1.5 shadow-lg">
        <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-mono text-[11px] font-bold text-foreground">
          Previewing: {density}
        </span>
        <button
          type="button"
          onClick={clearOverride}
          className="min-h-11 -my-2.5 px-1 text-[11px] font-bold text-primary-strong underline underline-offset-2 hover:no-underline cursor-pointer"
        >
          Exit
        </button>
      </div>
    </div>
  );
}
