import 'server-only';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, resolveLocale, type Locale } from './locales';
import { getMessages, type Messages } from './index';

/**
 * THE SERVER HALF OF THE LOCALE — read from a cookie, because the server cannot
 * read localStorage.
 *
 * WHY A COOKIE AND NOT SOMETHING CLEVERER. 81 of the remaining untranslated
 * strings live in components that never run on the client — page shells, guest
 * gates, cards rendered on the server. `useLanguage()` cannot reach them by
 * construction. The two honest options were "convert every such leaf to a client
 * component" or "send the locale with the request", and the second is both
 * smaller and already established here: `ui-mode-context` has been writing a
 * `view-mode` cookie for exactly this reason. Same key name as the localStorage
 * entry, same value, written together — see `setLocale` in language-context.tsx.
 *
 * COSTS NOTHING IN RENDERING STRATEGY. Reading cookies opts a route into dynamic
 * rendering, which would normally be a real trade. It is free here: the root
 * layout already awaits `headers()` for the CSP nonce, so every route in this app
 * is dynamic already. No page becomes slower by asking for the locale.
 *
 * NOT httpOnly, deliberately. The client writes it — a language picker that could
 * not set the language would be a strange thing to build. It carries no secret;
 * it is a display preference, and the worst an attacker can do by forging it is
 * show somebody their own app in Tamil.
 */

/** The locale for THIS request. Falls back to English on anything unexpected. */
export async function getServerLocale(): Promise<Locale> {
  try {
    const store = await cookies();
    return resolveLocale(store.get(LOCALE_STORAGE_KEY)?.value);
  } catch {
    // `cookies()` throws outside a request scope (a static prerender, some build
    // paths). English is the right answer there — nobody is reading it yet.
    return DEFAULT_LOCALE;
  }
}

/** The dictionary for THIS request. The server-side twin of `useLanguage().t`. */
export async function getServerMessages(): Promise<Messages> {
  return getMessages(await getServerLocale());
}
