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
  /**
   * HEALTH VAULT. Two things in here are deliberately NOT translated, and both
   * would be bugs if they were:
   *
   * · `confirmToken` is 'DELETE', compared literally by handlePermanentDelete
   *   (`.toUpperCase() !== 'DELETE'`). Translating the instruction while the code
   *   still demands the English word would make permanent delete impossible in six
   *   languages — the user types the word the screen asked for and nothing happens.
   *   So the token stays Latin and the sentence around it carries it as a slot,
   *   which keeps the screen and the check in agreement everywhere.
   *
   * · `formats` (PDF, JPG…) and the "20 MB" in `maxSize` are machine tokens and a
   *   unit symbol. They are slots, not words.
   */
  vault: {
    folders: string;
    recentDocuments: string;
    loading: string;
    privateNotice: string;
    backToFolders: string;
    sharedReadOnly: string;
    trashFolder: string;
    searchPlaceholder: string;
    uploadDocument: string;
    needsAccount: string;
    // Row actions
    preview: string;
    download: string;
    edit: string;
    delete: string;
    restore: string;
    purgeForever: string;
    open: string;
    openPdf: string;
    tapToViewPdf: string;
    previewUnavailable: string;
    closePreview: string;
    loadMore: string;
    loadingMore: string;
    // Edit dialog
    editTitle: string;
    editSubtitle: string;
    fieldTitle: string;
    fieldDate: string;
    fieldCategory: string;
    saveChanges: string;
    // Permanent delete dialog
    irreversible: string;
    /** "Please type {token} below to confirm:" — {token} is the literal word. */
    typeToConfirm: string;
    /** "Type {token} here..." */
    confirmPlaceholder: string;
    confirmDeleteTitle: string;
    canYouReadIt: string;
    confirmToken: string;
    deleteForever: string;
    // Upload wizard
    step1: string;
    step2: string;
    step3: string;
    step4: string;
    takePhoto: string;
    chooseFile: string;
    photoAlt: string;
    retake: string;
    chooseAnother: string;
    /** "Supported formats: {formats}." */
    formats: string;
    /** "Maximum file size: {size}." */
    maxSize: string;
    titlePlaceholder: string;
    summaryTitle: string;
    labelCategory: string;
    labelTitle: string;
    labelDate: string;
    labelFileName: string;
    labelFileSize: string;
    back: string;
    next: string;
    saving: string;
    uploadAndSave: string;
    // Errors + confirmations. Plain, no blame, no error codes on screen.
    errTimeline: string;
    errDownloadLink: string;
    errPreview: string;
    confirmTrash: string;
    errDelete: string;
    errRestore: string;
    errTypeDelete: string;
    errPermanentDelete: string;
    errTitleRequired: string;
    errDateRequired: string;
    errCategoryRequired: string;
    errSaveChanges: string;
    errSessionExpired: string;
    errSelectFile: string;
    errValidFolder: string;
    /** "Could not save. {detail}" — {detail} is a raw provider message, English. */
    errDatabase: string;
    errChooseFileFirst: string;
    errTitleForRecord: string;
  };
  /**
   * MEDICAL PROFILE. The placeholders here are hints WE wrote, so they translate —
   * with two deliberate exceptions, because "example" and "safe to translate" are
   * not the same question:
   *
   * · `drugAllergiesPlaceholder` keeps its drug names in Latin ("Penicillin,
   *   Aspirin"). Transliterating them would look helpful and teach the user to
   *   type a spelling that matches nothing on the box, nothing in the medication
   *   catalog, and nothing a pharmacist reads. Same rule as medicine names
   *   everywhere else in this app — see lib/i18n/format.ts.
   * · `timeZonePlaceholder` is an IANA identifier. A machine token, not a word.
   *
   * Foods and conditions DO translate: they are free text nobody matches against
   * a catalog, and "peanuts" is genuinely more useful to a Hindi reader as
   * मूंगफली.
   */
  profile: {
    title: string;
    subtitle: string;
    saved: string;
    sectionPersonal: string;
    sectionIdentity: string;
    sectionHealth: string;
    sectionEmergency: string;
    sectionPreferences: string;
    photoAlt: string;
    fullName: string;
    email: string;
    dob: string;
    gender: string;
    selectPlaceholder: string;
    bloodGroup: string;
    heightCm: string;
    weightKg: string;
    bmiAuto: string;
    separateWithCommas: string;
    drugAllergies: string;
    /** Latin drug names on purpose — see the note above. */
    drugAllergiesPlaceholder: string;
    foodAllergies: string;
    foodAllergiesPlaceholder: string;
    otherAllergies: string;
    otherAllergiesPlaceholder: string;
    chronicConditions: string;
    chronicConditionsPlaceholder: string;
    emergencyContact: string;
    emergencyContactPlaceholder: string;
    emergencyPhone: string;
    relationship: string;
    relationshipPlaceholder: string;
    primaryLanguage: string;
    reminderLanguage: string;
    languagePlaceholder: string;
    timeZone: string;
    /** IANA identifier. Not translated. */
    timeZonePlaceholder: string;
    errImageFile: string;
    errPhotoSize: string;
    errValues: string;
    /**
     * Gender and blood-group options render as `<option value={x}>{x}</option>` —
     * the STORED VALUE and the visible label are the same string today, and
     * `blood_group` is a zod enum validated against the English spellings. So the
     * label translates and the value must not, exactly like `units`. A+/O- are
     * international medical codes and never translate; only UNKNOWN is a word.
     */
    genderMale: string;
    genderFemale: string;
    genderOther: string;
    genderPreferNotToSay: string;
    bloodUnknown: string;
  };
  /**
   * THE DASHBOARD — banners, the first-run guide, the caregiver monitor header,
   * and the inventory column.
   *
   * `iosInstruction` names two iOS system labels ("Share", "Add to Home Screen").
   * Those appear in whatever language THE PHONE is set to, which we cannot know
   * from here, so naming them in the app's language can be wrong either way. The
   * sentence therefore leans on the icon description — a box with an arrow
   * pointing up — which is the same on every iPhone regardless of language, and
   * translates the rest normally.
   */
  dashboard: {
    enableNotifications: string;
    dismissBanner: string;
    iosTitle: string;
    iosInstruction: string;
    welcomeTitle: string;
    dismissGuide: string;
    guideMedsTitle: string;
    guideMedsBody: string;
    guideInviteTitle: string;
    guideInviteBody: string;
    guideCaregiverTitle: string;
    guideCaregiverBody: string;
    guideSkipTitle: string;
    guideSkipBody: string;
    photoAlt: string;
    statusIntervention: string;
    statusMissed: string;
    statusOnTrack: string;
    patientName: string;
    complianceRate: string;
    lastTakenDose: string;
    nextDose: string;
    alertStatus: string;
    compliance: string;
    dailyCycle: string;
    noSchedule: string;
    careCircle: string;
    inventoryTitle: string;
    inventorySubtitle: string;
    refillFor: string;
    unitsToAdd: string;
    inventoryBalanced: string;
    inventoryBalancedBody: string;
  };
  /**
   * CARE CIRCLE — the sharing controls and the consent log.
   *
   * The relationship options here are SAFE to translate, unlike gender in
   * `profile`: they already render as `<option value="SON">Son</option>`, so the
   * stored code and the visible label are separate fields. Worth noting the
   * contrast — the same-looking list was a trap in one file and is not in this one,
   * and the difference is one attribute.
   *
   * The consent-log lines carry a PERSON'S NAME. Same rule as medicine names: the
   * frame translates, `{name}` is substituted verbatim.
   */
  care: {
    trustGranted: string;
    trustGrantedBody: string;
    coordinatorUpdated: string;
    coordinatorUpdatedBody: string;
    accessRevoked: string;
    accessRevokedBody: string;
    trustUpdated: string;
    backToCareCircle: string;
    trustCenter: string;
    inControl1: string;
    inControl2: string;
    peopleSupportingMe: string;
    noCaregivers: string;
    promoteCoordinator: string;
    revokeAccess: string;
    accessLevel: string;
    permMedSchedule: string;
    permMissedAlerts: string;
    permComplianceReports: string;
    permVaultDocs: string;
    permModifySchedules: string;
    peopleISupport: string;
    noPatients: string;
    consentHistory: string;
    noConsentHistory: string;
    adjustPresets: string;
    relationshipType: string;
    relSon: string;
    relDaughter: string;
    relSpouse: string;
    relParent: string;
    relSibling: string;
    relFriend: string;
    relDoctor: string;
    relOther: string;
    accessPresets: string;
    granularToggles: string;
  };
  /**
   * THE MEDICATION FORM — shared by the add wizard and the edit form, which asked
   * the same ~24 questions in the same words. One set of keys rather than two
   * near-identical ones: they were already meant to agree, and two copies is how
   * they stop agreeing.
   *
   * The two files' placeholder examples differed slightly ("e.g., Paracetamol" vs
   * "e.g., Paracetamol, Atorvastatin"). Unified on the fuller version — a
   * difference nobody chose is not a difference worth preserving in seven
   * languages.
   *
   * `namePlaceholder` and `strengthPlaceholder` keep their DRUG NAMES and UNIT
   * SYMBOLS in Latin ("Paracetamol", "500mg", "0.5%"). Only the "e.g." around them
   * translates. Same reasoning as the allergy placeholders in `profile`: an
   * example that teaches someone to type a transliterated drug name is worse than
   * no example, because that spelling matches nothing on the box or in the catalog.
   */
  medForm: {
    name: string;
    namePlaceholder: string;
    form: string;
    formHint: string;
    selectFrequency: string;
    whichDays: string;
    reminderTimes: string;
    reminderTimesHint: string;
    strength: string;
    optional: string;
    strengthPlaceholder: string;
    dosageAmount: string;
    dosageAmountHint: string;
    trackStock: string;
    trackStockHint: string;
    currentStock: string;
    currentStockPlaceholder: string;
    lowStockThreshold: string;
    lowStockThresholdPlaceholder: string;
    reason: string;
    reasonHint: string;
    reasonPlaceholder: string;
    priorityLevel: string;
    priorityHint: string;
    reviewSchedule: string;
    reviewTimes: string;
    reviewDosage: string;
    reviewInventory: string;
    reviewReason: string;
    reviewPriority: string;
    errNoTimes: string;
    errNoTelegram: string;
    /** The edit page's own header — server-rendered, so it reads the cookie. */
    editPageTitle: string;
    editPageSubtitle: string;
  };
  /** THE SCHEDULE PLANNER — the week grid, its controls, and the dose-record sheet. */
  planner: {
    skipped: string;
    moved: string;
    restoreToUsual: string;
    adjustOrSkip: string;
    schedule: string;
    prevWeek: string;
    nextWeek: string;
    zoomOut: string;
    zoomIn: string;
    resetDay: string;
    clearDay: string;
    /** The "you are here" marker on the timeline. Short by design. */
    now: string;
    critical: string;
    priorityKey: string;
    timeOfDay: string;
    doseRecord: string;
    closeDetails: string;
    outcome: string;
    scheduledFor: string;
    answeredAt: string;
    dose: string;
    linkedMedicine: string;
    reason: string;
    adjustDose: string;
    newTime: string;
    /**
     * Outcome words on a PAST dose — a record of what happened, not a button.
     * They live in a ternary rather than JSX text, which is why the audit's
     * pattern cannot see them; found by reading the file.
     */
    outcomeTaken: string;
    outcomeMissed: string;
  };
  /** A caregiver's read-only view of one patient. SERVER-rendered — cookie path. */
  patient: {
    accessRestricted: string;
    monitoringStatus: string;
    active: string;
    adherence30d: string;
    activeMedications: string;
    missedDosesToday: string;
    routineStability: string;
    milestones: string;
    relation: string;
    role: string;
    longevity: string;
    sharedTrust: string;
    noActiveMeds: string;
    noComplianceLogs: string;
    viewFolder: string;
  };
  /**
   * Linking a Telegram account.
   *
   * `codePlaceholder` ("RMDR-XXXXXX") is a FORMAT, not a word — it shows the shape
   * of the code the bot sends. Translating the letters would describe a code that
   * does not exist. Same class as the DELETE token and the IANA timezone.
   */
  linkAccount: {
    errUnexpected: string;
    errMustSignIn: string;
    errSkipFailed: string;
    verificationConfirmed: string;
    setupGuide: string;
    openTelegramBot: string;
    openTelegramBotHint: string;
    requestPairingCode: string;
    /** "Send {command} to the bot." — {command} is a literal bot command. */
    sendToBot: string;
    enterPairingCode: string;
    enterPairingCodeHint: string;
    quickLink: string;
    verificationCode: string;
    codePlaceholder: string;
    or: string;
  };
  /** Sign-up. The legal links reuse `legal.*` rather than duplicating them. */
  auth: {
    errAgeTerms: string;
    errCaptcha: string;
    errFullCode: string;
    confirmationCode: string;
    fullName: string;
    fullNamePlaceholder: string;
    email: string;
    emailPlaceholder: string;
    password: string;
    passwordPlaceholder: string;
    alreadyHaveAccount: string;
    // -- sign in --
    createAccount: string;
    newHere: string;
    loginPasswordPlaceholder: string;
    errEmailForCode: string;
    /**
     * "No account found… Tap {label} below to sign up first."
     * {label} is `createAccount` — a slot rather than a repeated literal, so the
     * sentence and the button it points at cannot drift apart in seven languages.
     */
    errNoAccount: string;
    errTooManyEmail: string;
    // -- forgot / reset password --
    errEmailForReset: string;
    errTooManyRequests: string;
    errCaptchaFailed: string;
    resetCode: string;
    // -- set a new password --
    errPasswordTooShort: string;
    errPasswordMismatch: string;
    newPassword: string;
    newPasswordPlaceholder: string;
    confirmNewPassword: string;
    confirmNewPasswordPlaceholder: string;
    // -- guest → saved account --
    /**
     * Login's headline copy. NONE of these were visible to the audit — they live
     * in ternaries and template literals, which no `>text<` pattern can reach.
     * Found by reading the file, like the planner's outcome words.
     */
    welcomeBack: string;
    checkYourEmail: string;
    signInSubtitle: string;
    /** "We emailed a sign-in code to {email}." — {email} is the user's own address. */
    emailedCodeTo: string;
    /** "A fresh code is on its way to {email}." */
    freshCodeSent: string;
    /** "That code is invalid or expired. Tap {label} for a fresh one." */
    errCodeInvalid: string;
    resendCode: string;
    errEmailRequired: string;
    whyThisMatters: string;
    namePlaceholder: string;
    emailAddress: string;
    enterTheCode: string;
  };
  /** The profile dropdown in the top bar — where the non-tab destinations live. */
  profileMenu: {
    signedInAs: string;
    scheduler: string;
    emergencyCard: string;
    signOut: string;
  };
  /**
   * The medications list screen.
   *
   * `prevWeek`, `nextWeek` and `clearDay` are NOT here — they already exist in
   * `planner` and mean the same thing on both screens. One key per idea; a second
   * copy is a second thing to keep in step across seven languages.
   */
  meds: {
    openPlanner: string;
    addMedication: string;
    searchPlaceholder: string;
    searchAria: string;
    clearSearch: string;
    searchingDirectory: string;
    /** Catalog status, shown after a brand name. Lowercase, prefixed by " · " in code. */
    discontinued: string;
    filterMeds: string;
    addStock: string;
  };
  /** Care-circle requests, both directions. */
  requests: {
    confirmDecline: string;
    confirmWithdraw: string;
    loading: string;
    title: string;
    toSupportYou: string;
    noPending: string;
    confirmShare: string;
    decline: string;
    youveSent: string;
    noSent: string;
    pending: string;
    withdraw: string;
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
  vault: {
    folders: 'Folders',
    recentDocuments: 'Recent documents',
    loading: 'Loading your documents…',
    privateNotice: 'Your records are private',
    backToFolders: 'Back to folders',
    sharedReadOnly: 'Shared through Care Circle. You currently have read-only access.',
    trashFolder: 'Trash',
    searchPlaceholder: 'Search by title or file name…',
    uploadDocument: 'Upload document',
    needsAccount: 'Health Vault needs a saved account',
    preview: 'Preview',
    download: 'Download',
    edit: 'Edit',
    delete: 'Delete',
    restore: 'Restore',
    purgeForever: 'Delete forever',
    open: 'Open',
    openPdf: 'Open PDF',
    tapToViewPdf: 'Tap to view this PDF',
    previewUnavailable: 'Preview not available in the app',
    closePreview: 'Close preview',
    loadMore: 'Load more records',
    loadingMore: 'Loading more…',
    editTitle: 'Edit record details',
    editSubtitle: 'Change the folder or the date on this record.',
    fieldTitle: 'Title',
    fieldDate: 'Record date',
    fieldCategory: 'Folder',
    saveChanges: 'Save changes',
    irreversible:
      'This cannot be undone. The record and the stored file are deleted forever.',
    typeToConfirm: 'Please type {token} below to confirm:',
    confirmPlaceholder: 'Type {token} here…',
    confirmDeleteTitle: 'Delete this record forever?',
    canYouReadIt: 'Can you read it? If not, take it again — nothing is saved yet.',
    confirmToken: 'DELETE',
    deleteForever: 'Delete forever',
    step1: 'Step 1: Folder',
    step2: 'Step 2: File',
    step3: 'Step 3: Details',
    step4: 'Step 4: Save',
    takePhoto: 'Take photo',
    chooseFile: 'Choose file',
    photoAlt: 'The photo you just took',
    retake: 'Retake',
    chooseAnother: 'Choose another',
    formats: 'Supported formats: {formats}.',
    maxSize: 'Maximum file size: {size}.',
    titlePlaceholder: 'e.g. Blood test report',
    summaryTitle: 'Check before saving',
    labelCategory: 'Folder',
    labelTitle: 'Title',
    labelDate: 'Date',
    labelFileName: 'File name',
    labelFileSize: 'File size',
    back: 'Back',
    next: 'Next',
    saving: 'Saving…',
    uploadAndSave: 'Upload and save',
    errTimeline: 'Could not load your records. Please try again.',
    errDownloadLink: 'Could not prepare the download. Please try again.',
    errPreview: 'Could not load the preview. Please try again.',
    confirmTrash: 'Move this record to the Trash?',
    errDelete: 'Could not delete the record. Please try again.',
    errRestore: 'Could not restore the record. Please try again.',
    errTypeDelete: 'Please type {token} to confirm.',
    errPermanentDelete: 'Could not delete the record. Please try again.',
    errTitleRequired: 'Please add a title.',
    errDateRequired: 'Please choose a date.',
    errCategoryRequired: 'Please choose a folder.',
    errSaveChanges: 'Could not save the changes. Please try again.',
    errSessionExpired: 'Your session ended. Please sign in again.',
    errSelectFile: 'Please choose a file.',
    errValidFolder: 'Please choose a folder.',
    errDatabase: 'Could not save. {detail}',
    errChooseFileFirst: 'Please choose a file before continuing.',
    errTitleForRecord: 'Please add a title for this record.',
  },
  profile: {
    title: 'Medical profile',
    subtitle: 'Your medical identity card, used for reminders and emergencies.',
    saved: 'Medical profile saved.',
    sectionPersonal: 'Personal information',
    sectionIdentity: 'Medical identity',
    sectionHealth: 'Health information',
    sectionEmergency: 'Emergency information',
    sectionPreferences: 'Medical preferences',
    photoAlt: 'Profile photo',
    fullName: 'Full name',
    email: 'Email',
    dob: 'Date of birth',
    gender: 'Gender',
    selectPlaceholder: 'Select…',
    bloodGroup: 'Blood group',
    heightCm: 'Height (cm)',
    weightKg: 'Weight (kg)',
    bmiAuto: 'BMI (automatic)',
    separateWithCommas: 'Separate multiple entries with commas.',
    drugAllergies: 'Drug allergies',
    drugAllergiesPlaceholder: 'Penicillin, Aspirin',
    foodAllergies: 'Food allergies',
    foodAllergiesPlaceholder: 'Peanuts, shellfish',
    otherAllergies: 'Other allergies',
    otherAllergiesPlaceholder: 'Latex, pollen',
    chronicConditions: 'Long-term conditions',
    chronicConditionsPlaceholder: 'Diabetes, high blood pressure, asthma',
    emergencyContact: 'Emergency contact',
    emergencyContactPlaceholder: 'Name',
    emergencyPhone: 'Emergency phone',
    relationship: 'Relationship',
    relationshipPlaceholder: 'Spouse, son…',
    primaryLanguage: 'Main language',
    reminderLanguage: 'Preferred reminder language',
    languagePlaceholder: 'English',
    timeZone: 'Time zone',
    timeZonePlaceholder: 'Asia/Kolkata',
    errImageFile: 'Please choose an image file for your photo.',
    errPhotoSize: 'The photo must be under 5 MB.',
    errValues: 'Please check the values entered. Height and weight must be positive numbers.',
    genderMale: 'Male',
    genderFemale: 'Female',
    genderOther: 'Other',
    genderPreferNotToSay: 'Prefer not to say',
    bloodUnknown: 'Unknown',
  },
  dashboard: {
    enableNotifications: 'Turn on browser notifications',
    dismissBanner: 'Dismiss',
    iosTitle: 'Add to Home Screen (iPhone)',
    iosInstruction:
      'Tap the share button — the box with an arrow pointing up — then choose “Add to Home Screen”.',
    welcomeTitle: 'Welcome to Re-MIND-eЯ',
    dismissGuide: 'Close this guide',
    guideMedsTitle: 'Manage my medicines',
    guideMedsBody: 'Add your medicines, set the times, and record what you take.',
    guideInviteTitle: 'Invite someone to help me',
    guideInviteBody: 'Share your code so family can see how you are doing.',
    guideCaregiverTitle: 'Help care for someone else',
    guideCaregiverBody: 'Enter their code to see the doses they have agreed to share.',
    guideSkipTitle: 'Skip for now',
    guideSkipBody: 'Close this guide and look around on your own.',
    photoAlt: 'Profile photo',
    statusIntervention: 'A caregiver needs to step in.',
    statusMissed: 'Some doses were missed.',
    statusOnTrack: 'Today is on track.',
    patientName: 'Name',
    complianceRate: 'Doses taken',
    lastTakenDose: 'Last dose taken',
    nextDose: 'Next dose',
    alertStatus: 'Status',
    compliance: 'Doses taken',
    dailyCycle: "Today's progress",
    noSchedule: 'Nothing scheduled today',
    careCircle: 'Care circle',
    inventoryTitle: 'Medicine stock',
    inventorySubtitle: 'What you have left, and what is running low',
    refillFor: 'Running low:',
    unitsToAdd: 'How many to add',
    inventoryBalanced: 'Stock looks fine',
    inventoryBalancedBody: 'Nothing is running low right now.',
  },
  care: {
    trustGranted: 'Access granted',
    trustGrantedBody: 'You approved the request and shared your care circle with {name}.',
    coordinatorUpdated: 'Main contact changed',
    coordinatorUpdatedBody: '{name} is now your main contact.',
    accessRevoked: 'Access removed',
    accessRevokedBody: 'Access removed for {name}.',
    trustUpdated: 'Access updated',
    backToCareCircle: 'Back to care circle',
    trustCenter: 'Who can help me',
    inControl1: 'You decide who can support you.',
    inControl2: 'You can change or remove access at any time.',
    peopleSupportingMe: 'People supporting me',
    noCaregivers: 'Nobody has access yet',
    promoteCoordinator: 'Make main contact',
    revokeAccess: 'Remove access',
    accessLevel: 'Can see:',
    permMedSchedule: 'My medicine times',
    permMissedAlerts: 'Missed dose alerts',
    permComplianceReports: 'How I am doing',
    permVaultDocs: 'Health vault documents',
    permModifySchedules: 'Change my times',
    peopleISupport: 'People I support',
    noPatients: 'You are not supporting anyone yet',
    consentHistory: 'History of changes',
    noConsentHistory: 'Nothing has changed yet.',
    adjustPresets: 'Choose a preset, or set each permission yourself.',
    relationshipType: 'Relationship',
    relSon: 'Son',
    relDaughter: 'Daughter',
    relSpouse: 'Spouse',
    relParent: 'Parent',
    relSibling: 'Brother or sister',
    relFriend: 'Friend',
    relDoctor: 'Doctor',
    relOther: 'Other',
    accessPresets: 'Presets',
    granularToggles: 'Each permission',
  },
  medForm: {
    name: 'Medicine name',
    namePlaceholder: 'e.g. Paracetamol, Atorvastatin',
    form: 'What form is it?',
    formHint: 'Tablet, syrup, drops, and so on.',
    selectFrequency: 'How often?',
    whichDays: 'Which days?',
    reminderTimes: 'Reminder times',
    reminderTimesHint: 'Set a time for each dose, in 24-hour format.',
    strength: 'Strength',
    optional: '(optional)',
    strengthPlaceholder: 'e.g. 500mg, 10ml, 0.5%',
    dosageAmount: 'How many per dose?',
    dosageAmountHint: 'How many you take each time.',
    trackStock: 'Keep count of what is left',
    trackStockHint: 'Takes one off the count each time you record a dose.',
    currentStock: 'How many do you have now?',
    currentStockPlaceholder: 'e.g. 30',
    lowStockThreshold: 'Warn me when it drops to',
    lowStockThresholdPlaceholder: 'e.g. 4',
    reason: 'What is it for?',
    reasonHint: 'Optional. Helps you tell your medicines apart.',
    reasonPlaceholder: 'e.g. for blood pressure, headache',
    priorityLevel: 'How important is it?',
    priorityHint: 'Decides who is told, and how soon, if a dose is missed.',
    reviewSchedule: 'How often',
    reviewTimes: 'Times',
    reviewDosage: 'Each dose',
    reviewInventory: 'Stock',
    reviewReason: 'What for',
    reviewPriority: 'Importance',
    errNoTimes: 'Please add at least one reminder time.',
    errNoTelegram: 'Could not find that patient’s Telegram account.',
    editPageTitle: 'Edit this medicine',
    editPageSubtitle: 'Change the times, the dose, how important it is, or how many you have.',
  },
  planner: {
    skipped: 'Skipped',
    moved: 'Moved',
    restoreToUsual: 'Put back to the usual time',
    adjustOrSkip: 'Move or skip this dose',
    schedule: 'Schedule',
    prevWeek: 'Previous week',
    nextWeek: 'Next week',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    resetDay: 'Undo all changes for this day',
    clearDay: 'A clear day',
    now: 'NOW',
    critical: 'Critical',
    priorityKey: 'What the colours mean',
    timeOfDay: 'Time of day',
    doseRecord: 'Dose record',
    closeDetails: 'Close details',
    outcome: 'What happened',
    scheduledFor: 'Was due at',
    answeredAt: 'Answered at',
    dose: 'Dose',
    linkedMedicine: 'Linked medicine',
    reason: 'What for',
    adjustDose: 'Move this dose',
    newTime: 'New time',
    outcomeTaken: 'Taken',
    outcomeMissed: 'Missed',
  },
  patient: {
    accessRestricted: 'Access restricted',
    monitoringStatus: 'Monitoring',
    active: 'On',
    adherence30d: 'Doses taken, last 30 days',
    activeMedications: 'Medicines being taken',
    missedDosesToday: 'Doses missed today',
    routineStability: 'Routine steadiness',
    milestones: 'How long you have helped',
    relation: 'Relationship',
    role: 'Role',
    longevity: 'Time together',
    sharedTrust: 'What they share',
    noActiveMeds: 'No medicines scheduled today.',
    noComplianceLogs: 'Nothing recorded in the last 7 days.',
    viewFolder: 'Open folder',
  },
  linkAccount: {
    errUnexpected: 'Something went wrong. Please try again.',
    errMustSignIn: 'Please sign in first.',
    errSkipFailed: 'Could not skip. Please try again.',
    verificationConfirmed: 'Connected',
    setupGuide: 'How to connect',
    openTelegramBot: 'Open the Telegram bot',
    openTelegramBotHint: 'Search for it, or scan the QR code.',
    requestPairingCode: 'Ask for a code',
    sendToBot: 'Send {command} to the bot.',
    enterPairingCode: 'Enter the code',
    enterPairingCodeHint: 'Copy the code and paste it below.',
    quickLink: 'Quick link',
    verificationCode: 'Code',
    codePlaceholder: 'RMDR-XXXXXX',
    or: 'or',
  },
  auth: {
    errAgeTerms: 'Please confirm you are 18 or older and accept the terms.',
    errCaptcha: 'Please complete the check that you are a real person.',
    errFullCode: 'Please enter the whole code from your email.',
    confirmationCode: 'Confirmation code',
    fullName: 'Full name',
    fullNamePlaceholder: 'Full name',
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    password: 'Password',
    passwordPlaceholder: 'Choose a password',
    alreadyHaveAccount: 'Already have an account?',
    createAccount: 'Create account',
    newHere: 'New here?',
    loginPasswordPlaceholder: 'Your password',
    errEmailForCode: 'Please enter your email to get a sign-in code.',
    errNoAccount: 'No account found for that email. Tap {label} below to sign up first.',
    errTooManyEmail: 'Too many email requests. Please wait a minute, or sign in with your password.',
    errEmailForReset: 'Enter your email to get a reset code.',
    errTooManyRequests: 'Too many requests just now. Please wait a minute and try again.',
    errCaptchaFailed: 'The check did not go through. Please try it again.',
    resetCode: 'Reset code',
    errPasswordTooShort: 'Your password must be at least 6 characters.',
    errPasswordMismatch: 'The two passwords do not match.',
    newPassword: 'New password',
    newPasswordPlaceholder: 'At least 6 characters',
    confirmNewPassword: 'Confirm new password',
    confirmNewPasswordPlaceholder: 'Type it again',
    welcomeBack: 'Welcome back',
    checkYourEmail: 'Check your email',
    signInSubtitle: 'Sign in to carry on looking after yourself.',
    emailedCodeTo: 'We emailed a sign-in code to {email}.',
    freshCodeSent: 'A fresh code is on its way to {email}.',
    errCodeInvalid: 'That code is invalid or has expired. Tap {label} for a new one.',
    resendCode: 'Resend code',
    errEmailRequired: 'Please enter your email address.',
    whyThisMatters: 'Why this matters',
    namePlaceholder: 'What should we call you?',
    emailAddress: 'Email address',
    enterTheCode: 'Enter the code',
  },
  profileMenu: {
    signedInAs: 'Signed in as',
    scheduler: 'Schedule planner',
    emergencyCard: 'Emergency card',
    signOut: 'Sign out',
  },
  meds: {
    openPlanner: 'Open the schedule planner',
    addMedication: 'Add a medicine',
    searchPlaceholder: 'Search medicines',
    searchAria: 'Search your medicines or the medicine directory',
    clearSearch: 'Clear the search',
    searchingDirectory: 'Searching the medicine directory…',
    discontinued: 'discontinued',
    filterMeds: 'Filter medicines',
    addStock: 'Add stock',
  },
  requests: {
    confirmDecline: 'Decline this request?',
    confirmWithdraw: 'Withdraw this request? They will no longer see it.',
    loading: 'Loading requests…',
    title: 'Care circle requests',
    toSupportYou: 'People asking to support you',
    noPending: 'No requests waiting',
    confirmShare: 'Accept and share',
    decline: 'Decline',
    youveSent: 'Requests you have sent',
    noSent: 'You have not sent any requests',
    pending: 'Waiting',
    withdraw: 'Withdraw',
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
