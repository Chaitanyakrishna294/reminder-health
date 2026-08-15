import type { Messages } from './en';

/** മലയാളം — Malayalam. */
const ml: Messages = {
  units: {
    TABLET: { one: 'ഗുളിക', other: 'ഗുളികകൾ' },
    CAPSULE: { one: 'ക്യാപ്സ്യൂൾ', other: 'ക്യാപ്സ്യൂളുകൾ' },
    ML: { one: 'മില്ലിലിറ്റർ', other: 'മില്ലിലിറ്റർ' },
    DROP: { one: 'തുള്ളി', other: 'തുള്ളികൾ' },
    APPLICATION: { one: 'പുരട്ടൽ', other: 'പുരട്ടലുകൾ' },
    TEASPOON: { one: 'ടീസ്പൂൺ', other: 'ടീസ്പൂണുകൾ' },
    UNIT: { one: 'യൂണിറ്റ്', other: 'യൂണിറ്റുകൾ' },
    PATCH: { one: 'പാച്ച്', other: 'പാച്ചുകൾ' },
    INHALATION: { one: 'ശ്വസനം', other: 'ശ്വസനങ്ങൾ' },
    OTHER: { one: 'അളവ്', other: 'അളവുകൾ' },
  },
  dose: {
    amount: '{amount} {unit}',
  },
  elderly: {
    today: 'ഇന്ന്',
    progress: '{total}ൽ {taken} കഴിച്ചു',
    viewingOnly: 'നിങ്ങൾക്ക് കാണാൻ മാത്രമേ കഴിയൂ.',
    saving: 'സേവ് ചെയ്യുന്നു…',
    taken: 'കഴിച്ചു',
    skip: 'ഒഴിവാക്കുക',
    allDone: 'ഇന്നത്തേക്ക് എല്ലാം കഴിഞ്ഞു',
    nothingLeft: 'ഇനി കഴിക്കാൻ ഒന്നുമില്ല.',
    nothingRightNow: 'ഇപ്പോൾ ഒന്നുമില്ല',
    next: 'അടുത്തത്: {name}, {time}ന്',
    noneToday: 'ഇന്ന് മരുന്നൊന്നും നിശ്ചയിച്ചിട്ടില്ല.',
    laterToday: 'ഇന്ന് പിന്നീട്',
    notTaken: '{name} കഴിച്ചിട്ടില്ല',
    open: 'തുറക്കുക',
    notSavedTitle: 'സേവ് ചെയ്തില്ല',
    notSavedBody: 'ദയവായി വീണ്ടും ശ്രമിക്കുക.',
  },
  greeting: {
    morning: 'സുപ്രഭാതം',
    afternoon: 'ശുഭ ഉച്ച',
    evening: 'ശുഭ സന്ധ്യ',
    night: 'ശുഭ രാത്രി',
  },
  nav: {
    dashboard: 'ഡാഷ്‌ബോർഡ്',
    dashboardShort: 'ഇന്ന്',
    careCircle: 'പരിചരണ വലയം',
    careCircleShort: 'പരിചരണം',
    medications: 'മരുന്നുകൾ',
    medicationsShort: 'മരുന്ന്',
    medicationsElderly: 'മരുന്നുകൾ',
    healthVault: 'ആരോഗ്യ ശേഖരം',
    healthVaultShort: 'ശേഖരം',
    settings: 'ക്രമീകരണങ്ങൾ',
    settingsShort: 'ക്രമീകരണങ്ങൾ',
  },
  settings: {
    title: 'ക്രമീകരണങ്ങൾ',
    groupCare: 'പരിചരണം',
    groupAbout: 'ആപ്പിനെക്കുറിച്ച്',
    account: 'അക്കൗണ്ട്',
    notifications: 'അറിയിപ്പുകൾ',
    notificationStyle: 'അറിയിപ്പ് ശൈലി',
    display: 'കാഴ്ച',
    water: 'വെള്ളം',
    connections: 'കണക്ഷനുകൾ',
    careCircle: 'പരിചരണ വലയം',
    setupGuide: 'സജ്ജീകരണ ഗൈഡ്',
    language: 'ഭാഷ',
    help: 'സഹായവും പിന്തുണയും',
    legal: 'സ്വകാര്യതയും നിബന്ധനകളും',
    logOut: 'ലോഗ് ഔട്ട്',
    loggingOut: 'ലോഗ് ഔട്ട് ചെയ്യുന്നു…',
    logOutConfirm:
      'ലോഗ് ഔട്ട് ചെയ്യണോ?\n\nനിങ്ങൾ വീണ്ടും സൈൻ ഇൻ ചെയ്യുന്നതുവരെ ഈ ഫോണിലെ ഓർമ്മപ്പെടുത്തലുകൾ നിലയ്ക്കും.',
  },
  language: {
    title: 'ഭാഷ',
    scopeNote:
      'ഇത് മെനുകൾ, ക്രമീകരണ സ്ക്രീനുകൾ, കൂടാതെ സ്വകാര്യത, നിബന്ധനകൾ, വൈദ്യശാസ്ത്ര നിരാകരണം എന്നീ പേജുകൾ മാറ്റുന്നു. മരുന്നുകളുടെ പേരുകൾ നിങ്ങൾ ടൈപ്പ് ചെയ്തതുപോലെ തന്നെ നിലനിൽക്കും.',
    alarmNote:
      'നിങ്ങളുടെ ഫോണിലെ അലാറം സ്ക്രീൻ ഇപ്പോഴും ഇംഗ്ലീഷിലാണ്. ഞങ്ങൾ അതിൽ പ്രവർത്തിക്കുന്നു.',
    selected: 'തിരഞ്ഞെടുത്തു',
  },
  legal: {
    title: 'സ്വകാര്യതയും നിബന്ധനകളും',
    privacy: 'സ്വകാര്യതാ നയം',
    terms: 'സേവന നിബന്ധനകൾ',
    disclaimer: 'വൈദ്യശാസ്ത്ര നിരാകരണം',
    lastUpdated: 'അവസാന മാറ്റം',
    translationNotice:
      'ഇത് ഒരു വിവർത്തനമാണ്, നിങ്ങളുടെ സ്വന്തം ഭാഷയിൽ വായിക്കാൻ സഹായിക്കുന്നതിനായി നൽകിയിരിക്കുന്നു. ഇവിടെ എന്തെങ്കിലും ഇംഗ്ലീഷ് പതിപ്പിൽ നിന്ന് വ്യത്യസ്തമാണെങ്കിൽ, ഇംഗ്ലീഷ് പതിപ്പാണ് ബാധകമാകുക.',
    readInEnglish: 'ഇംഗ്ലീഷിൽ വായിക്കുക',
    backToSignIn: 'സൈൻ ഇന്നിലേക്ക് മടങ്ങുക',
  },
};

export default ml;
