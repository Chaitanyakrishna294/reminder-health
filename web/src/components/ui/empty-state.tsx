'use client';

// "There's nothing here yet" — one component, four screens.
//
// The app had four divergent versions: a bare sentence on the medications list, a rich
// icon+heading+CTA block in the vault, an elderly-only variant in Today's Schedule, and
// a one-line `<p>` in the planner. The bare ones left users with no idea what to do next,
// which is the whole job of an empty state.
//
// The icon tone defaults to NEUTRAL on purpose. Care Circle used to show a
// shield-with-exclamation for "no one linked yet" — a warning shape for a state that is
// not a problem. Nothing here is wrong; it just hasn't happened yet.

import React from 'react';
import Link from 'next/link';
import { useUiMode } from '@/context/ui-mode-context';
import { getToneTheme } from '@/lib/severity-theme';
import { buttonClasses } from '@/components/ui/button';
import type { Tone } from '@/lib/design/semantics';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  /** One line on what this space will hold, in plain language. */
  description?: string;
  /** The action that fills the space. Give it one whenever the user can act. */
  action?: { label: string; href?: string; onClick?: () => void };
  tone?: Tone;
  /** For placement on an already-tinted or colored surface, where the default
   *  card chrome would fight the parent. */
  bare?: boolean;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
  bare = false,
  className = '',
}: EmptyStateProps) {
  const { isElderly } = useUiMode();
  const theme = getToneTheme(tone);

  const container = bare
    ? isElderly
      ? 'p-6 text-center'
      : 'p-4 text-center'
    : isElderly
      ? 'p-10 rounded-3xl border-2 border-dashed border-border text-center'
      : 'p-8 rounded-[var(--r-card)] border border-dashed border-border text-center';

  return (
    <div className={`flex flex-col items-center justify-center ${container} ${className}`}>
      {icon && (
        <div
          className={`flex items-center justify-center rounded-full mb-3 ${theme.tile} ${
            isElderly ? 'w-20 h-20' : 'w-14 h-14'
          }`}
          aria-hidden="true"
        >
          {icon}
        </div>
      )}

      <h3
        className={`font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}
      >
        {title}
      </h3>

      {description && (
        <p
          className={`text-muted-foreground mt-1 max-w-[38ch] ${
            isElderly ? 'text-base' : 'text-xs'
          }`}
        >
          {description}
        </p>
      )}

      {action &&
        (action.href ? (
          <Link
            href={action.href}
            className={buttonClasses({
              variant: 'primary',
              size: 'sm',
              isElderly,
              className: 'mt-4',
            })}
          >
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className={buttonClasses({
              variant: 'primary',
              size: 'sm',
              isElderly,
              className: 'mt-4',
            })}
          >
            {action.label}
          </button>
        ))}
    </div>
  );
}
