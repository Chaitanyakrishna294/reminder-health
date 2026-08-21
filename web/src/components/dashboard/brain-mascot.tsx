'use client';

import React from 'react';
import { useLanguage } from '@/context/language-context';
import type { MascotMood } from '@/components/dashboard/mascot-slots';
import { RemiArt } from '@/components/dashboard/remi-art';

/**
 * The registry moved to `./mascot-slots` — it is data, and this file is
 * `'use client'`, which made every export client-only and 500'd the server-
 * rendered `(auth)` layout that calls `mascotSlot()`. See that file's header.
 *
 * Re-exported for the call sites that only need the type. **A SERVER component
 * must import `mascotSlot` / `MASCOT_SLOTS` from `./mascot-slots` directly** —
 * re-exporting a value through this module would put it back behind the client
 * boundary and bring the bug back.
 */
export type { MascotMood };

/** Slot → accessible name. Decorative placements pass no key and stay hidden. */
export type MascotAltKey = 'welcome' | 'happy' | 'proud' | 'peaceful' | 'curious';

interface BrainMascotProps {
  size?: number;
  mood?: MascotMood;
  className?: string;
  /**
   * Announce Remi with this name. Omitted (the default) renders `aria-hidden`,
   * which is right wherever the surrounding copy already says what Remi is
   * reacting to — a mascot that repeats the heading is noise in a screen reader.
   */
  altKey?: MascotAltKey | null;
}

/**
 * ONE RENDER PATH, ON PURPOSE.
 *
 * Until 2026-08-21 this component chose between inline SVG and a PNG, with a
 * third branch for a PNG that failed to load. The PNGs were the pre-freeze art
 * and their last caller was the dose gate, which was ruled to carry no mascot at
 * all — so every mood is now a frozen expression and the branching is gone.
 *
 * Keep it that way. A fallback branch here is where a second, unreviewed
 * character quietly lives: it renders only when something else is broken, which
 * is exactly when nobody is looking at it.
 */
export default function BrainMascot({
  size = 160,
  mood = 'happy',
  className = '',
  altKey = null,
}: BrainMascotProps) {
  const { t } = useLanguage();

  const label = altKey ? (t.mascot?.[altKey] ?? FALLBACK_ALT[altKey]) : null;
  const a11y = label
    ? ({ role: 'img' as const, 'aria-label': label })
    : ({ 'aria-hidden': true as const });

  return (
    <span
      className={`remi-bob inline-block ${className}`}
      style={{ width: size, height: size }}
      {...(label ? {} : { 'aria-hidden': true })}
    >
      {/* REMI'S IDLE IS THE ONE SANCTIONED LOOP. CLAUDE.md names exactly two
          earned motions — the all-taken celebration and this — so the calm rule
          is not being bent here; this is the carve-out itself.

          What was missing is the floor underneath it: the bob ran `infinite`
          with NO prefers-reduced-motion branch, on the one element in the app
          that never stops moving. For someone with vestibular sensitivity that
          is the worst possible thing to leave unguarded, and it is exactly what
          a blanket "nothing idle-animates" reading would have deleted rather
          than fixed. It now stops for anyone who asks. */}
      <style>{'@keyframes brainBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}.remi-bob{animation:brainBob 4.5s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.remi-bob{animation:none}}'}</style>

      <svg
        viewBox="0 0 512 512"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block' }}
        {...a11y}
      >
        <RemiArt expression={mood} size={size} />
      </svg>
    </span>
  );
}

/**
 * English fallbacks. The seven locale files carry `mascot.*`; these exist so a
 * missing key degrades to English rather than to nothing, which is the failure
 * mode that matters for an accessible name.
 */
const FALLBACK_ALT: Record<MascotAltKey, string> = {
  welcome: 'Remi, waving hello',
  happy: 'Remi, smiling',
  proud: 'Remi, pleased with you',
  peaceful: 'Remi, resting',
  curious: 'Remi, listening',
};
