// Presentational helpers extracted verbatim from dashboard-client-view.tsx to keep
// that view focused on composition rather than low-level rendering details. Pure /
// stateless — no behavior change versus the prior inline definitions.

import React from 'react';

// Single source of truth for the unit-type icon map lives in custom-icons.tsx;
// re-exported here so existing '@/components/dashboard/dashboard-helpers' imports keep working.
export { getUnitIcon } from '@/components/ui/custom-icons';

/**
 * Human-readable countdown / overdue text for a scheduled dose time.
 */
export const getCountdownText = (scheduledForStr: string) => {
  const scheduledTime = new Date(scheduledForStr).getTime();
  const now = new Date().getTime();
  const diffMs = scheduledTime - now;
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 0) {
    const overdueMins = Math.abs(diffMins);
    if (overdueMins < 60) {
      return `Missed ${overdueMins} min ago`;
    } else {
      const overdueHours = Math.floor(overdueMins / 60);
      const remainingMins = overdueMins % 60;
      if (remainingMins === 0) {
        return `Missed ${overdueHours} hour${overdueHours > 1 ? 's' : ''} ago`;
      }
      return `Missed ${overdueHours}h ${remainingMins}m ago`;
    }
  } else {
    if (diffMins < 60) {
      return `Due in ${diffMins} min`;
    } else {
      const dueHours = Math.floor(diffMins / 60);
      const remainingMins = diffMins % 60;
      return `Due in ${dueHours}h ${remainingMins}m`;
    }
  }
};

/**
 * Subtle translucent bubbles for the pink cards — faint, mixed sizes, scattered.
 * Deterministic positions (no Math.random) to avoid hydration mismatches.
 */
export const PinkBubbles = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden !m-0">
    <span className="absolute rounded-full bg-white/10" style={{ width: 150, height: 150, top: -45, left: -35 }} />
    <span className="absolute rounded-full bg-white/[0.06]" style={{ width: 96, height: 96, bottom: -28, right: 28 }} />
    <span className="absolute rounded-full bg-white/[0.07]" style={{ width: 56, height: 56, top: 28, right: -16 }} />
    <span className="absolute rounded-full bg-white/[0.08]" style={{ width: 38, height: 38, bottom: 26, left: 40 }} />
    <span className="absolute rounded-full bg-white/[0.05]" style={{ width: 22, height: 22, top: 64, left: '44%' }} />
    <span className="absolute rounded-full bg-white/[0.09]" style={{ width: 30, height: 30, top: 14, right: '36%' }} />
  </div>
);
