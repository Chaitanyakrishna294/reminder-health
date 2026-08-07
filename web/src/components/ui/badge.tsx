'use client';

// Status pills and count pills.
//
// Replaces the `getStatusBadge` closure that lived inside `todays-schedule.tsx` — which
// emitted `border-success/35` etc. WITHOUT a `border` width class in normal mode, so the
// border color was inert and the pill lost its edge everywhere except elderly mode.
//
// A badge always carries text. Color is a second signal, never the only one: colour-blind
// users and age-related blue/green desaturation are both squarely in this app's audience.

import React from 'react';
import { useUiMode } from '@/context/ui-mode-context';
import { getToneTheme } from '@/lib/severity-theme';
import type { Tone } from '@/lib/design/semantics';

export interface BadgeProps {
  tone?: Tone;
  /** Solid fill instead of a tint — for a count that must be seen at a glance
   *  (a pending-requests counter), not for status. */
  solid?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Badge({
  tone = 'neutral',
  solid = false,
  className = '',
  children,
}: BadgeProps) {
  const { isElderly } = useUiMode();
  const theme = getToneTheme(tone);
  const sizing = isElderly
    ? 'px-4 py-1.5 text-base rounded-xl'
    : 'px-2.5 py-0.5 text-[11px] rounded-full';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-bold whitespace-nowrap ${sizing} ${
        solid ? theme.solid : theme.badge
      } ${className}`}
    >
      {children}
    </span>
  );
}

/** A small numeric counter for a button or nav item. Renders nothing at 0, so call
 *  sites don't need their own `count > 0 &&` guard. */
export function CountBadge({
  count,
  tone = 'danger',
  label,
  className = '',
}: {
  count: number;
  tone?: Tone;
  /** Screen-reader context, e.g. "pending requests". */
  label: string;
  className?: string;
}) {
  const { isElderly } = useUiMode();
  if (!count || count < 1) return null;
  const theme = getToneTheme(tone);
  return (
    <span
      className={`inline-flex items-center justify-center font-black tabular-nums ${
        isElderly
          ? 'min-w-7 h-7 px-2 text-base rounded-full'
          : 'min-w-5 h-5 px-1.5 text-[11px] rounded-full'
      } ${theme.solid} ${className}`}
    >
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">
        {count} {label}
      </span>
    </span>
  );
}
