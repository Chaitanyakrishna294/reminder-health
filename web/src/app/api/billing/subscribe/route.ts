// Start a Care+ subscription (P3 skeleton). Authed + rate-limited. Creates a Razorpay
// subscription and records it as pending; the webhook flips it active on payment.
// Returns { subscription_id, key_id } for Razorpay Checkout. See docs/VOICE_CALLS_DESIGN.md.
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-role';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, tooManyRequests } from '@/lib/rate-limit';
import { razorpayConfigured, publicKeyId, createSubscription } from '@/lib/razorpay';

export async function POST(request: Request) {
  try {
    if (!(await checkRateLimit(`billing:subscribe:${getClientIp(request)}`, 10, 600))) {
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

    if (!razorpayConfigured()) {
      return NextResponse.json({ error: 'Subscriptions are not available yet.' }, { status: 503 });
    }

    const r = await createSubscription({ telegram_id: telegramId, email: user.email });
    if (!r.ok || !r.id) {
      console.error('[billing/subscribe] createSubscription failed:', r.reason, r.detail);
      return NextResponse.json({ error: 'Could not start subscription. Try again.' }, { status: 502 });
    }

    // Record the pending subscription so the webhook can activate it by id.
    // Never downgrade a live trial/active row to 'created': an abandoned checkout
    // must not cost the user their remaining trial. Status only moves forward via
    // the payment webhook.
    const admin = createServiceClient();
    const { data: existing } = await admin
      .from('subscriptions')
      .select('status')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    const keepStatus = existing?.status === 'trialing' || existing?.status === 'active';
    await admin.from('subscriptions').upsert(
      {
        telegram_id: telegramId,
        plan: 'care_plus',
        ...(keepStatus ? {} : { status: 'created' }),
        razorpay_subscription_id: r.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'telegram_id' }
    );

    return NextResponse.json({ subscription_id: r.id, key_id: publicKeyId() });
  } catch (error: unknown) {
    console.error('[billing/subscribe] error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
