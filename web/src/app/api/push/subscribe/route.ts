import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { subscription, deviceName } = body;

    if (!subscription || !subscription.endpoint) {
      return NextResponse.json({ error: 'Invalid subscription payload.' }, { status: 400 });
    }

    const endpoint = subscription.endpoint;
    const auth = subscription.keys?.auth;
    const p256dh = subscription.keys?.p256dh;

    if (!auth || !p256dh) {
      return NextResponse.json({ error: 'Missing encryption keys from subscription.' }, { status: 400 });
    }

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
