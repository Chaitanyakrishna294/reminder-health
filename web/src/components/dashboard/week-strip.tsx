'use client';

/**
 * THE WEEK STRIP — one full week above the rail.
 *
 * TWO MARKERS, AND THEY ARE NOT THE SAME THING. This is the rule the component
 * exists to hold:
 *   - TODAY keeps a solid marker at all times, even while you are reading Tuesday.
 *     Lose that anchor and someone editing a past day has nothing on screen telling
 *     them where "now" is — which is how a person corrects the wrong day.
 *   - THE SELECTED day gets a soft pill behind it.
 * They stack rather than compete: on today-and-selected you see the soft pill with
 * the solid marker inside it. One colour carrying both meanings was the failure mode
 * of the previous version of this row.
 *
 * SUNDAY FIRST, matching `weekOf()` and `dose_days` (0=Sun), so the strip, the
 * Schedule Planner grid and the weekday rule a medication is stored with all agree.
 *
 * FUTURE IS PREVIEW ONLY, and only within the current week — you cannot step past it.
 * A dose that has not happened has no outcome, and the server refuses to record one
 * regardless of what this component renders.
 *
 * Day keys are YYYY-MM-DD in the MEDICATION's timezone (lib/design/slots.ts). A 01:40
 * Asia/Kolkata dose is 20:10 UTC the previous day, so any other basis files it under
 * yesterday — seven times over, in a row whose whole job is which day a dose is on.
 */

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface WeekStripDay {
  /** YYYY-MM-DD. */
  key: string;
  /** Doses on this day — recorded for a past day, projected for a future one. */
  total: number;
  /** Doses nobody answered. Only meaningful for today and the past. */
  open: number;
  isFuture: boolean;
}

interface WeekStripProps {
  days: WeekStripDay[];
  selectedKey: string;
  todayKey: string;
  onSelect: (key: string) => void;
  onStepWeek: (delta: -1 | 1) => void;
  /** At the current week: there is no next week to step into. */
  canStepForward: boolean;
  /**
   * The dashboard loads 8 days of events. Stepping past that would render days as
   * EMPTY when they simply are not loaded — and an empty day in an adherence record
   * reads as "nothing was taken", which is the one lie this app must not tell. The
   * bound also matches the server's 7-day correction window, so the strip reaches
   * exactly as far as the record can actually be repaired.
   */
  canStepBack: boolean;
  isElderly: boolean;
}

/** Sunday-first initials. Fixed rather than locale-derived: the strip is 7 chars wide
 *  and a locale that returns two-letter abbreviations would break the column grid. */
const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function dayNumber(key: string): string {
  return String(Number(key.slice(8, 10)));
}

function longDate(key: string): string {
  // Noon UTC + a UTC read-back: a local-midnight Date slips a day in any negative
  // offset, which would make the accessible name disagree with the visible number.
  const at = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)), 12));
  return at.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export default function WeekStrip({
  days, selectedKey, todayKey, onSelect, onStepWeek, canStepForward, canStepBack, isElderly,
}: WeekStripProps) {
  // Swipe, kept to pointer maths rather than a gesture library: one axis, one
  // threshold. The arrows remain the real control — a swipe is unreachable by
  // keyboard and invisible to anyone who does not already expect it.
  const startX = React.useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? startX.current) - startX.current;
    startX.current = null;
    if (Math.abs(dx) < 48) return;
    if (dx > 0) { if (canStepBack) onStepWeek(-1); }
    else if (canStepForward) onStepWeek(1);
  };

  const stepBtn = 'w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

  return (
    <nav aria-label="Choose a day" className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onStepWeek(-1)}
        disabled={!canStepBack}
        aria-label="Previous week"
        className={stepBtn}
      >
        <ChevronLeft className={isElderly ? 'w-6 h-6' : 'w-5 h-5'} aria-hidden />
      </button>

      <ul
        className="flex-1 grid grid-cols-7 gap-0.5 touch-pan-y"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {days.map((d, i) => {
          const isToday = d.key === todayKey;
          const isSelected = d.key === selectedKey;

          return (
            <li key={d.key} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(d.key)}
                aria-current={isSelected ? 'date' : undefined}
                // The visible cell is two glyphs; the accessible name is the sentence.
                // This is a primary control for someone who may be checking on a parent
                // through a screen reader.
                aria-label={
                  `${isToday ? 'Today, ' : ''}${longDate(d.key)}`
                  + (d.isFuture
                    ? (d.total === 0 ? ' — nothing scheduled' : ` — ${d.total} scheduled, not yet due`)
                    : d.total === 0
                      ? ' — no doses'
                      : d.open > 0
                        ? ` — ${d.total} ${d.total === 1 ? 'dose' : 'doses'}, ${d.open} to answer`
                        : ` — ${d.total} ${d.total === 1 ? 'dose' : 'doses'}, all answered`)
                }
                className={`w-full min-h-11 py-1.5 rounded-[14px] flex flex-col items-center justify-center gap-1
                            transition-colors duration-150 cursor-pointer
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
                            ${isSelected ? 'bg-primary-soft' : 'hover:bg-muted'}`}
              >
                <span
                  aria-hidden
                  className={`font-mono uppercase tracking-wider leading-none ${isElderly ? 'text-[11px]' : 'text-[10px]'} ${
                    /* A future day is dimmer, so "not yet" reads before you tap it. */
                    d.isFuture ? 'text-muted-foreground/55' : 'text-muted-foreground'
                  }`}
                >
                  {LETTERS[i]}
                </span>

                {/* The date number. TODAY carries the solid marker permanently — that
                    is the anchor, and it survives any selection. */}
                <span
                  aria-hidden
                  className={`flex items-center justify-center rounded-full font-mono font-bold tabular-nums leading-none
                              ${isElderly ? 'w-8 h-8 text-base' : 'w-7 h-7 text-sm'}
                              ${isToday
                                ? 'bg-primary-strong text-primary-strong-foreground'
                                : d.isFuture
                                  ? 'text-muted-foreground/55'
                                  : 'text-foreground'}`}
                >
                  {dayNumber(d.key)}
                </span>

                {/* Never colour alone: an unanswered day gets a dot, and the count is
                    already spelled out in the accessible name above. A future day is
                    left blank — "scheduled" is not a gap to chase. */}
                <span className="h-1.5 flex items-center" aria-hidden>
                  {!d.isFuture && d.open > 0 && <span className="w-1.5 h-1.5 rounded-full bg-danger" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => onStepWeek(1)}
        disabled={!canStepForward}
        aria-label="Next week"
        className={stepBtn}
      >
        <ChevronRight className={isElderly ? 'w-6 h-6' : 'w-5 h-5'} aria-hidden />
      </button>
    </nav>
  );
}
