// Severity-driven theming shared across the medication list, dashboard "Next Medication"
// card, and Today's Schedule rows. Returns Tailwind class strings for a soft pastel wash,
// matching borders, an icon tile and a badge. Kept intentionally subtle so lists stay calm
// and legible; severity is always reinforced by badge TEXT, never color alone.
export interface SeverityTheme {
  bg: string;
  border: string;
  borderStrong: string;
  tile: string;
  badge: string;
}

export function getSeverityTheme(level?: string): SeverityTheme {
  switch (level) {
    case 'critical':
      return {
        bg: 'bg-danger/5',
        border: 'border-danger/25',
        borderStrong: 'border-danger/40',
        tile: 'bg-danger/15 text-danger',
        badge: 'bg-danger/10 text-danger border-danger/30',
      };
    case 'important':
      return {
        bg: 'bg-warning/8',
        border: 'border-warning/30',
        borderStrong: 'border-warning/45',
        tile: 'bg-warning/15 text-warning',
        badge: 'bg-warning/10 text-warning border-warning/30',
      };
    default:
      return {
        bg: 'bg-success/5',
        border: 'border-success/25',
        borderStrong: 'border-success/40',
        tile: 'bg-success/15 text-success',
        badge: 'bg-success/10 text-success border-success/30',
      };
  }
}
