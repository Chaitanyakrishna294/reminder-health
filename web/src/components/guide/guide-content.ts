import type { Density } from '@/lib/design/density';

export interface GuideStep {
  /** Matches a `data-tour="<target>"` attribute on the element to spotlight. */
  target: string;
  title: string;
  message: string;
  /** For multi-step forms: which wizard step this field lives on, so the page can
   *  jump there before the field is spotlighted. Used by the Add Medication wizard. */
  wizardStep?: number;
  /**
   * Which densities render this step's target. Omit when every density does.
   *
   * The tour degrades gracefully when a target is missing — it centres the card
   * and skips the spotlight — but "gracefully" is not the same as "honestly": a
   * step describing a ring that is not on this screen is a tour lying to the
   * person following it. Filtered in guide-tour.tsx.
   */
  densities?: Density[];
}

// Single source of truth for all guided tours. Add a tour or edit copy here only;
// the engine, the ? button, and every page read from this map.
export const TOURS: Record<string, GuideStep[]> = {
  dashboard: [
    {
      target: 'dash-next-med',
      title: 'Your next dose',
      // Anchored on the day rail's due-now card since the hero card was retired
      // (redesign §03). Same dose it always pointed at — DayRail picks the due-now
      // card, or the earliest unanswered dose when nothing is due yet.
      message:
        'This is the dose that needs answering next. When it is due, the card grows and shows Taken and Skip.',
    },
    {
      target: 'dash-compliance',
      // The ring lives in the side column, which only the browser density
      // renders. Without this the app tour would spend a step on a card that is
      // not there.
      densities: ['browser'],
      title: 'How today is going',
      // Was "Keeping this high is the goal!" — pressure, and an exclamation mark, on
      // the one number a struggling patient sees most. The screen reports; it does
      // not set targets. Also says what the ring actually shows: today, not a
      // lifetime average.
      message:
        'The ring fills as you answer each dose today. Tap a pocket in the strip above to see that dose here.',
    },
    {
      target: 'dash-today',
      title: 'Today’s schedule',
      message:
        'Your whole day runs down this line, grouped into morning, midday, evening and bedtime. If you logged a dose the wrong way, tap “Change” under it — that works on the same day only.',
    },
    {
      target: 'dash-nav',
      title: 'Get around',
      message:
        'Use these to reach Medications, the Scheduler, your Health Vault, and Settings. Your Medical Profile and Emergency card live in the profile menu.',
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
    },
    {
      target: 'mednew-catalog',
      wizardStep: 1,
      title: 'Link the real medicine',
      message:
        'If you know the exact brand, search and pick it here. It’s optional — but adding it helps your doctor see exactly what you take.',
    },
    {
      target: 'mednew-form',
      wizardStep: 1,
      title: 'What form is it?',
      message: 'Choose the form it comes in — tablet, capsule, syrup, drops, and so on.',
    },
    {
      target: 'mednew-frequency',
      wizardStep: 2,
      title: 'How often you take it',
      message: 'Pick how many times a day you take it — once, twice, or thrice.',
    },
    {
      target: 'mednew-times',
      wizardStep: 2,
      title: 'Time of each dose',
      message: 'Set the time for every dose. Your reminders arrive at exactly these times.',
    },
    {
      target: 'mednew-strength',
      wizardStep: 3,
      title: 'Strength',
      message: 'Type the strength, like 500mg — it’s printed on the box or strip. This one is optional.',
    },
    {
      target: 'mednew-amount',
      wizardStep: 3,
      title: 'How much to take',
      message: 'Use − and + to set how many to take each time — for example, 1 tablet or 2.',
    },
    {
      target: 'mednew-inventory',
      wizardStep: 4,
      title: 'Track your stock',
      message: 'Turn this on and I’ll count your pills down with each dose, then warn you before you run out.',
    },
    {
      target: 'mednew-stock',
      wizardStep: 4,
      title: 'How many you have',
      message: 'Enter how many you have now, and the low number you’d like to be warned at.',
    },
    {
      target: 'mednew-reason',
      wizardStep: 5,
      title: 'What it’s for',
      message: 'Add a short note like “for blood pressure”, so it’s easy to recognise later. This is optional.',
    },
    {
      target: 'mednew-priority',
      wizardStep: 5,
      title: 'How important is it',
      message: 'Set how important it is. Critical doses can alert your caregiver if one is missed.',
    },
    {
      target: 'mednew-review',
      wizardStep: 6,
      title: 'Check and save',
      message: 'Look over everything here, then tap Add Medication to switch on your reminders. You can edit it anytime.',
    },
  ],
  medications: [
    {
      target: 'med-hero',
      title: 'Your medication library',
      message:
        'All your active medications live here. Each card shows dose timing, stock level, and your next scheduled reminder.',
    },
    {
      target: 'med-card-first',
      title: 'One card per medication',
      // Described a left stripe that does not exist. The card leads with the
      // dose-form icon, and the chip row underneath carries every status.
      message:
        'The icon shows what form it comes in — tablet, syrup, drops. The marks underneath show how important it is, how much is left, and whether reminders are paused.',
    },
    {
      target: 'med-times',
      title: 'When you take it',
      message:
        'One line for the whole schedule — the times, then which days. Tap Edit on the card to change either.',
    },
    {
      target: 'med-stock',
      title: 'How much is left',
      // Was "pulses red" — the card never pulsed, and red is the danger tone.
      // Low stock is a waiting state, not a failure: amber, and worded as a
      // heads-up rather than an alarm.
      message:
        'Stock counts down with each dose. It turns amber at the number you set, so you can order more before you run out.',
    },
    {
      target: 'med-actions',
      title: 'Quick actions',
      message:
        'Pause stops reminders without deleting. Edit changes any detail. Add Stock tops up your count. Delete removes the medication entirely.',
    },
  ],
};
