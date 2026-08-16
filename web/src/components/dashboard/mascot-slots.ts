/**
 * MASCOT PLACEMENT SLOTS — where Remi is allowed to appear, and at what size.
 *
 * A registry rather than a convention, because the governing constraint is CALM: the
 * mascot earns its place on screens with nothing competing for attention, and the way
 * a character stops being charming is by turning up everywhere. A new slot is a
 * design decision, so it gets added here on purpose rather than by someone importing
 * the component into one more card.
 *
 * ELDERLY MODE narrows this further — Remi appears only at welcome, celebration and
 * offline reassurance, and says less everywhere (see the ux-copy skill).
 *
 * ── WHY THIS IS ITS OWN FILE, AND MUST STAY ONE ──
 *
 * It lived inside `brain-mascot.tsx`, which is `'use client'`. That marks every
 * export as client-only, so `(auth)/layout.tsx` — a SERVER component — calling
 * `mascotSlot('welcome')` threw at request time:
 *
 *     Attempted to call mascotSlot() from the server but mascotSlot is on the
 *     client. It's not possible to invoke a client function from the server.
 *
 * which 500'd every route under `(auth)`, login included. It builds clean and
 * type-checks clean; the boundary only exists at runtime, which is why it reached
 * production. `/welcome` sits outside that group and kept rendering, so the app
 * looked half-fine.
 *
 * This file has NO `'use client'` and no React import on purpose — it is data plus
 * one pure function, importable from either side. Do not move it back, and do not
 * add a hook to it.
 */

/** The full mood set (matches the illustrated brain sheet). */
export type MascotMood =
  | 'reminder'
  | 'concerned'
  | 'happy'
  | 'proud'
  | 'curious'
  | 'encouraging'
  | 'sorry'
  | 'peaceful';

export const MASCOT_SLOTS = {
  /** An empty day on the rail, or an empty notifications list. Remi is the content. */
  emptyState: { size: 144, elderlySize: 176, mood: 'peaceful' as MascotMood },
  /** Confirm dialogs — the exit confirmation, and any future one of the same weight. */
  dialog: { size: 56, elderlySize: 64, mood: 'happy' as MascotMood },
  /** The guided tour's bubble. */
  guide: { size: 64, elderlySize: 80, mood: 'curious' as MascotMood },
  /** First launch — the auth shell. The one place Remi greets a stranger. */
  welcome: { size: 42, elderlySize: 56, mood: 'happy' as MascotMood },
  /** Every dose answered. The one celebration in the product. */
  celebration: { size: 120, elderlySize: 148, mood: 'proud' as MascotMood },
} as const;

export type MascotSlot = keyof typeof MASCOT_SLOTS;

/**
 * Slot props for a call site. Use this rather than typing a size and a mood:
 * the registry exists so mascot placement is a DECISION MADE IN ONE PLACE
 * (CLAUDE.md), and every inline `size={144} mood="peaceful"` is that decision
 * quietly re-made somewhere nobody will look again.
 */
export function mascotSlot(slot: MascotSlot, isElderly = false) {
  const s = MASCOT_SLOTS[slot];
  return { size: isElderly ? s.elderlySize : s.size, mood: s.mood };
}
