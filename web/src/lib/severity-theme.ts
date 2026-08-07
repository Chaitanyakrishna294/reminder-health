// Tone-driven theming shared across the medication list, dashboard "Next Medication"
// card, Today's Schedule rows and the schedule planner. Returns Tailwind class strings
// for a soft pastel wash, matching borders, an icon tile and a badge. Kept intentionally
// subtle so lists stay calm and legible; severity is always reinforced by badge TEXT,
// never color alone.
//
// The tone→class mapping lives here; the meaning→tone mapping lives in
// `lib/design/semantics.ts`. Callers that have a DB priority value should use
// `getSeverityTheme(level)`; callers that already know the tone (dose status, an
// info surface) should use `getToneTheme(tone)`.
import { priorityMeta, type Tone } from '@/lib/design/semantics';

export interface SeverityTheme {
  /** Tinted surface. */
  bg: string;
  border: string;
  borderStrong: string;
  /** Icon tile — solid-ish tint with a saturated icon. */
  tile: string;
  /** Pill. Includes `border` width so the border color is not inert. */
  badge: string;
  /** Readable body/label color on `bg`. Use this, never `text-*-foreground`. */
  text: string;
  /** Solid fill for a primary action or a filled marker. */
  solid: string;
}

const THEMES: Record<Tone, SeverityTheme> = {
  danger: {
    bg: 'bg-danger/5',
    border: 'border-danger/25',
    borderStrong: 'border-danger/40',
    tile: 'bg-danger/15 text-danger',
    badge: 'bg-danger/10 text-danger-strong border border-danger/30',
    text: 'text-danger-strong',
    solid: 'bg-danger-strong text-card',
  },
  warning: {
    bg: 'bg-warning/8',
    border: 'border-warning/30',
    borderStrong: 'border-warning/45',
    tile: 'bg-warning/15 text-warning',
    badge: 'bg-warning/10 text-warning-strong border border-warning/30',
    text: 'text-warning-strong',
    solid: 'bg-warning text-warning-foreground',
  },
  success: {
    bg: 'bg-success/5',
    border: 'border-success/25',
    borderStrong: 'border-success/40',
    tile: 'bg-success/15 text-success',
    badge: 'bg-success/10 text-success-strong border border-success/30',
    text: 'text-success-strong',
    solid: 'bg-success text-success-foreground',
  },
  info: {
    bg: 'bg-info/5',
    border: 'border-info/25',
    borderStrong: 'border-info/40',
    tile: 'bg-info/15 text-info',
    badge: 'bg-info/10 text-info-strong border border-info/30',
    text: 'text-info-strong',
    solid: 'bg-info text-info-foreground',
  },
  primary: {
    bg: 'bg-primary/5',
    border: 'border-primary/25',
    borderStrong: 'border-primary/40',
    tile: 'bg-primary/15 text-primary',
    badge: 'bg-primary/10 text-primary border border-primary/30',
    text: 'text-primary',
    solid: 'bg-primary-strong text-primary-strong-foreground',
  },
  neutral: {
    bg: 'bg-muted/60',
    border: 'border-border',
    borderStrong: 'border-input',
    tile: 'bg-muted text-muted-foreground',
    badge: 'bg-muted text-muted-foreground border border-border',
    text: 'text-muted-foreground',
    solid: 'bg-muted text-foreground',
  },
};

export function getToneTheme(tone: Tone): SeverityTheme {
  return THEMES[tone] ?? THEMES.neutral;
}

/** Takes a raw `priority_level` DB value (`normal | important | critical`, or null). */
export function getSeverityTheme(level?: string | null): SeverityTheme {
  return getToneTheme(priorityMeta(level).tone);
}
