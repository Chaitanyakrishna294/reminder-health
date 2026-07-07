'use client';

// Care+ member hub (/care-plus). One dark "membership card" hero (the signature
// element) carrying the member's name, status, and a 7-day trial meter; below it,
// the unlocked-feature ledger and shortcuts sit on light app-standard cards so the
// card stays the jewel. Free users who land here get the luxe upgrade card instead.
import Link from 'next/link';
import { useRef } from 'react';
import { ArrowLeft, Crown, Check, PhoneCall, Settings, ChevronRight } from 'lucide-react';
import { usePlanStatus } from '@/lib/billing/use-plan-status';
import CarePlusCard, { FEATURES } from '@/components/billing/care-plus-card';
import {
  luxePanel, luxePanelShadow, accentSurface, accentText, accentHairline, luxeInk, luxeMuted, sheenStyle,
} from '@/lib/billing/luxe';

const TRIAL_DAYS = 7;

export default function CarePlusHub({ telegramId, memberName }: { telegramId: string; memberName?: string | null }) {
  const { status, daysLeft } = usePlanStatus(telegramId);
  const cardRef = useRef<HTMLDivElement>(null);

  // Subtle 3D tilt following the mouse. Writes transform directly to the node
  // (no React state per pointer event); mouse-only, honors reduced motion. The
  // always-on CSS transition dampens tracking into a weighty, physical feel.
  const handleTilt = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el || e.pointerType !== 'mouse') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 6).toFixed(2)}deg)`;
  };
  const resetTilt = () => {
    if (cardRef.current) cardRef.current.style.transform = '';
  };

  if (status === 'loading') {
    return <div className="max-w-2xl mx-auto rounded-3xl h-80 animate-pulse" style={{ ...luxePanel, border: accentHairline }} />;
  }

  const isMember = status === 'active' || status === 'trialing';
  const days = daysLeft ?? TRIAL_DAYS;

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

      {/* Membership card hero: the page's single dark, premium object. Body is
          neutral (no colored outline) so it reads as machined material; all pink
          lives in the details, like inlay on a metal card. */}
      <div
        ref={cardRef}
        onPointerMove={handleTilt}
        onPointerLeave={resetTilt}
        className="relative overflow-hidden rounded-3xl p-7 transition-transform duration-200 ease-out will-change-transform"
        style={{ ...luxePanel, border: '1px solid rgba(255,255,255,0.10)', boxShadow: luxePanelShadow }}
      >
        <span aria-hidden style={sheenStyle} />
        {/* machine-turned finish: hairline diagonal engraving, barely-there */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: 'repeating-linear-gradient(115deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 7px)' }}
        />
        {/* warm rose key light (top-right) + faint cool counter-light (bottom-left)
            so the card reads as a lit object, not a flat tile */}
        <span aria-hidden className="pointer-events-none absolute -top-20 -right-16 w-56 h-56 rounded-full" style={{ background: 'radial-gradient(circle, rgba(242,107,138,0.12), transparent 68%)' }} />
        <span aria-hidden className="pointer-events-none absolute -bottom-20 -left-14 w-64 h-64 rounded-full" style={{ background: 'radial-gradient(circle, rgba(91,141,239,0.10), transparent 70%)' }} />

        <div className="relative z-10 flex items-start justify-between gap-3">
          {/* embossed seal: top bevel highlight + lower inset, restrained glow */}
          <span
            className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{
              background: accentSurface,
              border: '1px solid rgba(255,255,255,0.28)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -6px 10px rgba(180,42,78,0.35), 0 6px 16px rgba(242,107,138,0.28)',
            }}
          >
            <Crown className="w-6 h-6" style={{ color: '#ffffff' }} strokeWidth={2.25} />
          </span>
          <span
            className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase"
            style={{ border: accentHairline, background: 'rgba(242,107,138,0.08)', ...accentText }}
          >
            {status === 'trialing' ? 'Trial' : 'Active'}
          </span>
        </div>

        <div className="relative z-10 mt-5">
          <p className="text-[10px] font-black tracking-[0.3em] uppercase" style={{ color: luxeMuted }}>Care+ Membership</p>
          {/* the member's name, set like an embossed card name: caps, tracked */}
          <h1 className="text-2xl font-black uppercase tracking-[0.08em] mt-1.5 truncate" style={{ color: luxeInk }}>
            {memberName || 'Care+ Member'}
          </h1>
          <p className="text-sm font-semibold mt-1.5" style={{ color: luxeMuted }}>
            {status === 'trialing'
              ? `${days} day${days === 1 ? '' : 's'} left in your free trial.`
              : 'Your premium features are live. Thank you for the support.'}
          </p>
          {status === 'trialing' && (
            /* fine 7-segment trial meter: filled = days remaining (text above carries the value) */
            <div aria-hidden className="mt-3 flex gap-1 max-w-[172px]">
              {Array.from({ length: TRIAL_DAYS }, (_, i) => (
                <span
                  key={i}
                  className="h-1 flex-1 rounded-full"
                  style={{ background: i < days ? accentSurface : 'rgba(255,255,255,0.10)' }}
                />
              ))}
            </div>
          )}
        </div>

        {/* perforated hairline, like the tear-line on a physical membership card */}
        <div
          aria-hidden
          className="relative z-10 mt-6 h-px"
          style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(242,107,138,0.38) 0 6px, transparent 6px 14px)' }}
        />
        <div className="relative z-10 mt-4 flex items-center justify-between">
          <div>
            <p className="text-[9px] font-black tracking-[0.25em] uppercase" style={{ color: 'rgba(166,182,221,0.6)' }}>Member No.</p>
            <p className="text-sm font-black font-mono tracking-wider" style={{ color: luxeInk }}>{memberNo}</p>
          </div>
          <p className="text-[11px] font-black tracking-widest uppercase" style={accentText}>Re-MIND-eЯ</p>
        </div>
      </div>

      {/* Unlocked ledger: light app-standard surface so the hero stays the jewel */}
      <div className="rounded-3xl p-6 bg-card border border-border shadow-sm">
        <h2 className="text-[10px] font-black tracking-[0.25em] uppercase mb-4 text-muted-foreground">What&apos;s unlocked</h2>
        <ul className="space-y-3">
          {unlocked.map((f, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 bg-primary/10 border border-primary/20">
                <Check className="w-4 h-4 text-primary" strokeWidth={2.75} />
              </span>
              <span className="text-sm font-semibold flex-1 text-foreground">{f.label}</span>
              {typeof f.plus !== 'boolean' && (
                <span className="text-[11px] font-black text-primary">{f.plus}</span>
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
            className="group rounded-3xl p-5 flex items-center gap-3 bg-card border border-border shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
          >
            <span className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-primary/10 border border-primary/15 text-primary">
              {s.icon}
            </span>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-black text-foreground">{s.t}</h3>
              <p className="text-[11px] font-semibold text-muted-foreground">{s.d}</p>
            </div>
            <ChevronRight className="w-5 h-5 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </div>
  );
}
