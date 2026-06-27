// Razorpay billing adapter (P3 skeleton). Inert until RAZORPAY_* env vars are set.
// Uses the REST API directly (no SDK dependency). See docs/VOICE_CALLS_DESIGN.md.

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const PLAN_ID = process.env.RAZORPAY_CAREPLUS_PLAN_ID; // created in the Razorpay dashboard

export function razorpayConfigured(): boolean {
  return Boolean(KEY_ID && KEY_SECRET && PLAN_ID);
}

// Safe to expose to the client (the publishable key id used by Checkout).
export function publicKeyId(): string {
  return KEY_ID || '';
}

type SubResult = { ok: boolean; id?: string; reason?: string; detail?: unknown };

export async function createSubscription(notes: Record<string, string | null | undefined>): Promise<SubResult> {
  if (!razorpayConfigured()) return { ok: false, reason: 'RAZORPAY_NOT_CONFIGURED' };
  try {
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: PLAN_ID,
        total_count: 12, // 12 billing cycles; tune during onboarding
        customer_notify: 1,
        notes,
      }),
    });
    const detail = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: `RAZORPAY_HTTP_${res.status}`, detail };
    return { ok: true, id: (detail as { id?: string }).id, detail };
  } catch (err) {
    return { ok: false, reason: 'RAZORPAY_REQUEST_FAILED', detail: String((err as Error)?.message || err) };
  }
}
