'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { useLanguage } from '@/context/language-context';
import { useUiMode } from '@/context/ui-mode-context';
import { LOCALE_META, pickableLocales } from '@/lib/i18n/locales';

/**
 * Settings → Language. The picker that the placeholder here used to promise.
 *
 * EVERY LANGUAGE IS WRITTEN IN ITS OWN SCRIPT, and that is the load-bearing decision
 * rather than a nicety. The person most likely to open this screen is the one who
 * cannot read the language the app is currently in; a list reading "Hindi / Telugu /
 * Tamil" in Latin script is unusable by exactly them. The English name sits
 * underneath in muted type for the other real case — a caregiver setting up a phone
 * for somebody else, who may not read the target script either.
 *
 * `lang` on each native name matters: it is what tells the browser to pick the right
 * Indic face out of the fallback chain, and it is what a screen reader switches voice
 * on. Without it a Telugu name inside an English document can be announced by an
 * English voice, which is noise.
 *
 * A RADIOGROUP, not a list of buttons. Seven mutually exclusive options with one
 * winner is what a radio group is, and it gives arrow-key navigation for free.
 *
 * NO SAVE BUTTON. The choice applies immediately and this screen re-renders into the
 * new language, which is the confirmation — a language you can see is a better
 * receipt than a toast telling you it worked.
 */
export default function LanguagePicker() {
  const { locale, setLocale, t } = useLanguage();
  const { isElderly } = useUiMode();

  return (
    <div className={`max-w-2xl mx-auto ${isElderly ? 'space-y-7' : 'space-y-6'}`}>
      <header className="px-1">
        <h1
          className={`font-black text-foreground tracking-tight ${
            isElderly ? 'text-4xl' : 'title-page'
          }`}
        >
          {t.language.title}
        </h1>
      </header>

      <div
        role="radiogroup"
        aria-label={t.language.title}
        className="card-lift overflow-hidden divide-y divide-border"
      >
        {/* pickableLocales(), never LOCALE_ORDER — a language appears here only
            once it is complete. See the gate in lib/i18n/locales.ts. */}
        {pickableLocales().map((code) => {
          const meta = LOCALE_META[code];
          const active = code === locale;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setLocale(code)}
              // 56px floor on the ROW, so the whole strip is the target — same rule
              // SettingsRow applies, and the same 72px in elderly.
              className={`w-full flex items-center gap-3 px-4 bg-card hover:bg-muted/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                isElderly ? 'min-h-[72px] py-3' : 'min-h-[56px] py-2.5'
              }`}
            >
              <span className="flex-1 min-w-0 text-left">
                <span
                  lang={meta.htmlLang}
                  className={`block font-bold text-foreground ${
                    isElderly ? 'text-2xl' : 'text-[17px]'
                  }`}
                >
                  {meta.nativeName}
                </span>
                {/* Skipped when the two are the same word, or English reads
                    "English / English" like a rendering bug. */}
                {meta.englishName !== meta.nativeName && (
                  <span
                    lang="en"
                    className={`block font-semibold text-muted-foreground ${
                      isElderly ? 'text-base' : 'text-xs'
                    }`}
                  >
                    {meta.englishName}
                  </span>
                )}
              </span>

              {active && (
                <Check
                  aria-label={t.language.selected}
                  className={`shrink-0 text-primary-strong ${isElderly ? 'w-7 h-7' : 'w-5 h-5'}`}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Says what this control DOES and does not reach. A picker that silently
          leaves half the app in another language teaches the user the setting is
          broken; saying so up front costs one paragraph. */}
      <div className="px-1 space-y-2">
        <p
          className={`text-muted-foreground font-semibold text-balance ${
            isElderly ? 'text-base' : 'text-xs'
          }`}
        >
          {t.language.scopeNote}
        </p>
        {/* The one gap that matters at 3am, stated rather than discovered. */}
        <p
          className={`text-muted-foreground font-semibold text-balance ${
            isElderly ? 'text-base' : 'text-xs'
          }`}
        >
          {t.language.alarmNote}
        </p>
      </div>
    </div>
  );
}
