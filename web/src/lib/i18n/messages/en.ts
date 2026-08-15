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

/**
 * A dose unit, in the two forms every one of these languages needs.
 *
 * `unitPhrase()` in medication-form-options.tsx pluralises by appending "s"/"es",
 * which is English morphology and produces nonsense everywhere else — "మాత్రs".
 * Two explicit forms per unit is the smallest thing that is actually correct.
 * Where a language does not inflect the noun here, both forms are the same word;
 * that is the right answer, not a placeholder.
 */
export interface UnitForms {
  one: string;
  other: string;
}

export interface Messages {
  /** Keyed by `medications.unit_type`. OTHER is the fallback for an unknown id. */
  units: {
    TABLET: UnitForms;
    CAPSULE: UnitForms;
    ML: UnitForms;
    DROP: UnitForms;
    APPLICATION: UnitForms;
    TEASPOON: UnitForms;
    UNIT: UnitForms;
    PATCH: UnitForms;
    INHALATION: UnitForms;
    OTHER: UnitForms;
  };
  dose: {
    /** "{amount} {unit}" — the amount is a number, the unit comes from `units`. */
    amount: string;
  };
  /**
   * ELDERLY MODE. The plainest register in the product, in every language: short
   * sentences, no idiom, nothing that needs a second reading. This is the copy
   * that matters most — the person reading it may be doing so without glasses,
   * at speed, deciding whether to swallow something.
   */
  elderly: {
    today: string;
    /** "{taken} of {total} taken" — both Western numerals. */
    progress: string;
    viewingOnly: string;
    saving: string;
    taken: string;
    skip: string;
    allDone: string;
    nothingLeft: string;
    nothingRightNow: string;
    /** "Next: {name} at {time}" — {name} is the medicine, VERBATIM. */
    next: string;
    noneToday: string;
    laterToday: string;
    /** "{name} not taken" — {name} VERBATIM. */
    notTaken: string;
    open: string;
    notSavedTitle: string;
    notSavedBody: string;
  };
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
  units: {
    TABLET: { one: 'tablet', other: 'tablets' },
    CAPSULE: { one: 'capsule', other: 'capsules' },
    ML: { one: 'milliliter', other: 'milliliters' },
    DROP: { one: 'drop', other: 'drops' },
    APPLICATION: { one: 'application', other: 'applications' },
    TEASPOON: { one: 'teaspoon', other: 'teaspoons' },
    UNIT: { one: 'unit', other: 'units' },
    PATCH: { one: 'patch', other: 'patches' },
    INHALATION: { one: 'inhalation', other: 'inhalations' },
    OTHER: { one: 'dose', other: 'doses' },
  },
  dose: {
    amount: '{amount} {unit}',
  },
  elderly: {
    today: 'Today',
    progress: '{taken} of {total} taken',
    viewingOnly: 'You are viewing only.',
    saving: 'Saving…',
    taken: 'Taken',
    skip: 'Skip',
    allDone: 'All done for today',
    nothingLeft: 'Nothing left to take.',
    nothingRightNow: 'Nothing right now',
    next: 'Next: {name} at {time}',
    noneToday: 'No medicines scheduled today.',
    laterToday: 'Later today',
    notTaken: '{name} not taken',
    open: 'Open',
    notSavedTitle: 'Not saved',
    notSavedBody: 'Please try again.',
  },
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
