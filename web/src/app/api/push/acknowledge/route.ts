import { createServiceClient } from '@/lib/supabase/service-role';
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';
import { checkRateLimit, getClientIp, tooManyRequests } from '@/lib/rate-limit';

const CallbackSchema = z.object({
  eventId: z.union([z.number().int().positive(), z.string().min(1).max(64)]),
  trackingToken: z.string().min(1).max(512),
});

export async function POST(request: Request) {
  try {
    if (!(await checkRateLimit(`push:ack:${getClientIp(request)}`, 60, 60))) {
      return tooManyRequests();
    }

    const parsed = CallbackSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing eventId or trackingToken.' }, { status: 400 });
    }
    const { eventId, trackingToken } = parsed.data;

    // 1. Verify token authorization using SHA-256 hash matching
    const tokenHash = createHash('sha256').update(trackingToken).digest('hex');
    const supabase = createServiceClient();

    const { data: tokenRecord, error: tokenErr } = await supabase
      .from('push_tracking_tokens')
      .select('event_id, expires_at')
      .eq('token_hash', tokenHash)
      .single();

    if (tokenErr || !tokenRecord) {
      return NextResponse.json({ error: 'Invalid tracking token.' }, { status: 401 });
    }

    // Check expiration
    if (new Date(tokenRecord.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Tracking token expired.' }, { status: 401 });
    }

    // Double check eventId match
    if (String(tokenRecord.event_id) !== String(eventId)) {
      return NextResponse.json({ error: 'Token and event ID mismatch.' }, { status: 401 });
    }

    // 2. Fetch event information
    const { data: eventRecord, error: eventErr } = await supabase
      .from('reminder_events')
      .select('id, telegram_id, reminder_status')
      .eq('id', eventId)
      .single();

    if (eventErr || !eventRecord) {
      return NextResponse.json({ error: 'Reminder event not found.' }, { status: 404 });
    }

    // Block if event is already resolved (e.g. taken or skipped)
    if (eventRecord.reminder_status === 'TAKEN' || eventRecord.reminder_status === 'SKIPPED') {
      return NextResponse.json({ error: 'Dose already resolved.' }, { status: 400 });
    }

    // 3. Resolve user profile ID using telegram_id
    const { data: profileRecord } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_chat_id', eventRecord.telegram_id)
      .single();

    // 4. Update reminder_events to CAREGIVER_ACKNOWLEDGED
    const { error: updateErr } = await supabase
      .from('reminder_events')
      .update({
        reminder_status: 'CAREGIVER_ACKNOWLEDGED',
        resolution_channel: 'PUSH_NOTIFICATION'
      })
      .eq('id', eventId);

    if (updateErr) {
      console.error('[API Push Acknowledge] Failed to update reminder_events status:', updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 5. Insert push log for OPENED
    const { error: logErr } = await supabase
      .from('push_logs')
      .upsert(
        [
          {
            user_id: profileRecord?.id || null,
            event_id: eventId,
            status: 'OPENED',
            gateway: 'Service Worker',
          },
        ],
        { onConflict: 'event_id,status', ignoreDuplicates: true }
      );

    if (logErr) {
      console.error('[API Push Acknowledge] Database upsert error on push_logs:', logErr);
    }

    console.log(`[PUSH_DIAGNOSTIC] Action: push_acknowledge_callback | EventId: ${eventId}`);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API Push Acknowledge] Error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}
