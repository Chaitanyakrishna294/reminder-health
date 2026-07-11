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
