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
        <div className="relative flex flex-col items-center text-center mb-9">
          {/* Soft pink halo behind the mascot — reads well in both light & dark. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 w-56 h-56 rounded-full bg-primary/25 blur-3xl opacity-70"
          />
          <div className="relative w-36 h-36 rounded-full bg-white shadow-xl ring-4 ring-primary/15 flex items-center justify-center overflow-hidden">
            <BrainMascot mood="happy" size={108} />
          </div>
          <h1 className="relative mt-5 font-mono font-black text-3xl text-foreground tracking-tight">Re-MIND-eЯ</h1>
          <p className="relative mt-1.5 text-sm text-muted-foreground">Your personal medication companion</p>
        </div>
        {children}
      </div>
    </div>
  );
}
