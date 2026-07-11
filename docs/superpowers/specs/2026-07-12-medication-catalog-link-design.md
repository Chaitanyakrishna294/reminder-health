# Medication Catalog Link (Personal Nickname + Real Medication) — Design Spec

**Date:** 2026-07-12
**Status:** Approved design, pending implementation plan
**Related:** `dataset/A_Z_medicines_dataset_of_India.csv`, `db/migrations/migration_medication_enhancements.sql`,
`web/src/lib/medication-utils.ts`, `web/src/components/medications/medication-form-options.tsx`,
`web/src/components/medical/medical-card.tsx`

## Problem

Today a patient's medication is stored as a single free-text `drug_name` (e.g. "the red
one", "sugar pill", or sometimes an actual brand like "Crocin"). This is fine for the
patient's own reminders, but it is useless to anyone else who needs to know what the
patient is actually taking: a second caregiver in another city, or a doctor reviewing the
patient's record. This app already supports multiple caregivers per patient, so the
ambiguity is not hypothetical — two caregivers can independently log what they believe is
the same medicine as two different free-text entries, with no way for the system to know
they're the same thing.

A newly added dataset (`A_Z_medicines_dataset_of_India.csv`, ~250k rows: brand name,
manufacturer, composition/salt with strength, pack size, discontinued flag, price) makes it
possible to attach a real, structured medication identity to a record, while leaving the
patient's own nickname untouched.

## Goal / non-goals

**Goal:** Let a patient/caregiver optionally link a medication to a real catalog entry
(brand name + composition), confirmed by a human, so the record is more useful to a doctor
or another caregiver — without changing how the patient's own reminders look or feel.

**Non-goals (explicitly deferred, not rejected):**
- **No auto-matching or fuzzy-suggestion.** Fuzzy-matching a vague nickname against 250k
  brand names produces a guess, not a fact — a wrong match shown to a doctor (especially a
  wrong *strength*, since the same brand name exists at multiple strengths in this dataset)
  is worse than today's honest "unknown." Every catalog link in this design is created by a
  human explicitly searching and selecting a row. Nothing in the UI ever asserts a match
  the system inferred on its own.
- **No drug interaction / duplicate-therapy detection.** Real value, but it requires
  correct composition links to be trustworthy, and this build doesn't guarantee coverage
  (many medications will stay unlinked). Becomes buildable once real links exist; not part
  of this ship.
- **No price / generic-substitution UI.** The dataset's price column is a static snapshot
  that rots immediately; shipping money-saving UI off stale numbers is a trust risk in a
  health app, not a convenience.
- **No Telegram bot support.** Bot-added medications stay free-text, as today. The catalog
  search/select UI is web-dashboard only for now; a bot-added medication can still be linked
  later from the web edit page.

## Approach

**Chosen: read-only reference table (`medication_catalog`) + nullable, explicitly-populated
snapshot columns on `medications`, linked only through a human search-and-select control.**

### Data model

- **`medication_catalog`** (new table): one row per CSV row — `brand_name`,
  `manufacturer_name`, `composition_text` (both salt fields from the CSV combined into a
  single display string, rather than forcing every drug into a rigid two-salt schema —
  some have one salt, some have two, and forcing a shape the data doesn't have creates more
  bugs than it prevents), `pack_size_label`, `type`, `is_discontinued`, and `snapshot_date`
  (the date this table was imported/refreshed — one value, stamped once per import).
  Trigram-indexed (`pg_trgm`) on `brand_name` for fast partial/typo-tolerant search. Global
  reference data: readable by any authenticated user, writable only by the import script
  (service role) — no per-user RLS needed since nothing in it is patient-specific.

- **On `medications`, new nullable columns:** `catalog_id`, `linked_brand_name`,
  `linked_composition`, `linked_manufacturer`, `linked_snapshot_date`. When a user picks a
  catalog row, these fields are **copied onto the medication row at that moment** — not
  joined live against `medication_catalog` at read time. This is deliberate: if the catalog
  data is corrected later (a bad import fixed, a discontinued flag updated), that must not
  silently rewrite what a doctor already saw on an existing patient's record. The record
  reflects what was true and selected *at the time of linking*. `catalog_id` is kept purely
  as a reference back to the source row, not as the source of truth for display.

- These `linked_*` fields are written **only** by the explicit search-and-select action
  described below. No other code path (import script, scheduler, bot) ever writes them.

### UI flow

**Wizard (Details step):** directly under the existing nickname field, an optional,
collapsed "Link to real medication (optional)" control — visually secondary, never
competing with the nickname input, never blocking progression to the next step. Expanding
it opens a search box; typing queries `medication_catalog` and shows matching rows (brand
name, composition, manufacturer, pack size), with a visible "Discontinued" badge on rows
where `is_discontinued` is true — shown, not hidden, so staleness is disclosed rather than
silently misleading. Selecting a row shows a one-line confirmation ("You selected: Augmentin
625 Duo Tablet — Amoxycillin 500mg + Clavulanic Acid 125mg") before it's committed, so the
save is a deliberate confirmation, not an instant silent write. The user can clear and
re-search, or skip entirely and continue — leaving a medication unlinked is identical to
today's behavior, no regression.

**Edit-medication page:** the same control, pre-seeded with the current link if one exists,
so a link can be added, changed, or removed at any time after creation. This is also how
existing (pre-feature) medications get retrofitted — on the caregiver's own schedule, not
all at once.

**Display, everywhere a medication appears** (medication list, medication detail, the
caregiver-gated Medical Card): the nickname remains the primary, bolded label, unchanged
from today. If a catalog link exists, the composition appears as a secondary line labeled
"Patient-selected from catalog · as of `<snapshot date>`" — small text, not a headline claim
— carrying the discontinued badge through if applicable. The UI never uses the phrase
"actual medication" or implies the system verified anything; it always attributes the link
to a human choice.

### Import mechanism

The CSV is loaded via a one-off script (e.g. `db/scripts/import-medication-catalog.js` or a
`psql \copy`), not a numbered runtime migration — this is a 250k-row bulk data load, not
schema DDL, and doesn't belong in the same migration chain as `migration_*.sql` files.
Idempotent (truncate-and-reload or upsert-by-natural-key) so a future refreshed CSV can be
re-imported safely, updating `snapshot_date` for the whole table.

### Error handling / edge cases

- **No search results:** plain "No match found — you can leave this unlinked" message, not
  an error state, since staying unlinked is the existing default.
- **Search/catalog table unavailable:** the link control fails open — hide or disable it
  quietly, and the wizard/edit page continue working normally. This is optional metadata; it
  must never be able to block adding or editing a medication.
- **Same brand name/strength sold by multiple manufacturers:** shown as separate rows, as
  the CSV has them; the user picks whichever specific row matches their strip.

## Testing

Manual verification: search returns sane results for exact and partial/typo brand input;
selecting a row correctly populates and displays the snapshot fields; the edit page can add,
change, and clear an existing link; the discontinued badge and snapshot date render
correctly; and this feature does not touch `next_reminder_at`, the scheduler, or any
reminder-firing logic — it is display and one new reference table only.

## Rationale (from adversarial review)

This design was stress-tested with a two-round for/against debate before being written up.
The strongest surviving points from each side, which directly shaped the decisions above:

- **For:** free-text ambiguity is a real, structural problem in a multi-caregiver app, not a
  hypothetical one; a resolved composition is what makes future interaction/duplicate-check
  features possible at all; doing this while the dataset is fresh is cheaper than retrofitting
  thousands of legacy free-text rows later.
- **Against:** auto-matching vague input against 250k rows produces false confidence, not
  facts; wrong-strength matches are a safety defect, not a UX bug; a static CSV snapshot
  rots (`is_discontinued`, price) the day it's imported and nobody will maintain a quarterly
  re-import; coverage will always skew toward well-known branded drugs.
- **Where both sides converged:** every risk raised by the "against" side is specific to
  *auto*-resolution. A human-confirmed search-and-select model — the design above — carries
  the "for" side's benefits without the "against" side's risks, because no algorithm ever
  asserts an identity; a person does.
