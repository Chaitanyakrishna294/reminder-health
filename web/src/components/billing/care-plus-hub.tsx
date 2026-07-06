'use client';

// Care+ member hub (/care-plus) — SKIN C ("membership"): a navy-pink membership
// card hero, the unlocked-feature ledger, and pink-sealed shortcut cards. Free users
// who land here directly get the luxe upgrade card instead.
import Link from 'next/link';
import { ArrowLeft, Crown, Check, PhoneCall, Settings, ChevronRight } from 'lucide-react';
import { usePlanStatus } from '@/lib/billing/use-plan-status';
import CarePlusCard, { FEATURES } from '@/components/billing/care-plus-card';
import {
  luxePanel, luxePanelSoft, luxePanelShadow, accentSurface, accentText, accentHairline, ACCENT, luxeInk, luxeMuted, sheenStyle,
} from '@/lib/billing/luxe';

export default function CarePlusHub({ telegramId }: { telegramId: string }) {
  const { status, daysLeft } = usePlanStatus(telegramId);

  if (status === 'loading') {
    return <div className="max-w-2xl mx-auto rounded-3xl h-80 animate-pulse" style={{ ...luxePanel, border: accentHairline }} />;
  }

  const isMember = status === 'active' || status === 'trialing';
  const days = daysLeft ?? 7;

  if (!isMember) {
    return (
      <div className="max-w-md mx-auto space-y-5">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>
        <CarePlusCard telegramId={telegramId} />
      </div>
    );
  }

  const unlocked = FEATURES.filter((f) => f.free !== f.plus);
  const memberNo = `#${telegramId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to dashboard
      </Link>

      {/* Membership card hero */}
      <div
        className="relative overflow-hidden rounded-3xl p-7"
        style={{ ...luxePanel, border: accentHairline, boxShadow: luxePanelShadow }}
      >
        <span aria-hidden style={sheenStyle} />
        {/* faint pink vignette */}
        <span aria-hidden className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full" style={{ background: 'radial-gradient(circle, rgba(242,107,138,0.20), transparent 70%)' }} />

        <div className="relative z-10 flex items-start justify-between gap-3">
          <span className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: accentSurface, boxShadow: '0 4px 16px rgba(242,107,138,0.45)' }}>
            <Crown className="w-7 h-7" style={{ color: '#ffffff' }} strokeWidth={2.25} />
          </span>
          <span
            className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase"
            style={{ border: accentHairline, color: ACCENT }}
          >
            {status === 'trialing' ? 'Trial' : 'Active'}
          </span>
        </div>

        <div className="relative z-10 mt-5">
          <p className="text-[10px] font-black tracking-[0.3em] uppercase" style={{ color: luxeMuted }}>Care+ Membership</p>
          <h1 className="text-3xl font-black tracking-tight mt-1" style={accentText}>Care+ Member</h1>
          <p className="text-sm font-semibold mt-1.5" style={{ color: luxeMuted }}>
            {status === 'trialing'
              ? `${days} day${days === 1 ? '' : 's'} left in your free trial.`
              : 'Your premium features are live. Thank you for the support.'}
          </p>
        </div>

        <div className="relative z-10 mt-6 flex items-center justify-between">
          <div>
            <p className="text-[9px] font-black tracking-[0.25em] uppercase" style={{ color: 'rgba(166,182,221,0.6)' }}>Member No.</p>
            <p className="text-sm font-black font-mono tracking-wider" style={{ color: luxeInk }}>{memberNo}</p>
          </div>
          <p className="text-[11px] font-black tracking-widest uppercase" style={accentText}>Re-MIND-eЯ</p>
        </div>
      </div>

      {/* Unlocked ledger */}
      <div className="relative overflow-hidden rounded-3xl p-6" style={{ ...luxePanelSoft, border: accentHairline }}>
        <h2 className="text-[10px] font-black tracking-[0.25em] uppercase mb-4" style={{ color: luxeMuted }}>What&apos;s unlocked</h2>
        <ul className="space-y-3">
          {unlocked.map((f, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(242,107,138,0.14)', border: '1px solid rgba(242,107,138,0.26)' }}>
                <Check className="w-4 h-4" style={{ color: ACCENT }} strokeWidth={2.75} />
              </span>
              <span className="text-sm font-semibold flex-1" style={{ color: luxeInk }}>{f.label}</span>
              {typeof f.plus !== 'boolean' && (
                <span className="text-[11px] font-black" style={{ color: ACCENT }}>{f.plus}</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Shortcuts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { href: '/care-plus/voice', icon: <PhoneCall className="w-5 h-5" />, t: 'Voice-call reminders', d: 'Call windows & phone' },
          { href: '/settings', icon: <Settings className="w-5 h-5" />, t: 'Manage subscription', d: 'Plan & billing' },
        ].map((s, i) => (
          <Link
            key={i}
            href={s.href}
            className="group relative overflow-hidden rounded-3xl p-5 flex items-center gap-3 transition-transform hover:scale-[1.01]"
            style={{ ...luxePanelSoft, border: accentHairline }}
          >
            <span className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(242,107,138,0.14)', border: '1px solid rgba(242,107,138,0.26)', color: ACCENT }}>
              {s.icon}
            </span>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-black" style={{ color: luxeInk }}>{s.t}</h3>
              <p className="text-[11px] font-semibold" style={{ color: luxeMuted }}>{s.d}</p>
            </div>
            <ChevronRight className="w-5 h-5 shrink-0" style={{ color: ACCENT }} />
          </Link>
        ))}
      </div>
    </div>
  );
}
