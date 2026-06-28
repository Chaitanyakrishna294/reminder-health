// Exotel outbound-voice adapter (P1).
// Inert until EXOTEL_* env vars are set. See docs/VOICE_CALLS_DESIGN.md.
//
// Exotel model (NOT Twilio): connect.json calls the customer (`From`) and, on answer,
// runs a Call Flow / App (`Url`) that you build in Exotel's Flow Builder. That flow's
// Passthru/Connect "dynamic URL" applet should point at our /api/voice/* webhooks.
// We forward our voice_calls id as `CustomField` so the flow can tell calls apart.
//   Docs: https://developer.exotel.com/api/outgoing-call-to-connect-number-to-a-call-flow

// Accept both the user's naming and the original skeleton names (back-compat).
const ACCOUNT_SID = process.env.EXOTEL_ACCOUNT_SID || process.env.EXOTEL_SID;
const API_KEY = process.env.EXOTEL_API_KEY;
const API_TOKEN = process.env.EXOTEL_API_TOKEN;
const CALLER_ID = process.env.EXOTEL_PHONE_NUMBER || process.env.EXOTEL_CALLER_ID; // ExoPhone
const SUBDOMAIN = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';
const FLOW_URL = process.env.EXOTEL_FLOW_URL; // http://my.exotel.com/<sid>/exoml/start_voice/<app_id>

function isConfigured() {
  return Boolean(ACCOUNT_SID && API_KEY && API_TOKEN && CALLER_ID && FLOW_URL);
}

/**
 * Place an outbound call that connects the patient to our Exotel Call Flow.
 * @param {{to:string, callId:string|number, statusUrl?:string}} args
 * @returns {Promise<{ok:boolean, sid?:string, reason?:string, detail?:any}>}
 */
async function placeCall({ to, callId, statusUrl }) {
  if (!isConfigured()) return { ok: false, reason: 'EXOTEL_NOT_CONFIGURED' };
  if (typeof fetch !== 'function') return { ok: false, reason: 'FETCH_UNAVAILABLE' };
  if (!to) return { ok: false, reason: 'NO_DESTINATION' };

  try {
    const endpoint =
      `https://${encodeURIComponent(API_KEY)}:${encodeURIComponent(API_TOKEN)}` +
      `@${SUBDOMAIN}/v1/Accounts/${ACCOUNT_SID}/Calls/connect.json`;

    const body = new URLSearchParams();
    body.set('From', to);             // dial the patient first
    body.set('CallerId', CALLER_ID);  // verified ExoPhone (DLT)
    body.set('Url', FLOW_URL);        // connect to our Call Flow / App on answer
    body.set('CustomField', String(callId)); // surfaced to the flow's dynamic URL
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
