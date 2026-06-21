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
      style={{ background: 'radial-gradient(120% 80% at 50% 0%, #FDEEF2 0%, #F8F9FB 62%, #EAF3FF 100%)' }}
    >
      <div className="w-full max-w-sm">
        {/* Brand hero */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-24 h-24 rounded-full bg-white shadow-lg ring-4 ring-primary/10 flex items-center justify-center overflow-hidden">
            <BrainMascot mood="happy" size={76} />
          </div>
          <h1 className="mt-4 font-mono font-black text-2xl text-foreground tracking-tight">Re-MIND-eЯ</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your personal medication companion</p>
        </div>
        {children}
      </div>
    </div>
  );
}
