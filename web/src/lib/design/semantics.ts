// Single source of truth for what a color MEANS and what a thing is CALLED.
//
// Before this file the app carried four different color sets for the same three
// priority levels (severity-theme, medication-list's local `cardTheme`, the schedule
// planner's hardcoded legend, and todays-schedule's `SeverityArcBadge`), and three
// phrasings for two care relationships. Screens drifted because each one made its own
// call. Everything user-visible that encodes meaning as color or as a word resolves
// here now.
//
// Rules this file exists to enforce:
//   - No new hex literals in components. Use a Tone and let the tokens resolve it.
//   - `primary` (pink) is brand + primary CTA ONLY — never a priority level, never a
//     chart band. It competes with status color otherwise.
//   - `info` (blue) is for trust/security/explanatory copy. Red and orange are alarms;
//     a reassurance message must never wear one.
//   - `neutral` is the honest answer for "nothing happened here" — a past day with no
//     dose logged is not a warning.
//
// See docs/DESIGN_SYSTEM.md for the full map.

export type Tone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'primary'
  | 'neutral';

/** CSS custom properties per tone, for SVG stroke/fill and inline styles where a
 *  Tailwind class can't reach. Always `var(--x)` so dark mode follows. */
export const TONE_VAR: Record<Tone, string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  primary: 'var(--primary)',
  neutral: 'var(--muted-foreground)',
};

/** The readable-on-a-tint text color per tone. Never use `-foreground` (white) on a
 *  `/10` tint — that is the bug this pair of maps prevents. */
export const TONE_TEXT_VAR: Record<Tone, string> = {
  success: 'var(--success-strong)',
  warning: 'var(--warning-strong)',
  danger: 'var(--danger-strong)',
  info: 'var(--info-strong)',
  primary: 'var(--primary)',
  neutral: 'var(--muted-foreground)',
};

// ── Medication priority ────────────────────────────────────────────────────────
// DB values stay lowercase `normal | important | critical` (column `priority_level`).
// Only the LABEL changed: "Normal" collided with "Switch to Normal view" (the elderly
// mode toggle) and with "Routine On Track" adherence copy, so the priority level is
// called Routine everywhere and "Normal" is left to the view mode.

export type PriorityLevel = 'normal' | 'important' | 'critical';

export interface PriorityMeta {
  label: string;
  tone: Tone;
  /** Shown under the label in the wizard's priority picker. */
  desc: string;
  /** One-line gloss for legends, where there is no room for `desc`. */
  gloss: string;
}

export const PRIORITY: Record<PriorityLevel, PriorityMeta> = {
  normal: {
    label: 'Routine',
    tone: 'success',
    desc: 'General vitamins and supplements',
    gloss: 'Helpful, not urgent',
  },
  important: {
    label: 'Important',
    tone: 'warning',
    desc: 'Core medication, small delay tolerated',
    gloss: 'Take close to time',
  },
  critical: {
    label: 'Critical',
    tone: 'danger',
    desc: 'Life-critical doses, alerts your caregiver if missed',
    gloss: 'Alerts your caregiver if missed',
  },
};

/** Tolerant of null/unknown DB values — anything unrecognised reads as routine,
 *  which matches how the rest of the app already treats a missing priority. */
export function priorityMeta(level?: string | null): PriorityMeta {
  const key = (level || '').toLowerCase() as PriorityLevel;
  return PRIORITY[key] ?? PRIORITY.normal;
}

export function priorityLabel(level?: string | null): string {
  return priorityMeta(level).label;
}

// ── Care relationships ─────────────────────────────────────────────────────────
// Two directions, two names, one order. Settings used to say "People Who Care For
// Me" while Care Circle said "People Caring For Me", and the two screens listed them
// in opposite orders — which made "am I the patient or the caregiver here?" a puzzle.
// Patient-side first everywhere: it is the relationship every user has.

export const CARE_LABELS = {
  /** The user is the caregiver; these are their patients. */
  asCaregiver: 'People I Care For',
  /** The user is the patient; these are their caregivers. */
  asPatient: 'People Caring For Me',
} as const;

/** Section order, patient-side first. Spread this rather than hand-ordering. */
export const CARE_SECTION_ORDER = ['asPatient', 'asCaregiver'] as const;

// ── Dose status ────────────────────────────────────────────────────────────────
// Note SNOOZED is `info`, not `warning`: the user acted, they just asked for later.
// PENDING/UNCONFIRMED are `neutral` — a dose that hasn't come due yet is not a fault,
// and neither is a past day with nothing scheduled.

export const DOSE_TONE: Record<string, Tone> = {
  TAKEN: 'success',
  RESOLVED_BY_CG: 'success',
  SKIPPED: 'warning',
  MISSED: 'danger',
  UNCONFIRMED: 'neutral',
  ESCALATED_TO_CG: 'danger',
  SNOOZED: 'info',
  PENDING: 'neutral',
  SENT: 'neutral',
  DISPLAYED: 'neutral',
  OPENED: 'neutral',
  GENTLE_REMINDER: 'warning',
  PENDING_REVIEW: 'warning',
};

export function doseTone(status?: string | null): Tone {
  return DOSE_TONE[(status || '').toUpperCase()] ?? 'neutral';
}

/** Human label per dose status, so color is never the only signal (WCAG 1.4.1). */
export const DOSE_LABEL: Record<string, string> = {
  TAKEN: 'Taken',
  RESOLVED_BY_CG: 'Logged by caregiver',
  SKIPPED: 'Skipped',
  MISSED: 'Missed',
  UNCONFIRMED: 'Not confirmed',
  ESCALATED_TO_CG: 'Caregiver alerted',
  SNOOZED: 'Snoozed',
  PENDING: 'Pending',
  SENT: 'Reminder sent',
  DISPLAYED: 'Reminder shown',
  OPENED: 'Reminder opened',
  GENTLE_REMINDER: 'Reminded again',
  PENDING_REVIEW: 'Needs review',
};

export function doseLabel(status?: string | null): string {
  return DOSE_LABEL[(status || '').toUpperCase()] ?? 'Pending';
}
