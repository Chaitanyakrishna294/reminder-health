// Voice keypad-response webhook (P1 skeleton). Maps DTMF to TAKEN/SKIP and resolves
// doses through the SAME resolve_reminder_event RPC as Telegram/push (one ledger).
// INERT until VOICE_CALLS_ENABLED=true. See docs/VOICE_CALLS_DESIGN.md.
import { createServiceClient } from '@/lib/supabase/service-role';

const enabled = () => process.env.VOICE_CALLS_ENABLED === 'true';
const RESOLVED = ['TAKEN', 'SKIPPED', 'RESOLVED_BY_CG'];
const WINDOW_MS = 90 * 60 * 1000; // match doses within ±90 min of the call

function xml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

async function handle(request: Request) {
  if (!enabled()) return new Response('Not found', { status: 404 });

  const url = new URL(request.url);
  const callId = url.searchParams.get('callId');
  // Provider field name for the pressed key varies — accept the common ones.
  const digits = url.searchParams.get('digits') || url.searchParams.get('Digits') || '';
  if (!callId) return new Response('Missing callId', { status: 400 });

  const supabase = createServiceClient();
  const { data: call } = await supabase
    .from('voice_calls')
    .select('id, telegram_id, scheduled_for, responses')
    .eq('id', callId)
    .maybeSingle();
  if (!call) return new Response('Call not found', { status: 404 });

  const action = digits === '1' ? 'TAKEN' : digits === '2' ? 'SKIP' : null;

  // Record the raw keypad response on the call.
  const prior = Array.isArray(call.responses) ? call.responses : [];
  await supabase
    .from('voice_calls')
    .update({ responses: [...prior, { digits, action, at: new Date().toISOString() }] })
    .eq('id', call.id);

  if (action) {
    // Resolve this patient's pending doses near the call time via the one-ledger RPC.
    // TODO(P1): tighten to the exact window's medications once the script is finalized.
    const callMs = new Date(call.scheduled_for).getTime();
    const { data: events } = await supabase
      .from('reminder_events')
      .select('id, medication_id, scheduled_for, reminder_status')
      .eq('telegram_id', call.telegram_id)
      .gte('scheduled_for', new Date(callMs - WINDOW_MS).toISOString())
      .lte('scheduled_for', new Date(callMs + WINDOW_MS).toISOString());

    for (const ev of events || []) {
      if (RESOLVED.includes(ev.reminder_status)) continue;
      const { error } = await supabase.rpc('resolve_reminder_event', {
        p_event_id: ev.id,
        p_medication_id: ev.medication_id,
        p_scheduled_for: ev.scheduled_for,
        p_action: action,
        p_actor_role: 'PATIENT',
        p_resolution_channel: 'VOICE_CALL',
      });
      if (error) console.error('[voice/response] resolve failed:', error);
    }
  }

  const say = action ? 'Thank you. Goodbye.' : 'Sorry, I did not get that. Goodbye.';
  return xml(`<Response><Say>${say}</Say></Response>`);
}

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
