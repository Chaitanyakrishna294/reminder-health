/**
 * THE LANGUAGE LIST — seven locales, and every one of them written in its own script.
 *
 * That is the whole reason `nativeName` exists as a separate field from `englishName`.
 * A language list written only in English is unusable by exactly the person who needs
 * to change it: someone who opened Settings because the app is in a language they
 * cannot read. "Telugu" is no help to a reader who is looking for తెలుగు.
 *
 * WHY THERE IS NO next-intl HERE. CLAUDE.md's phase-2 note names next-intl, and this
 * deliberately does not use it. next-intl's routing mode wants a `[locale]` segment,
 * which would restructure all 39 routes for a feature whose scope is UI labels and
 * three legal documents; its no-routing mode is a provider around a flat dictionary,
 * which is what this file's neighbours already are. The repo has three working
 * precedents for exactly this shape — theme-context, density-context, ui-mode-context
 * — and `messages/` is laid out the way next-intl expects, so adopting it later is a
 * config change rather than a rewrite. Flagged rather than done silently.
 *
 * SCRIPT NOTE: Hindi and Marathi share Devanagari, so six languages need five Indic
 * font families, not six. See `fontStackFor` below and the font wiring in app/layout.tsx.
 */

export const LOCALES = ['en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** localStorage key. Mirrors the 'theme' key's role in theme-context.tsx. */
export const LOCALE_STORAGE_KEY = 'language';

export interface LocaleMeta {
  code: Locale;
  /** Shown to the reader. Always in the language's own script. */
  nativeName: string;
  /** Shown underneath, so a caregiver setting up someone else's phone can find it. */
  englishName: string;
  /**
   * The `lang` attribute value. Same as `code` today, kept explicit because BCP-47
   * tags and our internal keys are not guaranteed to stay identical forever.
   */
  htmlLang: string;
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: { code: 'en', nativeName: 'English', englishName: 'English', htmlLang: 'en' },
  hi: { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', htmlLang: 'hi' },
  te: { code: 'te', nativeName: 'తెలుగు', englishName: 'Telugu', htmlLang: 'te' },
  ta: { code: 'ta', nativeName: 'தமிழ்', englishName: 'Tamil', htmlLang: 'ta' },
  kn: { code: 'kn', nativeName: 'ಕನ್ನಡ', englishName: 'Kannada', htmlLang: 'kn' },
  ml: { code: 'ml', nativeName: 'മലയാളം', englishName: 'Malayalam', htmlLang: 'ml' },
  mr: { code: 'mr', nativeName: 'मराठी', englishName: 'Marathi', htmlLang: 'mr' },
};

/** Ordered for the picker: English first, then the Indic languages alphabetically by English name. */
export const LOCALE_ORDER: Locale[] = ['en', 'hi', 'kn', 'ml', 'mr', 'ta', 'te'];

/**
 * THE COMPLETENESS GATE — a language appears in the picker only when it is DONE.
 *
 * "Better fewer complete languages than many partial ones." A half-translated
 * language is worse than no translation: an English-only app is at least
 * consistently readable by someone who got that far, whereas a "Telugu" app with
 * an English Save button strands them mid-task with no way to guess what the
 * button does. The partial state also teaches them the setting is broken, so they
 * never try it again.
 *
 * HOW A LANGUAGE GETS ADDED HERE — both must hold, and both are checkable:
 *   1. `node scripts/i18n-audit.mjs` reports 0 for every surface in scope, so no
 *      hardcoded English is left to leak through.
 *   2. `completeness.test.ts` passes for the locale — every key present (the
 *      TYPE already forces that) and none still carrying a TODO_TRANSLATE marker.
 *
 * Do not add a locale here to "make it visible for testing". Use `?preview=` for
 * that, the way the density split does — a shipped picker entry is a promise.
 *
 * CURRENT STATE (2026-08-15): all seven are complete **for the surfaces
 * translated so far** — nav, Settings hub, language picker, legal documents.
 * The full-app extraction is in progress (625 strings measured, see docs/I18N.md);
 * as each wave lands, the locales stay listed only while they keep passing both
 * checks above. If a wave translates English but not the other six, THIS LIST
 * shrinks to ['en'] until they catch up. That is the mechanism working, not a
 * regression to route around.
 */
export const COMPLETE_LOCALES: Locale[] = ['en', 'hi', 'kn', 'ml', 'mr', 'ta', 'te'];

/**
 * Sentinel for a string that has been extracted but not yet translated.
 *
 * Prefixing a value with this keeps the file type-correct (so the build stays
 * green and work can proceed in parallel) while `completeness.test.ts` refuses to
 * let that locale ship. Never ship a locale whose file contains one.
 */
export const TODO_TRANSLATE = 'TODO_TRANSLATE:';

/** The picker's list. Never `LOCALE_ORDER` directly — that would show unfinished work. */
export function pickableLocales(): Locale[] {
  return LOCALE_ORDER.filter((l) => COMPLETE_LOCALES.includes(l));
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Narrow an arbitrary string (a stored value, a query param, a browser locale like
 * "hi-IN") to a supported locale, falling back to English.
 */
export function resolveLocale(value: string | null | undefined): Locale {
  if (!value) return DEFAULT_LOCALE;
  if (isLocale(value)) return value;
  const base = value.split('-')[0]?.toLowerCase();
  return isLocale(base) ? base : DEFAULT_LOCALE;
}
