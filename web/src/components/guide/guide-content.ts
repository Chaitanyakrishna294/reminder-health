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
        'Your adherence at a glance: the percentage of doses you’ve taken on time. Keeping this high is the goal!',
      mood: 'encouraging',
    },
    {
      target: 'dash-today',
      title: 'Today’s schedule',
      message:
        'Every dose for today lives here. Mark each one Taken or Skip. If you logged one wrong, tap “Change” to fix it.',
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
  medications: [
    {
      target: 'med-hero',
      title: 'Your medication library',
      message:
        'All your active medications live here. Each card shows dose timing, stock level, and your next scheduled reminder.',
      mood: 'curious',
    },
    {
      target: 'med-card-first',
      title: 'One card per medication',
      message:
        'The coloured left stripe shows priority: red is critical, orange is important, pink is routine. A PAUSED chip means reminders are currently off.',
      mood: 'encouraging',
    },
    {
      target: 'med-times',
      title: 'Reminder times',
      message:
        'These are the exact times your Telegram reminders fire each day. Tap Edit on the card to change them.',
      mood: 'reminder',
    },
    {
      target: 'med-stock',
      title: 'Inventory tracking',
      message:
        'Stock counts down with each dose. When it reaches your threshold it pulses red: that\'s your cue to restock.',
      mood: 'curious',
    },
    {
      target: 'med-actions',
      title: 'Quick actions',
      message:
        'Pause stops reminders without deleting. Edit changes any detail. Add Stock tops up your count. Delete removes the medication entirely.',
      mood: 'proud',
    },
  ],
};
