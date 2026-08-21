import React from 'react';
import { Check, X, Clock } from 'lucide-react';

/**
 * PHONE MOCKUPS — rebuilt in CSS, faithful to the shipped screens.
 *
 * ── WHY REBUILT AND NOT SCREENSHOTTED ──
 *
 * The brief asked for real screenshots of the production app. Two of the three
 * requested screens cannot be captured:
 *
 *  - **The alarm is native.** `AlarmActivity` is Kotlin and only exists on a
 *    device at dose time. The brief anticipates this and permits a faithful CSS
 *    rebuild, which is what this is.
 *  - **Today and Care Circle are behind auth**, and signing in means entering a
 *    password, which is not something this agent does. A guest session is one tap
 *    and needs no password, but a fresh guest has no medications — it would
 *    screenshot an empty state, which is a less honest picture of the product
 *    than a faithful rebuild of a populated one.
 *
 * So these are drawn from the real components and the real `strings.xml`, using
 * the frozen tokens, with the copy exactly as shipped: "Dose due", "Taken",
 * "Skip", "Snooze 10 min" are lifted verbatim from
 * `res/values/strings.xml`. **No invented UI** — every element here corresponds to
 * something the shipped app renders.
 *
 * A side benefit worth keeping: CSS mockups cost no image bytes, so the hero and
 * these screens cost nothing against LCP on a mid-range Android over 4G. There is
 * nothing to lazy-load because there is nothing to load.
 */

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="mx-auto w-[248px] shrink-0 rounded-[2.25rem] p-2.5 shadow-lg"
      style={{ background: 'var(--slot-night)' }}
    >
      <div
        className="overflow-hidden rounded-[1.75rem]"
        style={{ background: 'var(--background)' }}
      >
        {/* Status bar — mono, because a clock is a value. */}
        <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
          <span className="font-mono text-[9px] font-bold text-muted-foreground">08:00</span>
          <span aria-hidden className="font-mono text-[9px] font-bold text-muted-foreground">
            ▮▮▮
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * THE NATIVE ALARM, as it is actually composed.
 *
 * Hierarchy is the shipped one: the eyebrow states the fact, the drug NAME is the
 * headline (this is the screen whose entire job is naming a medicine), Taken is
 * large and on top, Skip is an honest decline below it, and Snooze is smallest.
 * No mascot — Remi never appears on an alarm surface, by constitutional rule.
 */
export function AlarmMock() {
  return (
    <Frame label="The full-screen dose alarm: Dose due at 8 AM for Metformin, with Taken, Skip and Snooze buttons.">
      <div className="flex min-h-[380px] flex-col px-4 pb-5 pt-6 text-center">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-slot-morning-ink">
          Dose due · 08:00
        </p>
        <h4 className="mt-3 text-[22px] font-black leading-tight tracking-tight text-foreground">
          Metformin
        </h4>
        <p className="mt-1 text-[11px] font-semibold text-muted-foreground">1 tablet</p>

        <div className="mt-auto space-y-2 pt-8">
          <div
            className="flex items-center justify-center gap-1.5 rounded-[var(--r-control)] py-3.5 text-[15px] font-black"
            style={{ background: 'var(--success)', color: 'var(--success-foreground)' }}
          >
            <Check className="h-4 w-4" aria-hidden /> Taken
          </div>
          <div
            className="flex items-center justify-center gap-1.5 rounded-[var(--r-control)] border py-2.5 text-[13px] font-black text-foreground"
            style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Skip
          </div>
          <div className="flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden /> Snooze 10 min
          </div>
        </div>
      </div>
    </Frame>
  );
}

/**
 * TODAY — the day rail, as the app renders it.
 *
 * The dose strip's pockets carry state in SHAPE, not colour alone: a domed pocket
 * still holds its pill (upcoming or due), a pressed-in one has been emptied
 * (taken or skipped). That mapping is a deliberate second information channel for
 * readers with age-related colour vision changes, and it is why the strip is
 * drawn here rather than simplified into dots.
 */
export function TodayMock() {
  const pockets = [
    { t: '08:00', done: true },
    { t: '13:00', done: false, due: true },
    { t: '18:00', done: false },
    { t: '21:00', done: false },
  ];
  return (
    <Frame label="The Today screen: a strip of the day's doses, and the dose that is due now with Taken and Skip buttons.">
      <div className="min-h-[380px] px-4 pb-5 pt-2">
        <p className="text-[13px] font-black text-foreground">Good afternoon</p>

        {/* dose strip */}
        <div className="mt-3 flex gap-1.5">
          {pockets.map((p) => (
            <div
              key={p.t}
              className="flex-1 rounded-[var(--r-chip)] px-1 py-1.5 text-center"
              style={{
                background: p.done ? 'var(--surface-sunk)' : 'var(--card)',
                boxShadow: p.done ? 'inset 0 1px 3px rgba(15,28,90,.16)' : 'var(--lift-1)',
              }}
            >
              <span className="font-mono text-[8px] font-bold text-muted-foreground">{p.t}</span>
              <span
                aria-hidden
                className="mx-auto mt-1 block h-1.5 w-1.5 rounded-full"
                style={{ background: p.done ? 'var(--success)' : 'var(--slot-midday)' }}
              />
            </div>
          ))}
        </div>

        {/* slot drawer label — uppercase mono is a structural label, never a sentence */}
        <p className="mt-4 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-slot-midday-ink">
          Midday · 1 dose
        </p>

        {/* due-now card */}
        <div className="mt-2 rounded-[var(--r-card)] p-3" style={{ background: 'var(--card)', boxShadow: 'var(--lift-1)' }}>
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-slot-midday-ink">
            Due now
          </p>
          <p className="mt-1 text-[15px] font-black leading-tight text-foreground">Amlodipine</p>
          <p className="text-[10px] font-semibold text-muted-foreground">1 tablet · 13:00</p>
          <div className="mt-2.5 space-y-1.5">
            <div
              className="flex items-center justify-center gap-1 rounded-[var(--r-control)] py-2 text-[12px] font-black"
              style={{ background: 'var(--success)', color: 'var(--success-foreground)' }}
            >
              <Check className="h-3 w-3" aria-hidden /> Taken
            </div>
            <div
              className="flex items-center justify-center gap-1 rounded-[var(--r-control)] border py-1.5 text-[11px] font-black text-foreground"
              style={{ borderColor: 'var(--border)' }}
            >
              <X className="h-3 w-3" aria-hidden /> Skip
            </div>
          </div>
        </div>

        <p className="mt-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-slot-evening-ink">
          Evening · 2 doses
        </p>
      </div>
    </Frame>
  );
}
