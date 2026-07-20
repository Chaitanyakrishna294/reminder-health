import type { MascotMood } from '@/components/dashboard/brain-mascot';

export interface GuideStep {
  /** Matches a `data-tour="<target>"` attribute on the element to spotlight. */
  target: string;
  title: string;
  message: string;
  mood?: MascotMood;
  /** For multi-step forms: which wizard step this field lives on, so the page can
   *  jump there before the field is spotlighted. Used by the Add Medication wizard. */
  wizardStep?: number;
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
  // A field-by-field walkthrough. Each step jumps the wizard to `wizardStep`, then
  // spotlights one input and explains it in plain English.
  newMedication: [
    {
      target: 'mednew-name',
      wizardStep: 1,
      title: 'Name of the medicine',
      message: 'Type the medicine’s name here — like Paracetamol or Atorvastatin.',
      mood: 'curious',
    },
    {
      target: 'mednew-catalog',
      wizardStep: 1,
      title: 'Link the real medicine',
      message:
        'If you know the exact brand, search and pick it here. It’s optional — but adding it helps your doctor see exactly what you take.',
      mood: 'encouraging',
    },
    {
      target: 'mednew-form',
      wizardStep: 1,
      title: 'What form is it?',
      message: 'Choose the form it comes in — tablet, capsule, syrup, drops, and so on.',
      mood: 'curious',
    },
    {
      target: 'mednew-frequency',
      wizardStep: 2,
      title: 'How often you take it',
      message: 'Pick how many times a day you take it — once, twice, or thrice.',
      mood: 'reminder',
    },
    {
      target: 'mednew-times',
      wizardStep: 2,
      title: 'Time of each dose',
      message: 'Set the time for every dose. Your reminders arrive at exactly these times.',
      mood: 'reminder',
    },
    {
      target: 'mednew-strength',
      wizardStep: 3,
      title: 'Strength',
      message: 'The strength, like 500mg — it’s printed on the box or strip. This one is optional.',
      mood: 'curious',
    },
    {
      target: 'mednew-amount',
      wizardStep: 3,
      title: 'How much to take',
      message: 'How many to take each time — for example, 1 tablet or 2 tablets.',
      mood: 'encouraging',
    },
    {
      target: 'mednew-inventory',
      wizardStep: 4,
      title: 'Track your stock',
      message: 'Turn this on and I’ll count your pills down with each dose, then warn you before you run out.',
      mood: 'curious',
    },
    {
      target: 'mednew-stock',
      wizardStep: 4,
      title: 'How many you have',
      message: 'Enter how many you have now, and the low number you’d like to be warned at.',
      mood: 'reminder',
    },
    {
      target: 'mednew-reason',
      wizardStep: 5,
      title: 'What it’s for',
      message: 'Optional: a short note like “for blood pressure”, so it’s easy to recognise later.',
      mood: 'encouraging',
    },
    {
      target: 'mednew-priority',
      wizardStep: 5,
      title: 'How important is it',
      message: 'Set how important it is. Critical doses can alert your caregiver if one is missed.',
      mood: 'reminder',
    },
    {
      target: 'mednew-review',
      wizardStep: 6,
      title: 'Check and save',
      message: 'Look over everything here, then tap Add Medication to switch on your reminders. You can edit it anytime.',
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
