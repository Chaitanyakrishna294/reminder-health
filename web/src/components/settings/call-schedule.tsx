'use client';

// P0 "Call schedule" — captures the patient's voice-call reminder preferences into
// voice_call_preferences. No calls are placed yet (Exotel + OTP land in P1); this is
// preference capture only. See docs/VOICE_CALLS_DESIGN.md.

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getActivePlan } from '@/lib/plan';
import CarePlusCard from '@/components/billing/care-plus-card';
import { PhoneCall, Sun, CloudSun, Moon, MoonStar, Check, ShieldCheck } from 'lucide-react';

type Window = { enabled: boolean; time: string };
interface Prefs {
  phone_e164: string;
  enabled: boolean;
  mode: 'grouped' | 'per_medication';
  morning: Window;
  afternoon: Window;
  night: Window;
  nightly_confirm: Window;
  consent: boolean;
}

const DEFAULTS: Prefs = {
  phone_e164: '',
  enabled: false,
  mode: 'grouped',
  morning: { enabled: true, time: '08:00' },
  afternoon: { enabled: false, time: '14:00' },
  night: { enabled: true, time: '20:00' },
  nightly_confirm: { enabled: true, time: '21:30' },
  consent: false,
};

// E.164 India-friendly check: +<country><number>, 8–15 digits total.
const isValidPhone = (p: string) => /^\+\d{8,15}$/.test(p.trim());

// Per-window reminder scheduling (the "How should we call?" mode + the
// Morning/Afternoon/Night call windows) is hidden for now — at launch we offer a
// single nightly confirmation call only (budget). Flip to true to bring it back.
const SHOW_REMINDER_WINDOWS = false;

export default function CallSchedule({ telegramId, isElderly }: { telegramId: string; isElderly: boolean }) {
  const supabase = createClient();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  // Phone verification (OTP)
  const [verified, setVerified] = useState(false);
  const [otpStage, setOtpStage] = useState<'idle' | 'sent'>('idle');
  const [code, setCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpMsg, setOtpMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  // Care+ gate: voice calls are a paid (or trial) feature.
  const [access, setAccess] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const plan = await getActivePlan(supabase, telegramId);
        if (cancelled) return;
        setAccess(plan === 'care_plus');

        const { data } = await supabase
          .from('voice_call_preferences')
          .select('*')
          .eq('telegram_id', telegramId)
          .maybeSingle();
        if (cancelled) return;
        if (data) {
          setPrefs({
            phone_e164: data.phone_e164 || '',
            enabled: !!data.enabled,
            mode: data.mode === 'per_medication' ? 'per_medication' : 'grouped',
            morning: data.morning || DEFAULTS.morning,
            afternoon: data.afternoon || DEFAULTS.afternoon,
            night: data.night || DEFAULTS.night,
            nightly_confirm: data.nightly_confirm || DEFAULTS.nightly_confirm,
            consent: !!data.consent_at,
          });
          setVerified(!!data.phone_verified);
        }
      } catch (err) {
        console.error('[CallSchedule] load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, telegramId]);

  const setWindow = (key: 'morning' | 'afternoon' | 'night' | 'nightly_confirm', patch: Partial<Window>) =>
    setPrefs((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  const handleSendCode = async () => {
    setOtpMsg(null);
    if (!isValidPhone(prefs.phone_e164)) {
      setOtpMsg({ type: 'err', text: 'Enter a valid number first (e.g. +9198XXXXXXXX).' });
      return;
    }
    setOtpBusy(true);
    try {
      const res = await fetch('/api/voice/verify/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: prefs.phone_e164.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not send the code.');
      setOtpStage('sent');
      setOtpMsg({ type: 'ok', text: 'Code sent — check your SMS.' });
    } catch (e) {
      setOtpMsg({ type: 'err', text: e instanceof Error ? e.message : 'Failed to send code.' });
    } finally {
      setOtpBusy(false);
    }
  };

  const handleCheckCode = async () => {
    setOtpMsg(null);
    setOtpBusy(true);
    try {
      const res = await fetch('/api/voice/verify/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: prefs.phone_e164.trim(), code }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not verify the code.');
      setVerified(true);
      setOtpStage('idle');
      setCode('');
      setOtpMsg({ type: 'ok', text: 'Phone verified.' });
    } catch (e) {
      setOtpMsg({ type: 'err', text: e instanceof Error ? e.message : 'Verification failed.' });
    } finally {
      setOtpBusy(false);
    }
  };

  const handleSave = async () => {
    setMsg(null);
    if (prefs.enabled) {
      if (!isValidPhone(prefs.phone_e164)) {
        setMsg({ type: 'err', text: 'Enter a valid phone number in international format, e.g. +9198XXXXXXXX.' });
        return;
      }
      if (!prefs.consent) {
        setMsg({ type: 'err', text: 'Please tick consent to receive automated reminder calls.' });
        return;
      }
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('voice_call_preferences')
        .upsert(
          {
            telegram_id: telegramId,
            phone_e164: prefs.phone_e164.trim() || null,
            enabled: prefs.enabled,
            mode: prefs.mode,
            morning: prefs.morning,
            afternoon: prefs.afternoon,
            night: prefs.night,
            nightly_confirm: prefs.nightly_confirm,
            consent_at: prefs.consent ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'telegram_id' }
        );
      if (error) throw error;
      setMsg({ type: 'ok', text: 'Call schedule saved. Calls activate once we launch voice in your area.' });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : String(err);
      console.error('[CallSchedule] save failed:', text, err);
      setMsg({ type: 'err', text: 'Could not save your call schedule. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const label = isElderly ? 'text-lg' : 'text-xs';
  const heading = isElderly ? 'text-2xl' : 'text-sm';
  const timeInput = `bg-white border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono font-bold ${
    isElderly ? 'h-12 px-3 text-lg' : 'h-9 px-2 text-sm'
  }`;

  const WindowRow = ({
    icon, title, k, soon = false,
  }: { icon: React.ReactNode; title: string; k: 'morning' | 'afternoon' | 'night' | 'nightly_confirm'; soon?: boolean }) => {
    const w = prefs[k];
    return (
      <div className={`flex items-center justify-between gap-2 bg-muted/30 border border-border/80 rounded-2xl px-4 py-3 ${soon ? 'opacity-60' : ''}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">{icon}</span>
          <span className={`font-bold text-foreground leading-tight ${label}`}>{title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {soon ? (
            // Additional call timers roll out later (kept to one call/day for now).
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black bg-muted text-muted-foreground border border-border/80 uppercase tracking-wide">
              Soon
            </span>
          ) : (
            <>
              {w.enabled && (
                <input
                  type="time"
                  value={w.time}
                  onChange={(e) => setWindow(k, { time: e.target.value })}
                  className={timeInput}
                  aria-label={`${title} time`}
                />
              )}
              <button
                type="button"
                onClick={() => setWindow(k, { enabled: !w.enabled })}
                aria-pressed={w.enabled}
                className={`relative w-11 h-6 rounded-full transition-all cursor-pointer shrink-0 ${w.enabled ? 'bg-primary' : 'bg-border'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${w.enabled ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  // Care+ gate: free users see the compact upgrade card at the point of value.
  if (access === false) {
    return (
      <CarePlusCard
        telegramId={telegramId}
        isElderly={isElderly}
        compact
        onActivated={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="bg-card border border-border rounded-3xl p-6 shadow-sm space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className={`font-black text-foreground flex items-center gap-1.5 ${heading}`}>
            <PhoneCall className="w-5 h-5 text-primary" />
            Call Schedule
          </h3>
          <p className={`text-muted-foreground ${label}`}>
            Get medication reminders by phone call — ideal for those who don&apos;t use the app daily.
          </p>
        </div>
        <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-success/15 text-success border border-success/30">
          Care+
        </span>
      </div>

      {(loading || access === null) ? (
        <div className="h-24 rounded-2xl bg-muted/30 animate-pulse" />
      ) : (
        <>
          {/* Master enable */}
          <div className="flex items-center justify-between gap-3 bg-muted/30 border border-border/80 rounded-2xl px-4 py-3">
            <div className="min-w-0">
              <span className={`font-extrabold text-foreground block ${label}`}>Enable call reminders</span>
              <span className="text-muted-foreground block text-[11px] font-semibold">Turn on to set up reminder calls for this account.</span>
            </div>
            <button
              type="button"
              onClick={() => setPrefs((p) => ({ ...p, enabled: !p.enabled }))}
              aria-pressed={prefs.enabled}
              className={`relative w-11 h-6 rounded-full transition-all cursor-pointer shrink-0 ${prefs.enabled ? 'bg-primary' : 'bg-border'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${prefs.enabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          {prefs.enabled && (
            <div className="space-y-5 animate-fade-in">
              {/* Phone + verification */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={`block font-bold text-foreground ${label}`}>Phone number to call</label>
                  {verified && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-success/15 text-success border border-success/30">
                      <ShieldCheck className="w-3 h-3" /> Verified
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    inputMode="tel"
                    placeholder="+9198XXXXXXXX"
                    value={prefs.phone_e164}
                    onChange={(e) => {
                      setPrefs((p) => ({ ...p, phone_e164: e.target.value }));
                      setVerified(false);
                      setOtpStage('idle');
                      setOtpMsg(null);
                    }}
                    className={`flex-1 min-w-0 bg-white border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono ${
                      isElderly ? 'h-14 px-4 text-lg' : 'h-10 px-3 text-sm'
                    }`}
                  />
                  {!verified && (
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={otpBusy}
                      className={`shrink-0 font-bold rounded-xl border border-primary text-primary hover:bg-primary/5 transition-all cursor-pointer disabled:opacity-50 ${
                        isElderly ? 'h-14 px-5 text-base' : 'h-10 px-4 text-xs'
                      }`}
                    >
                      {otpBusy && otpStage === 'idle' ? 'Sending…' : otpStage === 'sent' ? 'Resend' : 'Verify'}
                    </button>
                  )}
                </div>

                {!verified && otpStage === 'sent' && (
                  <div className="flex gap-2 mt-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6-digit code"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className={`flex-1 min-w-0 bg-white border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono tracking-widest text-center ${
                        isElderly ? 'h-14 px-4 text-lg' : 'h-10 px-3 text-sm'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleCheckCode}
                      disabled={otpBusy || code.length !== 6}
                      className={`shrink-0 font-bold rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover transition-all cursor-pointer disabled:opacity-50 ${
                        isElderly ? 'h-14 px-5 text-base' : 'h-10 px-4 text-xs'
                      }`}
                    >
                      {otpBusy ? 'Checking…' : 'Confirm'}
                    </button>
                  </div>
                )}

                {otpMsg && (
                  <p className={`text-[11px] font-bold mt-1.5 ${otpMsg.type === 'ok' ? 'text-success' : 'text-danger'}`}>
                    {otpMsg.text}
                  </p>
                )}

                <p className="text-[11px] text-muted-foreground mt-1.5 font-semibold">
                  Use international format with country code (India: <span className="font-mono">+91…</span>). We&apos;ll text a code to confirm it&apos;s yours.
                </p>
              </div>

              {SHOW_REMINDER_WINDOWS && (<>
              {/* Mode */}
              <div>
                <span className={`block font-bold text-foreground mb-2 ${label}`}>How should we call?</span>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { id: 'grouped', t: 'By time of day', d: 'One call per window', soon: false },
                    { id: 'per_medication', t: 'Per medication', d: 'A call for each medicine', soon: true },
                  ] as const).map((opt) => {
                    const sel = prefs.mode === opt.id && !opt.soon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={opt.soon}
                        aria-disabled={opt.soon}
                        title={opt.soon ? 'Coming soon' : undefined}
                        onClick={() => { if (!opt.soon) setPrefs((p) => ({ ...p, mode: opt.id })); }}
                        className={`relative text-left rounded-2xl border p-3 transition-all ${
                          opt.soon
                            ? 'bg-muted/20 border-border/60 opacity-60 cursor-not-allowed'
                            : sel
                              ? 'bg-primary/8 border-primary/40 ring-2 ring-primary/20 cursor-pointer'
                              : 'bg-muted/30 border-border/80 hover:bg-muted/50 cursor-pointer'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 flex-wrap">
                          <span className={`font-bold ${sel ? 'text-primary' : 'text-foreground'} ${isElderly ? 'text-lg' : 'text-sm'}`}>{opt.t}</span>
                          {opt.soon && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-black bg-muted text-muted-foreground border border-border/80 uppercase tracking-wide">
                              Soon
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px] text-muted-foreground font-semibold mt-0.5">{opt.d}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Windows */}
              {prefs.mode === 'grouped' ? (
                <div className="space-y-2">
                  <span className={`block font-bold text-foreground ${label}`}>Reminder call windows</span>
                  <WindowRow icon={<Sun className="w-4 h-4" />} title="Morning" k="morning" />
                  <WindowRow icon={<CloudSun className="w-4 h-4" />} title="Afternoon" k="afternoon" soon />
                  <WindowRow icon={<Moon className="w-4 h-4" />} title="Night" k="night" soon />
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground font-semibold bg-muted/30 border border-border/80 rounded-2xl p-3">
                  We&apos;ll call at each medicine&apos;s scheduled time. (Per-medication calling rolls out after the grouped mode.)
                </p>
              )}
              </>)}

              {/* Nightly confirmation */}
              <div className="space-y-2">
                <span className={`block font-bold text-foreground ${label}`}>End-of-day check-in</span>
                <WindowRow icon={<MoonStar className="w-4 h-4" />} title="Nightly call" k="nightly_confirm" />
              </div>

              {/* Consent */}
              <label className="flex items-start gap-2.5 bg-primary/5 border border-primary/20 rounded-2xl p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.consent}
                  onChange={(e) => setPrefs((p) => ({ ...p, consent: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-[var(--primary)] shrink-0"
                />
                <span className="text-[12px] text-muted-foreground font-semibold leading-relaxed">
                  <ShieldCheck className="inline w-3.5 h-3.5 text-primary mr-1 -mt-0.5" />
                  I consent to receive automated medication reminder calls at this number. I can turn them off anytime.
                </span>
              </label>
            </div>
          )}

          {msg && (
            <div
              className={`flex items-start gap-2 p-3 rounded-2xl text-[12px] font-bold ${
                msg.type === 'ok' ? 'bg-success/10 border border-success/30 text-success' : 'bg-danger/10 border border-danger/30 text-danger'
              }`}
            >
              {msg.type === 'ok' ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : null}
              <span>{msg.text}</span>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className={`font-black rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover transition-all shadow-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 ${
              isElderly ? 'h-14 px-8 text-lg w-full' : 'h-10 px-6 text-xs'
            }`}
          >
            {saving ? 'Saving…' : 'Save call schedule'}
          </button>
        </>
      )}
    </div>
  );
}
