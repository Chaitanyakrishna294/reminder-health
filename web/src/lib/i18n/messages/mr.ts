import type { Messages } from './en';

/** मराठी — Marathi. Devanagari, same script as Hindi but a different language. */
const mr: Messages = {
  greeting: {
    morning: 'सुप्रभात',
    afternoon: 'शुभ दुपार',
    evening: 'शुभ संध्याकाळ',
    night: 'शुभ रात्री',
  },
  nav: {
    dashboard: 'डॅशबोर्ड',
    dashboardShort: 'आज',
    careCircle: 'काळजी मंडळ',
    careCircleShort: 'काळजी',
    medications: 'औषधे',
    medicationsShort: 'औषध',
    medicationsElderly: 'औषधे',
    healthVault: 'आरोग्य कोश',
    healthVaultShort: 'कोश',
    settings: 'सेटिंग्ज',
    settingsShort: 'सेटिंग्ज',
  },
  settings: {
    title: 'सेटिंग्ज',
    groupCare: 'काळजी',
    groupAbout: 'अ‍ॅपविषयी',
    account: 'खाते',
    notifications: 'सूचना',
    notificationStyle: 'सूचना शैली',
    display: 'स्वरूप',
    water: 'पाणी',
    connections: 'जोडण्या',
    careCircle: 'काळजी मंडळ',
    setupGuide: 'सेटअप मार्गदर्शक',
    language: 'भाषा',
    help: 'मदत आणि सहाय्य',
    legal: 'गोपनीयता आणि अटी',
    logOut: 'लॉग आउट',
    loggingOut: 'लॉग आउट होत आहे…',
    logOutConfirm:
      'लॉग आउट करायचे?\n\nतुम्ही पुन्हा साइन इन करेपर्यंत या फोनवरील स्मरणपत्रे थांबतील.',
  },
  language: {
    title: 'भाषा',
    scopeNote:
      'यामुळे मेनू, सेटिंग्जच्या स्क्रीन, आणि गोपनीयता, अटी व वैद्यकीय अस्वीकरण ही पाने बदलतात. औषधांची नावे तुम्ही टाइप केल्याप्रमाणेच राहतील.',
    alarmNote: 'तुमच्या फोनवरील अलार्म स्क्रीन अजूनही इंग्रजीत आहे. आम्ही त्यावर काम करत आहोत.',
    selected: 'निवडले',
  },
  legal: {
    title: 'गोपनीयता आणि अटी',
    privacy: 'गोपनीयता धोरण',
    terms: 'सेवा अटी',
    disclaimer: 'वैद्यकीय अस्वीकरण',
    lastUpdated: 'शेवटचा बदल',
    translationNotice:
      'हे एक भाषांतर आहे, तुमच्या स्वतःच्या भाषेत वाचण्यास मदत व्हावी म्हणून दिले आहे. येथे काहीही इंग्रजी आवृत्तीपेक्षा वेगळे असल्यास, इंग्रजी आवृत्तीच लागू होईल.',
    readInEnglish: 'इंग्रजीत वाचा',
    backToSignIn: 'साइन इनवर परत जा',
  },
};

export default mr;
