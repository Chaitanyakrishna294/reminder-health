'use client';

import { useLanguage } from '@/context/language-context';
import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Eye, EyeOff, User, Mail, Lock, AlertTriangle, Heart } from 'lucide-react';
import Turnstile, { captchaEnabled } from '@/components/turnstile';
import { buttonClasses } from '@/components/ui/button';
import { CodeInput, SpamCallout } from '@/components/auth/code-entry';
import LoadingMark from '@/components/ui/loading-mark';

function RegisterForm() {
  const { t } = useLanguage();
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
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { isElderly } = useUiMode();

  // /welcome's email field hands off HERE now, not to /login — its primary
  // action is "Create free account". Same contract login already honoured, so
  // nobody types their address twice on the way in.
  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) setEmail(emailParam);
  }, [searchParams]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      setError(t.auth.errAgeTerms);
      return;
    }
    if (captchaEnabled && !captchaToken) {
      setError(t.auth.errCaptcha);
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
      setError(t.auth.errFullCode);
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
  const inputClass = `w-full pl-12 pr-4 rounded-[14px] surface-sunk border border-input text-foreground placeholder:text-muted-foreground/90 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all ${isElderly ? 'py-5 text-lg' : 'py-3.5 text-[15px]'}`;
  const iconClass = 'absolute left-4 top-1/2 -translate-y-1/2 text-primary pointer-events-none w-[18px] h-[18px]';
  const labelClass = `block font-bold text-foreground mb-1.5 ${isElderly ? 'text-base' : 'text-xs'}`;

  if (success) {
    return (
      <div className={`space-y-5 ${isElderly ? 'max-w-2xl' : ''}`}>
        {error && (
          <div className="bg-danger/10 text-danger-strong text-sm p-3 rounded-[var(--r-card)] border border-danger/20 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        <header className="text-center">
          {/* Same hero-tile treatment as the login page's code screen. */}
          <div className="mx-auto mb-6 w-28 h-28 rounded-[20px] card-lift card-lift-2 ring-1 ring-primary/15 flex items-center justify-center">
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
          <h1 className={`title-page text-foreground text-center ${isElderly ? 'text-4xl' : ''}`}>
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
            <label htmlFor="reg-code" className={labelClass}>{t.auth.confirmationCode}</label>
            <CodeInput id="reg-code" value={code} onChange={setCode} autoFocus />
          </div>

          <SpamCallout />

          <button
            type="submit"
            disabled={loading}
            className={buttonClasses({ variant: 'primary', size: 'lg', isElderly, fullWidth: true })}
          >
            {loading ? 'Verifying…' : 'Verify & continue'}
          </button>

          <div className={`flex items-center justify-center gap-3 text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
            <button type="button" disabled={loading} onClick={handleResendCode} className="font-semibold hover:text-primary-strong disabled:opacity-50 transition-colors cursor-pointer">
              Resend code
            </button>
            <span aria-hidden>·</span>
            <Link href="/login" className="font-semibold hover:text-primary-strong transition-colors">
              Back to sign in
            </Link>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Headline matches the redesigned login page — the (auth) layout no longer
          renders a big brand hero, so each page owns its own heading. */}
      <header>
        <h1 className={`title-page text-foreground ${isElderly ? 'text-4xl' : ''}`}>
          Create account{' '}
          <Heart className="inline-block w-7 h-7 text-primary align-[-0.1em]" aria-hidden />
        </h1>
        <p className={`mt-2 text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
          A few details and your medication companion is ready.
        </p>
      </header>

      {error && (
        <div className="bg-danger/10 text-danger-strong text-sm p-3 rounded-[var(--r-card)] border border-danger/20 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleRegister} className="space-y-2">
        <div>
          <label htmlFor="reg-name" className={labelClass}>{t.auth.fullName}</label>
          <div className="relative">
            <User className={iconClass} />
            <input
              id="reg-name"
              name="name"
              type="text"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClass}
              placeholder={t.auth.fullNamePlaceholder}
            />
          </div>
        </div>

        <div>
          <label htmlFor="reg-email" className={labelClass}>{t.auth.email}</label>
          <div className="relative">
            <Mail className={iconClass} />
            <input
              id="reg-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder={t.auth.emailPlaceholder}
            />
          </div>
        </div>

        <div>
          <label htmlFor="reg-password" className={labelClass}>{t.auth.password}</label>
          <div className="relative flex items-center">
          <Lock className={iconClass} />
          <input
            id="reg-password"
            name="new-password"
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} pr-14`}
            placeholder={t.auth.passwordPlaceholder}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-1.5 w-11 h-11 flex items-center justify-center rounded-[var(--r-control)] text-muted-foreground hover:text-primary-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
          >
            {showPassword ? <EyeOff className="w-[18px] h-[18px]" aria-hidden /> : <Eye className="w-[18px] h-[18px]" aria-hidden />}
          </button>
          </div>
        </div>

        <label className={`flex items-start gap-2.5 text-muted-foreground cursor-pointer pt-1 ${isElderly ? 'text-base' : 'text-xs'}`}>
          {/* The wrapping label already makes the whole sentence tappable, so
              the EFFECTIVE target was never 16px — but the visible box was, and
              that is what a thumb aims at. The span gives the box its own 44px
              hit area; the negative margins keep the visual alignment and stop
              a 44px row appearing in a screen that has to fit 375x812. */}
          <span className="shrink-0 w-11 h-11 -my-3 -ml-3 flex items-center justify-center">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="w-[22px] h-[22px] accent-primary cursor-pointer"
            />
          </span>
          <span>
            I am 18 or older and I agree to the{' '}
            <Link href="/terms" target="_blank" className="text-primary-strong font-semibold hover:underline">{t.legal.terms}</Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" className="text-primary-strong font-semibold hover:underline">{t.legal.privacy}</Link>,
            {' '}and I understand this is a reminder tool, not medical advice{' '}
            {/* Named at the moment of consent, not only in Settings: someone signing
                up for a medication app should know what it is not BEFORE they rely
                on it. Play policy for health apps expects the disclaimer to be
                surfaced, not merely reachable. */}
            (<Link href="/disclaimer" target="_blank" className="text-primary-strong font-semibold hover:underline">{t.legal.disclaimer}</Link>).
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
        <span className="text-muted-foreground">{t.auth.alreadyHaveAccount} </span>
        <Link href="/login" className="font-semibold text-primary-strong hover:underline">
          Sign in
        </Link>
      </div>
    </div>
  );
}

// useSearchParams needs a Suspense boundary — same wrapper login uses, for the
// same reason (it opts the route out of static prerendering otherwise).
export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
          <LoadingMark size={44} className="text-primary-strong" />
          Loading sign-up…
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
