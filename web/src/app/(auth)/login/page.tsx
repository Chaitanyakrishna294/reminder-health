'use client';

import { useLanguage } from '@/context/language-context';
import { format } from '@/lib/i18n/format';
import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { buttonClasses } from '@/components/ui/button';
import {
  Eye,
  EyeOff,
  AlertTriangle,
  Info,
  Mail,
  Lock,
  Heart,
  Send,
} from 'lucide-react';
import Turnstile, { captchaEnabled } from '@/components/turnstile';
import { CodeInput, SpamCallout } from '@/components/auth/code-entry';
import LoadingMark from '@/components/ui/loading-mark';

/**
 * Redesigned 2026-08-09 from the generated mockups ("Welcome back" form-first
 * screen + the code-entry screen). Two visual states that SWAP instead of
 * stacking: the password form with the emailed-code option, and — once a code
 * is sent — a focused code-entry screen with the hero mascot tile and the
 * spam callout. All auth logic is unchanged from the pre-redesign page.
 */
function LoginForm() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { isElderly } = useUiMode();

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      setError(errorParam);
    }
    // /welcome hands its email field off here so nobody types it twice.
    const emailParam = searchParams.get('email');
    if (emailParam) {
      setEmail(emailParam);
    }
  }, [searchParams]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (captchaEnabled && !captchaToken) {
      setError(t.auth.errCaptcha);
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);

    const { error: loginErr } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: captchaToken ?? undefined },
    });

    if (loginErr) {
      setError(loginErr.message);
      setLoading(false);
    } else {
      router.refresh();
      router.push('/dashboard');
    }
  };

  // Email a sign-in code (NOT a link). Omitting emailRedirectTo makes Supabase send the
  // {{ .Token }} code; a typed code has no PKCE verifier cookie, so it works no matter which
  // app/browser opens the email (the magic *link* broke when Gmail opened it in its own
  // in-app browser). shouldCreateUser:false keeps this a LOGIN — new users use "Create account".
  // NOTE: the Supabase "Magic Link" email template must include {{ .Token }} for the code to show.
  const handleSendCode = async () => {
    if (!email) {
      setError(t.auth.errEmailForCode);
      return;
    }
    if (captchaEnabled && !captchaToken) {
      setError(t.auth.errCaptcha);
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);

    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, captchaToken: captchaToken ?? undefined },
    });

    setLoading(false);
    if (otpErr) {
      const m = (otpErr.message || '').toLowerCase();
      if (m.includes('not allowed') || m.includes('signups')) {
        setError(format(t.auth.errNoAccount, { label: t.auth.createAccount }));
      } else if (m.includes('rate limit') || m.includes('security purposes') || m.includes('too many')) {
        setError(t.auth.errTooManyEmail);
      } else {
        setError(otpErr.message);
      }
    } else {
      const resending = codeSent;
      setCodeSent(true);
      // First send: the code screen's own heading says where the code went, so a
      // banner would say it twice. On a RESEND the screen doesn't change, so the
      // banner is the only feedback that anything happened.
      setInfo(resending ? format(t.auth.freshCodeSent, { email }) : null);
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

    // type 'email' verifies the OTP from signInWithOtp; on success the browser client stores the
    // session in cookies, so the proxy sees it on the next navigation (same as password login).
    const { error: verifyErr } = await supabase.auth.verifyOtp({ email, token, type: 'email' });

    if (verifyErr) {
      const m = (verifyErr.message || '').toLowerCase();
      setError(
        m.includes('expired') || m.includes('invalid')
          ? format(t.auth.errCodeInvalid, { label: t.auth.resendCode })
          : verifyErr.message
      );
      setLoading(false);
    } else {
      router.refresh();
      router.push('/dashboard');
    }
  };

  const inputClass = `w-full pl-12 pr-4 rounded-[14px] surface-sunk border border-input text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all ${isElderly ? 'py-5 text-lg' : 'py-4 text-[15px]'}`;
  // Pink icons are decorative accents (mockup direction) — labels carry the meaning.
  const iconClass = 'absolute left-4 top-1/2 -translate-y-1/2 text-primary pointer-events-none';
  const labelClass = `block font-bold text-foreground mb-1.5 ${isElderly ? 'text-base' : 'text-xs'}`;

  return (
    <div className="space-y-5">
      <header>
        {codeSent && (
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
        )}
        {/* The heart is INLINE, not a flex sibling — a flex heart detaches and
            floats beside the text block whenever the title wraps to two lines. */}
        <h1
          className={`title-page text-foreground ${codeSent ? 'text-center' : ''} ${isElderly ? 'text-4xl' : ''}`}
        >
          {codeSent ? t.auth.checkYourEmail : t.auth.welcomeBack}{' '}
          <Heart className="inline-block w-7 h-7 text-primary align-[-0.1em]" aria-hidden />
        </h1>
        <p
          className={`mt-2 text-muted-foreground ${codeSent ? 'text-center' : ''} ${isElderly ? 'text-lg' : 'text-sm'}`}
        >
          {codeSent ? (
            <>{format(t.auth.emailedCodeTo, { email })}</>
          ) : (
            t.auth.signInSubtitle
          )}
        </p>
      </header>

      {error && (
        <div className="bg-danger/10 text-danger-strong text-sm p-3 rounded-[var(--r-card)] border border-danger/20 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> <span>{error}</span>
        </div>
      )}

      {info && (
        <div className="bg-primary/10 text-primary-strong text-sm p-3 rounded-[var(--r-card)] border border-primary/20 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> <span>{info}</span>
        </div>
      )}

      {!codeSent ? (
        <>
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label htmlFor="login-email" className={labelClass}>
                Email
              </label>
              <div className="relative">
                <Mail className={`${iconClass} w-[18px] h-[18px]`} aria-hidden />
                <input
                  id="login-email"
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
              <label htmlFor="login-password" className={labelClass}>
                Password
              </label>
              <div className="relative flex items-center">
                <Lock className={`${iconClass} w-[18px] h-[18px]`} aria-hidden />
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pr-14`}
                  placeholder={t.auth.loginPasswordPlaceholder}
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
              <div className="flex justify-end mt-2">
                <Link
                  href="/forgot-password"
                  className={`font-semibold text-muted-foreground hover:text-primary-strong underline decoration-dashed decoration-muted-foreground/50 underline-offset-4 transition-colors ${isElderly ? 'text-base' : 'text-xs'}`}
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            <Turnstile onVerify={setCaptchaToken} />

            <button
              type="submit"
              disabled={loading}
              className={buttonClasses({ variant: 'primary', size: 'lg', isElderly, fullWidth: true })}
            >
              <Lock className="w-4 h-4" aria-hidden />
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="relative flex items-center" aria-hidden>
            <div className="flex-grow border-t border-border"></div>
            <span className="flex-shrink mx-4 text-muted-foreground text-xs font-semibold">or</span>
            <div className="flex-grow border-t border-border"></div>
          </div>

          {/* One-off outline treatment (mockup): a real action, but visually quieter
              than the solid primary so only ONE thing on screen reads as "the" action. */}
          <button
            type="button"
            disabled={loading}
            onClick={handleSendCode}
            className={`w-full inline-flex items-center justify-center gap-2 font-bold rounded-[var(--r-control)] border border-primary/35 text-primary-strong hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${isElderly ? 'h-16 text-lg' : 'h-14 text-sm'}`}
          >
            <Send className="w-4 h-4" aria-hidden />
            Email me a sign-in code
          </button>

          {/* A text row, not a third button-shaped block: it mirrors register's
              "Already have an account?" line and buys back ~32px of the one-screen
              vertical budget (see the layout's header comment). */}
          <p className={`text-center ${isElderly ? 'text-base' : 'text-sm'}`}>
            <span className="text-muted-foreground">{t.auth.newHere} </span>
            <Link href="/register" className="font-semibold text-primary-strong hover:underline">
              Create account
            </Link>
          </p>
        </>
      ) : (
        <form onSubmit={handleVerifyCode} className="space-y-4">
          <div>
            <label htmlFor="login-code" className={labelClass}>
              Sign-in code
            </label>
            <CodeInput id="login-code" value={code} onChange={setCode} autoFocus />
          </div>

          <SpamCallout />

          <Turnstile onVerify={setCaptchaToken} />

          <button
            type="submit"
            disabled={loading}
            className={buttonClasses({ variant: 'primary', size: 'lg', isElderly, fullWidth: true })}
          >
            {loading ? 'Verifying…' : 'Verify & sign in'}
          </button>

          <div
            className={`flex items-center justify-center gap-3 text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}
          >
            <button
              type="button"
              disabled={loading}
              onClick={handleSendCode}
              className="font-semibold hover:text-primary-strong disabled:opacity-50 transition-colors cursor-pointer"
            >
              Resend code
            </button>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={() => { setCodeSent(false); setCode(''); setInfo(null); setError(null); }}
              className="font-semibold hover:text-primary-strong transition-colors cursor-pointer"
            >
              Use a different email
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
          <LoadingMark size={44} className="text-primary-strong" />
          Loading sign-in…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
