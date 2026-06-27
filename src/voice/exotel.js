// Exotel outbound-voice adapter (P1 skeleton).
// Inert until EXOTEL_* env vars are set. See docs/VOICE_CALLS_DESIGN.md.
//
// NOTE: Exotel's exact outbound mechanism (Connect API "Url"/applet vs App Bazaar
// flow) must be confirmed against the live account before enabling. The request
// shape below is the Connect API starting point; treat the endpoint/params as TODO
// to validate during the Exotel onboarding.

const EXOTEL_SID = process.env.EXOTEL_SID;
const EXOTEL_API_KEY = process.env.EXOTEL_API_KEY;
const EXOTEL_API_TOKEN = process.env.EXOTEL_API_TOKEN;
const EXOTEL_CALLER_ID = process.env.EXOTEL_CALLER_ID;          // verified ExoPhone / DLT caller id
const EXOTEL_SUBDOMAIN = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';

function isConfigured() {
  return Boolean(EXOTEL_SID && EXOTEL_API_KEY && EXOTEL_API_TOKEN && EXOTEL_CALLER_ID);
}

/**
 * Place an outbound call. On answer the provider should fetch `answerUrl` (our IVR
 * script) and post keypad input + status to our webhooks.
 * @returns {Promise<{ok:boolean, sid?:string, reason?:string, detail?:any}>}
 */
async function placeCall({ to, answerUrl, statusUrl }) {
  if (!isConfigured()) return { ok: false, reason: 'EXOTEL_NOT_CONFIGURED' };
  if (typeof fetch !== 'function') return { ok: false, reason: 'FETCH_UNAVAILABLE' };
  if (!to) return { ok: false, reason: 'NO_DESTINATION' };

  try {
    const endpoint =
      `https://${encodeURIComponent(EXOTEL_API_KEY)}:${encodeURIComponent(EXOTEL_API_TOKEN)}` +
      `@${EXOTEL_SUBDOMAIN}/v1/Accounts/${EXOTEL_SID}/Calls/connect.json`;

    const body = new URLSearchParams();
    body.set('From', to);                 // customer number to dial
    body.set('CallerId', EXOTEL_CALLER_ID);
    body.set('Url', answerUrl);           // TODO: confirm applet vs Url for IVR flow
    if (statusUrl) body.set('StatusCallback', statusUrl);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: `EXOTEL_HTTP_${res.status}`, detail: json };

    const sid = json?.Call?.Sid || json?.Sid || null;
    return { ok: true, sid, detail: json };
  } catch (err) {
    return { ok: false, reason: 'EXOTEL_REQUEST_FAILED', detail: String((err && err.message) || err) };
  }
}

module.exports = { isConfigured, placeCall };
