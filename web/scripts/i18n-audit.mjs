#!/usr/bin/env node
/**
 * i18n-audit — find user-facing strings that are still hardcoded.
 *
 * WHY THIS EXISTS. "Translate the whole app" is a claim nobody can check by reading
 * a diff: 235 source files, and the failure mode is a screen that is 90% Telugu with
 * an English "Save" button. The rule is that a language ships only when it is
 * complete, so "complete" has to be a number this script prints, not a feeling.
 *
 * WHAT IT FLAGS: JSX text nodes, and the four attributes that reach a user
 * (aria-label, placeholder, title, alt). Plus toast/confirm/alert argument strings.
 *
 * WHAT IT DELIBERATELY DOES NOT FLAG — these are the false positives that would
 * otherwise drown the signal:
 *   · anything inside {} that is not a plain string literal (expressions, t.* lookups)
 *   · className / href / key / id / type / role / data-* — machine strings
 *   · single words that are pure punctuation, numbers, or symbols
 *   · files under lib/i18n (the message files ARE the translations)
 *   · test files
 *
 * IT IS A GUIDE, NOT A GATE. It cannot know that `{med.name}` must stay untranslated
 * — that is the hard rule below and it is enforced by where user content lives (the
 * database), not by a regex. Use this to find work, and the completeness test in
 * lib/i18n/completeness.test.ts to prove a language is done.
 *
 * Usage:
 *   node scripts/i18n-audit.mjs            # summary, worst files first
 *   node scripts/i18n-audit.mjs --detail   # every string, with file:line
 *   node scripts/i18n-audit.mjs --path src/components/dashboard
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const args = process.argv.slice(2);
const DETAIL = args.includes('--detail');
const pathArgIdx = args.indexOf('--path');
const SCAN_ROOT = join(ROOT, pathArgIdx > -1 ? args[pathArgIdx + 1] : 'src');

/** Directories whose contents are never user-facing copy. */
const SKIP_DIRS = new Set(['node_modules', '.next', 'lib/i18n']);

/**
 * Surfaces deliberately EXCLUDED from the translation target, with the reason.
 *
 * The count is supposed to mean "work left to do". Anything counted here that
 * nobody will translate makes the number a lie, and a number people stop trusting
 * is worse than no number.
 *
 * · admin-diagnostics — server-gated behind `getAdminUser()` / ADMIN_EMAILS, which
 *   is deliberately unset (see the project memory). It is a maintainer's
 *   instrument panel; no patient can reach it in any language.
 */
const EXCLUDED = [
  { match: 'admin-diagnostics', why: 'maintainer-only, ADMIN_EMAILS-gated' },
];
/** Attributes that reach a human. Everything else is a machine string. */
const UI_ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    if (SKIP_DIRS.has(entry) || rel.includes('src/lib/i18n')) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The product's own name, in the fragments the markup splits it into.
 *
 * `Re-MIND-eЯ` is styled per-syllable in a few headers, so the raw pattern sees
 * "Re", "MIND" and "eЯ" as three separate strings. A brand is not translated in
 * any language, and counting its pieces as three outstanding items is noise.
 */
const BRAND_FRAGMENTS = new Set(['Re', 'MIND', 'eЯ', 'Re-MIND-eЯ', 'MIND-eЯ', 'Re-MIND']);

/** A string worth translating: has a letter, and is more than a lone symbol. */
function isCopy(s) {
  const t = s.trim();
  if (t.length < 2) return false;
  if (!/[A-Za-z]/.test(t)) return false;            // numbers/punctuation only
  if (/^[a-z0-9-]+$/.test(t) && !t.includes(' ')) return false; // slug/ident
  if (/^(https?:|\/|#|@)/.test(t)) return false;    // urls, paths, anchors
  if (BRAND_FRAGMENTS.has(t)) return false;
  // DEVELOPER INVARIANTS, not user copy. `throw new Error('useTheme must be used
  // within a ThemeProvider')` fires when a programmer wires a component wrong; it
  // reaches a console and a Sentry event, never a patient. Translating it would
  // make the one audience who reads it — us — worse off.
  if (/must be used within|is not (defined|available)|^no session$/i.test(t)) return false;
  return true;
}

const findings = [];

// `--path` takes a directory or a single file — scoping to one file is the common
// case while working through a surface.
const targets = statSync(SCAN_ROOT).isDirectory() ? walk(SCAN_ROOT) : [SCAN_ROOT];

const skipped = [];

for (const file of targets) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');

  const excluded = EXCLUDED.find((e) => rel.includes(e.match));
  if (excluded) { skipped.push(`${rel} — ${excluded.why}`); continue; }

  const lines = readFileSync(file, 'utf8').split('\n');
  // JSX exists only in .tsx. Applying the `>text<` rule to a .ts file matches
  // TypeScript generics instead — `Promise<void>`, `Record<string, X>` — which is
  // where 24 phantom "strings" in schedule-bridge.ts came from. Attributes and
  // toast/confirm copy CAN appear in .ts, so those rules still run below.
  const isTsx = rel.endsWith('.tsx');

  lines.forEach((line, i) => {
    const at = { file: rel, line: i + 1 };

    // JSX text between tags, excluding anything that is an expression.
    if (isTsx) {
      for (const m of line.matchAll(/>([^<>{}]{2,120})</g)) {
        if (isCopy(m[1])) findings.push({ ...at, kind: 'jsx', text: m[1].trim() });
      }
    }
    // User-facing attributes.
    for (const attr of UI_ATTRS) {
      const re = new RegExp(`${attr}="([^"]{2,120})"`, 'g');
      for (const m of line.matchAll(re)) {
        if (isCopy(m[1])) findings.push({ ...at, kind: attr, text: m[1] });
      }
    }
    // Imperative copy: toasts, confirms, alerts, thrown Errors.
    for (const m of line.matchAll(/(?:toast|confirm|alert|Error)\s*\(\s*['"`]([^'"`]{5,160})/g)) {
      if (isCopy(m[1])) findings.push({ ...at, kind: 'call', text: m[1] });
    }
  });
}

const byFile = new Map();
for (const f of findings) byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
const ranked = [...byFile.entries()].sort((a, b) => b[1] - a[1]);

if (DETAIL) {
  for (const [file] of ranked) {
    console.log(`\n${file}`);
    for (const f of findings.filter((x) => x.file === file)) {
      console.log(`  ${String(f.line).padStart(4)}  [${f.kind}] ${f.text}`);
    }
  }
  console.log('');
}

console.log('── i18n audit ──────────────────────────────────');
console.log(`untranslated strings : ${findings.length}`);
console.log(`files affected       : ${byFile.size}`);
// Say what was left out. A silent exclusion is how a number quietly stops
// meaning what everyone thinks it means.
if (skipped.length) {
  console.log(`excluded by policy   : ${skipped.length} file(s)`);
  for (const s of skipped) console.log(`  · ${s}`);
}
console.log('\nworst 15 files:');
for (const [file, n] of ranked.slice(0, 15)) {
  console.log(`  ${String(n).padStart(4)}  ${file}`);
}
console.log('\nRun with --detail for every string, or --path <dir> to scope.');
console.log('A language is COMPLETE when this reaches 0 for the surfaces it covers');
console.log('AND lib/i18n/completeness.test.ts passes for that locale.');
