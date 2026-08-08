'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Eye, EyeOff, User, Mail, Lock, AlertTriangle, KeyRound, MailWarning } from 'lucide-react';
import Turnstile, { captchaEnabled } from '@/components/turnstile';

export default function RegisterPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [code, setCode] = useState('');

  const router = useRouter();
  const supabase = createClient();
  const { isElderly } = useUiMode();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      setError('Please confirm you are 18+ and accept the Terms and Privacy Policy.');
      return;
    }
    if (captchaEnabled && !captchaToken) {
      setError('Please complete the verification challenge.');
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: signupErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // No emailRedirectTo → Supabase sends the {{ .Token }} confirmation CODE instead of a
        // link (requires the "Confirm signup" email template to include {{ .Token }}). A typed
        // code avoids the link/PKCE/in-app-browser problem, same as the login flow.
        data: {
          full_name: fullName,
        },
        captchaToken: captchaToken ?? undefined,
      },
    });

    if (signupErr) {
      setError(signupErr.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    // If confirmation is required, show the code entry. If not, the account is already active.
    // New users go straight to the dashboard (Telegram linking is optional, done later from
    // Settings) — no forced Connect-Telegram step.
    if (data.session) {
      router.refresh();
      router.push('/dashboard');
    } else {
      setSuccess(true);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = code.trim();
    if (token.length < 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setLoading(true);
    setError(null);

    // type 'signup' confirms the account created by signUp; on success the session is stored
    // client-side and the proxy sees the user on the next navigation.
    const { error: verifyErr } = await supabase.auth.verifyOtp({ email, token, type: 'signup' });

    if (verifyErr) {
      const m = (verifyErr.message || '').toLowerCase();
      setError(
        m.includes('expired') || m.includes('invalid')
          ? 'That code is invalid or expired. Tap "Resend code" for a fresh one.'
          : verifyErr.message
      );
      setLoading(false);
    } else {
      router.refresh();
      router.push('/dashboard');
    }
  };

  const handleResendCode = async () => {
    setLoading(true);
    setError(null);
    const { error: resendErr } = await supabase.auth.resend({ type: 'signup', email });
    setLoading(false);
    if (resendErr) setError(resendErr.message);
  };

  const inputClass = `w-full pl-11 pr-4 rounded-2xl bg-white border border-border text-foreground shadow-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all ${isElderly ? 'py-4 text-lg' : 'py-3.5 text-sm'}`;
  const iconClass = 'absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none w-4 h-4';

  if (success) {
    return (
      <div className={`space-y-5 ${isElderly ? 'max-w-2xl' : ''}`}>
        {error && (
          <div className="bg-danger/10 text-danger text-sm p-3 rounded-2xl border border-danger/20 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-success/10 text-success rounded-full">
            <Mail className="w-6 h-6" />
          </div>
          <h2 className={`font-bold text-foreground ${isElderly ? 'text-2xl' : 'text-xl'}`}>Enter your code</h2>
          <p className={`text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
            We emailed a 6-digit code to <b>{email}</b>. Enter it below to activate your account.
          </p>
        </div>

        <div className="bg-warning/10 border border-warning/35 p-3 rounded-2xl flex items-start gap-2 text-warning-strong text-xs font-semibold">
          <MailWarning className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Not in your inbox? <b>Check your Spam / Junk folder</b> — and mark it &quot;Not spam&quot; so future codes arrive on time.</span>
        </div>

        <form onSubmit={handleVerifyCode} className="space-y-3">
          <div className="relative">
            <KeyRound className={iconClass} />
            <input
              id="reg-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className={`${inputClass} text-center font-mono tracking-[0.4em]`}
              placeholder="000000"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{ background: 'linear-gradient(180deg, #F8839E 0%, #F26B8A 100%)' }}
            className={`w-full flex justify-center rounded-2xl shadow-md font-black text-white hover:brightness-[0.97] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 transition-all active:scale-[0.98] cursor-pointer ${isElderly ? 'py-4 text-xl' : 'py-3.5 text-base'}`}
          >
            {loading ? 'Verifying…' : 'Verify & Continue'}
          </button>

          <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
            <button type="button" disabled={loading} onClick={handleResendCode} className="hover:text-primary disabled:opacity-50 transition-colors cursor-pointer">
              Resend code
            </button>
            <span>·</span>
            <Link href="/login" className="hover:text-primary transition-colors">
              Back to Sign In
            </Link>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-danger/10 text-danger text-sm p-3 rounded-2xl border border-danger/20 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleRegister} className="space-y-3">
        <div>
          <label htmlFor="reg-name" className={`block font-bold text-foreground mb-1.5 ${isElderly ? 'text-base' : 'text-xs'}`}>Full name</label>
          <div className="relative">
            <User className={iconClass} />
            <input
              id="reg-name"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClass}
              placeholder="Full name"
            />
          </div>
        </div>

        <div>
          <label htmlFor="reg-email" className={`block font-bold text-foreground mb-1.5 ${isElderly ? 'text-base' : 'text-xs'}`}>Email</label>
          <div className="relative">
            <Mail className={iconClass} />
            <input
              id="reg-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@example.com"
            />
          </div>
        </div>

        <div>
          <label htmlFor="reg-password" className={`block font-bold text-foreground mb-1.5 ${isElderly ? 'text-base' : 'text-xs'}`}>Password</label>
          <div className="relative flex items-center">
          <Lock className={iconClass} />
          <input
            id="reg-password"
            type={showPassword ? 'text' : 'password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} pr-12`}
            placeholder="Choose a password"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-4 text-muted-foreground hover:text-primary transition-colors focus:outline-none flex items-center justify-center"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 shrink-0 cursor-pointer"
          />
          <span>
            I am 18 or older and I agree to the{' '}
            <Link href="/terms" target="_blank" className="text-primary font-semibold hover:underline">Terms of Service</Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" className="text-primary font-semibold hover:underline">Privacy Policy</Link>.
          </span>
        </label>

        <Turnstile onVerify={setCaptchaToken} />

        <button
          type="submit"
          disabled={loading}
          style={{ background: 'linear-gradient(180deg, #F8839E 0%, #F26B8A 100%)' }}
          className={`w-full flex justify-center rounded-2xl shadow-md font-black text-white hover:brightness-[0.97] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 transition-all active:scale-[0.98] cursor-pointer ${isElderly ? 'py-4 text-xl' : 'py-3.5 text-base'}`}
        >
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <div className="text-center text-sm">
        <span className="text-muted-foreground">Already have an account? </span>
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign In
        </Link>
      </div>
    </div>
  );
}
