/**
 * ENGLISH IS THE SOURCE OF TRUTH.
 *
 * Every other dictionary in this folder is typed as `Messages`, so adding a key here
 * breaks the other six at compile time until they carry it too. That is deliberate:
 * a missing translation should be a build error, not a blank label discovered by the
 * person who cannot read the fallback.
 *
 * SCOPE, stated plainly so nobody mistakes this for full app translation: this covers
 * the greeting, the five navigation labels, the Settings hub, and the language picker
 * itself. Medication names, dose forms, the wizard, the care circle and the health
 * vault are still English. See docs/I18N.md for what is and is not translated.
 *
 * Copy rules (.claude/skills/ux-copy) apply to all seven files: sentence case, no
 * emoji, zero blame, and nothing that implies the app checks medical correctness.
 */

export interface Messages {
  greeting: {
    morning: string;
    afternoon: string;
    evening: string;
    night: string;
  };
  nav: {
    dashboard: string;
    dashboardShort: string;
    careCircle: string;
    careCircleShort: string;
    medications: string;
    medicationsShort: string;
    /** Elderly density can afford the plain word rather than the idiomatic short one. */
    medicationsElderly: string;
    healthVault: string;
    healthVaultShort: string;
    settings: string;
    settingsShort: string;
  };
  settings: {
    title: string;
    groupCare: string;
    groupAbout: string;
    account: string;
    notifications: string;
    notificationStyle: string;
    display: string;
    water: string;
    connections: string;
    careCircle: string;
    setupGuide: string;
    language: string;
    help: string;
    legal: string;
    logOut: string;
    loggingOut: string;
    logOutConfirm: string;
  };
  language: {
    title: string;
    /** Sits under the list. Says what IS translated, so the list promises nothing false. */
    scopeNote: string;
    /** The one thing a language setting cannot yet change. Honest, not buried. */
    alarmNote: string;
    selected: string;
  };
  legal: {
    title: string;
    privacy: string;
    terms: string;
    disclaimer: string;
    lastUpdated: string;
    /** Shown on every non-English rendering of a legal document. */
    translationNotice: string;
    readInEnglish: string;
    backToSignIn: string;
  };
}

const en: Messages = {
  greeting: {
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening',
    night: 'Good night',
  },
  nav: {
    dashboard: 'Dashboard',
    dashboardShort: 'Today',
    careCircle: 'Care Circle',
    careCircleShort: 'Care',
    medications: 'Medications',
    medicationsShort: 'Meds',
    medicationsElderly: 'Medicines',
    healthVault: 'Health Vault',
    healthVaultShort: 'Vault',
    settings: 'Settings',
    settingsShort: 'Settings',
  },
  settings: {
    title: 'Settings',
    groupCare: 'Care',
    groupAbout: 'About',
    account: 'Account',
    notifications: 'Notifications',
    notificationStyle: 'Notification style',
    display: 'Display',
    water: 'Water',
    connections: 'Connections',
    careCircle: 'Care circle',
    setupGuide: 'Setup guide',
    language: 'Language',
    help: 'Help & support',
    legal: 'Privacy & terms',
    logOut: 'Log out',
    loggingOut: 'Logging out…',
    logOutConfirm: 'Log out?\n\nReminders on this phone will stop until you sign in again.',
  },
  language: {
    title: 'Language',
    scopeNote:
      'This changes the menus, the settings screens, and the privacy, terms and medical disclaimer pages. Medicine names stay exactly as you typed them.',
    alarmNote: 'The alarm screen on your phone is still in English. We are working on it.',
    selected: 'Selected',
  },
  legal: {
    title: 'Privacy & terms',
    privacy: 'Privacy policy',
    terms: 'Terms of service',
    disclaimer: 'Medical disclaimer',
    lastUpdated: 'Last updated',
    translationNotice:
      'This is a translation, provided to help you read it in your own language. If anything here differs from the English version, the English version is the one that applies.',
    readInEnglish: 'Read in English',
    backToSignIn: 'Back to sign in',
  },
};

export default en;
