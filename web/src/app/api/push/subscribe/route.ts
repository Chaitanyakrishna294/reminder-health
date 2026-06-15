import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, getClientIp, tooManyRequests } from '@/lib/rate-limit';

const SubscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(2048),
    keys: z.object({
      auth: z.string().min(1).max(512),
      p256dh: z.string().min(1).max(512),
    }),
  }),
  deviceName: z.string().max(120).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    if (!(await checkRateLimit(`push:subscribe:${getClientIp(request)}`, 30, 60))) {
      return tooManyRequests();
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = SubscribeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid subscription payload.' }, { status: 400 });
    }
    const { subscription, deviceName } = parsed.data;
    const endpoint = subscription.endpoint;
    const auth = subscription.keys.auth;
    const p256dh = subscription.keys.p256dh;

    // Upsert push subscription in public.push_subscriptions table
    const { data, error: upsertErr } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh,
          auth,
          device_name: deviceName || null,
        },
        { onConflict: 'user_id,endpoint' }
      )
      .select();

    if (upsertErr) {
      console.error('[API Subscribe] Database upsert error:', upsertErr);
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    console.log(`[PUSH_DIAGNOSTIC] Action: subscription_registered | User: ${user.id} | Device: ${deviceName || 'Unknown'} | Endpoint: ...${endpoint.slice(-30)}`);

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('[API Subscribe] Catch block error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}
