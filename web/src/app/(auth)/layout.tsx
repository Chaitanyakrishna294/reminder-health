import React from 'react';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-white border border-border/80 shadow-sm rounded-3xl p-8">
        <div className="flex flex-col items-center justify-center">
          <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary/20 mb-3">
            🛡️ Safe & Secure Care
          </span>
          <span className="text-3xl font-black tracking-tight text-primary flex items-center gap-1 font-mono">
            <span>💊 Re-</span>
            <img 
              src="/logo2.png" 
              alt="MIND" 
              className="rounded-lg object-contain shrink-0 bg-white" 
              style={{ width: '60px', height: '60px' }}
            />
            <span>-eЯ</span>
          </span>
          <p className="mt-2 text-sm text-muted-foreground text-center">
            Apple Health-Inspired Medication Companion
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
