import React from 'react';
import { Pill, ShieldCheck } from 'lucide-react';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="w-full max-w-md space-y-6 sm:space-y-8 bg-white border border-border/80 shadow-md rounded-3xl p-6 sm:p-8">
        <div className="flex flex-col items-center justify-center text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary/20 mb-4">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> Safe &amp; Secure Care
          </span>
          <span className="flex items-center justify-center gap-1.5 sm:gap-2 font-black tracking-tight text-foreground font-mono text-2xl sm:text-3xl">
            <Pill className="w-6 h-6 sm:w-7 sm:h-7 text-primary shrink-0" />
            <span>Re-</span>
            <img
              src="/logo2.png"
              alt="MIND"
              className="rounded-lg object-contain shrink-0 bg-white w-12 h-12 sm:w-[60px] sm:h-[60px]"
            />
            <span>-eЯ</span>
          </span>
          <p className="mt-2 text-xs sm:text-sm text-muted-foreground">
            Apple Health-Inspired Medication Companion
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
