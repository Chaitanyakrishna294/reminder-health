import type { MascotMood } from '@/components/dashboard/brain-mascot';

export interface GuideStep {
  /** Matches a `data-tour="<target>"` attribute on the element to spotlight. */
  target: string;
  title: string;
  message: string;
  mood?: MascotMood;
}

// Single source of truth for all guided tours. Add a tour or edit copy here only;
// the engine, the ? button, and every page read from this map.
export const TOURS: Record<string, GuideStep[]> = {
  dashboard: [
    {
      target: 'dash-next-med',
      title: 'Your next dose',
      message:
        'This card shows the medication that needs your attention next. If a dose is overdue, it moves to the top so you never miss it.',
      mood: 'curious',
    },
    {
      target: 'dash-compliance',
      title: 'How you’re doing',
      message:
        'Your adherence at a glance — the percentage of doses you’ve taken on time. Keeping this high is the goal!',
      mood: 'encouraging',
    },
    {
      target: 'dash-today',
      title: 'Today’s schedule',
      message:
        'Every dose for today lives here. Mark each one Taken or Skip — and if you logged one wrong, tap “Change” to fix it.',
      mood: 'reminder',
    },
    {
      target: 'dash-nav',
      title: 'Get around',
      message:
        'Use these to reach Medications, the Scheduler, your Health Vault, and Settings. Your Medical Profile and Emergency card live in the profile menu.',
      mood: 'proud',
    },
  ],
};
