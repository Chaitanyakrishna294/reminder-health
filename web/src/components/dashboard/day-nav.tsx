'use client';

/**
 * THE DATE ROW — seven days, above the rail.
 *
 * The rail answers "what about today". This answers "what about the day I actually
 * mean", which for a family is usually yesterday: someone took a dose, nobody
 * recorded it, and the record now says MISSED about a person who did the right
 * thing. Being able to reach back and fix that is the point of the row.
 *
 * SEVEN DAYS, NOT MORE. The correction window server-side is 7 days
 * (migration_past_day_correction_2026_08_12.sql), and the row must not offer a day
 * whose Change button the server will refuse. If that window ever moves, move this
 * with it.
 *
 * NO FUTURE DAYS. A dose that has not happened cannot have an outcome, and a row
 * you can scroll into next week invites exactly that. The server refuses future
 * corrections regardless — this is the polite half of a guard that exists twice.
 *
 * Day keys are YYYY-MM-DD in the MEDICATION's timezone (lib/design/slots.ts), never
 * the viewer's and never UTC. A 01:40 Asia/Kolkata dose is 20:10 UTC the previous
 * day, so keying by anything else files it under yesterday — which is the specific
 * bug this row would otherwise put on screen seven times over.
 */

import React from 'react';
import { Check } from 'lucide-react';

export interface DayNavDay {
  /** YYYY-MM-DD in the reference timezone. */
  key: string;
  /** Doses recorded that day. Used for the count, never to hide the day. */
  total: number;
  /** Doses still unanswered — the reason to go back and look. */
  open: number;
}

interface DayNavProps {
  days: DayNavDay[];
  selectedKey: string;
  todayKey: string;
  onSelect: (key: string) => void;
  isElderly: boolean;
}

/** Weekday initial + day number, from the key alone — no timezone re-derivation. */
function labelFor(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  // Noon UTC: the parts are read back with getUTC*, so the label can never slip a
  // day the way a local-midnight Date would in a negative-offset zone.
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekday: at.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }).slice(0, 1),
    day: String(at.getUTCDate()),
  };
}

export default function DayNav({ days, selectedKey, todayKey, onSelect, isElderly }: DayNavProps) {
  return (
    <nav aria-label="Choose a day">
      <ul className="flex gap-2 overflow-x-auto pb-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map((d) => {
          const isToday = d.key === todayKey;
          const isSelected = d.key === selectedKey;
          const { weekday, day } = labelFor(d.key);
          // Everything answered, and there was something to answer. Worth one glyph:
          // the row's job is to show WHERE a gap is without making you open each day.
          const settled = d.total > 0 && d.open === 0;

          return (
            <li key={d.key} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(d.key)}
                aria-current={isSelected ? 'date' : undefined}
                // The visible label is two glyphs, so the accessible name carries the
                // whole sentence — this row is a primary navigation control for
                // someone who may be using a screen reader to check on a parent.
                aria-label={
                  `${isToday ? 'Today, ' : ''}${new Date(Date.UTC(
                    Number(d.key.slice(0, 4)), Number(d.key.slice(5, 7)) - 1, Number(d.key.slice(8, 10)), 12,
                  )).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}`
                  + (d.total === 0
                    ? ' — no doses'
                    : d.open > 0
                      ? ` — ${d.total} ${d.total === 1 ? 'dose' : 'doses'}, ${d.open} to answer`
                      : ` — ${d.total} ${d.total === 1 ? 'dose' : 'doses'}, all answered`)
                }
                className={`min-h-11 w-[52px] rounded-2xl border flex flex-col items-center justify-center gap-0.5 py-1.5
                            transition-[background-color,border-color] duration-150 cursor-pointer
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
                            ${isSelected
                              ? 'bg-primary-strong text-primary-strong-foreground border-transparent'
                              : 'bg-card border-border hover:bg-muted'}`}
              >
                <span className={`font-mono uppercase tracking-wider leading-none ${isElderly ? 'text-[11px]' : 'text-[10px]'} ${isSelected ? 'text-primary-strong-foreground/80' : 'text-muted-foreground'}`}>
                  {weekday}
                </span>
                <span className={`font-bold tabular-nums leading-none ${isElderly ? 'text-lg' : 'text-base'}`}>
                  {day}
                </span>
                {/* One dot's worth of state, and never colour alone: an unanswered
                    day gets a filled dot, a fully answered one gets a tick. */}
                <span className="h-3 flex items-center" aria-hidden>
                  {d.open > 0 ? (
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-primary-strong-foreground' : 'bg-danger'}`} />
                  ) : settled ? (
                    <Check className={`w-3 h-3 ${isSelected ? 'text-primary-strong-foreground/90' : 'text-success-strong'}`} />
                  ) : null}
                </span>
              </button>
              {/* "Today" is spelled out rather than left to the highlight, which is
                  also what "selected" uses. Two meanings on one colour is how you end
                  up correcting yesterday believing it is today. */}
              <p className={`mt-1 text-center font-mono uppercase tracking-wider leading-none ${isElderly ? 'text-[10px]' : 'text-[9px]'} ${isToday ? 'text-primary-strong' : 'text-transparent'}`}>
                {isToday ? 'Today' : '·'}
              </p>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
