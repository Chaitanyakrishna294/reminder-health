import { DEFAULT_LOCALE, type Locale } from '../locales';
import type { LegalDocSet } from './types';
import en from './en';
import hi from './hi';
import te from './te';
import ta from './ta';
import kn from './kn';
import ml from './ml';
import mr from './mr';

export type { LegalDoc, LegalDocKey, LegalDocSet, LegalSection, LegalBullet } from './types';

/**
 * Unlike the UI dictionaries next door, these are LONG — three full documents per
 * language. They are still imported statically, and the reason is that they only
 * ever load on /privacy, /terms and /disclaimer: three routes nobody visits in the
 * course of using the app, whose entire content is this text. Splitting them would
 * trade a bundle nobody downloads for a loading state on a page that is nothing but
 * the thing being loaded.
 */
const LEGAL: Record<Locale, LegalDocSet> = { en, hi, te, ta, kn, ml, mr };

export function getLegalDocs(locale: Locale): LegalDocSet {
  return LEGAL[locale] ?? LEGAL[DEFAULT_LOCALE];
}
