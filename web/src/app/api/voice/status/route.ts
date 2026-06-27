// Voice call status webhook (P1 skeleton). Updates the call's terminal state + meters
// usage for quota/billing. INERT until VOICE_CALLS_ENABLED=true. See docs/VOICE_CALLS_DESIGN.md.
import { createServiceClient } from '@/lib/supabase/service-role';

const enabled = () => process.env.VOICE_CALLS_ENABLED === 'true';

// Provider status string -> our voice_calls.status enum.
const STATUS_MAP: Record<string, string> = {
  completed: 'COMPLETED',
  'in-progress': 'IN_PROGRESS',
  ringing: 'RINGING',
  busy: 'BUSY',
  'no-answer': 'NO_ANSWER',
  failed: 'FAILED',
  canceled: 'FAILED',
};

async function handle(request: Request) {
  if (!enabled()) return new Response('Not found', { status: 404 });

  const url = new URL(request.url);
  const callId = url.searchParams.get('callId');
  if (!callId) return new Response('Missing callId', { status: 400 });

  // Field names vary by provider; accept the common ones.
  const raw = (url.searchParams.get('CallStatus') || url.searchParams.get('Status') || '').toLowerCase();
  const status = STATUS_MAP[raw] || null;
  const billedSeconds = Number(
    url.searchParams.get('CallDuration') || url.searchParams.get('Duration') || 0
  ) || 0;

  const supabase = createServiceClient();
  const { data: call } = await supabase
    .from('voice_calls')
    .select('id, telegram_id, billed_seconds')
    .eq('id', callId)
    .maybeSingle();
  if (!call) return new Response('Call not found', { status: 404 });

  await supabase
    .from('voice_calls')
    .update({
      ...(status ? { status } : {}),
      ...(billedSeconds ? { billed_seconds: billedSeconds } : {}),
    })
    .eq('id', call.id);

  // Meter usage for quota/billing (period = current month).
  if (billedSeconds) {
    const periodYm = new Date().toISOString().slice(0, 7); // YYYY-MM
    const { data: usage } = await supabase
      .from('voice_call_usage')
      .select('id, calls_made, billed_seconds')
      .eq('telegram_id', call.telegram_id)
      .eq('period_ym', periodYm)
      .maybeSingle();

    if (usage) {
      await supabase
        .from('voice_call_usage')
        .update({
          calls_made: (usage.calls_made || 0) + 1,
          billed_seconds: (usage.billed_seconds || 0) + billedSeconds,
        })
        .eq('id', usage.id);
    } else {
      await supabase
        .from('voice_call_usage')
        .insert([{ telegram_id: call.telegram_id, period_ym: periodYm, calls_made: 1, billed_seconds: billedSeconds }]);
    }
  }

  // TODO(P1): on NO_ANSWER/BUSY, schedule a capped retry; if critical med unanswered,
  // reuse the existing caregiver escalation path.

  return new Response('OK', { status: 200 });
}

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
