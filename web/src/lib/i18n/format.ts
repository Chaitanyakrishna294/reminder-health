/**
 * MIXED LINES — a translated frame around user content that is never translated.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE HARD RULE: WE TRANSLATE THE FRAME, NEVER THE CONTENT.
 *
 *   frame   → "Medicines", "Taken", "{name} — {dose} at {time}"     TRANSLATED
 *   content → "Dolo 650", "1 tablet", a folder name, a person's name  VERBATIM
 *
 * A translated medicine name is a patient-safety hazard. "Dolo 650" stays
 * "Dolo 650" in every one of the seven languages — no translation, and no
 * transliteration either, which is the subtler trap: రూపాంతరం of a drug name
 * looks helpful and produces a string that matches nothing on the box, nothing
 * in the catalog, and nothing the pharmacist will recognise.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS IS STRUCTURALLY SAFE, not merely a rule people remember.
 * The translations are STATIC FILES (`lib/i18n/messages/*.ts`) written ahead of
 * time. User content lives in Postgres and arrives at render time. The two never
 * meet in a translatable position: there is no runtime translation service, no
 * auto-translate pass, and nothing that walks the DOM. For a medicine name to be
 * translated, somebody would have to paste it into a message file by hand.
 *
 * That is the argument for keeping it this way. Any future "just run it through
 * a translation API" change breaks the guarantee, and would need to exempt every
 * DB-sourced field explicitly — which is exactly the kind of allowlist that is
 * wrong the first time someone adds a column.
 *
 * ── NUMERALS: WESTERN EVERYWHERE (decided 2026-08-15) ──────────────────────
 * `0123456789`, in all seven languages — not Devanagari (०१२३), not Telugu
 * (౦౧౨౩), not Tamil (௦௧௨௩). Three reasons, in order of weight:
 *   1. DOSE SAFETY. The number on the screen should match the number on the
 *      strip, the prescription and the pharmacist's label — all of which are
 *      Western numerals in India in practice. A "2" that renders as "౨" is a
 *      number the patient must translate back before acting on it.
 *   2. Times are Western on every phone clock these are checked against.
 *   3. The design uses `tabular-nums` for dose counts and times; the Indic
 *      numeral sets in these fonts are not reliably tabular, so columns would
 *      stop lining up.
 * Applies to dose counts, times, dates, stock counts and the water tally. The
 * WORDS around them are translated; the digits are not.
 */

import type { Messages } from './messages/en';

/**
 * Substitute `{key}` placeholders in a translated pattern.
 *
 * Every value is inserted **verbatim** — that is the point, and why user content
 * is passed here rather than looked up. Numbers are rendered with Western digits
 * (see the note above); pass a pre-formatted string if a value needs anything
 * cleverer.
 *
 *   format(t.dose.line, { name: med.drug_name, dose: '1 tablet', time: '8:00 AM' })
 *   // en → "Dolo 650 — 1 tablet at 8:00 AM"
 *   // te → "Dolo 650 — 8:00 AM కి 1 tablet"      ← frame reordered, name untouched
 *
 * An unmatched placeholder is left as-is rather than blanked: `{name}` visible on
 * screen is a bug report, an empty gap is a silent wrong dose line.
 */
export function format(
  pattern: string,
  values: Record<string, string | number>
): string {
  return pattern.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole
  );
}

/**
 * Marker for values that came from the user, for readability at call sites.
 *
 * Deliberately an identity function and NOT a branded type. A brand would force a
 * wrapper at every call site and give a compile error that reads like a type
 * puzzle; the real guarantee is structural (see the header). This exists so a
 * reviewer scanning a component can see which slots are user content:
 *
 *   format(t.dose.line, { name: userContent(med.drug_name), time })
 *
 * If you ever find yourself wanting to pass one of these into a message LOOKUP
 * rather than a message SLOT, stop — that is the bug this file exists to prevent.
 */
export const userContent = (value: string): string => value;

/**
 * A dose unit in the right form for the amount.
 *
 * Replaces `unitPhrase()` from medication-form-options.tsx, which appended "s" or
 * "es" — English morphology that yields "మాత్రs" in Telugu and "गोलीs" in Hindi.
 * The plural rule these seven languages share is "one vs. not-one", which is what
 * the `{ one, other }` pair encodes. An unknown unit id falls back to OTHER
 * ("dose") rather than throwing: a dose line with a vague unit is recoverable,
 * a crashed elderly screen is not.
 */
export function unitFor(
  units: Messages['units'],
  unitType: string | undefined,
  amount: number
): string {
  const key = (unitType || 'TABLET').toUpperCase() as keyof Messages['units'];
  const forms = units[key] ?? units.OTHER;
  return amount === 1 ? forms.one : forms.other;
}

/**
 * A clock time: LOCAL CONVENTIONS, WESTERN DIGITS.
 *
 * This is the "times format per locale, numerals stay familiar" rule made real.
 * `-u-nu-latn` is a Unicode locale extension that pins the numbering system to
 * Latin while leaving everything else — 12- vs 24-hour, the separator, the
 * am/pm marker — to the locale. So Telugu gets Telugu time conventions with
 * `8:00`, never `౮:౦౦`.
 *
 * Why that matters more here than it looks: the digits on this screen have to
 * match the digits on the strip, the prescription and the pharmacist's label. A
 * time or a dose the patient must mentally convert is one they can convert wrong.
 *
 * Returns a placeholder before mount — the server has no viewer timezone, so
 * rendering a real time during SSR produces a hydration mismatch and, worse, a
 * visibly wrong time for the first frame.
 */
export function formatTime(iso: string, locale: string, mounted: boolean): string {
  if (!mounted) return '--:--';
  return new Date(iso).toLocaleTimeString(`${locale}-u-nu-latn`, {
    hour: '2-digit',
    minute: '2-digit',
  });
}
