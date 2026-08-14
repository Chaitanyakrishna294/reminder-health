// Alarm ring duration — bounds and the group arithmetic.
//   node --experimental-strip-types src/lib/alarm/ring-duration.test.ts
import assert from 'node:assert';
import {
  RING_DURATION_CHOICES,
  RING_SECONDS_DEFAULT,
  RING_SECONDS_MAX,
  RING_SECONDS_MIN,
  clampRingSeconds,
  largestHandful,
  ringDurationHint,
  ringDurationLabel,
} from './ring-duration.ts';

// ── The floor is the current behaviour, and it is a floor for a reason ──
// Anything under a minute is a dose alarm that gives up before someone in
// another room can reach the phone.
assert.equal(clampRingSeconds(30), 60);
assert.equal(clampRingSeconds(0), 60);
assert.equal(clampRingSeconds(-500), 60);

// ── The ceiling bounds a lit, ringing screen ──
assert.equal(clampRingSeconds(600), 300);
assert.equal(clampRingSeconds(RING_SECONDS_MAX), 300);

// ── Junk resolves to the DEFAULT, never to NaN in a setTimeout ──
// Non-finite means "not a number I can use", so it falls back rather than
// clamping. A merely large finite number is different — that is a real value out
// of range, and it clamps to the ceiling.
assert.equal(clampRingSeconds(Number.NaN), RING_SECONDS_DEFAULT);
assert.equal(clampRingSeconds(Number.POSITIVE_INFINITY), RING_SECONDS_DEFAULT);
assert.equal(clampRingSeconds(Number.NEGATIVE_INFINITY), RING_SECONDS_DEFAULT);
assert.equal(clampRingSeconds(999_999), RING_SECONDS_MAX);

// ── Every offered choice must survive the clamp unchanged ──
// A control that offers a value the clamp then moves is a control that lies.
for (const choice of RING_DURATION_CHOICES) {
  assert.equal(clampRingSeconds(choice), choice, `choice ${choice} must be within bounds`);
  assert.ok(choice >= RING_SECONDS_MIN && choice <= RING_SECONDS_MAX);
}
assert.equal(RING_DURATION_CHOICES[0], RING_SECONDS_DEFAULT, 'the first choice is the default');

// ── Labels ──
assert.equal(ringDurationLabel(60), '1 minute');
assert.equal(ringDurationLabel(120), '2 minutes');
assert.equal(ringDurationLabel(300), '5 minutes');

// ── The hint says the arithmetic out loud for a handful ──
// The setting is per DOSE and the screen it drives is per HANDFUL; four
// medicines at 3 minutes is twelve minutes of ringing phone, and the only way
// someone can weigh that is if we tell them.
{
  const one = ringDurationHint(180, 1);
  assert.match(one, /Each medicine rings for 3 minutes\./);
  assert.ok(!one.includes('busiest'), 'no totals for someone with a single medicine — that is noise');

  const many = ringDurationHint(180, 4);
  assert.match(many, /Each medicine rings for 3 minutes\./);
  assert.match(many, /4 medicines/);
  assert.match(many, /up to 12 minutes/);
}

// A zero-medication account must not produce "0 medicines" copy.
assert.ok(!ringDurationHint(60, 0).includes('busiest'));

// ── largestHandful: the number the hint is built on ──
{
  const med = (times: string[], active = true, timezone = 'Asia/Kolkata') => ({
    reminderTimes: times,
    timezone,
    active,
  });

  assert.equal(largestHandful([]), 0);

  // The 4-med acceptance scenario.
  assert.equal(
    largestHandful([med(['12:00']), med(['12:00']), med(['12:00']), med(['12:00']), med(['20:00'])]),
    4,
  );

  // The BUSIEST time wins, not the last one seen.
  assert.equal(largestHandful([med(['08:00', '20:00']), med(['08:00']), med(['20:00'])]), 2);

  // Paused medications produce no alarm, so they are not in anyone's handful.
  assert.equal(largestHandful([med(['09:00']), med(['09:00'], false)]), 1);

  // Different timezones are different wall clocks — the same grouping rule the
  // native DosesAtInstant.hasDoseAt uses.
  assert.equal(
    largestHandful([med(['12:00'], true, 'Asia/Kolkata'), med(['12:00'], true, 'Europe/London')]),
    1,
  );

  // A medication listing a time twice is one dose at that time.
  assert.equal(largestHandful([med(['08:00', '08:00'])]), 1);

  // Blank entries are not a dose. The bot pre-filters these; the count must not
  // invent a handful out of them.
  assert.equal(largestHandful([med(['', ' ']), med(['07:00'])]), 1);
}

console.log('ring-duration.test.ts: all assertions passed');
