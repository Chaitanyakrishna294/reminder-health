// Self-contained check for notification routing.
//   node --experimental-strip-types src/lib/design/notification-kinds.test.ts
//
// Worth testing because the failure is silent and lands on the least able user:
// a wrong href does not throw, it just opens the wrong screen, and the person it
// misroutes is someone who tapped a notification about their medication.
import assert from 'node:assert';
import {
  notificationMeta,
  notificationTarget,
  DOSE_MED_PARAM,
  DOSE_AT_PARAM,
} from './notification-kinds.ts';

// The real day-key rule is timezone-aware and lives in slots.ts; routing only
// needs "some key or null", so the tests inject a trivial one.
const dayKey = (iso: string) => (iso ? iso.slice(0, 10) : null);
const noKey = () => null;

const AT = '2026-08-14T02:30:00.000Z';
const BORN = '2026-08-13T21:05:00.000Z'; // the row's created_at — a DIFFERENT day

// ── Kinds ──
assert.equal(notificationMeta('TAKEN').kind, 'dose');
assert.equal(notificationMeta('CARE_CIRCLE_ACCESS_REVOKED').kind, 'care-circle');
assert.equal(notificationMeta('LOW_STOCK').kind, 'system');
// A type this build has not heard of must still render and still route.
assert.equal(notificationMeta('SOMETHING_NEW_2027').kind, 'system');

// ── EVERY notification gets a destination ──
// This is bug 3: care-circle notifications used to navigate nowhere at all.
for (const type of [
  'TAKEN', 'SKIPPED', 'MISSED', 'ESCALATED', 'UNCONFIRMED',
  'CARE_CIRCLE_ACCESS_REQUEST', 'CARE_CIRCLE_ACCESS_GRANTED', 'CARE_CIRCLE_ACCESS_UPDATED',
  'CARE_CIRCLE_ACCESS_REVOKED', 'CARE_CIRCLE_PRIMARY_CHANGED', 'LOW_STOCK',
  'SOMETHING_NEW_2027',
]) {
  const href = notificationTarget({ type, created_at: BORN }, dayKey);
  assert.ok(href && href.startsWith('/'), `${type} must route somewhere: got ${href}`);
}

// ── Dose: the row knows its dose ──
{
  const href = notificationTarget(
    { type: 'TAKEN', created_at: BORN, medication_id: 42, scheduled_for: AT },
    dayKey,
  );
  // The DOSE instant decides the day, never the row's birthday. These fall on
  // opposite sides of midnight on purpose — that is the bug being fixed.
  assert.ok(href.includes('day=2026-08-14'), href);
  assert.ok(!href.includes('2026-08-13'), 'created_at must not decide the day');
  assert.ok(href.includes(`${DOSE_MED_PARAM}=42`), href);
  assert.ok(href.includes(DOSE_AT_PARAM + '='), href);
}

// ── Dose: an older row, on the approximation ──
{
  const href = notificationTarget({ type: 'MISSED', created_at: BORN }, dayKey);
  assert.equal(href, '/dashboard?day=2026-08-13');
  // No med param — better to open the day and ring NOTHING than to ring a guess.
  assert.ok(!href.includes(DOSE_MED_PARAM + '='), href);
}

// ── Dose: half the pair is not enough ──
// (medication_id, scheduled_for) is what reminder_events is unique on. With only
// the medication, "which dose" is undefined and the first one would be rung.
{
  const half = notificationTarget(
    { type: 'TAKEN', created_at: BORN, medication_id: 42 },
    dayKey,
  );
  assert.ok(!half.includes(DOSE_MED_PARAM + '='), half);
}

// ── Dose: an unusable instant still lands somewhere ──
assert.equal(notificationTarget({ type: 'TAKEN', created_at: BORN }, noKey), '/dashboard');

// ── Care circle ──
// A pending request is the one with something to DO, and its screen differs.
assert.equal(
  notificationTarget({ type: 'CARE_CIRCLE_ACCESS_REQUEST', created_at: BORN }, dayKey),
  '/care-circle/requests',
);
assert.equal(
  notificationTarget({ type: 'CARE_CIRCLE_ACCESS_REVOKED', created_at: BORN }, dayKey),
  '/care-circle',
);

// ── System ──
assert.equal(
  notificationTarget({ type: 'LOW_STOCK', created_at: BORN, medication_id: 7 }, dayKey),
  '/medications/7',
);
assert.equal(
  notificationTarget({ type: 'LOW_STOCK', created_at: BORN }, dayKey),
  '/medications',
);
// A stock warning must never carry a dose instant even if one is somehow set:
// it is about a medication, not about one dose of it.
assert.ok(
  !notificationTarget(
    { type: 'LOW_STOCK', created_at: BORN, medication_id: 7, scheduled_for: AT },
    dayKey,
  ).includes(DOSE_AT_PARAM + '='),
);

console.log('notification-kinds.test.ts: all assertions passed');
