import type { Messages } from './en';

/** தமிழ் — Tamil. */
const ta: Messages = {
  units: {
    TABLET: { one: 'மாத்திரை', other: 'மாத்திரைகள்' },
    CAPSULE: { one: 'காப்சூல்', other: 'காப்சூல்கள்' },
    ML: { one: 'மில்லிலிட்டர்', other: 'மில்லிலிட்டர்' },
    DROP: { one: 'சொட்டு', other: 'சொட்டுகள்' },
    APPLICATION: { one: 'பூச்சு', other: 'பூச்சுகள்' },
    TEASPOON: { one: 'தேக்கரண்டி', other: 'தேக்கரண்டிகள்' },
    UNIT: { one: 'அலகு', other: 'அலகுகள்' },
    PATCH: { one: 'பேட்ச்', other: 'பேட்ச்கள்' },
    INHALATION: { one: 'உள்ளிழுப்பு', other: 'உள்ளிழுப்புகள்' },
    OTHER: { one: 'அளவு', other: 'அளவுகள்' },
  },
  dose: {
    amount: '{amount} {unit}',
  },
  elderly: {
    today: 'இன்று',
    progress: '{total}ல் {taken} எடுத்தாகிவிட்டது',
    viewingOnly: 'நீங்கள் பார்க்க மட்டுமே முடியும்.',
    saving: 'சேமிக்கிறது…',
    taken: 'எடுத்துவிட்டேன்',
    skip: 'தவிர்',
    allDone: 'இன்றைக்கு எல்லாம் முடிந்தது',
    nothingLeft: 'இனி எடுக்க எதுவும் இல்லை.',
    nothingRightNow: 'இப்போது எதுவும் இல்லை',
    next: 'அடுத்தது: {name}, {time} மணிக்கு',
    noneToday: 'இன்று மருந்து எதுவும் திட்டமிடப்படவில்லை.',
    laterToday: 'இன்று பின்னர்',
    notTaken: '{name} எடுக்கப்படவில்லை',
    open: 'திற',
    notSavedTitle: 'சேமிக்கப்படவில்லை',
    notSavedBody: 'மீண்டும் முயற்சிக்கவும்.',
  },
  greeting: {
    morning: 'காலை வணக்கம்',
    afternoon: 'மதிய வணக்கம்',
    evening: 'மாலை வணக்கம்',
    night: 'இனிய இரவு',
  },
  nav: {
    dashboard: 'டாஷ்போர்டு',
    dashboardShort: 'இன்று',
    careCircle: 'பராமரிப்பு வட்டம்',
    careCircleShort: 'பராமரிப்பு',
    medications: 'மருந்துகள்',
    medicationsShort: 'மருந்து',
    medicationsElderly: 'மருந்துகள்',
    healthVault: 'சுகாதாரப் பெட்டகம்',
    healthVaultShort: 'பெட்டகம்',
    settings: 'அமைப்புகள்',
    settingsShort: 'அமைப்புகள்',
  },
  settings: {
    title: 'அமைப்புகள்',
    groupCare: 'பராமரிப்பு',
    groupAbout: 'செயலி பற்றி',
    account: 'கணக்கு',
    notifications: 'அறிவிப்புகள்',
    notificationStyle: 'அறிவிப்பு பாணி',
    display: 'தோற்றம்',
    water: 'தண்ணீர்',
    connections: 'இணைப்புகள்',
    careCircle: 'பராமரிப்பு வட்டம்',
    setupGuide: 'அமைவு வழிகாட்டி',
    language: 'மொழி',
    help: 'உதவி & ஆதரவு',
    legal: 'தனியுரிமை & விதிமுறைகள்',
    logOut: 'வெளியேறு',
    loggingOut: 'வெளியேறுகிறது…',
    logOutConfirm:
      'வெளியேற வேண்டுமா?\n\nநீங்கள் மீண்டும் உள்நுழையும் வரை இந்த ஃபோனில் நினைவூட்டல்கள் நிற்கும்.',
  },
  language: {
    title: 'மொழி',
    scopeNote:
      'இது மெனுக்கள், அமைப்புத் திரைகள், மற்றும் தனியுரிமை, விதிமுறைகள், மருத்துவ மறுப்பு பக்கங்களை மாற்றுகிறது. மருந்துப் பெயர்கள் நீங்கள் தட்டச்சு செய்தபடியே இருக்கும்.',
    alarmNote:
      'உங்கள் ஃபோனின் அலாரத் திரை இன்னும் ஆங்கிலத்தில் உள்ளது. நாங்கள் அதில் வேலை செய்கிறோம்.',
    selected: 'தேர்ந்தெடுக்கப்பட்டது',
  },
  legal: {
    title: 'தனியுரிமை & விதிமுறைகள்',
    privacy: 'தனியுரிமைக் கொள்கை',
    terms: 'சேவை விதிமுறைகள்',
    disclaimer: 'மருத்துவ மறுப்பு',
    lastUpdated: 'கடைசி புதுப்பிப்பு',
    translationNotice:
      'இது ஒரு மொழிபெயர்ப்பு, உங்கள் சொந்த மொழியில் படிக்க உதவும் வகையில் வழங்கப்பட்டுள்ளது. இங்கு ஏதேனும் ஆங்கிலப் பதிப்பிலிருந்து வேறுபட்டால், ஆங்கிலப் பதிப்பே பொருந்தும்.',
    readInEnglish: 'ஆங்கிலத்தில் படிக்கவும்',
    backToSignIn: 'உள்நுழைவுக்குத் திரும்பு',
  },
};

export default ta;
