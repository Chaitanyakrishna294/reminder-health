/**
 * The reminder-reliability setup guide, as DATA.
 *
 * Every Android OEM buries these switches somewhere different, and the paths
 * change between models and OS versions. Encoding them as data rather than as
 * branching UI code means adding Xiaomi or Samsung later is a new entry in
 * BRAND_GUIDES — no component changes, no new conditionals, and no risk of
 * breaking the brand that already worked.
 *
 * The vivo/iQOO paths below are VERIFIED on a real vivo I2202 (2026-08-11), by
 * a user who first spent three minutes failing to find them from a generic "App
 * info" screen. That failure is why these are numbered steps in the user's own
 * words rather than one paragraph naming the Android setting.
 */

import type { ReliabilityStatus, ReliabilityTarget } from '@/lib/native/schedule-bridge';

export interface SetupItem {
  id: ReliabilityTarget;
  title: string;
  /** What breaks for the patient — never what the Android setting is called. */
  why: string;
  /**
   * False when Android gives us no way to read the state (autostart), so the
   * user marks it done themselves. Being honest about this matters: a checklist
   * that claims to know something it cannot is worse than one that asks.
   */
  autoDetected: boolean;
  /** Ordered, one action per line. */
  steps: string[];
}

const APP_NAME = 'Re-MIND-eЯ';

/** Used when the device's brand has no verified path yet. */
const GENERIC_STEPS: Record<ReliabilityTarget, string[]> = {
  notifications: [
    'Open your phone Settings',
    'Tap Apps, then find ' + APP_NAME,
    'Tap Notifications',
    'Turn notifications ON',
  ],
  exactAlarms: [
    'Open your phone Settings',
    'Tap Apps, then find ' + APP_NAME,
    'Look for "Alarms & reminders" (it may be under Special app access)',
    'Allow ' + APP_NAME + ' to set alarms and reminders',
  ],
  battery: [
    'Open your phone Settings',
    'Tap Apps, then find ' + APP_NAME,
    'Tap Battery',
    'Choose "Unrestricted" (not "Optimised" or "Restricted")',
  ],
  autostart: [
    'Open your phone Settings',
    'Look for Autostart, Auto-launch or "Background start" — often under Apps, Special app access, or your phone\'s security app',
    'Find ' + APP_NAME + ' in the list',
    'Turn it ON',
  ],
};

interface BrandGuide {
  /** Lowercase substrings matched against manufacturer AND brand. */
  match: string[];
  label: string;
  /** Only the items whose path differs from GENERIC_STEPS need listing. */
  steps: Partial<Record<ReliabilityTarget, string[]>>;
}

const BRAND_GUIDES: BrandGuide[] = [
  {
    // Verified on vivo I2202 (BRAND=iQOO, MANUFACTURER=vivo), 2026-08-11.
    match: ['vivo', 'iqoo'],
    label: 'vivo / iQOO',
    steps: {
      autostart: [
        'Open your phone Settings',
        'Tap Apps',
        'Tap Special app access',
        'Tap Autostart',
        `Find ${APP_NAME} in the list`,
        'Turn ON "Allow autostart"',
      ],
      battery: [
        `Press and hold the ${APP_NAME} icon on your home screen`,
        'Tap App info',
        'Tap App battery usage',
        'Tap Background power',
        'Choose "Unrestricted"',
      ],
    },
  },
];

function guideFor(status: ReliabilityStatus | null): BrandGuide | null {
  if (!status) return null;
  const make = `${status.manufacturer ?? ''} ${status.brand ?? ''}`.toLowerCase();
  return BRAND_GUIDES.find((g) => g.match.some((m) => make.includes(m))) ?? null;
}

/** The brand label to show, or null when we have no verified path for it. */
export function brandLabel(status: ReliabilityStatus | null): string | null {
  return guideFor(status)?.label ?? null;
}

export function stepsFor(target: ReliabilityTarget, status: ReliabilityStatus | null): string[] {
  return guideFor(status)?.steps[target] ?? GENERIC_STEPS[target];
}

/**
 * Every setup item, in order of consequence — an alarm that never arrives
 * outranks one that arrives without taking over the screen.
 */
export function setupItems(status: ReliabilityStatus | null): SetupItem[] {
  return [
    {
      id: 'notifications',
      title: 'Allow notifications',
      why: 'Without this, dose alarms cannot appear at all. Nothing else on this list matters until it is on.',
      autoDetected: true,
      steps: stepsFor('notifications', status),
    },
    {
      id: 'exactAlarms',
      title: 'Allow exact alarms',
      why: 'Without this, Android is free to deliver a reminder late — by minutes or by hours.',
      autoDetected: true,
      steps: stepsFor('exactAlarms', status),
    },
    {
      id: 'battery',
      title: 'Allow unrestricted battery use',
      why: 'While the phone sits idle, battery saving can delay or skip alarms entirely. This usually bites overnight, which is exactly when a missed dose goes unnoticed.',
      autoDetected: true,
      steps: stepsFor('battery', status),
    },
    {
      id: 'autostart',
      title: 'Allow autostart',
      why: 'After a restart, phones from some manufacturers block apps from starting again. Reminders then stop silently until you next open the app.',
      // Android exposes no API for this — the OEM managers keep it to themselves.
      autoDetected: false,
      steps: stepsFor('autostart', status),
    },
  ];
}

/** True when this item is satisfied, for the items Android lets us check. */
export function isItemSatisfied(id: ReliabilityTarget, status: ReliabilityStatus): boolean {
  switch (id) {
    case 'notifications':
      return status.notificationsEnabled;
    case 'exactAlarms':
      return status.canScheduleExactAlarms;
    case 'battery':
      return status.ignoringBatteryOptimizations;
    case 'autostart':
      // Never knowable from Android; the caller consults the manual mark.
      return false;
  }
}

/** localStorage key for the items the user confirms themselves. */
export const MANUAL_DONE_KEY = 'reliabilitySetupDone';

export function readManualDone(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(MANUAL_DONE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function writeManualDone(next: Record<string, boolean>): void {
  try {
    localStorage.setItem(MANUAL_DONE_KEY, JSON.stringify(next));
  } catch {
    /* a non-persisted acknowledgement is better than a crash */
  }
}
