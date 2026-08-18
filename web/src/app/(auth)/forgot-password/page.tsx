'use client';

/**
 * Password reset — CODE flow, matching sign-in and registration.
 *
 * WHY IT IS NOT A LINK ANY MORE (changed 2026-08-13).
 * The link flow is PKCE: `resetPasswordForEmail` stashes a code verifier in this
 * browser, and `/api/auth/callback` can only exchange the returned code if the
 * SAME browser opens the email. That constraint bit a real journey on the first
 * attempt at verification — request the reset in one context, open the mail in
 * another, get "Could not exchange session code" and no way forward. On phones
 * that is the NORMAL path, not an edge case: the request happens in the app and
 * the mail opens in Gmail's own in-app browser.
 *
 * A code has no such context. Request it here, read it in whatever app shows
 * mail, type it back. It is also what login and register already do, so there is
 * one thing to learn instead of three.
 *
 * REQUIRES A DASHBOARD CHANGE: Supabase → Authentication → Emails → **Reset
 * Password** must include `{{ .Token }}`. Until it does, the email carries only a
 * link and there is no code to type. `redirectTo` is kept below precisely so that
 * in-between state still works for someone who opens the link in this browser.
 *
 * TURNSTILE is here because it was the one auth page without it. Supabase
 * enforces captcha on /recover the same as on /signup and /token, so switching
 * captcha on would have killed password reset silently — the 2026-08-10 outage
 * again, on the flow nobody exercises weekly.
 */

import { useLanguage } from '@/context/language-context';
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Mail, AlertTriangle, KeyRound, Send } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import { CodeInput, SpamCallout } from '@/components/auth/code-entry';
import Turnstile, { captchaEnabled } from '@/components/turnstile';

export default function ForgotPasswordPage() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // NOTE: the copy on this screen deliberately never states a digit count. The
  // OTP length is a Supabase Auth setting (this project issues 8), CodeInput
  // accepts 6-10 for exactly that reason, and a screen promising "6-digit" while
  // the email shows eight digits makes a working flow look broken.

  const supabase = createClient();
  const router = useRouter();
  const { isElderly } = useUiMode();

  const sendCode = async () => {
    if (!email) {
      setError(t.auth.errEmailForReset);
      return;
    }
    if (captchaEnabled && !captchaToken) {
      setError(t.auth.errCaptcha);
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);

    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
      // Kept deliberately. If the template still carries {{ .ConfirmationURL }},
      // or carries both, a link opened in THIS browser still works — same-browser
      // is the one case PKCE handles. The code is the path that always works.
      redirectTo: `${window.location.origin}/api/auth/callback?next=/update-password`,
      captchaToken: captchaToken ?? undefined,
    });

    setLoading(false);
    if (resetErr) {
      const m = (resetErr.message || '').toLowerCase();
      if (m.includes('rate limit') || m.includes('security purposes') || m.includes('too many')) {
        setError(t.auth.errTooManyRequests);
      } else if (m.includes('captcha')) {
        setError(t.auth.errCaptchaFailed);
      } else {
        setError(resetErr.message);
      }
    } else {
      // Never says whether an account exists — Supabase answers the same either
      // way, and so does this screen. Confirming the address would turn the reset
      // form into an account checker.
      const resending = codeSent;
      setCodeSent(true);
      setInfo(resending ? `A fresh code is on its way to ${email}.` : null);
    }
  };

  const handleSendSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendCode();
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = code.trim();
    if (token.length < 6) {
      setError(t.auth.errFullCode);
      return;
    }
    setLoading(true);
    setError(null);

    // type 'recovery' — NOT 'email'. 'email' verifies a signInWithOtp token and
    // fails here. On success the browser client stores the session in cookies, so
    // /update-password (a protected route) opens with a live session, exactly as
    // it does when arriving from the link.
    const { error: verifyErr } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });

    if (verifyErr) {
      const m = (verifyErr.message || '').toLowerCase();
      setError(
        m.includes('expired') || m.includes('invalid')
          ? 'That code is invalid or expired. Tap "Resend code" for a fresh one.'
          : verifyErr.message,
      );
      setLoading(false);
    } else {
      router.refresh();
      router.push('/update-password');
    }
  };

  const inputClass = `w-full pl-12 pr-4 rounded-[14px] surface-sunk border border-input text-foreground placeholder:text-muted-foreground/90 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all ${isElderly ? 'py-5 text-lg' : 'py-4 text-[15px]'}`;
  const iconClass = 'absolute left-4 top-1/2 -translate-y-1/2 text-primary pointer-events-none w-[18px] h-[18px]';
  const labelClass = `block font-bold text-foreground mb-1.5 ${isElderly ? 'text-base' : 'text-xs'}`;
  const quietLink = `font-semibold text-primary-strong hover:underline disabled:opacity-50 disabled:no-underline cursor-pointer min-h-11 px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg ${isElderly ? 'text-base' : 'text-sm'}`;

  return (
    <div className="space-y-5">
      <header>
        <h1 className={`title-page text-foreground ${isElderly ? 'text-4xl' : ''}`}>
          {codeSent ? 'Enter the code' : 'Reset password'}{' '}
          <KeyRound className="inline-block w-7 h-7 text-primary align-[-0.1em]" aria-hidden />
        </h1>
        <p className={`mt-2 text-muted-foreground text-balance ${isElderly ? 'text-lg' : 'text-sm'}`}>
          {codeSent ? (
            <>
              We emailed a code to{' '}
              <b className="text-foreground break-all">{email}</b>. Type it below to
              choose a new password.
            </>
          ) : (
            "Enter your email and we'll send you a code."
          )}
        </p>
      </header>

      {error && (
        <div className="bg-danger/10 text-danger-strong text-sm p-3 rounded-[var(--r-card)] border border-danger/20 flex items-start gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> <span>{error}</span>
        </div>
      )}

      {info && (
        <div className="bg-success/10 text-success-strong text-sm p-3 rounded-[var(--r-card)] border border-success/20 flex items-start gap-2" role="status">
          <Mail className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> <span>{info}</span>
        </div>
      )}

      {!codeSent ? (
        <form onSubmit={handleSendSubmit} className="space-y-4">
          <div>
            <label htmlFor="forgot-email" className={labelClass}>{t.auth.email}</label>
            <div className="relative">
              <Mail className={iconClass} aria-hidden />
              <input
                id="forgot-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder={t.auth.emailPlaceholder}
              />
            </div>
          </div>

          <Turnstile onVerify={setCaptchaToken} />

          <button
            type="submit"
            disabled={loading}
            className={buttonClasses({ variant: 'primary', size: 'lg', isElderly, fullWidth: true })}
          >
            <Send className="w-4 h-4" aria-hidden />
            {loading ? 'Sending…' : 'Email me a code'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label htmlFor="reset-code" className={labelClass}>{t.auth.resetCode}</label>
            <CodeInput id="reset-code" value={code} onChange={setCode} autoFocus />
          </div>

          <SpamCallout />

          {/* Rendered here too: Resend calls /recover again, which is the endpoint
              Supabase captcha-protects. */}
          <Turnstile onVerify={setCaptchaToken} />

          <button
            type="submit"
            disabled={loading}
            className={buttonClasses({ variant: 'primary', size: 'lg', isElderly, fullWidth: true })}
          >
            {loading ? 'Checking…' : 'Continue'}
          </button>

          <div className={`flex flex-wrap items-center justify-center gap-2 text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
            <button type="button" disabled={loading} onClick={() => void sendCode()} className={quietLink}>
              Resend code
            </button>
            <span aria-hidden>·</span>
            <button
              type="button"
              disabled={loading}
              onClick={() => { setCodeSent(false); setCode(''); setError(null); setInfo(null); }}
              className={quietLink}
            >
              Use a different email
            </button>
          </div>
        </form>
      )}

      <div className={`text-center ${isElderly ? 'text-base' : 'text-sm'}`}>
        <Link href="/login" className="font-semibold text-primary-strong hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
