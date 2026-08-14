'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Lock, AlertCircle, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';

// Restyled 2026-08-09 to the redesigned (auth) system — the login page is the
// reference implementation. Update logic unchanged.
export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const supabase = createClient();
  const { isElderly } = useUiMode();

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }

    const { error: updateErr } = await supabase.auth.updateUser({
      password: password,
    });

    setLoading(false);
    if (updateErr) {
      setError(updateErr.message);
    } else {
      setSuccess(true);
    }
  };

  const inputClass = `w-full pl-12 rounded-[14px] surface-sunk border border-input text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all ${isElderly ? 'py-5 text-lg' : 'py-4 text-[15px]'}`;
  const iconClass = 'absolute left-4 top-1/2 -translate-y-1/2 text-primary pointer-events-none w-[18px] h-[18px]';
  const labelClass = `block font-bold text-foreground mb-1.5 ${isElderly ? 'text-base' : 'text-xs'}`;
  const eyeClass =
    'absolute right-1.5 w-11 h-11 flex items-center justify-center rounded-xl text-muted-foreground hover:text-primary-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer';

  if (success) {
    return (
      <div className="space-y-5 text-center">
        <div className={`inline-flex items-center justify-center bg-success/10 text-success rounded-full ${isElderly ? 'w-16 h-16' : 'w-12 h-12'}`}>
          <CheckCircle className={isElderly ? 'w-8 h-8' : 'w-6 h-6'} aria-hidden />
        </div>
        <h1 className={`font-mono font-black tracking-tight text-foreground ${isElderly ? 'text-4xl' : 'text-[2rem]'}`}>
          Password updated
        </h1>
        <p className={`text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
          Your new password is saved. You can head straight to your dashboard.
        </p>
        <div className="pt-2">
          <Link
            href="/dashboard"
            className={buttonClasses({ variant: 'primary', size: 'lg', isElderly, fullWidth: true })}
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className={`font-mono font-black tracking-tight text-foreground ${isElderly ? 'text-4xl' : 'text-[2rem]'}`}>
          New password{' '}
          <Lock className="inline-block w-7 h-7 text-primary align-[-0.1em]" aria-hidden />
        </h1>
        <p className={`mt-2 text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
          Choose a secure new password for your Re-MIND-eЯ account.
        </p>
      </header>

      {error && (
        <div className="bg-danger/10 text-danger-strong text-sm p-3 rounded-2xl border border-danger/20 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleUpdatePassword} className="space-y-4">
        <div>
          <label htmlFor="new-password" className={labelClass}>New password</label>
          <div className="relative flex items-center">
            <Lock className={iconClass} aria-hidden />
            <input
              id="new-password"
              name="new-password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputClass} pr-14`}
              placeholder="At least 6 characters"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className={eyeClass}
            >
              {showPassword ? <EyeOff className="w-[18px] h-[18px]" aria-hidden /> : <Eye className="w-[18px] h-[18px]" aria-hidden />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="confirm-password" className={labelClass}>Confirm new password</label>
          <div className="relative flex items-center">
            <Lock className={iconClass} aria-hidden />
            <input
              id="confirm-password"
              name="confirm-password"
              type={showConfirmPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`${inputClass} pr-14`}
              placeholder="Type it again"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              className={eyeClass}
            >
              {showConfirmPassword ? <EyeOff className="w-[18px] h-[18px]" aria-hidden /> : <Eye className="w-[18px] h-[18px]" aria-hidden />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={buttonClasses({ variant: 'primary', size: 'lg', isElderly, fullWidth: true })}
        >
          <Lock className="w-4 h-4" aria-hidden />
          {loading ? 'Updating…' : 'Update password'}
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
