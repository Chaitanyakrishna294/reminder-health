'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Eye, EyeOff, User, Mail, Lock, AlertTriangle, Heart } from 'lucide-react';
import Turnstile, { captchaEnabled } from '@/components/turnstile';
import { buttonClasses } from '@/components/ui/button';
import { CodeInput, SpamCallout } from '@/components/auth/code-entry';

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
      setError('Enter the full code from your email.');
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

  // Kept identical to the login page — the two screens sit one tap apart.
  const inputClass = `w-full pl-12 pr-4 rounded-2xl bg-white border border-border text-foreground shadow-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all ${isElderly ? 'py-5 text-lg' : 'py-4 text-[15px]'}`;
  const iconClass = 'absolute left-4 top-1/2 -translate-y-1/2 text-primary pointer-events-none w-[18px] h-[18px]';
  const labelClass = `block font-bold text-foreground mb-1.5 ${isElderly ? 'text-base' : 'text-xs'}`;

  if (success) {
    return (
      <div className={`space-y-5 ${isElderly ? 'max-w-2xl' : ''}`}>
        {error && (
          <div className="bg-danger/10 text-danger-strong text-sm p-3 rounded-2xl border border-danger/20 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        <header className="text-center">
          {/* Same hero-tile treatment as the login page's code screen. */}
          <div className="mx-auto mb-6 w-28 h-28 rounded-[32px] bg-white shadow-xl ring-1 ring-primary/15 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/mascot/login-hero.png"
              alt=""
              aria-hidden
              width={88}
              height={88}
              className="w-[88px] h-[88px] object-contain"
            />
          </div>
          <h1 className={`font-mono font-black tracking-tight text-foreground text-center ${isElderly ? 'text-4xl' : 'text-[2rem]'}`}>
            Check your email{' '}
            <Heart className="inline-block w-7 h-7 text-primary align-[-0.1em]" aria-hidden />
          </h1>
          <p className={`mt-2 text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
            We emailed a code to <b className="text-foreground break-all">{email}</b>. Enter it
            below to activate your account.
          </p>
        </header>

        <form onSubmit={handleVerifyCode} className="space-y-4">
          <div>
            <label htmlFor="reg-code" className={labelClass}>Confirmation code</label>
            <CodeInput id="reg-code" value={code} onChange={setCode} autoFocus />
          </div>

          <SpamCallout />

          <button
            type="submit"
            disabled={loading}
            className={buttonClasses({ variant: 'primary', size: 'lg', isElderly, fullWidth: true })}
          >
            {loading ? 'Verifying…' : 'Verify & Continue'}
          </button>

          <div className={`flex items-center justify-center gap-3 text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
            <button type="button" disabled={loading} onClick={handleResendCode} className="font-semibold hover:text-primary-strong disabled:opacity-50 transition-colors cursor-pointer">
              Resend code
            </button>
            <span aria-hidden>·</span>
            <Link href="/login" className="font-semibold hover:text-primary-strong transition-colors">
              Back to Sign In
            </Link>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Headline matches the redesigned login page — the (auth) layout no longer
          renders a big brand hero, so each page owns its own heading. */}
      <header>
        <h1 className={`font-mono font-black tracking-tight text-foreground ${isElderly ? 'text-4xl' : 'text-[2rem]'}`}>
          Create account{' '}
          <Heart className="inline-block w-7 h-7 text-primary align-[-0.1em]" aria-hidden />
        </h1>
        <p className={`mt-2 text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
          A few details and your medication companion is ready.
        </p>
      </header>

      {error && (
        <div className="bg-danger/10 text-danger-strong text-sm p-3 rounded-2xl border border-danger/20 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleRegister} className="space-y-3">
        <div>
          <label htmlFor="reg-name" className={labelClass}>Full name</label>
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
          <label htmlFor="reg-email" className={labelClass}>Email</label>
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
          <label htmlFor="reg-password" className={labelClass}>Password</label>
          <div className="relative flex items-center">
          <Lock className={iconClass} />
          <input
            id="reg-password"
            type={showPassword ? 'text' : 'password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} pr-14`}
            placeholder="Choose a password"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-1.5 w-11 h-11 flex items-center justify-center rounded-xl text-muted-foreground hover:text-primary-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
          >
            {showPassword ? <EyeOff className="w-[18px] h-[18px]" aria-hidden /> : <Eye className="w-[18px] h-[18px]" aria-hidden />}
          </button>
          </div>
        </div>

        <label className={`flex items-start gap-2.5 text-muted-foreground cursor-pointer pt-1 ${isElderly ? 'text-base' : 'text-xs'}`}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 shrink-0 w-4 h-4 accent-primary cursor-pointer"
          />
          <span>
            I am 18 or older and I agree to the{' '}
            <Link href="/terms" target="_blank" className="text-primary-strong font-semibold hover:underline">Terms of Service</Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" className="text-primary-strong font-semibold hover:underline">Privacy Policy</Link>.
          </span>
        </label>

        <Turnstile onVerify={setCaptchaToken} />

        <button
          type="submit"
          disabled={loading}
          className={buttonClasses({ variant: 'primary', size: 'lg', isElderly, fullWidth: true })}
        >
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <div className={`text-center ${isElderly ? 'text-base' : 'text-sm'}`}>
        <span className="text-muted-foreground">Already have an account? </span>
        <Link href="/login" className="font-semibold text-primary-strong hover:underline">
          Sign In
        </Link>
      </div>
    </div>
  );
}
