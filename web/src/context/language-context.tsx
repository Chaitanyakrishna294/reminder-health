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

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      // Private mode / storage disabled. English is the fallback, which is the
      // same answer the pre-paint script lands on.
    }
    const next = resolveLocale(saved);
    setLocaleState(next);
    applyLocale(next);
    setMounted(true);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // The choice still applies for this session; it just will not survive a reload.
    }
    applyLocale(next);
  }, []);

  // Before mount, render English — it is what the server streamed, so this is what
  // keeps hydration honest rather than patching over a mismatch.
  const active = mounted ? locale : DEFAULT_LOCALE;

  return (
    <LanguageContext.Provider value={{ locale: active, setLocale, t: getMessages(active) }}>
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
