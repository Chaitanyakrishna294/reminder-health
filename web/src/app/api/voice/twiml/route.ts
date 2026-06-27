// Voice IVR script webhook (P1 skeleton). The provider fetches this when the call is
// answered. Returns the spoken prompt + a keypad gather. INERT until VOICE_CALLS_ENABLED=true.
// NOTE: response body is TwiML-style as a starting point — confirm the exact format
// (Exotel applet vs TwiML) during Exotel onboarding. See docs/VOICE_CALLS_DESIGN.md.
import { createServiceClient } from '@/lib/supabase/service-role';

const enabled = () => process.env.VOICE_CALLS_ENABLED === 'true';
const base = () => (process.env.PUBLIC_WEBHOOK_BASE_URL || '').replace(/\/$/, '');

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string)
  );
}

function xml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

async function handle(request: Request) {
  if (!enabled()) return new Response('Not found', { status: 404 });

  const callId = new URL(request.url).searchParams.get('callId');
  if (!callId) return new Response('Missing callId', { status: 400 });

  const supabase = createServiceClient();
  const { data: call } = await supabase
    .from('voice_calls')
    .select('id, telegram_id, call_type')
    .eq('id', callId)
    .maybeSingle();
  if (!call) return new Response('Call not found', { status: 404 });

  // TODO(P1): scope to the specific window's due meds once the call script is finalized.
  const { data: meds } = await supabase
    .from('medications')
    .select('drug_name')
    .eq('telegram_id', call.telegram_id)
    .eq('active', true);
  const names = (meds || []).map((m) => m.drug_name).join(', ');

  const speak =
    call.call_type === 'nightly_confirmation'
      ? 'Hello. This is your end of day medication check in. Press 1 if you took all your medicines today. Press 2 if you missed any.'
      : names
        ? `Hello. This is your medication reminder. It is time for: ${names}. Press 1 if you have taken all. Press 2 to skip.`
        : 'Hello. This is your medication reminder.';

  const action = `${base()}/api/voice/response?callId=${encodeURIComponent(callId)}`;
  return xml(
    `<Response><Gather numDigits="1" action="${escapeXml(action)}" method="POST">` +
      `<Say>${escapeXml(speak)}</Say></Gather></Response>`
  );
}

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
