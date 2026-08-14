'use client';

/**
 * The water card on Today — the gap under Today's Doses.
 *
 * PART OF TODAY, NOT A STICKER ON IT. Same card conventions as everything else
 * on the page (`bg-card`, `border-border`, `rounded-3xl`), same spacing scale.
 * The only thing that marks it as different in kind is the scoped sky-blue on
 * the tumbler itself — deliberate, so a glass of water is never mistaken for a
 * dose, and deliberately confined to the tumbler so the card still belongs to
 * the page.
 *
 * It sits in the gap under the doses INCLUDING the "nothing scheduled" empty
 * state. That is the case it earns most: a day with no doses is a screen with
 * nothing on it, and one quiet, useful thing is better than an empty page.
 *
 * Renders nothing at all unless the feature is switched on. Off by default —
 * a hydration widget nobody asked for is exactly the kind of thing that makes a
 * medication app feel like it is selling something.
 */

import React from 'react';
import Link from 'next/link';
import { useUiMode } from '@/context/ui-mode-context';
import WaterTumbler from '@/components/water/water-tumbler';
import { useWaterDay } from '@/components/water/use-water-day';

export interface WaterCardProps {
  enabled: boolean;
  goalCups: number;
  cupMl: number;
}

export default function WaterCard({ enabled, goalCups, cupMl }: WaterCardProps) {
  const { isElderly } = useUiMode();
  const { cups, add, undo, ready } = useWaterDay(enabled);

  if (!enabled) return null;
  // Nothing until the count is known: painting 0 and correcting it a moment
  // later looks like the app forgot what you drank.
  if (!ready) return null;

  return (
    <section
      aria-labelledby="water-heading"
      className={`bg-card border border-border rounded-3xl ${isElderly ? 'p-6' : 'p-5'}`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2
          id="water-heading"
          className={`font-black text-foreground tracking-tight ${isElderly ? 'text-2xl' : 'text-lg'}`}
        >
          Water today
        </h2>
        <Link
          href="/settings/water"
          className={`shrink-0 min-h-11 inline-flex items-center font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg px-1 ${
            isElderly ? 'text-base' : 'text-xs'
          }`}
        >
          Change
        </Link>
      </div>

      <WaterTumbler
        cups={cups}
        goalCups={goalCups}
        cupMl={cupMl}
        onAdd={add}
        onUndo={undo}
        isElderly={isElderly}
      />
    </section>
  );
}
