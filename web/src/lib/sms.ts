// SMS adapter for OTP delivery (P1b). Inert until a provider is configured.
// India note: outbound OTP SMS requires a DLT-registered template + sender id.
// Supports MSG91 or Exotel; pick via SMS_PROVIDER. See docs/VOICE_CALLS_DESIGN.md.

type SmsResult = { ok: boolean; reason?: string; detail?: unknown };

const PROVIDER = (process.env.SMS_PROVIDER || 'msg91').toLowerCase();

export function smsConfigured(): boolean {
  if (PROVIDER === 'exotel') {
    return Boolean(
      process.env.EXOTEL_SID &&
        process.env.EXOTEL_API_KEY &&
        process.env.EXOTEL_API_TOKEN &&
        process.env.EXOTEL_SMS_SENDER
    );
  }
  // default: msg91
  return Boolean(process.env.MSG91_AUTHKEY && process.env.MSG91_SENDER);
}

export async function sendSms({ to, text }: { to: string; text: string }): Promise<SmsResult> {
  if (!smsConfigured()) return { ok: false, reason: 'SMS_NOT_CONFIGURED' };

  try {
    if (PROVIDER === 'exotel') {
      const endpoint =
        `https://${encodeURIComponent(process.env.EXOTEL_API_KEY!)}:${encodeURIComponent(process.env.EXOTEL_API_TOKEN!)}` +
        `@${process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com'}/v1/Accounts/${process.env.EXOTEL_SID}/Sms/send.json`;
      const body = new URLSearchParams();
      body.set('From', process.env.EXOTEL_SMS_SENDER!);
      body.set('To', to);
      body.set('Body', text);
      // TODO: attach DLT template/entity ids as required by Exotel India.
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const detail = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, detail } : { ok: false, reason: `EXOTEL_SMS_HTTP_${res.status}`, detail };
    }

    // MSG91 (default)
    const res = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: process.env.MSG91_AUTHKEY! },
      // TODO: MSG91 expects a DLT-approved flow/template id + variables, not raw text.
      // This is the request shape; wire template_id + recipients during onboarding.
      body: JSON.stringify({
        sender: process.env.MSG91_SENDER,
        template_id: process.env.MSG91_TEMPLATE_ID || '',
        recipients: [{ mobiles: to.replace(/^\+/, ''), OTP_TEXT: text }],
      }),
    });
    const detail = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, detail } : { ok: false, reason: `MSG91_HTTP_${res.status}`, detail };
  } catch (err) {
    return { ok: false, reason: 'SMS_REQUEST_FAILED', detail: String((err as Error)?.message || err) };
  }
}
