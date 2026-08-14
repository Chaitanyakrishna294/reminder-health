// Water intake — goal arithmetic and scheduling.
//   node --experimental-strip-types src/lib/water/hydration.test.ts
//
// Off-screen because these are the parts that can be quietly wrong: a goal that
// misreads an age band, a nudge landing on top of a dose, a window that puts
// every cup in the same ten minutes.
import assert from 'node:assert';
import {
  DEFAULT_CUP_ML,
  MAX_GOAL_CUPS,
  ML_PER_KG_ADULT,
  ML_PER_KG_SENIOR,
  goalPhrase,
  localDayKey,
  minutesOfDay,
  mlPerKg,
  nudgeTimes,
  suggestedGoalCups,
  toHhmm,
  waterSchedule,
  withoutDoseClashes,
} from './hydration.ts';

// ── The age split ──
assert.equal(mlPerKg(40), ML_PER_KG_ADULT);
assert.equal(mlPerKg(64), ML_PER_KG_ADULT);
assert.equal(mlPerKg(65), ML_PER_KG_SENIOR, '65 is the boundary and belongs to the reduced figure');
assert.equal(mlPerKg(80), ML_PER_KG_SENIOR);
// Unknown age takes the ADULT figure. Guessing someone older would quietly lower
// their goal on no evidence — the app does not infer facts about a person's body.
assert.equal(mlPerKg(undefined), ML_PER_KG_ADULT);
assert.equal(mlPerKg(null), ML_PER_KG_ADULT);

// ── The goal ──
// 70 kg adult: 70 × 35 = 2450 ml ÷ 250 = 9.8 → 10 cups.
assert.equal(suggestedGoalCups({ weightKg: 70, ageYears: 40, cupMl: DEFAULT_CUP_ML }), 10);
// Same person at 70: 70 × 25 = 1750 ÷ 250 = 7 cups.
assert.equal(suggestedGoalCups({ weightKg: 70, ageYears: 70, cupMl: DEFAULT_CUP_ML }), 7);
// Whole cups only — "7 of 7.4" would make the goal unreachable by design.
for (const w of [52, 63, 71, 88, 96]) {
  const cups = suggestedGoalCups({ weightKg: w, cupMl: 300 });
  assert.equal(cups, Math.round(cups), `goal for ${w}kg must be whole cups`);
}
// A bigger cup means fewer of them.
assert.ok(
  suggestedGoalCups({ weightKg: 70, cupMl: 500 }) < suggestedGoalCups({ weightKg: 70, cupMl: 250 }),
);

// ── Rails, so a typo cannot produce an absurd day ──
assert.ok(suggestedGoalCups({ weightKg: 0, cupMl: 250 }) >= 1, 'never a goal of zero');
assert.ok(suggestedGoalCups({ weightKg: 9999, cupMl: 100 }) <= MAX_GOAL_CUPS);
assert.equal(suggestedGoalCups({ weightKg: Number.NaN, cupMl: 250 }), 3); // 20kg floor × 35 / 250

assert.equal(goalPhrase(7, 250), '7 cups of 250 ml');
assert.equal(goalPhrase(1, 500), '1 cup of 500 ml', 'singular, because "1 cups" reads as a bug');

// ── Time helpers ──
assert.equal(minutesOfDay('08:00'), 480);
assert.equal(minutesOfDay('8:05'), 485);
assert.equal(minutesOfDay('23:59'), 1439);
assert.equal(minutesOfDay('24:00'), null);
assert.equal(minutesOfDay('nope'), null);
assert.equal(toHhmm(485), '08:05');
assert.equal(toHhmm(0), '00:00');

// ── Spreading cups across the window ──
{
  // 8:00–21:00 is 780 minutes; 7 cups anchor both ends with 130 min between.
  const times = nudgeTimes('08:00', '21:00', 7);
  assert.equal(times.length, 7);
  assert.equal(times[0], '08:00', 'the first cup opens the window');
  assert.equal(times[times.length - 1], '21:00', 'the last cup closes it');
  assert.deepEqual(times, ['08:00', '10:10', '12:20', '14:30', '16:40', '18:50', '21:00']);
}

// One cup goes at the START, not the middle: a single reminder is more useful
// while there is still a day left to drink in.
assert.deepEqual(nudgeTimes('08:00', '21:00', 1), ['08:00']);

// A window that ends before it starts is not wrapped past midnight — a hydration
// nudge at 3am is a worse failure than a short window.
{
  const times = nudgeTimes('22:00', '06:00', 3);
  assert.ok(times.every((t) => minutesOfDay(t)! >= minutesOfDay('22:00')!));
}

// Two cups in a tiny window must not become two notifications for one minute.
assert.equal(new Set(nudgeTimes('08:00', '08:00', 4)).size, nudgeTimes('08:00', '08:00', 4).length);

assert.deepEqual(nudgeTimes('08:00', '21:00', 0), []);
assert.deepEqual(nudgeTimes('bad', '21:00', 5), []);

// ── WATER YIELDS TO MEDICINE ──
{
  const water = ['08:00', '10:10', '12:20', '14:30'];
  // A dose at 12:15 is 5 minutes from the 12:20 cup: the cup steps aside.
  assert.deepEqual(withoutDoseClashes(water, ['12:15']), ['08:00', '10:10', '14:30']);
  // Exactly on the boundary still yields — the rule is "within", inclusive.
  assert.deepEqual(withoutDoseClashes(['12:20'], ['12:30']), []);
  // Eleven minutes away is far enough to keep.
  assert.deepEqual(withoutDoseClashes(['12:20'], ['12:31']), ['12:20']);
  // Dropped, never MOVED: moving a cup puts it somewhere the user did not choose
  // and can cascade into the next one.
  assert.equal(withoutDoseClashes(water, ['08:00']).length, water.length - 1);
  // No doses, nothing to yield to.
  assert.deepEqual(withoutDoseClashes(water, []), water);
}

// ── The whole schedule ──
{
  const schedule = waterSchedule({
    startHhmm: '08:00',
    endHhmm: '21:00',
    goalCups: 7,
    doseTimes: ['08:00', '14:30'],
  });
  assert.ok(!schedule.includes('08:00'));
  assert.ok(!schedule.includes('14:30'));
  assert.equal(schedule.length, 5);
}

// ── The day key is LOCAL ──
// A cup at 11pm belongs to that day; a UTC key would move it to tomorrow for
// half the country's evening.
{
  const late = new Date(2026, 7, 14, 23, 30);
  assert.equal(localDayKey(late), '2026-08-14');
  const early = new Date(2026, 0, 5, 0, 15);
  assert.equal(localDayKey(early), '2026-01-05');
}

console.log('hydration.test.ts: all assertions passed');
