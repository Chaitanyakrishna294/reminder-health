'use client';

// Care+ upgrade card — Free vs Care+ comparison + "Start 7-day free trial" (no price,
// no card needed). Shows trial/active status once started. See docs/VOICE_CALLS_DESIGN.md.
import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Check, X, Sparkles, PhoneCall } from 'lucide-react';

type Status = 'loading' | 'free' | 'trialing' | 'active';

interface Feature { label: string; free: React.ReactNode; plus: React.ReactNode }
const FEATURES: Feature[] = [
  { label: 'Medication reminders (app & Telegram)', free: true, plus: true },
  { label: 'Reminder phone calls', free: false, plus: true },
  { label: 'Caregiver "missed dose" alert call', free: false, plus: true },
  { label: 'Health Vault storage', free: '250 MB', plus: 'Unlimited' },
  { label: 'Caregivers linked', free: '1', plus: 'Multiple' },
];

function Cell({ value }: { value: React.ReactNode }) {
  if (value === true) return <Check className="w-4 h-4 text-success mx-auto" strokeWidth={2.5} />;
  if (value === false) return <X className="w-4 h-4 text-muted-foreground/40 mx-auto" strokeWidth={2.5} />;
  return <span className="text-[11px] font-bold text-foreground">{value}</span>;
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
  const supabase = createClient();
  const [status, setStatus] = useState<Status>('loading');
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('subscriptions')
          .select('status, current_period_end')
          .eq('telegram_id', telegramId)
          .maybeSingle();
        if (cancelled) return;
        if (!data) { setStatus('free'); return; }
        const future = data.current_period_end ? new Date(data.current_period_end) > new Date() : true;
        if (data.status === 'active') setStatus('active');
        else if (data.status === 'trialing' && future) {
          setStatus('trialing');
          if (data.current_period_end) {
            setDaysLeft(Math.max(0, Math.ceil((new Date(data.current_period_end).getTime() - Date.now()) / 86400000)));
          }
        } else setStatus('free');
      } catch {
        if (!cancelled) setStatus('free');
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, telegramId]);

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
    return <div className="bg-card border border-border rounded-3xl h-28 animate-pulse" />;
  }

  // Active / trialing → compact status banner
  if (status === 'active' || status === 'trialing') {
    return (
      <div className="bg-card border border-success/30 rounded-3xl p-5 shadow-sm flex items-center gap-3">
        <span className="w-10 h-10 rounded-2xl bg-success/15 text-success flex items-center justify-center shrink-0">
          <Check className="w-5 h-5" strokeWidth={2.5} />
        </span>
        <div>
          <h3 className={`font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}>
            Care+ {status === 'trialing' ? 'trial active' : 'active'}
          </h3>
          <p className="text-[11px] text-muted-foreground font-semibold">
            {status === 'trialing'
              ? `${daysLeft ?? 7} day${(daysLeft ?? 7) === 1 ? '' : 's'} left in your free trial. Phone-call reminders are unlocked.`
              : 'Phone-call reminders are unlocked.'}
          </p>
        </div>
      </div>
    );
  }

  // Free → comparison + trial CTA
  return (
    <div className="bg-card border border-primary/30 rounded-3xl p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <span className="w-9 h-9 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <PhoneCall className="w-5 h-5" />
        </span>
        <div>
          <h3 className={`font-black text-foreground flex items-center gap-1.5 ${isElderly ? 'text-2xl' : 'text-sm'}`}>
            Care+
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-primary/10 text-primary border border-primary/20">
              <Sparkles className="w-3 h-3" /> 7-day free trial
            </span>
          </h3>
          <p className="text-[11px] text-muted-foreground font-semibold">
            Add reminder phone calls + caregiver miss-alerts.
          </p>
        </div>
      </div>

      {/* Comparison (hidden in compact mode to avoid repeating the full table) */}
      {!compact && (
        <div className="rounded-2xl border border-border overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto] text-[11px]">
            <div className="px-3 py-2 bg-muted/40 font-bold text-muted-foreground">What you get</div>
            <div className="px-3 py-2 bg-muted/40 font-bold text-muted-foreground text-center w-16">Free</div>
            <div className="px-3 py-2 bg-primary/10 font-black text-primary text-center w-20">Care+</div>
            {FEATURES.map((f, i) => (
              <React.Fragment key={i}>
                <div className={`px-3 py-2.5 text-foreground font-semibold ${i % 2 ? 'bg-muted/10' : ''}`}>{f.label}</div>
                <div className={`px-3 py-2.5 text-center ${i % 2 ? 'bg-muted/10' : ''}`}><Cell value={f.free} /></div>
                <div className={`px-3 py-2.5 text-center bg-primary/[0.04] ${i % 2 ? 'bg-primary/[0.07]' : ''}`}><Cell value={f.plus} /></div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {err && <p className="text-[11px] font-bold text-danger">{err}</p>}

      <button
        onClick={startTrial}
        disabled={busy}
        className={`w-full font-black rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover transition-all shadow-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 ${
          isElderly ? 'h-14 text-lg' : 'h-11 text-sm'
        }`}
        style={{ boxShadow: '0 4px 12px rgba(242, 107, 138, 0.35)' }}
      >
        {busy ? 'Starting…' : 'Start 7-day free trial'}
      </button>
      <p className="text-[10px] text-center text-muted-foreground font-semibold">
        No card needed · cancel anytime
      </p>
    </div>
  );
}
