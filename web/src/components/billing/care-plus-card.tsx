'use client';

// Care+ pricing card — SKIN B ("luxe pricing"): dark navy panel, pink seal +
// wordmark, pink-highlighted Care+ column, and a pink "Start 7-day free trial" CTA.
// Free-vs-Care+ comparison + trial start; also renders a status banner once active.
// See docs/VOICE_CALLS_DESIGN.md.
import React, { useState } from 'react';
import { Check, X, Crown, Sparkles } from 'lucide-react';
import { usePlanStatus } from '@/lib/billing/use-plan-status';
import {
  luxePanel, luxePanelShadow, accentSurface, accentText, accentHairline, ACCENT, luxeInk, luxeMuted, sheenStyle,
} from '@/lib/billing/luxe';

export interface Feature { label: string; free: React.ReactNode; plus: React.ReactNode }
export const FEATURES: Feature[] = [
  { label: 'Medication reminders (app & Telegram)', free: true, plus: true },
  { label: 'Reminder phone calls', free: false, plus: true },
  { label: 'Caregiver "missed dose" alert call', free: false, plus: true },
  { label: 'Health Vault storage', free: '250 MB', plus: 'Unlimited' },
  { label: 'Caregivers linked', free: '1', plus: 'Multiple' },
];

function Cell({ value, accent }: { value: React.ReactNode; accent?: boolean }) {
  if (value === true)
    return <Check className="w-4 h-4 mx-auto" strokeWidth={2.5} style={{ color: accent ? ACCENT : luxeMuted }} />;
  if (value === false) return <X className="w-4 h-4 mx-auto" strokeWidth={2.5} style={{ color: 'rgba(166,182,221,0.4)' }} />;
  return <span className="text-[11px] font-black" style={{ color: accent ? ACCENT : luxeInk }}>{value}</span>;
}

export default function CarePlusCard({
  telegramId,
  isElderly,
  compact = false,
  onActivated,
}: {
  telegramId: string;
  isElderly?: boolean;
  compact?: boolean;
  onActivated?: () => void;
}) {
  const { status, daysLeft, setStatus, setDaysLeft } = usePlanStatus(telegramId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startTrial = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch('/api/billing/start-trial', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not start the trial.');
      setStatus('trialing');
      setDaysLeft(7);
      onActivated?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the trial.');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading') {
    return <div className="rounded-3xl h-40 animate-pulse" style={{ ...luxePanel, border: accentHairline }} />;
  }

  // Active / trialing → luxe status banner.
  if (status === 'active' || status === 'trialing') {
    return (
      <div
        className="relative overflow-hidden rounded-3xl p-5 flex items-center gap-3.5"
        style={{ ...luxePanel, border: accentHairline, boxShadow: luxePanelShadow }}
      >
        <span aria-hidden style={sheenStyle} />
        <span
          className="relative z-10 w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: accentSurface, boxShadow: '0 4px 16px rgba(242,107,138,0.40)' }}
        >
          <Crown className="w-6 h-6" style={{ color: '#ffffff' }} strokeWidth={2.25} />
        </span>
        <div className="relative z-10">
          <h3 className={`font-black ${isElderly ? 'text-xl' : 'text-sm'}`} style={accentText}>
            Care+ {status === 'trialing' ? 'trial active' : 'active'}
          </h3>
          <p className="text-[11px] font-semibold" style={{ color: luxeMuted }}>
            {status === 'trialing'
              ? `${daysLeft ?? 7} day${(daysLeft ?? 7) === 1 ? '' : 's'} left in your free trial. Phone-call reminders unlocked.`
              : 'Phone-call reminders are unlocked.'}
          </p>
        </div>
      </div>
    );
  }

  // Free → luxe comparison + trial CTA.
  return (
    <div
      className="relative overflow-hidden rounded-3xl p-6 space-y-5"
      style={{ ...luxePanel, border: accentHairline, boxShadow: luxePanelShadow }}
    >
      <span aria-hidden style={sheenStyle} />

      <div className="relative z-10 flex items-center gap-3">
        <span
          className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: accentSurface, boxShadow: '0 4px 16px rgba(242,107,138,0.40)' }}
        >
          <Crown className="w-6 h-6" style={{ color: '#ffffff' }} strokeWidth={2.25} />
        </span>
        <div>
          <h3 className={`font-black flex items-center gap-2 ${isElderly ? 'text-2xl' : 'text-base'}`} style={accentText}>
            Care+
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black tracking-wide"
              style={{ border: accentHairline, color: ACCENT }}
            >
              <Sparkles className="w-3 h-3" /> 7-DAY FREE TRIAL
            </span>
          </h3>
          <p className="text-[11px] font-semibold" style={{ color: luxeMuted }}>
            Reminder phone calls + caregiver miss-alerts, and more.
          </p>
        </div>
      </div>

      {!compact && (
        <div className="relative z-10 rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(242,107,138,0.18)' }}>
          <div className="grid grid-cols-[1fr_auto_auto] text-[11px]">
            <div className="px-3 py-2 font-bold" style={{ color: luxeMuted, background: 'rgba(255,255,255,0.02)' }}>What you get</div>
            <div className="px-3 py-2 font-bold text-center w-16" style={{ color: luxeMuted, background: 'rgba(255,255,255,0.02)' }}>Free</div>
            <div className="px-3 py-2 font-black text-center w-20" style={{ color: ACCENT, background: 'rgba(242,107,138,0.10)' }}>Care+</div>
            {FEATURES.map((f, i) => (
              <React.Fragment key={i}>
                <div className="px-3 py-2.5 font-semibold" style={{ color: luxeInk, borderTop: '1px solid rgba(242,107,138,0.12)' }}>{f.label}</div>
                <div className="px-3 py-2.5 text-center" style={{ borderTop: '1px solid rgba(242,107,138,0.12)' }}><Cell value={f.free} /></div>
                <div className="px-3 py-2.5 text-center" style={{ borderTop: '1px solid rgba(242,107,138,0.12)', background: 'rgba(242,107,138,0.06)' }}><Cell value={f.plus} accent /></div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {err && <p className="relative z-10 text-[11px] font-bold text-danger">{err}</p>}

      <button
        onClick={startTrial}
        disabled={busy}
        className={`relative z-10 w-full font-black rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 text-white ${
          isElderly ? 'h-14 text-lg' : 'h-11 text-sm'
        }`}
        style={{ background: accentSurface, boxShadow: '0 8px 24px rgba(242,107,138,0.35)' }}
      >
        <Crown className="w-4 h-4" strokeWidth={2.5} />
        {busy ? 'Starting…' : 'Start 7-day free trial'}
      </button>
      <p className="relative z-10 text-[10px] text-center font-semibold" style={{ color: luxeMuted }}>
        No card needed · cancel anytime
      </p>
    </div>
  );
}
