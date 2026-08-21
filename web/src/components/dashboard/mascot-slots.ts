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
 * surface, and as of 2026-08-21 there is no exception — the dose gate was the last
 * one and it was ruled off (see the bottom of this file).
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
 * Kept as the name the call sites and `brain-mascot` already use. It once also
 * covered four PNG-only legacy moods (`reminder`, `concerned`, `encouraging`,
 * `sorry`); those were deleted with the gate ruling on 2026-08-21, so the two
 * types now name the same set. **Every mood is a frozen expression** — which is
 * what lets `BrainMascot` render inline SVG unconditionally, with no PNG branch
 * and no fallback.
 */
export type MascotMood = RemiExpression;

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
 * ── RULED 2026-08-21: THE DOSE GATE GETS NO MASCOT ──
 *
 * `med-due-gate.tsx` used to render Remi inside its overdue ring and pick the face
 * from how late the dose was:
 *
 *     const mood = missedMode || minutesLate(...) >= 30 ? 'concerned' : 'reminder'
 *
 * It was the one placement outside this registry, flagged rather than settled. The
 * maintainer ruled: **drop Remi from the gate.** The gate is a dose question, and
 * REMI.md is right that Remi never belongs on one — a mascot that computes a
 * disappointed face when you missed a dose is scolding, which is the single thing
 * the character is defined not to do.
 *
 * The ring and its lens went with the art. Both existed to frame and seat the
 * mascot, so keeping them would have left a frosted empty donut — exactly the hole
 * the removal was told not to leave. No information went with them: the lateness
 * figure is spelled out in the chip below (icon + text + tint), and every list row
 * already carries its own time and missed state as text.
 *
 * **Do not re-add a mascot to the gate.** The three options were drop it, keep the
 * legacy art as a documented exception, or design a gate-specific expression under
 * a fresh unfreeze. The first was chosen; the other two are closed.
 */
