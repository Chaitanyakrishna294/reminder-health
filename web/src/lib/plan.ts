// Plan gating (P3). Resolves whether an account is on the paid Care+ plan.
// Used to gate voice features. See docs/VOICE_CALLS_DESIGN.md.
import type { SupabaseClient } from '@supabase/supabase-js';

export type Plan = 'free' | 'care_plus';

export async function getActivePlan(supabase: SupabaseClient, telegramId: string): Promise<Plan> {
  const { data } = await supabase
    .from('subscriptions')
    .select('plan, status, current_period_end')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (!data) return 'free';
  const active =
    data.plan === 'care_plus' &&
    data.status === 'active' &&
    (!data.current_period_end || new Date(data.current_period_end) > new Date());
  return active ? 'care_plus' : 'free';
}

export async function isCarePlus(supabase: SupabaseClient, telegramId: string): Promise<boolean> {
  return (await getActivePlan(supabase, telegramId)) === 'care_plus';
}
