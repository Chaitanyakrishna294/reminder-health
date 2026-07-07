import React from 'react';
import BrainMascot from '@/components/dashboard/brain-mascot';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6 py-10"
      style={{ background: 'var(--auth-radial)' }}
    >
      <div className="w-full max-w-sm">
        {/* Brand hero */}
        <div className="relative flex flex-col items-center text-center mb-7">
          {/* Soft pink halo behind the mascot, reads well in both light & dark. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-60 h-60 rounded-full bg-primary/25 blur-3xl opacity-70"
          />
          <div className="relative w-32 h-32 rounded-[38px] bg-white shadow-xl ring-1 ring-primary/15 flex items-center justify-center overflow-hidden">
            {/* soft top-lit sheen for a premium, molded surface */}
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/70 to-transparent" />
            <BrainMascot mood="happy" size={100} />
          </div>
          <h1 className="relative mt-5 font-mono font-black text-3xl text-foreground tracking-tight">Re-MIND-eЯ</h1>
          <p className="relative mt-1.5 text-sm text-muted-foreground">Your personal medication companion</p>
        </div>

        {/* Frosted card frames the form so it reads as a composed surface, not
            loose fields floating on the page. Theme-aware + blur fallback. */}
        <div className="rounded-[28px] bg-white/80 dark:bg-card/70 backdrop-blur-xl border border-border/70 shadow-lg p-6 sm:p-7 supports-[backdrop-filter]:bg-white/70">
          {children}
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground/80">
          Encrypted in transit and at rest
        </p>
      </div>
    </div>
  );
}
