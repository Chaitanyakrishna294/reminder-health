// Server-side browser push, ported from the bot's src/scheduler.js sendBrowserPush
// so the web failover cron can deliver reminders when the bot is down. Uses the
// service client (bypasses RLS). Fire-and-forget: any failure is logged, never thrown.
import webpush from 'web-push';
import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/service-role';

let vapidReady = false;
function ensureVapid(): boolean {
  if (vapidReady) return true;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return false; // push disabled
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidReady = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  eventId?: number | string | null;
}

export async function sendBrowserPush(telegramId: string, payload: PushPayload): Promise<void> {
  if (!ensureVapid()) return;
  const supabase = createServiceClient();
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_chat_id', telegramId)
      .single();
    if (!profile) return; // user not on the web dashboard

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', profile.id);
    if (!subs || subs.length === 0) return;

    // Mint a tracking token so the Take/Skip push actions authorize against this event.
    let trackingToken: string | null = null;
    if (payload.eventId) {
      trackingToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(trackingToken).digest('hex');
      await supabase.from('push_tracking_tokens').insert([{
        event_id: payload.eventId,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }]);
    }

    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      eventId: payload.eventId ?? null,
      trackingToken,
    });

    for (const sub of subs) {
      const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      let gateway = 'Unknown Gateway';
      try { gateway = new URL(sub.endpoint).hostname; } catch { /* ignore */ }
      try {
        await webpush.sendNotification(subscription, pushPayload);
        await supabase.from('push_logs').upsert(
          [{ user_id: profile.id, event_id: payload.eventId ?? null, status: 'SENT', gateway }],
          { onConflict: 'event_id,status', ignoreDuplicates: true },
        );
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        let status = 'FAILED';
        if (e.statusCode === 410 || e.statusCode === 404) {
          status = 'EXPIRED';
          await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          console.error(`[send-push] gateway error sub ${sub.id} code ${e.statusCode ?? '?'}: ${e.message}`);
        }
        await supabase.from('push_logs').upsert(
          [{ user_id: profile.id, event_id: payload.eventId ?? null, status, gateway, error_message: e.message }],
          { onConflict: 'event_id,status', ignoreDuplicates: true },
        );
      }
    }
  } catch (err) {
    console.error('[send-push] error:', err);
  }
}
