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
