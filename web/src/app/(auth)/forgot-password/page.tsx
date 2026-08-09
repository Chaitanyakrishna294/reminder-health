'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Mail, AlertTriangle, KeyRound, Send } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import { SpamCallout } from '@/components/auth/code-entry';

// Restyled 2026-08-09 to the redesigned (auth) system — the login page is the
// reference implementation. Reset logic unchanged.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const supabase = createClient();
  const { isElderly } = useUiMode();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/api/auth/callback?next=/update-password`,
    });

    setLoading(false);
    if (resetErr) {
      setError(resetErr.message);
    } else {
      setSuccess(true);
    }
  };

  const inputClass = `w-full pl-12 pr-4 rounded-2xl bg-white border border-border text-foreground shadow-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all ${isElderly ? 'py-5 text-lg' : 'py-4 text-[15px]'}`;
  const iconClass = 'absolute left-4 top-1/2 -translate-y-1/2 text-primary pointer-events-none w-[18px] h-[18px]';
  const labelClass = `block font-bold text-foreground mb-1.5 ${isElderly ? 'text-base' : 'text-xs'}`;

  if (success) {
    return (
      <div className="space-y-5 text-center">
        <div className={`inline-flex items-center justify-center bg-success/10 text-success rounded-full ${isElderly ? 'w-16 h-16' : 'w-12 h-12'}`}>
          <Mail className={isElderly ? 'w-8 h-8' : 'w-6 h-6'} aria-hidden />
        </div>
        <h1 className={`font-mono font-black tracking-tight text-foreground ${isElderly ? 'text-4xl' : 'text-[2rem]'}`}>
          Check your email
        </h1>
        <p className={`text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
          We sent a password reset link to <b className="text-foreground break-all">{email}</b>.
          Follow it to choose a new password.
        </p>
        <SpamCallout noun="link" />
        <div className="pt-2">
          <Link
            href="/login"
            className={`font-semibold text-primary-strong hover:underline ${isElderly ? 'text-lg' : 'text-sm'}`}
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className={`font-mono font-black tracking-tight text-foreground ${isElderly ? 'text-4xl' : 'text-[2rem]'}`}>
          Reset password{' '}
          <KeyRound className="inline-block w-7 h-7 text-primary align-[-0.1em]" aria-hidden />
        </h1>
        <p className={`mt-2 text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
          Enter your email and we&apos;ll send you a link to choose a new one.
        </p>
      </header>

      {error && (
        <div className="bg-danger/10 text-danger-strong text-sm p-3 rounded-2xl border border-danger/20 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleReset} className="space-y-4">
        <div>
          <label htmlFor="forgot-email" className={labelClass}>Email</label>
          <div className="relative">
            <Mail className={iconClass} aria-hidden />
            <input
              id="forgot-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@example.com"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={buttonClasses({ variant: 'primary', size: 'lg', isElderly, fullWidth: true })}
        >
          <Send className="w-4 h-4" aria-hidden />
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <div className={`text-center ${isElderly ? 'text-base' : 'text-sm'}`}>
        <Link href="/login" className="font-semibold text-primary-strong hover:underline">
          Back to Sign In
        </Link>
      </div>
    </div>
  );
}
