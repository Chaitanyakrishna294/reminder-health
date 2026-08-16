import { DEFAULT_LOCALE, type Locale } from './locales';
import en, { type Messages } from './messages/en';
import hi from './messages/hi';
import te from './messages/te';
import ta from './messages/ta';
import kn from './messages/kn';
import ml from './messages/ml';
import mr from './messages/mr';

export type { Messages };
export * from './locales';

/**
 * All seven dictionaries are imported statically rather than lazily.
 *
 * They are UI labels — the whole map is a few kilobytes, well under the cost of a
 * second network round-trip on the 2G-ish connections this app is built for. A
 * dynamic import would mean the Settings screen paints its labels one frame late,
 * which is a visible flash of English for exactly the user who cannot read it.
 * The legal documents are a different matter and ARE split — see ./legal.
 */
const MESSAGES: Record<Locale, Messages> = { en, hi, te, ta, kn, ml, mr };

export function getMessages(locale: Locale): Messages {
  return MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
}
