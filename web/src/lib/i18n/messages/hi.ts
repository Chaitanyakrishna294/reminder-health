import type { Messages } from './en';

/** हिन्दी — Hindi. Devanagari. */
const hi: Messages = {
  greeting: {
    morning: 'सुप्रभात',
    afternoon: 'शुभ दोपहर',
    evening: 'शुभ संध्या',
    night: 'शुभ रात्रि',
  },
  nav: {
    dashboard: 'डैशबोर्ड',
    dashboardShort: 'आज',
    careCircle: 'देखभाल मंडल',
    careCircleShort: 'देखभाल',
    medications: 'दवाइयाँ',
    medicationsShort: 'दवाई',
    medicationsElderly: 'दवाइयाँ',
    healthVault: 'स्वास्थ्य तिजोरी',
    healthVaultShort: 'तिजोरी',
    settings: 'सेटिंग्स',
    settingsShort: 'सेटिंग्स',
  },
  settings: {
    title: 'सेटिंग्स',
    groupCare: 'देखभाल',
    groupAbout: 'ऐप के बारे में',
    account: 'खाता',
    notifications: 'सूचनाएँ',
    notificationStyle: 'सूचना की शैली',
    display: 'दिखावट',
    water: 'पानी',
    connections: 'कनेक्शन',
    careCircle: 'देखभाल मंडल',
    setupGuide: 'सेटअप गाइड',
    language: 'भाषा',
    help: 'मदद और सहायता',
    legal: 'गोपनीयता और शर्तें',
    logOut: 'लॉग आउट',
    loggingOut: 'लॉग आउट हो रहा है…',
    logOutConfirm:
      'लॉग आउट करें?\n\nजब तक आप दोबारा साइन इन नहीं करते, इस फ़ोन पर रिमाइंडर बंद रहेंगे।',
  },
  language: {
    title: 'भाषा',
    scopeNote:
      'इससे मेन्यू, सेटिंग्स की स्क्रीन, और गोपनीयता, शर्तें व चिकित्सा अस्वीकरण के पन्ने बदलते हैं। दवाइयों के नाम वैसे ही रहेंगे जैसे आपने लिखे हैं।',
    alarmNote: 'आपके फ़ोन की अलार्म स्क्रीन अभी अंग्रेज़ी में ही है। हम उस पर काम कर रहे हैं।',
    selected: 'चुनी गई',
  },
  legal: {
    title: 'गोपनीयता और शर्तें',
    privacy: 'गोपनीयता नीति',
    terms: 'सेवा की शर्तें',
    disclaimer: 'चिकित्सा अस्वीकरण',
    lastUpdated: 'आख़िरी बदलाव',
    translationNotice:
      'यह एक अनुवाद है, जो आपकी अपनी भाषा में पढ़ने में मदद के लिए दिया गया है। अगर यहाँ कुछ भी अंग्रेज़ी संस्करण से अलग है, तो अंग्रेज़ी संस्करण ही लागू होगा।',
    readInEnglish: 'अंग्रेज़ी में पढ़ें',
    backToSignIn: 'साइन इन पर वापस जाएँ',
  },
};

export default hi;
