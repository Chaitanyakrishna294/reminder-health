# i18n — handoff for the remaining tail

Parked 2026-08-16. The **heavy surfaces are done and shipped**; what is left is a
long tail of small files. Read [I18N.md](I18N.md) first for how the system works —
this note only covers what is unfinished and what will bite you.

---

## Where it stands

| | |
|---|---|
| Audit on `main` (2101d9a) | **194 untranslated strings, 58 files** |
| Languages | 7 — en · hi · te · ta · kn · ml · mr, **all in exact lockstep** |
| `COMPLETE_LOCALES` | all seven listed |
| Biggest remaining file | 12 strings |
| Command | `node scripts/i18n-audit.mjs` (add `--detail`, or `--path <file-or-dir>`) |

**Done and translated:** elderly mode · health vault · medical profile · dashboard ·
care circle (both pages) · medications (wizard + editor + edit page) · schedule
planner · Telegram linking · all four auth screens · the three legal documents ·
nav, Settings hub and the language picker · **and the native Android alarm**
(alarm screen, notification actions, retry rungs, missed notice, water nudge).

---

## 1. Three files are PRE-KEYED — start here, it is the cheapest 30 strings

The keys exist and are **already translated into all seven languages**; only the
component wiring is missing. Sections `profileMenu`, `meds` and `requests` in
`web/src/lib/i18n/messages/*.ts`.

| File | Strings | Section to use |
|---|---|---|
| `components/layout/navbar.tsx` | 6 | `t.profileMenu.*` |
| `components/medications/medication-list.tsx` | 12 | `t.meds.*` |
| `app/(dashboard)/care-circle/requests/page.tsx` | 12 | `t.requests.*` |

Reuse rather than re-mint while wiring these: `medication-list` needs
"Previous week" / "Next week" / "A clear day", which already exist as
`t.planner.prevWeek` / `nextWeek` / `clearDay`, and "Profile photo" is
`t.profile.photoAlt`. One key per idea.

After those: `call-schedule` (12), `connections` (11), `guide-tour` (10),
`account` (8), `patient-stock-card` (7), `install-prompt` (7), then ~50 files of
1–6 each.

---

## 2. READ THE FILE — the audit is a floor, not a total

**The single most important thing in this note.** In three consecutive waves the
strings the audit missed were the ones that mattered:

- **`schedule-planner`** — the outcome words on a past dose live in a ternary
  (`outcome === 'TAKEN' ? 'Taken' : … 'Missed'`), not in JSX text.
- **`login`** — six strings, including the page's own headline, in ternaries and
  template literals: "Welcome back" / "Check your email", the subtitle, "We
  emailed a sign-in code to {email}", the resend banner, the invalid-code error.
- **`health-vault`** — "Confirm Permanent Deletion" and the photo-legibility line,
  both inside markup the `>text<` pattern cannot reach.

No regex finds a string built in a ternary, a template literal, or a `const`
array. **Open every file you extract.** The audit tells you where to look; it does
not tell you when you are finished. `completeness.test.ts` is what proves a
locale is internally consistent — it cannot prove a string was never extracted.

Related: **check which component the strings are actually in.** Twice a scripted
pass rewrote call sites inside a helper defined *above* the page (`DoseCard` in
the planner, `LoginForm` in login), where `t` was not in scope. tsc catches it,
but it is faster to look first.

---

## 3. The interface-vs-object trap — FIXED each time, but it keeps returning

`messages/en.ts` contains both the `Messages` **interface** and the `en`
**object**, with identical key names. Any script that anchors on a key name hits
the interface first, because it comes earlier in the file. This landed three
different ways:

1. Keys inserted into the interface got **string-literal types**, so the other six
   locales failed to match them.
2. A script skipped `en.ts` entirely, reporting sections "already present" — it had
   matched the interface declarations.
3. Three whole object blocks were inserted **into the interface**, producing
   duplicate identifiers.

All three were caught by `tsc` and fixed; nothing shipped. **The reliable anchor is
a regex that requires a quoted value** — `/^\s*someKey: '/m` matches the object and
never the interface. Use that, or edit `en.ts` by hand.

---

## 4. Rule 4 caveat — the tail means still-English screens in a translated app

Stated plainly because it is the honest status, not a detail:

**Every one of the 194 remaining strings renders in English regardless of the
chosen language.** A user on Telugu today gets Telugu on every heavy surface and
English on the tail — settings sub-pages, the guided tour, the install prompt,
care-circle requests, and the rest. That is the half-translated state the project
rule forbids.

It is not resolved by dropping languages: **all seven are in exact lockstep**, so
no language is further along than another, and removing six from
`COMPLETE_LOCALES` would cost real coverage and gain nothing — English is what
those screens fall back to anyway. The two honest options are:

- **keep shipping progressively** (current state) and close the tail, or
- **hold the picker to English only** until the tail is zero.

That is a product call, not a technical one. It is deliberately still open.

---

## 5. Two tooling notes, both paid for once

- **Do not use PowerShell to rewrite source in this repo.** PowerShell 5.1's
  `Get-Content -Raw` decodes as ANSI and `Set-Content -Encoding utf8` re-encodes
  the result — it turned every em-dash in `DoseNotifications.kt` into mojibake,
  65 changed lines for 17 intended edits. Use node, which is UTF-8 by default.
  Also: `git checkout` restores files with **CRLF** here (`core.autocrlf`), so a
  literal `\n` anchor silently misses. Match `\r?\n`.
- **`Select-String -Path` treats `[id]` as a character class**, so it silently
  returns nothing for this repo's dynamic-route files. Use `-LiteralPath`.

---

## 6. What is genuinely out of scope, and why

Excluded from the audit by policy, with reasons printed when it runs:

- **`admin-diagnostics`** — server-gated behind `ADMIN_EMAILS`, which is
  deliberately unset. A maintainer's instrument panel no patient can reach.
- **`.ts` files** no longer run the JSX rule — JSX does not exist in them, and the
  pattern was matching TypeScript generics (`Promise`, `Record`).
- **Developer invariants** (`useTheme must be used within a ThemeProvider`) reach a
  console and Sentry, never a patient.
- **Brand fragments** — `Re-MIND-eЯ` is styled per-syllable in some headers.

Never translated, anywhere: **medication names, dosages, notes, folder names and
people's names**. Frame translates, content is verbatim — see `lib/i18n/format.ts`.
