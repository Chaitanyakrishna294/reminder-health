// Start the 7-day Care+ free trial — no payment required (P3 trial model).
// Authed + rate-limited. Marks the account 'trialing'; the paid Razorpay step
// happens at trial end. See docs/VOICE_CALLS_DESIGN.md (§1a).
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-role';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, tooManyRequests } from '@/lib/rate-limit';

const TRIAL_DAYS = 7;

export async function POST(request: Request) {
  try {
    if (!(await checkRateLimit(`billing:trial:${getClientIp(request)}`, 5, 600))) {
      return tooManyRequests();
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', user.id)
      .single();
    const telegramId = profile?.telegram_chat_id;
    if (!telegramId) return NextResponse.json({ error: 'No account identifier found.' }, { status: 400 });

    const admin = createServiceClient();

    // One trial per account: if any subscription row already exists, block re-trialing.
    const { data: existing } = await admin
      .from('subscriptions')
      .select('id, status')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'Your free trial has already been used.' }, { status: 409 });
    }

    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await admin.from('subscriptions').insert([{
      telegram_id: telegramId,
      plan: 'care_plus',
      status: 'trialing',
      current_period_end: trialEndsAt,
    }]);
    if (error) {
      console.error('[billing/start-trial] insert failed:', error);
      return NextResponse.json({ error: 'Could not start the trial. Try again.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, trial_ends_at: trialEndsAt });
  } catch (error: unknown) {
    console.error('[billing/start-trial] error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
