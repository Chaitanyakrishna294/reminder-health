// Self-contained check for the narrowed gate/rail invariant.
//   node --experimental-strip-types src/lib/schedule/dose-group.test.ts
//
// The rule (CLAUDE.md): the gate and the rail must never disagree about which
// doses are outstanding. Doses at the SAME instant are presented together and
// answered independently; earliest-first still governs ACROSS instants.
//
// Both surfaces call `earliestDoseGroup`, so this test is the guard on the one
// definition they share. It replaced "both pick the earliest overdue dose",
// which was built on there being exactly one earliest — false for the case it
// most needed to cover, and found by a 4-medication device test where two doses
// fought for the full screen while two sat as notifications.
import assert from 'node:assert';
import { earliestDoseGroup } from './dose-attention.ts';

const at = (id: number, iso: string) => ({
  id,
  scheduled_for: iso,
  reminder_status: 'SENT',
});

// ── The case that prompted the rule change: four at one instant ──
{
  const noon = [at(1, '2026-08-14T12:00:00Z'), at(2, '2026-08-14T12:00:00Z'),
                at(3, '2026-08-14T12:00:00Z'), at(4, '2026-08-14T12:00:00Z')];
  const group = earliestDoseGroup(noon);
  assert.equal(group.length, 4, 'a noon handful is one handful');
  assert.deepEqual(group.map((e) => e.id).sort(), [1, 2, 3, 4]);
}

// ── Earliest-first still governs across instants ──
{
  const mixed = [
    at(10, '2026-08-14T14:00:00Z'),
    at(11, '2026-08-14T08:00:00Z'),
    at(12, '2026-08-14T08:00:00Z'),
    at(13, '2026-08-14T20:00:00Z'),
  ];
  const group = earliestDoseGroup(mixed);
  assert.deepEqual(group.map((e) => e.id).sort(), [11, 12], 'only the 08:00 pair');
  // The later doses are still outstanding — they are simply not the group being
  // asked about right now. Dropping them would be a different bug entirely.
  assert.equal(mixed.length, 4);
}

// ── A minute apart is two asks, not one handful ──
// Exact equality on the instant is deliberate. Widening this to a tolerance
// would silently merge doses the user scheduled separately, and the person who
// set 08:00 and 08:01 meant something by it.
{
  const near = [at(20, '2026-08-14T08:00:00Z'), at(21, '2026-08-14T08:01:00Z')];
  assert.deepEqual(earliestDoseGroup(near).map((e) => e.id), [20]);
}

// ── Order of the input must not matter ──
// The gate freezes row order and the rail sorts by slot; if grouping depended on
// input order the two surfaces could group differently from the same data, which
// is precisely what the invariant forbids.
{
  const a = [at(30, '2026-08-14T09:00:00Z'), at(31, '2026-08-14T07:00:00Z'), at(32, '2026-08-14T07:00:00Z')];
  const b = [at(32, '2026-08-14T07:00:00Z'), at(30, '2026-08-14T09:00:00Z'), at(31, '2026-08-14T07:00:00Z')];
  assert.deepEqual(
    earliestDoseGroup(a).map((e) => e.id).sort(),
    earliestDoseGroup(b).map((e) => e.id).sort(),
  );
}

// ── Degenerate inputs ──
assert.deepEqual(earliestDoseGroup([]), [], 'empty renders nothing, no guard needed at the call site');
assert.equal(earliestDoseGroup([at(40, '2026-08-14T06:00:00Z')]).length, 1);

// ── Identity, not a copy ──
// The rail maps the result to ids and the gate renders the objects; returning
// clones would break `dueNowIds.has(event.id)` in subtle ways.
{
  const one = at(50, '2026-08-14T05:00:00Z');
  assert.equal(earliestDoseGroup([one])[0], one);
}

console.log('dose-group.test.ts: all assertions passed');
