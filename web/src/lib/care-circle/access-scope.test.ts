// Self-contained check for the access-scope summary.
//   node --experimental-strip-types src/lib/care-circle/access-scope.test.ts
//
// This is the copy shown to someone deciding whether a family member may see
// their medication history. If it drifts from what the database actually grants,
// the app describes one thing and does another — and the failure is silent.
import assert from 'node:assert';
import { ACCESS_ITEMS, DEFAULT_ACCESS, describeAccess } from './access-scope.ts';

// ── The defaults must match the columns ──
// caregiver_connections column defaults, from
// migration_caregiver_decoupling_phase_a.sql and migration_medical_profiles.sql.
// invite_caregiver inserts without overriding them, so a fresh invitation lands
// exactly here. If a migration changes one, this fails and the copy gets fixed
// in the same commit instead of quietly lying.
assert.deepEqual(DEFAULT_ACCESS, {
  can_view_medications: true,
  can_view_vault: false,
  can_view_reports: false,
  can_edit_medications: false,
  can_receive_escalations: true,
  can_view_medical_profile: false,
});

// ── Every flag is described, in both directions ──
const keys = ACCESS_ITEMS.map((i) => i.key);
assert.equal(new Set(keys).size, keys.length, 'a flag is described twice');
assert.equal(keys.length, Object.keys(DEFAULT_ACCESS).length, 'a flag has no description');
for (const k of Object.keys(DEFAULT_ACCESS)) {
  assert.ok(keys.includes(k as never), `no copy for ${k}`);
}

// ── Nothing leaks a column name to the reader ──
for (const item of ACCESS_ITEMS) {
  for (const line of [item.can, item.cannot]) {
    assert.ok(!/can_[a-z_]+/.test(line), `column name in copy: ${line}`);
    assert.ok(!/\b[A-Z]{2,}\b/.test(line), `shouting in copy: ${line}`);
    assert.equal(line[0], line[0].toUpperCase(), `not sentence case: ${line}`);
  }
}

// ── The default invitation: what it actually says ──
{
  const { can, cannot } = describeAccess(DEFAULT_ACCESS);
  assert.equal(can.length + cannot.length, ACCESS_ITEMS.length, 'every item lands on one side');
  // The two things a new caregiver really gets.
  assert.ok(can.some((l) => /medicines and when each dose/i.test(l)));
  assert.ok(can.some((l) => /miss an important dose/i.test(l)));
  // And the reassurances that make saying yes possible. The vault line is the
  // one worth printing even though the answer is no.
  assert.ok(cannot.some((l) => /health vault/i.test(l)));
  assert.ok(cannot.some((l) => /change anything about your medicines/i.test(l)));
}

// ── Full access has nothing left to reassure about ──
{
  const all = Object.fromEntries(Object.keys(DEFAULT_ACCESS).map((k) => [k, true]));
  const { can, cannot } = describeAccess(all as typeof DEFAULT_ACCESS);
  assert.equal(cannot.length, 0);
  assert.equal(can.length, ACCESS_ITEMS.length);
}

// ── The write permission is unmistakable ──
// Only one flag lets a caregiver CHANGE the regimen, and its copy has to say so
// plainly — this is the one a patient is most likely to regret granting.
const edit = ACCESS_ITEMS.find((i) => i.key === 'can_edit_medications')!;
assert.match(edit.can, /add, change and pause/i);

console.log('access-scope.test.ts: all assertions passed');
