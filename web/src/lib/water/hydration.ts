/**
 * Water intake — the arithmetic and the scheduling rules.
 *
 * Pure, so the parts that can be quietly wrong are testable off the screen: a
 * goal that misreads someone's age band, a nudge that lands on top of a dose, a
 * window that puts every cup in the same ten minutes.
 *
 * THIS IS NOT MEDICAL ADVICE AND THE APP MUST NEVER PRESENT IT AS ANY. It is a
 * common rule of thumb, editable by the user, off unless they turn it on, and
 * shipped alongside a line telling anyone with heart or kidney conditions to ask
 * their doctor. Everything here follows CLAUDE.md's standing rule: a reminder
 * tool, never something that recommends, adjusts, or interprets.
 */

/** ml per kg of body weight — the usual rule of thumb, and the reduced figure for 65+. */
export const ML_PER_KG_ADULT = 35;
export const ML_PER_KG_SENIOR = 25;
export const SENIOR_AGE = 65;

export const DEFAULT_CUP_ML = 250;
export const DEFAULT_WINDOW_START = '08:00';
export const DEFAULT_WINDOW_END = '21:00';

/** A water nudge this close to a dose steps aside. Water never competes with medicine. */
export const DOSE_YIELD_MINUTES = 10;

/** Sanity rails on the inputs, so a typo cannot produce a 90-cup day. */
export const MIN_WEIGHT_KG = 20;
export const MAX_WEIGHT_KG = 250;
export const MIN_CUP_ML = 100;
export const MAX_CUP_ML = 1000;
export const MAX_GOAL_CUPS = 20;

export interface HydrationInputs {
  weightKg: number;
  /** Optional. Absent means the adult figure — never guess someone older to be safe. */
  ageYears?: number | null;
  cupMl: number;
}

/** ml per kg for this person. Split at 65 per the usual clinical guidance. */
export function mlPerKg(ageYears?: number | null): number {
  return ageYears != null && ageYears >= SENIOR_AGE ? ML_PER_KG_SENIOR : ML_PER_KG_ADULT;
}

/**
 * The suggested daily goal, in whole cups.
 *
 * Rounded to whole cups because the widget counts cups: a goal of 7.4 would make
 * "7 of 7.4" the best anyone could ever do, and a target nobody can finish is a
 * quiet way of telling someone they failed.
 *
 * At least one cup, so a valid setup never produces a goal of zero.
 */
export function suggestedGoalCups({ weightKg, ageYears, cupMl }: HydrationInputs): number {
  const weight = clamp(weightKg, MIN_WEIGHT_KG, MAX_WEIGHT_KG);
  const cup = clamp(cupMl, MIN_CUP_ML, MAX_CUP_ML);
  const ml = weight * mlPerKg(ageYears);
  return clamp(Math.round(ml / cup), 1, MAX_GOAL_CUPS);
}

/** The same goal expressed the way the setup screen says it: "7 cups of 250 ml". */
export function goalPhrase(cups: number, cupMl: number): string {
  return `${cups} ${cups === 1 ? 'cup' : 'cups'} of ${cupMl} ml`;
}

/** "HH:MM" → minutes from midnight. Returns null for anything unparseable. */
export function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function toHhmm(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/**
 * When to nudge — cups spread evenly across the drinking window.
 *
 * First cup at the start of the window, last at the end, the rest evenly
 * between. Anchoring both ends matters: a window is someone saying "I am awake
 * between these hours", and nudges that drift past the end are nudges arriving
 * at bedtime.
 *
 * One cup gets the START of the window, not the middle — a single reminder is
 * more useful early, while there is still a day left to drink in.
 *
 * A window that ends before it starts (an overnight shift) is treated as
 * ending at midnight rather than wrapping, because a hydration reminder at 3am
 * is a worse failure than a slightly short window.
 */
export function nudgeTimes(startHhmm: string, endHhmm: string, cups: number): string[] {
  const start = minutesOfDay(startHhmm);
  const end = minutesOfDay(endHhmm);
  if (start == null || end == null || cups < 1) return [];

  const last = end > start ? end : 1439;
  if (cups === 1) return [toHhmm(start)];

  const step = (last - start) / (cups - 1);
  const out: string[] = [];
  for (let i = 0; i < cups; i++) out.push(toHhmm(start + step * i));
  // Two cups can round onto the same minute in a very short window; a duplicate
  // nudge is two notifications for one cup.
  return Array.from(new Set(out));
}

/**
 * WATER YIELDS TO MEDICINE — the rule that keeps this feature quiet.
 *
 * A nudge within [DOSE_YIELD_MINUTES] of a scheduled dose is dropped, not moved.
 * Moving it would put the cup somewhere the user did not choose and could cascade
 * into the next one; dropping it costs a single glass of water, which is the
 * cheapest thing on this screen.
 *
 * @param doseTimes the day's scheduled dose times as "HH:MM"
 */
export function withoutDoseClashes(
  waterTimes: string[],
  doseTimes: string[],
  withinMinutes: number = DOSE_YIELD_MINUTES,
): string[] {
  const doses = doseTimes.map(minutesOfDay).filter((m): m is number => m != null);
  if (doses.length === 0) return waterTimes;
  return waterTimes.filter((t) => {
    const at = minutesOfDay(t);
    if (at == null) return false;
    return !doses.some((d) => Math.abs(d - at) <= withinMinutes);
  });
}

/**
 * The whole schedule for a day, in one call — what the device registers.
 *
 * Returns times only. Whether they fire at all is the device's business, and it
 * is deliberately INEXACT: exact alarms stay medication-only (CLAUDE.md), and a
 * glass of water is not worth the battery or the permission.
 */
export function waterSchedule(opts: {
  startHhmm: string;
  endHhmm: string;
  goalCups: number;
  doseTimes?: string[];
}): string[] {
  return withoutDoseClashes(
    nudgeTimes(opts.startHhmm, opts.endHhmm, opts.goalCups),
    opts.doseTimes ?? [],
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * The local calendar day a count belongs to, as `YYYY-MM-DD`.
 *
 * LOCAL, not UTC. A cup drunk at 11pm in Kolkata belongs to that day, and a UTC
 * key would move it to tomorrow for half the country's evening.
 */
export function localDayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
