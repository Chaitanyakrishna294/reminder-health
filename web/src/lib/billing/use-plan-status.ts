'use client';

// Resolves the caller's Care+ plan status client-side from the `subscriptions`
// table. Extracted from care-plus-card.tsx so the dashboard Care+ spotlight banner
// and the card share one query and one source of truth. Mirrors the rules in
// lib/plan.ts (getActivePlan): a trial counts until current_period_end passes.
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export type PlanStatus = 'loading' | 'free' | 'trialing' | 'active';

export interface UsePlanStatus {
  status: PlanStatus;
  daysLeft: number | null;
  // Exposed so a caller that just started a trial can optimistically reflect it
  // (preserves the card's prior post-start-trial behavior).
  setStatus: (s: PlanStatus) => void;
  setDaysLeft: (d: number | null) => void;
}

export function usePlanStatus(telegramId: string): UsePlanStatus {
  const supabase = createClient();
  const [status, setStatus] = useState<PlanStatus>('loading');
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('subscriptions')
          .select('status, current_period_end')
          .eq('telegram_id', telegramId)
          .maybeSingle();
        if (cancelled) return;
        if (!data) { setStatus('free'); return; }
        const future = data.current_period_end ? new Date(data.current_period_end) > new Date() : true;
        if (data.status === 'active') setStatus('active');
        else if (data.status === 'trialing' && future) {
          setStatus('trialing');
          if (data.current_period_end) {
            setDaysLeft(Math.max(0, Math.ceil((new Date(data.current_period_end).getTime() - Date.now()) / 86400000)));
          }
        } else setStatus('free');
      } catch {
        if (!cancelled) setStatus('free');
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, telegramId]);

  return { status, daysLeft, setStatus, setDaysLeft };
}
