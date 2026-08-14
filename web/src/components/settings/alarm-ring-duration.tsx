'use client';

/**
 * Settings → Notifications → how long each dose alarm rings.
 *
 * The alarm screen used to ring for a hard-coded 60 seconds. That number was
 * chosen when an alarm asked about exactly one dose; the coalesced ring asks
 * about a HANDFUL, one dose at a time, each with its own window, so 60s became a
 * per-dose budget and whether it is enough now depends on the person holding the
 * phone. Someone who needs two minutes to reach the kitchen and read a label is
 * not served by a number picked for someone who does not.
 *
 * THE ARITHMETIC IS ON SCREEN. The setting is per dose and the thing it drives is
 * per handful, so the hint names the user's own busiest reminder time and the
 * total it adds up to. Four medicines at 3 minutes is a lit, ringing phone for
 * twelve, and the only way someone can weigh that is if we say it.
 *
 * WHAT IT DOES NOT DO, said plainly in the copy: running out of time does not
 * record anything. The dose stays unanswered, its retry ladder keeps going and
 * the care circle is still told. Without that line a longer ring reads as "more
 * chances to be marked missed", which is backwards.
 */

import React, { useState } from 'react';
import { AlarmClock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import {
  RING_DURATION_CHOICES,
  ringDurationHint,
  ringDurationLabel,
} from '@/lib/alarm/ring-duration';

export default function AlarmRingDuration({
  initialSeconds,
  largestHandful,
}: {
  initialSeconds: number;
  /** How many doses share the user's busiest reminder time — drives the hint. */
  largestHandful: number;
}) {
  const { isElderly } = useUiMode();
  const [seconds, setSeconds] = useState(initialSeconds);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const label = isElderly ? 'text-xl' : 'text-sm';
  const body = isElderly ? 'text-base' : 'text-xs';

  const choose = async (next: number) => {
    if (busy || next === seconds) return;
    const previous = seconds;
    // Optimistic: the control has to feel immediate, and the failure path puts
    // it back rather than leaving a chosen-looking value that never saved.
    setSeconds(next);
    setBusy(true);
    setNote(null);
    try {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const id = userData.user?.id;
      if (!id) throw new Error('no session');
      const { error } = await supabase
        .from('profiles')
        .update({ alarm_ring_seconds: next })
        .eq('id', id);
      if (error) throw error;
      setNote('Saved. Open the app once on your phone for this to reach your alarms.');
    } catch {
      setSeconds(previous);
      setNote('Could not save that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-card border border-border rounded-3xl p-5 space-y-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`shrink-0 rounded-2xl flex items-center justify-center bg-muted text-muted-foreground ${
            isElderly ? 'w-14 h-14' : 'w-10 h-10'
          }`}
        >
          <AlarmClock className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
        </span>
        <div className="min-w-0">
          <p className={`font-extrabold text-foreground ${label}`}>How long each alarm rings</p>
          <p className={`text-muted-foreground font-semibold mt-0.5 text-balance ${body}`}>
            {ringDurationHint(seconds, largestHandful)}
          </p>
        </div>
      </div>

      <div role="radiogroup" aria-label="How long each alarm rings" className="flex flex-wrap gap-2">
        {RING_DURATION_CHOICES.map((choice) => {
          const active = choice === seconds;
          return (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy}
              onClick={() => choose(choice)}
              className={`rounded-2xl px-4 font-black transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                isElderly ? 'min-h-16 text-lg' : 'min-h-12 text-sm'
              } ${
                active
                  ? 'bg-primary-strong text-primary-strong-foreground'
                  : 'bg-muted text-foreground hover:bg-muted/70'
              }`}
            >
              {ringDurationLabel(choice)}
            </button>
          );
        })}
      </div>

      <p className={`text-muted-foreground font-semibold text-balance ${body}`}>
        Running out of time does not record anything. The dose stays unanswered, your
        phone keeps reminding you, and your care circle is still told.
      </p>

      {note && (
        <p className={`font-bold text-muted-foreground ${body}`} role="status">
          {note}
        </p>
      )}
    </section>
  );
}
