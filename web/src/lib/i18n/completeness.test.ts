import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPLETE_LOCALES, LOCALES, TODO_TRANSLATE, type Locale } from './locales.ts';

// Imported DIRECTLY with explicit .ts extensions rather than through ./index.ts.
// Node's ESM resolver (which is what runs these tests) does not do extensionless
// resolution, and index.ts imports `./locales` the way the bundler expects. Going
// straight to the data also means this suite tests the dictionaries themselves
// rather than the lookup wrapper — the dictionaries are what can be wrong.
import en from './messages/en.ts';
import hi from './messages/hi.ts';
import te from './messages/te.ts';
import ta from './messages/ta.ts';
import kn from './messages/kn.ts';
import ml from './messages/ml.ts';
import mr from './messages/mr.ts';
import legalEn from './legal/en.ts';
import legalHi from './legal/hi.ts';
import legalTe from './legal/te.ts';
import legalTa from './legal/ta.ts';
import legalKn from './legal/kn.ts';
import legalMl from './legal/ml.ts';
import legalMr from './legal/mr.ts';

const MESSAGES = { en, hi, te, ta, kn, ml, mr } as const;
const LEGAL = {
  en: legalEn, hi: legalHi, te: legalTe, ta: legalTa,
  kn: legalKn, ml: legalMl, mr: legalMr,
} as const;

const getMessages = (l: Locale) => MESSAGES[l];
const getLegalDocs = (l: Locale) => LEGAL[l];

/**
 * THE PROOF BEHIND THE COMPLETENESS GATE.
 *
 * TypeScript already guarantees every locale has every KEY — the six non-English
 * dictionaries are typed against `Messages`, so a new key breaks the build until
 * all seven carry it. What the type system cannot see is whether a value was
 * actually translated or just copied across to make the build green. That is what
 * these tests are for, and it is the difference between "compiles" and "shipped a
 * Telugu app with an English Save button".
 *
 * Run: node --experimental-strip-types --test src/lib/i18n/completeness.test.ts
 * (CI already globs src/lib/**\/*.test.ts, so this runs on every push.)
 */

/** Walk a nested message object into [path, value] pairs. */
function flatten(obj: unknown, prefix = ''): [string, string][] {
  const out: [string, string][] = [];
  if (typeof obj === 'string') return [[prefix, obj]];
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => out.push(...flatten(v, `${prefix}[${i}]`)));
    return out;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      out.push(...flatten(v, prefix ? `${prefix}.${k}` : k));
    }
  }
  return out;
}

test('every locale in COMPLETE_LOCALES is actually a supported locale', () => {
  for (const l of COMPLETE_LOCALES) {
    assert.ok(
      (LOCALES as readonly string[]).includes(l),
      `COMPLETE_LOCALES lists "${l}", which is not in LOCALES`
    );
  }
});

test('no shippable locale carries an untranslated marker', () => {
  for (const locale of COMPLETE_LOCALES) {
    const entries = [
      ...flatten(getMessages(locale)),
      ...flatten(getLegalDocs(locale)),
    ];
    const todo = entries.filter(([, v]) => v.includes(TODO_TRANSLATE));
    assert.equal(
      todo.length,
      0,
      `Locale "${locale}" is in COMPLETE_LOCALES but has ${todo.length} untranslated ` +
        `string(s): ${todo.slice(0, 5).map(([k]) => k).join(', ')}` +
        `\n→ Either translate them, or remove "${locale}" from COMPLETE_LOCALES until they are done.`
    );
  }
});

test('no shippable locale has an empty string', () => {
  // An empty value passes the type check and renders as a blank button.
  for (const locale of COMPLETE_LOCALES) {
    const entries = [
      ...flatten(getMessages(locale)),
      ...flatten(getLegalDocs(locale)),
    ];
    const blank = entries.filter(([, v]) => v.trim() === '');
    assert.equal(blank.length, 0, `Locale "${locale}" has empty string(s): ${blank.map(([k]) => k).join(', ')}`);
  }
});

test('every locale has the same key set as English', () => {
  // Belt and braces: the TYPE enforces this, but a stray `as Messages` cast or a
  // future JSON-loading change would slip past it silently.
  const enKeys = flatten(getMessages('en')).map(([k]) => k).sort();
  for (const locale of LOCALES as readonly Locale[]) {
    const keys = flatten(getMessages(locale)).map(([k]) => k).sort();
    assert.deepEqual(
      keys,
      enKeys,
      `Locale "${locale}" key set differs from English (missing/extra keys)`
    );
  }
});

test('interpolation slots survive translation in every locale', () => {
  // THE PATIENT-SAFETY ONE. A frame like "{name} — {dose} at {time}" is useless if a
  // translator dropped a placeholder: the medicine name would silently vanish from
  // the line. Any key whose English value has {slots} must have the SAME slots in
  // every language — reordered is fine, missing is not.
  const en = flatten(getMessages('en'));
  const slotsOf = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();

  for (const locale of LOCALES as readonly Locale[]) {
    if (locale === 'en') continue;
    const other = new Map(flatten(getMessages(locale)));
    for (const [key, enValue] of en) {
      const enSlots = slotsOf(enValue);
      if (enSlots.length === 0) continue;
      assert.deepEqual(
        slotsOf(other.get(key) ?? ''),
        enSlots,
        `Locale "${locale}" key "${key}" has different interpolation slots than English. ` +
          `English: ${enSlots.join(' ')} — a missing slot drops user content (e.g. the medicine name) from the line.`
      );
    }
  }
});
