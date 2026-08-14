'use client';

/**
 * Today's cup count — local-first, synced so the widget agrees across devices.
 *
 * ## The mechanism, stated plainly
 *
 * `localStorage` is the first paint and the offline buffer; the `water_logs` row
 * for (user, local day) is the shared truth. On mount the widget paints from
 * localStorage immediately, then reads the row and takes it. Every tap writes
 * localStorage synchronously and upserts in the background.
 *
 * **Last write wins, not "larger count wins."** Taking the larger number would
 * be the obvious conflict rule for a counter and it is the wrong one here: it
 * makes undo impossible, because the count the user just corrected would come
 * straight back from the other device. Undo is the entire purpose of the swipe.
 *
 * The cost is that a change made offline on one phone can be overwritten by a
 * later change on another. For a glass of water that is the right trade, and it
 * is the reason this feature records nothing else: there is no streak to break,
 * no adherence figure to skew, and no caregiver being told. A wrong count costs
 * a wrong count.
 *
 * Nothing here blocks the tap. A failed sync leaves the local value in place and
 * retries on the next mount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { localDayKey } from '@/lib/water/hydration';

const KEY_PREFIX = 'water-cups-';

function readLocal(day: string): number | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + day);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function writeLocal(day: string, cups: number) {
  try {
    localStorage.setItem(KEY_PREFIX + day, String(cups));
    // Yesterday's key is dead weight the moment the day rolls over. Cheap to
    // drop here rather than growing one entry per day forever.
    Object.keys(localStorage)
      .filter((k) => k.startsWith(KEY_PREFIX) && k !== KEY_PREFIX + day)
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* private mode, quota — the server round trip still carries the value */
  }
}

export function useWaterDay(enabled: boolean) {
  const [day, setDay] = useState(() => localDayKey());
  const [cups, setCups] = useState(0);
  const [ready, setReady] = useState(false);
  const userId = useRef<string | null>(null);

  // RESETS DAILY. The widget can be on screen across midnight — someone who
  // opens the app at 11:58pm and taps at 12:01am is starting a new day, and a
  // count that carried over would be wrong in the direction that flatters us.
  useEffect(() => {
    const tick = setInterval(() => {
      const today = localDayKey();
      setDay((d) => (d === today ? d : today));
    }, 60_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const local = readLocal(day);
    if (local != null) setCups(local);

    (async () => {
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        const id = userData.user?.id ?? null;
        userId.current = id;
        if (!id) {
          setReady(true);
          return;
        }
        const { data } = await supabase
          .from('water_logs')
          .select('cups')
          .eq('user_id', id)
          .eq('day', day)
          .maybeSingle();
        if (cancelled) return;
        if (data?.cups != null) {
          setCups(data.cups);
          writeLocal(day, data.cups);
        }
      } catch {
        // Offline, or the migration is not applied yet. The local value stands.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, day]);

  const commit = useCallback(
    (next: number) => {
      setCups(next);
      writeLocal(day, next);
      const id = userId.current;
      if (!id) return;
      // Fire and forget: the tap must confirm instantly, and a failure leaves
      // the local value in place to be re-sent on the next mount.
      void (async () => {
        try {
          const supabase = createClient();
          await supabase
            .from('water_logs')
            .upsert(
              { user_id: id, day, cups: next, updated_at: new Date().toISOString() },
              { onConflict: 'user_id,day' },
            );
        } catch {
          /* see above */
        }
      })();
    },
    [day],
  );

  const add = useCallback(() => commit(Math.min(60, cups + 1)), [commit, cups]);
  const undo = useCallback(() => commit(Math.max(0, cups - 1)), [commit, cups]);

  return { cups, add, undo, ready, day };
}
