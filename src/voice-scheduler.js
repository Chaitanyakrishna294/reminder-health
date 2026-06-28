// Voice-call scheduler (P1 skeleton) — fully ISOLATED from the medication tick.
//   * Own cron, own cross-instance lock ('voice_minute_tick').
//   * Gated by VOICE_CALLS_ENABLED (default off): when off, no cron is scheduled.
//   * Every operation wrapped so a voice failure can never affect medication reminders.
// See docs/VOICE_CALLS_DESIGN.md.

const cron = require('node-cron');
const crypto = require('crypto');
const moment = require('moment-timezone');
const { supabase } = require('./db');
const exotel = require('./voice/exotel');

const VOICE_INSTANCE_ID = crypto.randomUUID();
const ENABLED = process.env.VOICE_CALLS_ENABLED === 'true';
const WEBHOOK_BASE = (process.env.PUBLIC_WEBHOOK_BASE_URL || '').replace(/\/$/, '');
const DAILY_CALL_CAP = Number(process.env.VOICE_DAILY_CALL_CAP || 6);

// Which call(s) are due for a preference at the current wall-clock minute (in its tz).
function callsDue(pref, hhmm) {
  const out = [];
  for (const key of ['morning', 'afternoon', 'night']) {
    const w = pref[key];
    if (w && w.enabled && w.time === hhmm) out.push({ call_type: 'med_reminder', window_key: key });
  }
  const nc = pref.nightly_confirm;
  if (nc && nc.enabled && nc.time === hhmm) out.push({ call_type: 'nightly_confirmation', window_key: null });
  return out;
}

async function processPreference(pref) {
  const tz = pref.timezone || 'Asia/Kolkata';
  const nowTz = moment().tz(tz);
  const hhmm = nowTz.format('HH:mm');
  const due = callsDue(pref, hhmm);
  if (due.length === 0) return;

  // Per-medication fan-out is a later phase; skeleton handles grouped + nightly only.
  if (pref.mode === 'per_medication') return;

  // Daily cap (cost guard).
  const startOfDay = nowTz.clone().startOf('day').toISOString();
  const { count: todayCount } = await supabase
    .from('voice_calls')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', pref.telegram_id)
    .gte('created_at', startOfDay);
  if ((todayCount || 0) >= DAILY_CALL_CAP) return;

  for (const d of due) {
    const scheduledFor = nowTz.clone().seconds(0).milliseconds(0).toISOString();

    // Idempotent claim: unique (telegram_id, call_type, window_key, scheduled_for).
    const { data: inserted, error: insErr } = await supabase
      .from('voice_calls')
      .insert([{
        telegram_id: pref.telegram_id,
        call_type: d.call_type,
        window_key: d.window_key,
        scheduled_for: scheduledFor,
        status: 'QUEUED',
      }])
      .select()
      .maybeSingle();
    if (insErr || !inserted) continue; // unique violation => already queued this minute

    if (!pref.phone_e164) {
      await supabase.from('voice_calls').update({ status: 'FAILED' }).eq('id', inserted.id);
      continue;
    }

    const statusUrl = `${WEBHOOK_BASE}/api/voice/status?callId=${inserted.id}`;
    const r = await exotel.placeCall({ to: pref.phone_e164, callId: inserted.id, statusUrl });

    await supabase
      .from('voice_calls')
      .update({
        status: r.ok ? 'INITIATED' : 'FAILED',
        provider_call_sid: r.sid || null,
        attempts: 1,
      })
      .eq('id', inserted.id);

    if (!r.ok) {
      console.warn(`[VoiceScheduler] placeCall failed for call ${inserted.id}: ${r.reason}`);
    }
  }
}

async function tick() {
  let lockHeld = false;
  try {
    const { data: locked, error: lockErr } = await supabase.rpc('try_acquire_scheduler_lock', {
      p_lock_name: 'voice_minute_tick',
      p_ttl_seconds: 120,
      p_holder: VOICE_INSTANCE_ID,
    });
    if (lockErr || !locked) return;
    lockHeld = true;

    const { data: prefs, error } = await supabase
      .from('voice_call_preferences')
      .select('*')
      .eq('enabled', true)
      .eq('phone_verified', true)
      .eq('dnd_optout', false)
      .not('consent_at', 'is', null);
    if (error) { console.error('[VoiceScheduler] load prefs failed:', error); return; }
    if (!prefs || prefs.length === 0) return;

    for (const pref of prefs) {
      try {
        await processPreference(pref);
      } catch (perr) {
        console.error(`[VoiceScheduler] error for ${pref.telegram_id}:`, perr);
      }
    }
  } catch (err) {
    console.error('[VoiceScheduler] tick error:', err);
  } finally {
    if (lockHeld) {
      await supabase
        .rpc('release_scheduler_lock', { p_lock_name: 'voice_minute_tick', p_holder: VOICE_INSTANCE_ID })
        .catch((e) => console.error('[VoiceScheduler] lock release failed:', e));
    }
  }
}

function initVoiceScheduler() {
  if (!ENABLED) {
    console.log('[VoiceScheduler] VOICE_CALLS_ENABLED != true — disabled (no cron scheduled).');
    return;
  }
  if (!WEBHOOK_BASE) console.warn('[VoiceScheduler] PUBLIC_WEBHOOK_BASE_URL not set — provider cannot reach webhooks.');
  if (!exotel.isConfigured()) console.warn('[VoiceScheduler] Exotel not configured — calls will be marked FAILED until creds are set.');
  console.log('⏰📞 Voice scheduler initialized (minute tick).');
  cron.schedule('* * * * *', () => { tick().catch((e) => console.error('[VoiceScheduler] unhandled:', e)); });
}

module.exports = { initVoiceScheduler };
