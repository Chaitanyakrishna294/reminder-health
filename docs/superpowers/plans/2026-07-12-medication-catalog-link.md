# Medication Catalog Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a patient/caregiver optionally link a medication to a real catalog entry (brand name + generic composition, from the ~254k-row India medicines dataset) via explicit human search-and-select, while the patient's own nickname stays the required, unchanged, primary label everywhere.

**Architecture:** A new read-only `medication_catalog` table (trigram-indexed for typo-tolerant search) plus six nullable `linked_*`/`catalog_id` columns on `medications`, populated only when a user searches and picks a row via a `search_medication_catalog` RPC. Values are copied onto the medication row at selection time (never live-joined), so a later catalog refresh can't silently rewrite what a doctor already saw. A shared `MedicationCatalogLink` component is wired into both the add-medicine wizard and the edit page through the existing `buildSharedMedicationFields` seam those two pages already funnel through.

**Tech Stack:** Supabase Postgres (SQL migration, `pg_trgm`, `plpgsql` function), Next.js 16 client components (React 19, TypeScript), `@supabase/supabase-js` (browser client + a one-off Node import script), `csv-parse` (new, import-script-only dependency).

## Global Constraints

- DB migrations are `.sql` files under `db/migrations/`, applied manually by the maintainer via the Supabase SQL editor (project `jaflclnakwtikqbfhfdk`) — no task may attempt to apply one itself.
- The CSV import script (`db/scripts/import-medication-catalog.js`) is run manually by the maintainer from their own machine (it needs `SUPABASE_URL`/`SUPABASE_KEY` — the service role key — from the repo-root `.env`, since it bypasses RLS to write). No task runs it against the live project itself.
- **No auto-matching, ever.** `linked_brand_name`/`linked_composition`/`linked_manufacturer`/`linked_snapshot_date`/`linked_is_discontinued`/`catalog_id` on `medications` are written **only** by a user explicitly selecting a row in `MedicationCatalogLink`. No code path (import script, a hook, a default) ever populates them automatically.
- `drug_name` (the nickname) is untouched by this plan: still required, still free-text, still the primary bolded label everywhere a medication is shown. The catalog link is always optional and secondary.
- UI copy must always say "Patient-selected from catalog" (or equivalent, attributing the choice to the human) — never "actual medication," "resolved," "verified," or any phrasing implying the system determined the match itself.
- This feature is web-dashboard only. The bot (`src/`, deployed on Render) is not touched by any task in this plan.
- Web deploys from `web/` (Vercel monorepo, `directory: web`).
- Commit message trailer for every commit: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Work on the current branch (`main`). Do not create branches.

---

### Task 1: `medication_catalog` schema, RLS, and search RPC

**Files:**
- Create: `db/migrations/migration_medication_catalog_2026_07.sql`

**Interfaces:**
- Produces: table `public.medication_catalog` (`id`, `brand_name`, `manufacturer_name`, `composition_text`, `pack_size_label`, `type`, `is_discontinued`, `snapshot_date`); function `public.search_medication_catalog(p_query text, p_limit int DEFAULT 20) RETURNS TABLE(id bigint, brand_name text, manufacturer_name text, composition_text text, pack_size_label text, is_discontinued boolean, snapshot_date date)`; six new nullable columns on `public.medications`: `catalog_id`, `linked_brand_name`, `linked_composition`, `linked_manufacturer`, `linked_snapshot_date`, `linked_is_discontinued`.

Note: the design spec (`docs/superpowers/specs/2026-07-12-medication-catalog-link-design.md`) lists five `linked_*` columns and doesn't call out discontinued status. This migration adds a sixth, `linked_is_discontinued`, for consistency with the spec's own "copied at selection time, never live-joined" principle — without it, showing a discontinued badge on an already-linked medication would require a live join back to `medication_catalog`, which is exactly what the spec says to avoid.

This task only creates and commits the migration file. Do NOT apply it to any database — that is a separate manual step by the maintainer (Step 3).

- [ ] **Step 1: Write the migration file**

Create `db/migrations/migration_medication_catalog_2026_07.sql` with exactly this content:

```sql
-- medication_catalog: read-only reference data (India medicines dataset, imported by
-- db/scripts/import-medication-catalog.js) used to let a patient/caregiver OPTIONALLY
-- link a medication to a real brand + generic composition, via explicit human
-- search-and-select only — no auto-matching. See
-- docs/superpowers/specs/2026-07-12-medication-catalog-link-design.md.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.medication_catalog (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_name text NOT NULL,
  manufacturer_name text,
  composition_text text,
  pack_size_label text,
  type text,
  is_discontinued boolean NOT NULL DEFAULT false,
  snapshot_date date NOT NULL
);

-- Trigram index powers both substring search and the similarity()-ranked fuzzy search in
-- search_medication_catalog below, against ~254k brand names.
CREATE INDEX medication_catalog_brand_name_trgm_idx
  ON public.medication_catalog USING gin (brand_name gin_trgm_ops);

-- Global reference data: any authenticated user may read it. Nothing in this table is
-- patient-specific, so there is no per-row ownership to filter by. Writes happen only via
-- the service_role import script (db/scripts/import-medication-catalog.js), which bypasses
-- RLS entirely — no INSERT/UPDATE/DELETE policy is defined for any client role.
ALTER TABLE public.medication_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read medication catalog"
  ON public.medication_catalog FOR SELECT
  TO authenticated
  USING (true);

-- Fuzzy, typo-tolerant search backing the "Link to real medication" UI. Returns nothing
-- for a query under 2 characters (avoids a full-table trigram scan on near-empty input).
-- Default SECURITY INVOKER is sufficient: it only reads through the SELECT policy above.
CREATE OR REPLACE FUNCTION public.search_medication_catalog(p_query text, p_limit int DEFAULT 20)
RETURNS TABLE (
  id bigint,
  brand_name text,
  manufacturer_name text,
  composition_text text,
  pack_size_label text,
  is_discontinued boolean,
  snapshot_date date
)
LANGUAGE plpgsql
STABLE
SET search_path = 'public'
AS $$
BEGIN
  IF p_query IS NULL OR length(trim(p_query)) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.id, c.brand_name, c.manufacturer_name, c.composition_text, c.pack_size_label,
         c.is_discontinued, c.snapshot_date
  FROM public.medication_catalog c
  WHERE c.brand_name % p_query
  ORDER BY similarity(c.brand_name, p_query) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_medication_catalog(text, int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.search_medication_catalog(text, int) FROM anon;

-- Nullable, populated ONLY by an explicit human search-and-select action in
-- MedicationCatalogLink (web/src/components/medications/medication-catalog-link.tsx) —
-- never by any matching algorithm. Values are copied at selection time, not live-joined
-- against medication_catalog, so a later catalog refresh (re-running the import script)
-- cannot silently rewrite what a doctor already saw on an existing patient's record.
-- ON DELETE SET NULL: if a re-imported catalog replaces the referenced row, catalog_id
-- goes null but the linked_* display fields are untouched — the record still shows what
-- the patient originally selected.
ALTER TABLE public.medications
  ADD COLUMN IF NOT EXISTS catalog_id bigint NULL
    REFERENCES public.medication_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_brand_name text NULL,
  ADD COLUMN IF NOT EXISTS linked_composition text NULL,
  ADD COLUMN IF NOT EXISTS linked_manufacturer text NULL,
  ADD COLUMN IF NOT EXISTS linked_snapshot_date date NULL,
  ADD COLUMN IF NOT EXISTS linked_is_discontinued boolean NULL;
```

- [ ] **Step 2: Commit**

```bash
git add db/migrations/migration_medication_catalog_2026_07.sql
git commit -m "$(cat <<'EOF'
feat(db): add medication_catalog table, search RPC, and medications link columns

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Ask the maintainer to apply it**

Post to the maintainer: "Apply `db/migrations/migration_medication_catalog_2026_07.sql` in the Supabase SQL editor (project `jaflclnakwtikqbfhfdk`), then confirm." Verify by running in the SQL editor:

```sql
SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
```

Expected: one row.

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='medication_catalog'
ORDER BY ordinal_position;
```

Expected: `id`, `brand_name`, `manufacturer_name`, `composition_text`, `pack_size_label`, `type`, `is_discontinued`, `snapshot_date`.

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='medications'
AND column_name LIKE 'linked_%' OR column_name = 'catalog_id'
ORDER BY column_name;
```

Expected: `catalog_id`, `linked_brand_name`, `linked_composition`, `linked_is_discontinued`, `linked_manufacturer`, `linked_snapshot_date`.

```sql
SELECT routine_name FROM information_schema.routines WHERE routine_name = 'search_medication_catalog';
```

Expected: one row.

---

### Task 2: CSV import script

**Files:**
- Create: `db/scripts/import-medication-catalog.js`
- Create: `test/medication-catalog-import.test.js`
- Modify: `package.json` (root) — add `csv-parse` devDependency

**Interfaces:**
- Consumes: `dataset/A_Z_medicines_dataset_of_India.csv` (columns: `id`, `name`, `price(₹)`, `Is_discontinued`, `manufacturer_name`, `type`, `pack_size_label`, `short_composition1`, `short_composition2`); `medication_catalog` table from Task 1.
- Produces: `mapRow(csvRow)` — exported pure function, `{ brand_name, manufacturer_name, composition_text, pack_size_label, type, is_discontinued }`. Later tasks do not depend on this script directly.

- [ ] **Step 1: Install the CSV parsing dependency**

Run: `npm install --save-dev csv-parse`

Expected: `package.json` (root) gains a `csv-parse` entry under `devDependencies`.

- [ ] **Step 2: Write the failing test for `mapRow`**

Create `test/medication-catalog-import.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { mapRow } = require('../db/scripts/import-medication-catalog');

// mapRow turns one raw CSV row into a medication_catalog insert row. Guards the two
// real edge cases in the dataset: rows with only one composition salt, and the
// TRUE/FALSE string encoding of is_discontinued.

test('combines both composition fields with a separator, trims whitespace', () => {
  const row = mapRow({
    name: 'Augmentin 625 Duo Tablet',
    manufacturer_name: 'Glaxo SmithKline Pharmaceuticals Ltd',
    type: 'allopathy',
    pack_size_label: 'strip of 10 tablets',
    short_composition1: 'Amoxycillin  (500mg) ',
    short_composition2: '  Clavulanic Acid (125mg)',
    Is_discontinued: 'FALSE',
  });
  assert.strictEqual(row.brand_name, 'Augmentin 625 Duo Tablet');
  assert.strictEqual(row.manufacturer_name, 'Glaxo SmithKline Pharmaceuticals Ltd');
  assert.strictEqual(row.composition_text, 'Amoxycillin  (500mg) + Clavulanic Acid (125mg)');
  assert.strictEqual(row.pack_size_label, 'strip of 10 tablets');
  assert.strictEqual(row.type, 'allopathy');
  assert.strictEqual(row.is_discontinued, false);
});

test('falls back to a single composition when short_composition2 is empty', () => {
  const row = mapRow({
    name: 'Azithral 500 Tablet',
    manufacturer_name: 'Alembic Pharmaceuticals Ltd',
    type: 'allopathy',
    pack_size_label: 'strip of 5 tablets',
    short_composition1: 'Azithromycin (500mg)',
    short_composition2: '',
    Is_discontinued: 'FALSE',
  });
  assert.strictEqual(row.composition_text, 'Azithromycin (500mg)');
});

test('parses is_discontinued case-insensitively', () => {
  const discontinued = mapRow({
    name: 'Cervarix Vaccine', manufacturer_name: 'GSK', type: 'allopathy',
    pack_size_label: '', short_composition1: '', short_composition2: '',
    Is_discontinued: 'TRUE',
  });
  assert.strictEqual(discontinued.is_discontinued, true);

  const lower = mapRow({
    name: 'Some Drug', manufacturer_name: 'X', type: 'allopathy',
    pack_size_label: '', short_composition1: '', short_composition2: '',
    Is_discontinued: 'true',
  });
  assert.strictEqual(lower.is_discontinued, true);
});

test('blank optional fields become null, not empty strings', () => {
  const row = mapRow({
    name: 'Generic Tablet',
    manufacturer_name: '',
    type: '',
    pack_size_label: '',
    short_composition1: '',
    short_composition2: '',
    Is_discontinued: 'FALSE',
  });
  assert.strictEqual(row.manufacturer_name, null);
  assert.strictEqual(row.type, null);
  assert.strictEqual(row.pack_size_label, null);
  assert.strictEqual(row.composition_text, null);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../db/scripts/import-medication-catalog'` (the file doesn't exist yet).

- [ ] **Step 4: Write the import script**

Create `db/scripts/import-medication-catalog.js`:

```js
#!/usr/bin/env node
// One-off loader for dataset/A_Z_medicines_dataset_of_India.csv into
// public.medication_catalog. Safe to re-run: it clears and re-inserts the whole table,
// so a refreshed CSV can be reloaded later. Any medications.catalog_id pointing at a
// replaced row is set to NULL by that column's ON DELETE SET NULL (see
// db/migrations/migration_medication_catalog_2026_07.sql) — expected and harmless,
// because a medication's linked_brand_name/linked_composition/etc. were copied at
// selection time and are untouched by this reload. See
// docs/superpowers/specs/2026-07-12-medication-catalog-link-design.md.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');

const CSV_PATH = path.join(__dirname, '../../dataset/A_Z_medicines_dataset_of_India.csv');
const BATCH_SIZE = 500;

function mapRow(row) {
  const composition = [row.short_composition1, row.short_composition2]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(' + ');

  return {
    brand_name: (row.name || '').trim(),
    manufacturer_name: (row.manufacturer_name || '').trim() || null,
    composition_text: composition || null,
    pack_size_label: (row.pack_size_label || '').trim() || null,
    type: (row.type || '').trim() || null,
    is_discontinued: (row.Is_discontinued || '').trim().toUpperCase() === 'TRUE',
  };
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('SUPABASE_URL / SUPABASE_KEY missing in environment. Aborting.');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`Reading ${CSV_PATH}...`);
  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(csvText, { columns: true, skip_empty_lines: true });
  console.log(`Parsed ${records.length} rows.`);

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const rows = records.map((r) => ({ ...mapRow(r), snapshot_date: snapshotDate }));

  console.log('Clearing existing medication_catalog rows...');
  const { error: deleteErr } = await supabase.from('medication_catalog').delete().not('id', 'is', null);
  if (deleteErr) {
    console.error('Failed to clear medication_catalog:', deleteErr);
    process.exit(1);
  }

  console.log(`Inserting ${rows.length} rows in batches of ${BATCH_SIZE}...`);
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('medication_catalog').insert(batch);
    if (error) {
      console.error(`Failed at batch starting row ${i}:`, error);
      process.exit(1);
    }
    if (i % (BATCH_SIZE * 20) === 0) {
      console.log(`  ...${i + batch.length}/${rows.length}`);
    }
  }

  console.log(`Done. Imported ${rows.length} rows with snapshot_date ${snapshotDate}.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
  });
}

module.exports = { mapRow };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: all tests in `test/medication-catalog-import.test.js` PASS, and all pre-existing suites (`test/utils.test.js`, `test/reminders.test.js`) still PASS.

- [ ] **Step 6: Commit**

```bash
git add db/scripts/import-medication-catalog.js test/medication-catalog-import.test.js package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(db): add medication_catalog CSV import script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Ask the maintainer to run the import**

This requires Task 1's migration to already be applied (Task 1 Step 3). Post to the maintainer: "Run `node db/scripts/import-medication-catalog.js` from the repo root (needs `SUPABASE_URL`/`SUPABASE_KEY` in your root `.env`) to load the catalog. It will log progress and a final row count." Verify in the Supabase SQL editor:

```sql
SELECT count(*) FROM public.medication_catalog;
```

Expected: `253973` (or close to it, depending on the CSV's exact row count at import time).

---

### Task 3: Catalog search client helper

**Files:**
- Create: `web/src/lib/medications/catalog.ts`

**Interfaces:**
- Consumes: `search_medication_catalog` RPC from Task 1.
- Produces: `CatalogLinkValue` type, `CatalogSearchResult` type, `searchMedicationCatalog(supabase, query): Promise<CatalogSearchResult[]>` — used by Task 4's component.

- [ ] **Step 1: Write the helper**

Create `web/src/lib/medications/catalog.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

// A row a user has explicitly selected from the medication catalog, ready to be spread
// onto a medications insert/update via buildSharedMedicationFields (form-logic.ts).
// Never populated by any matching algorithm — only by an explicit pick in
// MedicationCatalogLink. See docs/superpowers/specs/2026-07-12-medication-catalog-link-design.md.
export interface CatalogLinkValue {
  catalogId: number;
  brandName: string;
  composition: string | null;
  manufacturer: string | null;
  isDiscontinued: boolean;
  snapshotDate: string;
}

export interface CatalogSearchResult {
  id: number;
  brand_name: string;
  manufacturer_name: string | null;
  composition_text: string | null;
  pack_size_label: string | null;
  is_discontinued: boolean;
  snapshot_date: string;
}

/**
 * Typo-tolerant search against medication_catalog via the search_medication_catalog RPC.
 * Fails open: on any error it logs and returns an empty list rather than throwing, so a
 * catalog outage can never block adding or editing a medication.
 */
export async function searchMedicationCatalog(
  supabase: SupabaseClient,
  query: string,
): Promise<CatalogSearchResult[]> {
  const { data, error } = await supabase.rpc('search_medication_catalog', {
    p_query: query,
    p_limit: 20,
  });
  if (error) {
    console.error('[searchMedicationCatalog] RPC error:', error);
    return [];
  }
  return (data as CatalogSearchResult[]) || [];
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/medications/catalog.ts
git commit -m "$(cat <<'EOF'
feat(web): add medication catalog search helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `MedicationCatalogLink` component

**Files:**
- Create: `web/src/components/medications/medication-catalog-link.tsx`

**Interfaces:**
- Consumes: `searchMedicationCatalog`, `CatalogLinkValue`, `CatalogSearchResult` from Task 3; `createClient` from `@/lib/supabase/client` (existing).
- Produces: `<MedicationCatalogLink value={CatalogLinkValue | null} onChange={(v: CatalogLinkValue | null) => void} />` — a self-contained collapsed-by-default control (search box → results list → selected-state summary with a remove action). Used by Task 6 (wizard) and Task 7 (edit form).

- [ ] **Step 1: Write the component**

Create `web/src/components/medications/medication-catalog-link.tsx`:

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { searchMedicationCatalog, type CatalogLinkValue, type CatalogSearchResult } from '@/lib/medications/catalog';
import { Search, X, ShieldAlert } from 'lucide-react';

interface MedicationCatalogLinkProps {
  value: CatalogLinkValue | null;
  onChange: (value: CatalogLinkValue | null) => void;
}

function toLinkValue(row: CatalogSearchResult): CatalogLinkValue {
  return {
    catalogId: row.id,
    brandName: row.brand_name,
    composition: row.composition_text,
    manufacturer: row.manufacturer_name,
    isDiscontinued: row.is_discontinued,
    snapshotDate: row.snapshot_date,
  };
}

export default function MedicationCatalogLink({ value, onChange }: MedicationCatalogLinkProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      const rows = await searchMedicationCatalog(supabase, query.trim());
      setResults(rows);
      setSearching(false);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  if (value) {
    return (
      <div className="mt-2 flex items-start justify-between gap-3 rounded-2xl bg-[#F2F2F7] px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-foreground truncate">
            Linked: {value.brandName}
            {value.isDiscontinued && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground align-middle">
                <ShieldAlert className="w-3 h-3" /> Discontinued
              </span>
            )}
          </p>
          {value.composition && (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{value.composition}</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Patient-selected from catalog · as of {value.snapshotDate}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Remove catalog link"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-primary"
      >
        <Search className="w-3.5 h-3.5" /> Link to real medication (optional)
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brand name, e.g. Augmentin"
          autoFocus
          className="flex-1 rounded-2xl bg-[#F2F2F7] px-3.5 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="button"
          onClick={() => { setOpen(false); setQuery(''); setResults([]); }}
          className="text-xs font-semibold text-muted-foreground"
        >
          Cancel
        </button>
      </div>

      {searching && <p className="text-[11px] text-muted-foreground">Searching...</p>}

      {!searching && query.trim().length >= 2 && results.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No match found — you can leave this unlinked.</p>
      )}

      {results.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-2xl border border-border divide-y divide-border">
          {results.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => { onChange(toLinkValue(row)); setOpen(false); setQuery(''); setResults([]); }}
              className="w-full text-left px-3.5 py-2.5 hover:bg-muted/50"
            >
              <p className="text-xs font-bold text-foreground truncate">
                {row.brand_name}
                {row.is_discontinued && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground align-middle">
                    Discontinued
                  </span>
                )}
              </p>
              {row.composition_text && (
                <p className="text-[11px] text-muted-foreground truncate">{row.composition_text}</p>
              )}
              <p className="text-[10px] text-muted-foreground">
                {row.manufacturer_name}{row.pack_size_label ? ` · ${row.pack_size_label}` : ''}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/medications/medication-catalog-link.tsx
git commit -m "$(cat <<'EOF'
feat(web): add MedicationCatalogLink search-and-select component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Extend shared form logic

**Files:**
- Modify: `web/src/lib/medications/form-logic.ts`

**Interfaces:**
- Consumes: `CatalogLinkValue` from Task 3.
- Produces: `MedicationFormState.catalogLink: CatalogLinkValue | null` (new field); `buildSharedMedicationFields` now also returns `catalog_id`, `linked_brand_name`, `linked_composition`, `linked_manufacturer`, `linked_snapshot_date`, `linked_is_discontinued`. Consumed by Task 6 and Task 7.

- [ ] **Step 1: Add the import and the field**

In `web/src/lib/medications/form-logic.ts`, find this exact block:

```ts
// Presentation-neutral logic shared by the "new" and "edit" medication wizards.
// The two pages keep their own (intentionally divergent) markup and styling, but the
// per-step validation rules and the medication row fields they write are identical —
// centralized here so the two can never silently drift apart.

export const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The wizard fields that drive validation and the persisted medication row. */
export interface MedicationFormState {
  drugName: string;
  frequency: string;
  times: string[];
  dosageAmount: number;
  strength: string;
  enableInventory: boolean;
  currentStock: string;
  stockThreshold: string;
  medicationReason: string;
  priority: string;
  unitType: string;
}
```

Replace with:

```ts
// Presentation-neutral logic shared by the "new" and "edit" medication wizards.
// The two pages keep their own (intentionally divergent) markup and styling, but the
// per-step validation rules and the medication row fields they write are identical —
// centralized here so the two can never silently drift apart.

import type { CatalogLinkValue } from '@/lib/medications/catalog';

export const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The wizard fields that drive validation and the persisted medication row. */
export interface MedicationFormState {
  drugName: string;
  frequency: string;
  times: string[];
  dosageAmount: number;
  strength: string;
  enableInventory: boolean;
  currentStock: string;
  stockThreshold: string;
  medicationReason: string;
  priority: string;
  unitType: string;
  /** Optional, explicit human-selected catalog link. Never auto-populated. */
  catalogLink: CatalogLinkValue | null;
}
```

- [ ] **Step 2: Extend `buildSharedMedicationFields`**

In the same file, find this exact block:

```ts
export function buildSharedMedicationFields(
  s: MedicationFormState,
  sortedTimes: string[],
) {
  return {
    drug_name: s.drugName.trim(),
    dosage: s.strength.trim() || 'N/A',
    frequency: s.frequency,
    reminder_times: sortedTimes,
    unit_type: s.unitType,
    dosage_amount: Number(s.dosageAmount),
    current_stock: s.enableInventory && s.currentStock !== '' ? Number(s.currentStock) : null,
    stock_threshold: s.enableInventory && s.stockThreshold !== '' ? Number(s.stockThreshold) : null,
    medication_reason: s.medicationReason.trim() || null,
    priority_level: s.priority,
    low_stock_alert_enabled: s.enableInventory,
  };
}
```

Replace with:

```ts
export function buildSharedMedicationFields(
  s: MedicationFormState,
  sortedTimes: string[],
) {
  return {
    drug_name: s.drugName.trim(),
    dosage: s.strength.trim() || 'N/A',
    frequency: s.frequency,
    reminder_times: sortedTimes,
    unit_type: s.unitType,
    dosage_amount: Number(s.dosageAmount),
    current_stock: s.enableInventory && s.currentStock !== '' ? Number(s.currentStock) : null,
    stock_threshold: s.enableInventory && s.stockThreshold !== '' ? Number(s.stockThreshold) : null,
    medication_reason: s.medicationReason.trim() || null,
    priority_level: s.priority,
    low_stock_alert_enabled: s.enableInventory,
    // Copied at selection time from an explicit human pick (MedicationCatalogLink) —
    // never auto-matched. null when nothing was linked.
    catalog_id: s.catalogLink?.catalogId ?? null,
    linked_brand_name: s.catalogLink?.brandName ?? null,
    linked_composition: s.catalogLink?.composition ?? null,
    linked_manufacturer: s.catalogLink?.manufacturer ?? null,
    linked_snapshot_date: s.catalogLink?.snapshotDate ?? null,
    linked_is_discontinued: s.catalogLink?.isDiscontinued ?? null,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: FAIL — `new/page.tsx` and `edit-form.tsx` call `buildSharedMedicationFields` with an object missing `catalogLink`, and TypeScript will flag it. This is expected; Tasks 6 and 7 fix both call sites next.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/medications/form-logic.ts
git commit -m "$(cat <<'EOF'
feat(web): thread catalog link fields through buildSharedMedicationFields

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Wire into the add-medicine wizard

**Files:**
- Modify: `web/src/app/(dashboard)/medications/new/page.tsx:1-27` (imports), `:32-55` (state), `:174-187` (submit payload), `:298-311` (Details step JSX)

**Interfaces:**
- Consumes: `MedicationCatalogLink` (Task 4), `CatalogLinkValue` (Task 3), the updated `buildSharedMedicationFields` (Task 5).

- [ ] **Step 1: Add the imports**

In `web/src/app/(dashboard)/medications/new/page.tsx`, find this exact line:

```ts
import { type UnitType, unitOptions, stepMeta, frequencies, priorities } from '@/components/medications/medication-form-options';
```

Replace with:

```ts
import { type UnitType, unitOptions, stepMeta, frequencies, priorities } from '@/components/medications/medication-form-options';
import MedicationCatalogLink from '@/components/medications/medication-catalog-link';
import type { CatalogLinkValue } from '@/lib/medications/catalog';
```

- [ ] **Step 2: Add the state**

Find this exact line:

```ts
  const [drugName, setDrugName] = useState('');
```

Replace with:

```ts
  const [drugName, setDrugName] = useState('');
  const [catalogLink, setCatalogLink] = useState<CatalogLinkValue | null>(null);
```

- [ ] **Step 3: Include it in the insert payload**

Find this exact block:

```ts
          ...buildSharedMedicationFields(
            { drugName, frequency, times, dosageAmount, strength, enableInventory, currentStock, stockThreshold, medicationReason, priority, unitType },
            sortedTimes,
          ),
```

Replace with:

```ts
          ...buildSharedMedicationFields(
            { drugName, frequency, times, dosageAmount, strength, enableInventory, currentStock, stockThreshold, medicationReason, priority, unitType, catalogLink },
            sortedTimes,
          ),
```

- [ ] **Step 4: Render the control in the Details step**

Find this exact block:

```tsx
                  <div>
                    <label className={labelClass}>Medication Name</label>
                    <input
                      type="text"
                      required
                      value={drugName}
                      onChange={(e) => setDrugName(e.target.value)}
                      className={inputClass}
                      placeholder="e.g., Paracetamol, Atorvastatin"
                      autoFocus
                    />
                  </div>
                  
                  <div>
                    <label className={labelClass}>Medication Form</label>
```

Replace with:

```tsx
                  <div>
                    <label className={labelClass}>Medication Name</label>
                    <input
                      type="text"
                      required
                      value={drugName}
                      onChange={(e) => setDrugName(e.target.value)}
                      className={inputClass}
                      placeholder="e.g., Paracetamol, Atorvastatin"
                      autoFocus
                    />
                    <MedicationCatalogLink value={catalogLink} onChange={setCatalogLink} />
                  </div>
                  
                  <div>
                    <label className={labelClass}>Medication Form</label>
```

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0 for this file (the `edit-form.tsx` error from Task 5 Step 3 still exists until Task 7 — that's expected).

- [ ] **Step 6: Commit**

```bash
git add "web/src/app/(dashboard)/medications/new/page.tsx"
git commit -m "$(cat <<'EOF'
feat(web): wire MedicationCatalogLink into the add-medicine wizard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire into the edit-medication page

**Files:**
- Modify: `web/src/app/(dashboard)/medications/[id]/edit-form.tsx:1-45` (imports + props interface), `:47-54` (state), `:159-164` (update payload), `:269-282` (Details step JSX)

**Interfaces:**
- Consumes: same as Task 6. Also relies on `EditMedicationPage` (`web/src/app/(dashboard)/medications/[id]/page.tsx`) already doing `select('*')` (line 39) — the new columns arrive automatically, no query change needed there.

- [ ] **Step 1: Add the imports and extend the props interface**

Find this exact block:

```ts
import { type UnitType, unitOptions, stepMeta, frequencies, priorities } from '@/components/medications/medication-form-options';
import { validateMedicationStep, buildSharedMedicationFields } from '@/lib/medications/form-logic';
import {
  Pill,
  Clock,
  Layers,
  ShieldAlert,
  Check,
  ArrowLeft,
  ArrowRight,
  FileText,
  Beaker,
  AlertTriangle,
  Minus,
  Plus,
} from 'lucide-react';

interface EditMedicationFormProps {
  medication: {
    id: number;
    telegram_id: string;
    drug_name: string;
    dosage: string;
    frequency: string;
    reminder_times: string[];
    tablet_count: number;
    priority_level: string;
    active: boolean;
    low_stock_alert_enabled: boolean;
    unit_type?: string;
    dosage_amount?: number;
    current_stock?: number | null;
    stock_threshold?: number | null;
    medication_reason?: string | null;
    timezone?: string | null;
  };
}
```

Replace with:

```ts
import { type UnitType, unitOptions, stepMeta, frequencies, priorities } from '@/components/medications/medication-form-options';
import { validateMedicationStep, buildSharedMedicationFields } from '@/lib/medications/form-logic';
import MedicationCatalogLink from '@/components/medications/medication-catalog-link';
import type { CatalogLinkValue } from '@/lib/medications/catalog';
import {
  Pill,
  Clock,
  Layers,
  ShieldAlert,
  Check,
  ArrowLeft,
  ArrowRight,
  FileText,
  Beaker,
  AlertTriangle,
  Minus,
  Plus,
} from 'lucide-react';

interface EditMedicationFormProps {
  medication: {
    id: number;
    telegram_id: string;
    drug_name: string;
    dosage: string;
    frequency: string;
    reminder_times: string[];
    tablet_count: number;
    priority_level: string;
    active: boolean;
    low_stock_alert_enabled: boolean;
    unit_type?: string;
    dosage_amount?: number;
    current_stock?: number | null;
    stock_threshold?: number | null;
    medication_reason?: string | null;
    timezone?: string | null;
    catalog_id?: number | null;
    linked_brand_name?: string | null;
    linked_composition?: string | null;
    linked_manufacturer?: string | null;
    linked_snapshot_date?: string | null;
    linked_is_discontinued?: boolean | null;
  };
}
```

- [ ] **Step 2: Add the state, seeded from the existing link if present**

Find this exact line:

```ts
  const [drugName, setDrugName] = useState(medication.drug_name);
```

Replace with:

```ts
  const [drugName, setDrugName] = useState(medication.drug_name);
  const [catalogLink, setCatalogLink] = useState<CatalogLinkValue | null>(
    medication.catalog_id
      ? {
          catalogId: medication.catalog_id,
          brandName: medication.linked_brand_name || '',
          composition: medication.linked_composition ?? null,
          manufacturer: medication.linked_manufacturer ?? null,
          isDiscontinued: medication.linked_is_discontinued ?? false,
          snapshotDate: medication.linked_snapshot_date || '',
        }
      : null
  );
```

- [ ] **Step 3: Include it in the update payload**

Find this exact block:

```ts
          ...buildSharedMedicationFields(
            { drugName, frequency, times, dosageAmount, strength, enableInventory, currentStock, stockThreshold, medicationReason, priority, unitType },
            sortedTimes,
          ),
```

Replace with:

```ts
          ...buildSharedMedicationFields(
            { drugName, frequency, times, dosageAmount, strength, enableInventory, currentStock, stockThreshold, medicationReason, priority, unitType, catalogLink },
            sortedTimes,
          ),
```

- [ ] **Step 4: Render the control in the Details step**

Find this exact block:

```tsx
                <div>
                  <label className={labelClass}>Medication Name</label>
                  <input
                    type="text"
                    required
                    value={drugName}
                    onChange={(e) => setDrugName(e.target.value)}
                    className={inputClass}
                    placeholder="e.g., Paracetamol"
                    autoFocus
                  />
                </div>
                
                <div>
                  <label className={labelClass}>Medication Form</label>
```

Replace with:

```tsx
                <div>
                  <label className={labelClass}>Medication Name</label>
                  <input
                    type="text"
                    required
                    value={drugName}
                    onChange={(e) => setDrugName(e.target.value)}
                    className={inputClass}
                    placeholder="e.g., Paracetamol"
                    autoFocus
                  />
                  <MedicationCatalogLink value={catalogLink} onChange={setCatalogLink} />
                </div>
                
                <div>
                  <label className={labelClass}>Medication Form</label>
```

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0 (this clears the error introduced in Task 5 Step 3, since both call sites now pass `catalogLink`).

- [ ] **Step 6: Commit**

```bash
git add "web/src/app/(dashboard)/medications/[id]/edit-form.tsx"
git commit -m "$(cat <<'EOF'
feat(web): wire MedicationCatalogLink into the edit-medication page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Display the link on the medication list

**Files:**
- Modify: `web/src/components/medications/medication-list.tsx:14-31` (interface), `:118` (select query), `:284-294` (card JSX)
- Modify: `web/src/app/(dashboard)/medications/page.tsx:18-23` (select query)

**Interfaces:**
- Consumes: the six new columns on `medications` (Task 1). No new exported interfaces; this is a display-only change.

- [ ] **Step 1: Extend the `Medication` interface**

In `web/src/components/medications/medication-list.tsx`, find this exact block:

```ts
export interface Medication {
  id: number;
  telegram_id: string;
  drug_name: string;
  dosage: string;
  frequency: string;
  reminder_times: string[];
  tablet_count: number;
  priority_level: string;
  next_reminder_at: string | null;
  active: boolean;
  unit_type?: string;
  dosage_amount?: number;
  current_stock?: number | null;
  stock_threshold?: number | null;
  medication_reason?: string | null;
  timezone?: string | null;
}
```

Replace with:

```ts
export interface Medication {
  id: number;
  telegram_id: string;
  drug_name: string;
  dosage: string;
  frequency: string;
  reminder_times: string[];
  tablet_count: number;
  priority_level: string;
  next_reminder_at: string | null;
  active: boolean;
  unit_type?: string;
  dosage_amount?: number;
  current_stock?: number | null;
  stock_threshold?: number | null;
  medication_reason?: string | null;
  timezone?: string | null;
  catalog_id?: number | null;
  linked_brand_name?: string | null;
  linked_composition?: string | null;
  linked_manufacturer?: string | null;
  linked_snapshot_date?: string | null;
  linked_is_discontinued?: boolean | null;
}
```

- [ ] **Step 2: Extend the client-side refetch query**

In the same file, find this exact line:

```ts
          .select('id, telegram_id, drug_name, dosage, frequency, reminder_times, tablet_count, priority_level, next_reminder_at, active, unit_type, dosage_amount, current_stock, stock_threshold, medication_reason')
```

Replace with:

```ts
          .select('id, telegram_id, drug_name, dosage, frequency, reminder_times, tablet_count, priority_level, next_reminder_at, active, unit_type, dosage_amount, current_stock, stock_threshold, medication_reason, catalog_id, linked_brand_name, linked_composition, linked_manufacturer, linked_snapshot_date, linked_is_discontinued')
```

- [ ] **Step 3: Show the linked composition under the dosage line**

Find this exact block:

```tsx
                      <p className={`text-muted-foreground font-medium mt-0.5 ${isElderly ? 'text-base' : 'text-[13px]'}`}>
                        {med.dosage_amount || 1} {med.unit_type?.toLowerCase() || 'tablet'}(s)
                        {med.dosage && med.dosage !== 'N/A' && <> · {med.dosage}</>}
                      </p>
                      {/* Category + frequency pills */}
```

Replace with:

```tsx
                      <p className={`text-muted-foreground font-medium mt-0.5 ${isElderly ? 'text-base' : 'text-[13px]'}`}>
                        {med.dosage_amount || 1} {med.unit_type?.toLowerCase() || 'tablet'}(s)
                        {med.dosage && med.dosage !== 'N/A' && <> · {med.dosage}</>}
                      </p>
                      {med.linked_brand_name && (
                        <p className="text-[11px] text-muted-foreground/80 font-medium mt-1 truncate">
                          {med.linked_brand_name}{med.linked_composition ? ` — ${med.linked_composition}` : ''}
                          {med.linked_is_discontinued && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground align-middle">
                              Discontinued
                            </span>
                          )}
                          <span className="block text-[9px] text-muted-foreground/70 mt-0.5">
                            Patient-selected from catalog · as of {med.linked_snapshot_date}
                          </span>
                        </p>
                      )}
                      {/* Category + frequency pills */}
```

- [ ] **Step 4: Extend the server-side initial query**

In `web/src/app/(dashboard)/medications/page.tsx`, find this exact line:

```ts
        .select('id, telegram_id, drug_name, dosage, frequency, reminder_times, tablet_count, priority_level, next_reminder_at, active, unit_type, dosage_amount, current_stock, stock_threshold, medication_reason, timezone')
```

Replace with:

```ts
        .select('id, telegram_id, drug_name, dosage, frequency, reminder_times, tablet_count, priority_level, next_reminder_at, active, unit_type, dosage_amount, current_stock, stock_threshold, medication_reason, timezone, catalog_id, linked_brand_name, linked_composition, linked_manufacturer, linked_snapshot_date, linked_is_discontinued')
```

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/medications/medication-list.tsx "web/src/app/(dashboard)/medications/page.tsx"
git commit -m "$(cat <<'EOF'
feat(web): show linked catalog composition on the medication list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Display the link in the caregiver's Care Circle view

**Files:**
- Modify: `web/src/app/(dashboard)/care-circle/[patientId]/page.tsx:444-457`

**Interfaces:**
- Consumes: same columns as Task 8. No query change needed — this file's medication fetch (line 154) already uses `select('*')`.

- [ ] **Step 1: Show the linked composition in the Schedule List card**

Find this exact block:

```tsx
              <div className="divide-y divide-border text-xs">
                {medications.map((med) => (
                  <div key={med.id} className="py-3 flex justify-between items-center first:pt-0 last:pb-0">
                    <div>
                      <p className="font-extrabold text-foreground">{med.drug_name}</p>
                      <p className="text-[10px] text-muted-foreground font-semibold mt-0.5">{med.dosage} • {med.frequency.replace('_', ' ')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-foreground font-semibold">{med.tablet_count !== null ? `${med.tablet_count} Left` : 'Unlimited'}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5 font-bold">Priority: {med.priority_level}</p>
                    </div>
                  </div>
                ))}
              </div>
```

Replace with:

```tsx
              <div className="divide-y divide-border text-xs">
                {medications.map((med) => (
                  <div key={med.id} className="py-3 flex justify-between items-center first:pt-0 last:pb-0">
                    <div>
                      <p className="font-extrabold text-foreground">{med.drug_name}</p>
                      <p className="text-[10px] text-muted-foreground font-semibold mt-0.5">{med.dosage} • {med.frequency.replace('_', ' ')}</p>
                      {med.linked_brand_name && (
                        <p className="text-[9px] text-muted-foreground/80 font-semibold mt-0.5">
                          {med.linked_brand_name}{med.linked_composition ? ` — ${med.linked_composition}` : ''} · Patient-selected from catalog
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-foreground font-semibold">{med.tablet_count !== null ? `${med.tablet_count} Left` : 'Unlimited'}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5 font-bold">Priority: {med.priority_level}</p>
                    </div>
                  </div>
                ))}
              </div>
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add "web/src/app/(dashboard)/care-circle/[patientId]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(web): show linked catalog composition in the Care Circle view

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Build, deploy, and acceptance

**Files:** none (build + ops + acceptance test).

- [ ] **Step 1: Production build**

Run: `cd web && npm run build`
Expected: `✓ Compiled successfully`; no type or build errors.

- [ ] **Step 2: Confirm Task 1 and Task 2's manual steps are done**

If the migration (Task 1 Step 3) or the catalog import (Task 2 Step 7) haven't been confirmed yet, do that now before continuing — the UI has nothing to search against otherwise.

- [ ] **Step 3: Deploy the web app**

From the repo root:
```bash
git push origin main
npx vercel deploy --prod --yes
```
Wait for `readyState: READY`.

- [ ] **Step 4: Acceptance test — search and link (wizard)**

Go to `/medications/new`, fill in a nickname (e.g. "my BP tablet") on the Details step, then tap "Link to real medication (optional)" and search "augmentin". Expected: a results list appears within ~1 second showing "Augmentin 625 Duo Tablet" with its composition and manufacturer. Select it. Expected: the search box is replaced by a "Linked: Augmentin 625 Duo Tablet" summary showing the composition and "Patient-selected from catalog · as of `<date>`". Complete the wizard and submit.

In the Supabase SQL editor, confirm the row was written correctly:
```sql
SELECT drug_name, catalog_id, linked_brand_name, linked_composition, linked_snapshot_date
FROM public.medications ORDER BY id DESC LIMIT 1;
```
Expected: `drug_name` is your nickname (unchanged), `catalog_id` and the `linked_*` fields are populated.

- [ ] **Step 5: Acceptance test — display**

On `/medications`, confirm the medication card shows your nickname as the bold primary label, with "Augmentin 625 Duo Tablet — `<composition>`" and "Patient-selected from catalog · as of `<date>`" as a secondary line underneath.

- [ ] **Step 6: Acceptance test — retrofit via edit page**

Pick an existing medication with no catalog link. Go to its edit page. Expected: "Link to real medication (optional)" appears unselected. Search and select a match, save. Expected: the medication list now shows the linked composition for that medication too — confirming the edit-page retrofit path works independently of the wizard.

- [ ] **Step 7: Acceptance test — no match / unlinked stays unlinked**

In the wizard or edit page, search for a nonsense string (e.g. "zzzzqqqq"). Expected: "No match found — you can leave this unlinked." message, no error thrown, and the rest of the form remains fully usable. Save without linking. Expected: the medication saves normally with `catalog_id` null, identical to pre-feature behavior.

- [ ] **Step 8: Acceptance test — Care Circle view**

As a caregiver with `can_view_medications` on a connection, open that patient's Care Circle page. Expected: any of the patient's linked medications show the same secondary "Patient-selected from catalog" line in the Schedule List card.

---

## Self-Review

**Spec coverage:**
- `medication_catalog` table, trigram search, RLS read-only for authenticated, service-role-only writes → Task 1. ✓
- Six `linked_*`/`catalog_id` columns, copied at selection time (not live-joined), `ON DELETE SET NULL` so a catalog refresh can't rewrite history → Task 1 (with the `linked_is_discontinued` addition explicitly called out as consistent with, not contradicting, the spec). ✓
- No auto-matching anywhere — every write to `linked_*` traces to an explicit user click in `MedicationCatalogLink` → Tasks 4, 6, 7 (data flows from `onChange` callbacks only). ✓
- CSV import as a one-off idempotent script, not a numbered migration → Task 2. ✓
- Wizard placement (Details step, optional, non-blocking) → Task 6. ✓
- Edit-page retrofit path → Task 7, verified in Task 10 Step 6. ✓
- Display: nickname primary, linked composition secondary, "Patient-selected from catalog · as of `<date>`" copy, discontinued badge shown not hidden → Tasks 8 and 9. ✓
- No results / search failure fails open, never blocks the form → `searchMedicationCatalog`'s catch-and-return-empty (Task 3) and the component's "No match found" state (Task 4), verified in Task 10 Step 7. ✓
- Bot untouched, web-only → no task modifies `src/`. ✓
- Manual verification (no practical unit test for the SQL/RPC or the React UI in a codebase with no test framework for either) → Task 10 Steps 4-8, matching the spec's Testing section; the one place genuine TDD applies (the pure CSV-row-mapping logic) is unit-tested in Task 2. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; every command has expected output. ✓

**Type consistency:** `CatalogLinkValue` (Task 3) has the same five fields (`catalogId`, `brandName`, `composition`, `manufacturer`, `isDiscontinued`, `snapshotDate`) used identically in `MedicationCatalogLink` (Task 4), `MedicationFormState`/`buildSharedMedicationFields` (Task 5), and both wizard pages' seeding/payload code (Tasks 6, 7). The RPC name `search_medication_catalog` and its `p_query`/`p_limit` parameters (Task 1) match exactly what `searchMedicationCatalog` calls (Task 3). Column names `catalog_id`/`linked_brand_name`/`linked_composition`/`linked_manufacturer`/`linked_snapshot_date`/`linked_is_discontinued` (Task 1) match verbatim across `buildSharedMedicationFields`'s return object (Task 5), the `Medication` interface and both select queries (Task 8), and the `EditMedicationFormProps.medication` interface (Task 7). `mapRow`'s return shape (Task 2) matches the columns `medication_catalog` actually has (Task 1) plus `snapshot_date`, added by the script itself at insert time. ✓
