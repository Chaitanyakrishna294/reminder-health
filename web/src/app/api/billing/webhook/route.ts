// Razorpay subscription webhook (P3 skeleton). Verifies the HMAC signature against the
// raw body, then syncs subscription status into our subscriptions table.
// INERT until RAZORPAY_WEBHOOK_SECRET is set. See docs/VOICE_CALLS_DESIGN.md.
import { createServiceClient } from '@/lib/supabase/service-role';
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';

const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// Razorpay subscription events -> our status enum.
const STATUS_MAP: Record<string, string> = {
  'subscription.activated': 'active',
  'subscription.charged': 'active',
  'subscription.resumed': 'active',
  'subscription.pending': 'past_due',
  'subscription.halted': 'past_due',
  'subscription.cancelled': 'cancelled',
  'subscription.completed': 'cancelled',
};

export async function POST(request: Request) {
  if (!SECRET) return new Response('Not configured', { status: 503 });

  const signature = request.headers.get('x-razorpay-signature') || '';
  const raw = await request.text(); // raw body required for HMAC

  const expected = createHmac('sha256', SECRET).update(raw).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response('Invalid signature', { status: 401 });
  }

  let evt: { event?: string; payload?: { subscription?: { entity?: { id?: string; current_end?: number } } } };
  try {
    evt = JSON.parse(raw);
  } catch {
    return new Response('Bad body', { status: 400 });
  }

  const sub = evt?.payload?.subscription?.entity;
  const subId = sub?.id;
  const status = evt.event ? STATUS_MAP[evt.event] : undefined;

  if (subId && status) {
    const periodEnd = sub?.current_end ? new Date(sub.current_end * 1000).toISOString() : undefined;
    const admin = createServiceClient();
    const { error } = await admin
      .from('subscriptions')
      .update({
        status,
        plan: 'care_plus',
        ...(periodEnd ? { current_period_end: periodEnd } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('razorpay_subscription_id', subId);
    if (error) console.error('[billing/webhook] update failed:', error);
  }

  return NextResponse.json({ ok: true });
}
