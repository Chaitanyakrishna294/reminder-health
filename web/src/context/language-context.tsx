'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_META,
  LOCALE_STORAGE_KEY,
  resolveLocale,
  type Locale,
} from '@/lib/i18n/locales';
import { getMessages, type Messages } from '@/lib/i18n';

/**
 * THE LANGUAGE CONTEXT — the same shape as theme-context, on purpose.
 *
 * `setLocale` only, no `cycleLocale`: seven languages is a list, not a toggle, and
 * the single control is Settings → Language.
 *
 * WHY localStorage AND NOT a profiles column (for now). The theme is stored this way
 * and ships; the view lock is stored on the profile because CLAUDE.md's reasoning
 * there is specific — a lock that survives a reinstall protects someone who cannot
 * re-find the setting. Language has the same argument in its favour and it is worth
 * doing, but it needs a migration the maintainer applies by hand, so it is called out
 * in docs/I18N.md as the follow-up rather than half-built here. Nothing in this file
 * has to change when that lands: the provider gains an initial value from the server.
 *
 * FIRST PAINT. The pre-paint script in app/layout.tsx stamps `lang` on <html> from the
 * same storage key, so the font stack and the browser's own text handling are correct
 * from the first frame. This provider is still the authority — it re-stamps on mount.
 * Keep the storage key in lockstep with lib/i18n/locales.ts.
 */
interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** The active dictionary. Named `t` to read like every other i18n library. */
  t: Messages;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function applyLocale(locale: Locale) {
  document.documentElement.lang = LOCALE_META[locale].htmlLang;
}

/**
 * Mirror the choice into a cookie so the SERVER can read it.
 *
 * Same key and value as the localStorage entry, written together and never
 * separately — server-rendered copy and client-rendered copy disagreeing about
 * the language is worse than either being wrong on its own, because it looks like
 * the app is half-translated. One year, `Lax` so it survives normal navigation
 * without riding along on cross-site requests. Not httpOnly: the picker writes it.
 * Mirrors the `view-mode` cookie in ui-mode-context.tsx.
 */
function writeLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_STORAGE_KEY}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
}

function readLocaleCookie(): string | null {
  const hit = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${LOCALE_STORAGE_KEY}=`));
  return hit ? hit.split('=')[1] : null;
}

export function LanguageProvider({
  children,
  /**
   * Read from the cookie on the server (lib/i18n/server.ts) and handed down by the
   * root layout. THIS IS WHAT REMOVES THE FLASH: the first painted frame is already
   * in the right language, rather than English being replaced a moment later. It is
   * also what keeps hydration honest — the client starts from the same value the
   * server rendered, instead of correcting it after the fact.
   */
  initialLocale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    // MIGRATION, and the reason this effect still exists. Anyone who chose a
    // language before the cookie existed has localStorage and no cookie, so the
    // server rendered them English. Adopt their stored choice and write the cookie
    // so every later request is server-rendered correctly.
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      // Private mode / storage disabled. The cookie alone is enough.
    }
    const cookie = readLocaleCookie();
    const next = resolveLocale(cookie ?? saved);

    if (!cookie) writeLocaleCookie(next);
    if (next !== locale) setLocaleState(next);
    applyLocale(next);
    // `locale` is intentionally not a dependency: this runs once, to reconcile the
    // server's guess with what the browser remembers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // The choice still applies for this session; the cookie below carries it.
    }
    writeLocaleCookie(next);
    applyLocale(next);
  }, []);

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t: getMessages(locale) }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
