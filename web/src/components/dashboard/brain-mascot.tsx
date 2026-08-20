'use client';

import React, { useState } from 'react';
import { useLanguage } from '@/context/language-context';
import type { MascotMood, RemiExpression } from '@/components/dashboard/mascot-slots';
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

/**
 * THE FROZEN SIX render as inline SVG from `remi-art`; anything else is legacy
 * PNG. See REMI.md for why inline is forced rather than preferred — the dark
 * blush rule and the size floors both have to reach inside the art, and an
 * `<img>` lets nothing in.
 */
const FROZEN = new Set<string>(['happy', 'waving', 'proud', 'peaceful', 'curious', 'peaceful-sleep']);
const isFrozen = (m: MascotMood): m is RemiExpression => FROZEN.has(m);

/**
 * LEGACY ART — the pre-2026-08-20 PNGs.
 *
 * Only `med-due-gate` still reaches this path, and only because whether Remi
 * belongs on a dose question at all is a decision the maintainer has reserved
 * (see the flag at the bottom of mascot-slots.ts). Do not add call sites.
 */
const LEGACY: Record<string, string> = {
  reminder: '/mascot/reminder.png',
  concerned: '/mascot/concerned.png',
  encouraging: '/mascot/encouraging.png',
  sorry: '/mascot/sorry.png',
};

/** Slot → accessible name. Decorative placements pass no key and stay hidden. */
export type MascotAltKey = 'welcome' | 'happy' | 'proud' | 'peaceful' | 'curious';

interface BrainMascotProps {
  size?: number;
  /** 'asking' is kept as a backward-compatible alias for 'reminder'. */
  mood?: MascotMood | 'asking';
  className?: string;
  /**
   * Announce Remi with this name. Omitted (the default) renders `aria-hidden`,
   * which is right wherever the surrounding copy already says what Remi is
   * reacting to — a mascot that repeats the heading is noise in a screen reader.
   */
  altKey?: MascotAltKey | null;
}

export default function BrainMascot({
  size = 160,
  mood = 'reminder',
  className = '',
  altKey = null,
}: BrainMascotProps) {
  const resolved: MascotMood = mood === 'asking' ? 'reminder' : mood;
  const [imgOk, setImgOk] = useState(true);
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

      {isFrozen(resolved) ? (
        <svg
          viewBox="0 0 512 512"
          width={size}
          height={size}
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: 'block' }}
          {...a11y}
        >
          <RemiArt expression={resolved} size={size} />
        </svg>
      ) : imgOk && LEGACY[resolved] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={LEGACY[resolved]}
          alt=""
          width={size}
          height={size}
          onError={() => setImgOk(false)}
          style={{ width: size, height: size, objectFit: 'contain' }}
          aria-hidden
        />
      ) : (
        // Last resort if a legacy PNG is missing: the calm frozen face rather
        // than the old gradient brain, which broke the palette law.
        <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden style={{ display: 'block' }}>
          <RemiArt expression="peaceful" size={size} />
        </svg>
      )}
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
