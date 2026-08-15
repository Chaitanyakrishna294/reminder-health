import type { Messages } from './en';

/** ಕನ್ನಡ — Kannada. */
const kn: Messages = {
  units: {
    TABLET: { one: 'ಮಾತ್ರೆ', other: 'ಮಾತ್ರೆಗಳು' },
    CAPSULE: { one: 'ಕ್ಯಾಪ್ಸೂಲ್', other: 'ಕ್ಯಾಪ್ಸೂಲ್‌ಗಳು' },
    ML: { one: 'ಮಿಲಿಲೀಟರ್', other: 'ಮಿಲಿಲೀಟರ್' },
    DROP: { one: 'ಹನಿ', other: 'ಹನಿಗಳು' },
    APPLICATION: { one: 'ಲೇಪನ', other: 'ಲೇಪನಗಳು' },
    TEASPOON: { one: 'ಚಮಚ', other: 'ಚಮಚಗಳು' },
    UNIT: { one: 'ಘಟಕ', other: 'ಘಟಕಗಳು' },
    PATCH: { one: 'ಪ್ಯಾಚ್', other: 'ಪ್ಯಾಚ್‌ಗಳು' },
    INHALATION: { one: 'ಉಸಿರೆಳೆತ', other: 'ಉಸಿರೆಳೆತಗಳು' },
    OTHER: { one: 'ಪ್ರಮಾಣ', other: 'ಪ್ರಮಾಣಗಳು' },
  },
  dose: {
    amount: '{amount} {unit}',
  },
  elderly: {
    today: 'ಇಂದು',
    progress: '{total}ರಲ್ಲಿ {taken} ತೆಗೆದುಕೊಂಡಿದ್ದೀರಿ',
    viewingOnly: 'ನೀವು ನೋಡುತ್ತಿದ್ದೀರಿ ಮಾತ್ರ.',
    saving: 'ಉಳಿಸಲಾಗುತ್ತಿದೆ…',
    taken: 'ತೆಗೆದುಕೊಂಡೆ',
    skip: 'ಬಿಟ್ಟುಬಿಡಿ',
    allDone: 'ಇಂದಿಗೆ ಎಲ್ಲಾ ಮುಗಿಯಿತು',
    nothingLeft: 'ಇನ್ನು ತೆಗೆದುಕೊಳ್ಳಲು ಏನೂ ಇಲ್ಲ.',
    nothingRightNow: 'ಈಗ ಏನೂ ಇಲ್ಲ',
    next: 'ಮುಂದಿನದು: {name}, {time}ಕ್ಕೆ',
    noneToday: 'ಇಂದು ಯಾವುದೇ ಔಷಧಿ ನಿಗದಿಯಾಗಿಲ್ಲ.',
    laterToday: 'ಇಂದು ನಂತರ',
    notTaken: '{name} ತೆಗೆದುಕೊಂಡಿಲ್ಲ',
    open: 'ತೆರೆಯಿರಿ',
    notSavedTitle: 'ಉಳಿಸಲಾಗಿಲ್ಲ',
    notSavedBody: 'ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  },
  greeting: {
    morning: 'ಶುಭೋದಯ',
    afternoon: 'ಶುಭ ಮಧ್ಯಾಹ್ನ',
    evening: 'ಶುಭ ಸಂಜೆ',
    night: 'ಶುಭ ರಾತ್ರಿ',
  },
  nav: {
    dashboard: 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
    dashboardShort: 'ಇಂದು',
    careCircle: 'ಆರೈಕೆ ಬಳಗ',
    careCircleShort: 'ಆರೈಕೆ',
    medications: 'ಔಷಧಿಗಳು',
    medicationsShort: 'ಔಷಧಿ',
    medicationsElderly: 'ಔಷಧಿಗಳು',
    healthVault: 'ಆರೋಗ್ಯ ಕಣಜ',
    healthVaultShort: 'ಕಣಜ',
    settings: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
    settingsShort: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
  },
  settings: {
    title: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
    groupCare: 'ಆರೈಕೆ',
    groupAbout: 'ಆ್ಯಪ್ ಬಗ್ಗೆ',
    account: 'ಖಾತೆ',
    notifications: 'ಅಧಿಸೂಚನೆಗಳು',
    notificationStyle: 'ಅಧಿಸೂಚನೆ ಶೈಲಿ',
    display: 'ನೋಟ',
    water: 'ನೀರು',
    connections: 'ಸಂಪರ್ಕಗಳು',
    careCircle: 'ಆರೈಕೆ ಬಳಗ',
    setupGuide: 'ಸೆಟಪ್ ಮಾರ್ಗದರ್ಶಿ',
    language: 'ಭಾಷೆ',
    help: 'ಸಹಾಯ ಮತ್ತು ಬೆಂಬಲ',
    legal: 'ಗೌಪ್ಯತೆ ಮತ್ತು ನಿಯಮಗಳು',
    logOut: 'ಲಾಗ್ ಔಟ್',
    loggingOut: 'ಲಾಗ್ ಔಟ್ ಆಗುತ್ತಿದೆ…',
    logOutConfirm:
      'ಲಾಗ್ ಔಟ್ ಮಾಡಬೇಕೇ?\n\nನೀವು ಮತ್ತೆ ಸೈನ್ ಇನ್ ಮಾಡುವವರೆಗೆ ಈ ಫೋನ್‌ನಲ್ಲಿ ಜ್ಞಾಪನೆಗಳು ನಿಲ್ಲುತ್ತವೆ.',
  },
  language: {
    title: 'ಭಾಷೆ',
    scopeNote:
      'ಇದು ಮೆನುಗಳು, ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಪರದೆಗಳು, ಮತ್ತು ಗೌಪ್ಯತೆ, ನಿಯಮಗಳು ಹಾಗೂ ವೈದ್ಯಕೀಯ ಹಕ್ಕುತ್ಯಾಗ ಪುಟಗಳನ್ನು ಬದಲಾಯಿಸುತ್ತದೆ. ಔಷಧಿಗಳ ಹೆಸರುಗಳು ನೀವು ಟೈಪ್ ಮಾಡಿದಂತೆಯೇ ಇರುತ್ತವೆ.',
    alarmNote:
      'ನಿಮ್ಮ ಫೋನ್‌ನ ಅಲಾರಂ ಪರದೆ ಇನ್ನೂ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿದೆ. ನಾವು ಅದರ ಮೇಲೆ ಕೆಲಸ ಮಾಡುತ್ತಿದ್ದೇವೆ.',
    selected: 'ಆಯ್ಕೆಯಾಗಿದೆ',
  },
  legal: {
    title: 'ಗೌಪ್ಯತೆ ಮತ್ತು ನಿಯಮಗಳು',
    privacy: 'ಗೌಪ್ಯತಾ ನೀತಿ',
    terms: 'ಸೇವಾ ನಿಯಮಗಳು',
    disclaimer: 'ವೈದ್ಯಕೀಯ ಹಕ್ಕುತ್ಯಾಗ',
    lastUpdated: 'ಕೊನೆಯ ಬದಲಾವಣೆ',
    translationNotice:
      'ಇದು ಒಂದು ಅನುವಾದ, ನಿಮ್ಮ ಸ್ವಂತ ಭಾಷೆಯಲ್ಲಿ ಓದಲು ಸಹಾಯವಾಗಲಿ ಎಂದು ನೀಡಲಾಗಿದೆ. ಇಲ್ಲಿ ಏನಾದರೂ ಇಂಗ್ಲಿಷ್ ಆವೃತ್ತಿಗಿಂತ ಭಿನ್ನವಾಗಿದ್ದರೆ, ಇಂಗ್ಲಿಷ್ ಆವೃತ್ತಿಯೇ ಅನ್ವಯಿಸುತ್ತದೆ.',
    readInEnglish: 'ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಓದಿ',
    backToSignIn: 'ಸೈನ್ ಇನ್‌ಗೆ ಹಿಂತಿರುಗಿ',
  },
};

export default kn;
