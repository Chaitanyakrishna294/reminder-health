/**
 * MASCOT PLACEMENT SLOTS — where Remi is allowed to appear, and at what size.
 *
 * A registry rather than a convention, because the governing constraint is CALM: the
 * mascot earns its place on screens with nothing competing for attention, and the way
 * a character stops being charming is by turning up everywhere. A new slot is a
 * design decision, so it gets added here on purpose rather than by someone importing
 * the component into one more card.
 *
 * **The art itself is frozen in [docs/design/REMI.md](../../../../docs/design/REMI.md)** —
 * palette, silhouette, the six expressions, the size-conditional floors and the
 * rejection ledger. This file decides only WHERE and HOW BIG.
 *
 * REMI CELEBRATES AND COMFORTS. He never appears on a missed-dose or alarm
 * surface — see the note on `medDueGate` at the bottom of this file, which is the
 * one live exception and is flagged for a decision rather than settled.
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

/**
 * The six frozen expressions. Adding one means adding it to REMI.md first —
 * the doc is the authority, this type is its echo.
 *
 * `peaceful-sleep` is APPROVED BUT UNWIRED: no bedtime empty state exists yet.
 * It is in the union so the art can be referenced when one does.
 */
export type RemiExpression =
  | 'happy'
  | 'waving'
  | 'proud'
  | 'peaceful'
  | 'curious'
  | 'peaceful-sleep';

/**
 * LEGACY MOODS — the pre-2026-08-20 art, still rendered from PNG.
 *
 * Only `med-due-gate` still uses these (`reminder` / `concerned`), and only
 * because converting it is a design decision the maintainer has reserved. Do not
 * add new call sites; when the gate question is settled these disappear along
 * with `web/public/mascot/*.png`.
 */
export type LegacyMood =
  | 'reminder'
  | 'concerned'
  | 'encouraging'
  | 'sorry';

export type MascotMood = RemiExpression | LegacyMood;

export interface MascotSlotSpec {
  /** Which frozen expression this moment gets. */
  readonly expression: RemiExpression;
  readonly size: number;
  readonly elderlySize: number;
  /** Announced name. Decorative slots pass `null` and render aria-hidden. */
  readonly altKey: 'welcome' | 'happy' | 'proud' | 'peaceful' | 'curious' | null;
}

export const MASCOT_SLOTS = {
  /** First launch — the auth shell. The one place Remi greets a stranger. */
  welcome: { expression: 'waving', size: 42, elderlySize: 56, altKey: 'welcome' },
  /** Confirm dialogs — the exit confirmation, and any future one of the same weight. */
  exitDialog: { expression: 'happy', size: 56, elderlySize: 64, altKey: 'happy' },
  /** Every dose answered. The one celebration in the product. */
  celebration: { expression: 'proud', size: 120, elderlySize: 148, altKey: 'proud' },
  /** A care-circle moment worth marking — same face, same weight as a celebration. */
  careCircleMoment: { expression: 'proud', size: 120, elderlySize: 148, altKey: 'proud' },
  /** An empty day on the rail, or an empty notifications list. Remi is the content. */
  emptyState: { expression: 'peaceful', size: 144, elderlySize: 176, altKey: 'peaceful' },
  /** Offline reassurance — one of elderly's three permitted moments. */
  offline: { expression: 'peaceful', size: 120, elderlySize: 148, altKey: 'peaceful' },
  /** The guided tour's bubble. */
  guideTour: { expression: 'curious', size: 64, elderlySize: 80, altKey: 'curious' },
} as const satisfies Record<string, MascotSlotSpec>;

export type MascotSlot = keyof typeof MASCOT_SLOTS;

/**
 * Slot props for a call site. Use this rather than typing a size and an
 * expression: the registry exists so mascot placement is a DECISION MADE IN ONE
 * PLACE, and every inline `size={144} mood="peaceful"` is that decision quietly
 * re-made somewhere nobody will look again.
 */
export function mascotSlot(slot: MascotSlot, isElderly = false) {
  const s = MASCOT_SLOTS[slot];
  return {
    size: isElderly ? s.elderlySize : s.size,
    mood: s.expression as MascotMood,
    altKey: s.altKey,
  };
}

/**
 * ── FLAGGED, NOT DECIDED: the dose gate ──
 *
 * `med-due-gate.tsx` renders Remi inside the overdue ring and picks the face from
 * how late the dose is:
 *
 *     const mood = missedMode || minutesLate(...) >= 30 ? 'concerned' : 'reminder'
 *
 * It is deliberately NOT in this registry, for two reasons the maintainer asked to
 * rule on rather than have settled:
 *
 *  1. **It contradicts the placement rule.** REMI.md says Remi celebrates and
 *     comforts and never appears on a missed-dose surface. The gate is exactly
 *     that surface — it asks about doses the patient may have missed, and it
 *     literally computes a `concerned` face when they have.
 *  2. **A registry lookup cannot express it.** Slots carry one fixed expression;
 *     the gate's face is dynamic. Converting it would mean choosing a single
 *     expression, which changes behaviour on a safety-critical screen — the one
 *     thing the conversion brief ruled out.
 *
 * So the gate keeps its legacy PNG moods untouched, with zero behaviour change,
 * until that call is made. The three options are: drop Remi from the gate
 * entirely (what REMI.md implies), keep the legacy art there as a documented
 * exception, or design a gate-specific expression under a fresh unfreeze.
 */
