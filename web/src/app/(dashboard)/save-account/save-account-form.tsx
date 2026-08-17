'use client';

import { useLanguage } from '@/context/language-context';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Mail, KeyRound, ShieldCheck, Loader2, UserRound } from 'lucide-react';

/**
 * Guest -> permanent account, in the app's existing typed-code idiom.
 *
 * `updateUser({ email })` on an anonymous user starts an email-change
 * confirmation; because the account has no previous address, Supabase sends the
 * code only to the new one (this holds whether or not "Secure email change" is
 * enabled — that setting double-sends only when there IS an old address).
 * Verifying with type 'email_change' promotes the SAME auth user to permanent:
 * is_anonymous flips to false, the uid is untouched, and every row already
 * pointing at that uid is simply now reachable by signing in.
 *
 * No password step. The app's primary sign-in is an emailed code (see
 * (auth)/login), so an email alone is a complete, working credential — and
 * asking a guest for a password here would be one more reason to abandon the
 * only screen that protects their data. A password can be added afterwards from
 * the existing /update-password page.
 */
export default function SaveAccountForm({ currentName }: { currentName: string }) {
  const { t } = useLanguage();
  const [fullName, setFullName] = useState(currentName);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const supabase = createClient();
  const { isElderly } = useUiMode();

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError(t.auth.errEmailRequired);
      return;
    }
    setLoading(true);
    setError(null);

    // Name first, and separately: it is a profiles write that must not be lost
    // if the email step fails, and it is not part of the auth conversion.
    const name = fullName.trim();
    if (name) {
      await supabase.auth.updateUser({ data: { full_name: name } });
      const { data: { user } } = await supabase.auth.getUser();
      if (user) await supabase.from('profiles').update({ full_name: name }).eq('id', user.id);
    }

    const { error: updateErr } = await supabase.auth.updateUser({ email: trimmed });

    if (updateErr) {
      const m = (updateErr.message || '').toLowerCase();
      setError(
        m.includes('already') || m.includes('registered')
          ? 'That email already has an account. Sign in to it instead — note that this guest data stays with this device.'
          : updateErr.message,
      );
      setLoading(false);
      return;
    }

    setLoading(false);
    setSent(true);
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

    // 'email_change' is the type for confirming a NEW address on an existing
    // user — which is exactly what an anonymous account being promoted is.
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'email_change',
    });

    if (verifyErr) {
      const m = (verifyErr.message || '').toLowerCase();
      setError(
        m.includes('expired') || m.includes('invalid')
          ? 'That code is invalid or expired. Send a fresh one below.'
          : verifyErr.message,
      );
      setLoading(false);
      return;
    }

    router.refresh();
    router.push('/dashboard');
  };

  const labelClass = `block font-semibold text-foreground ${isElderly ? 'text-xl mb-2' : 'text-sm mb-1.5'}`;
  // `surface-sunk` (§1: inputs are wells, below the card) replaces a hardcoded
  // #F2F2F7 — an iOS grey that is not in the palette and, being a literal, stayed
  // light in dark mode (§10.2). It carries the well background AND the 14px
  // control radius, so the off-scale `rounded-2xl` goes with it.
  // Elderly keeps its exact previous classes: it is excluded, and the swap is a
  // small warm/cool shift its branch should not inherit.
  const inputClass = `block w-full px-4 py-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 text-sm transition-all ${
    isElderly ? 'rounded-2xl bg-[#F2F2F7] py-4 text-xl' : 'surface-sunk'
  }`;

  return (
    <div className={`mx-auto ${isElderly ? 'max-w-2xl space-y-6' : 'max-w-xl space-y-5'}`}>
      <div>
        {/* `title-page` (30/34) rather than an ad-hoc 26px — §4's scale. */}
        <h1 className={`font-bold tracking-tight text-foreground ${isElderly ? 'text-4xl' : 'title-page'}`}>
          Save your account
        </h1>
        <p className={`text-muted-foreground mt-1 font-medium ${isElderly ? 'text-lg' : 'text-[13px]'}`}>
          You are using Re-MIND-eЯ as a guest. Add an email to keep your medicines safe.
        </p>
      </div>

      {/* The honest warning. A guest session lives in this browser's cookie:
          clear it, switch device, or reinstall, and the data is unreachable —
          not deleted, but with no email there is no way to prove it is yours. */}
      <div className="rounded-[var(--r-card)] bg-warning/10 ring-1 ring-warning/25 px-5 py-4">
        <p className="text-sm font-semibold text-foreground">{t.auth.whyThisMatters}</p>
        <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
          Right now your medicines exist only in this browser&apos;s session. If you clear your
          browser data, switch phones, or reinstall the app, there is no way to prove the account is
          yours and you would start over. Adding an email fixes that — nothing is moved or re-entered.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-[var(--r-card)] bg-danger/10 ring-1 ring-danger/25 px-5 py-3">
          <p className="text-sm font-semibold text-destructive">{error}</p>
        </div>
      )}

      {!sent ? (
        <form onSubmit={handleSendCode} className="space-y-4">
          <div>
            <label htmlFor="save-name" className={labelClass}>
              Your name <span className="font-normal text-muted-foreground">{t.medForm.optional}</span>
            </label>
            <div className="relative">
              <UserRound
                className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none"
                aria-hidden
              />
              <input
                id="save-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t.auth.namePlaceholder}
                className={`${inputClass} pl-12`}
              />
            </div>
          </div>

          <div>
            <label htmlFor="save-email" className={labelClass}>{t.auth.emailAddress}</label>
            <div className="relative">
              <Mail
                className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none"
                aria-hidden
              />
              <input
                id="save-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.auth.emailPlaceholder}
                autoComplete="email"
                className={`${inputClass} pl-12`}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              We will send a short code to confirm it. Check your spam folder if it does not arrive.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-14 inline-flex items-center justify-center gap-2 rounded-[var(--r-control)] bg-primary text-white font-bold text-base shadow-md hover:brightness-95 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 disabled:cursor-wait transition-all cursor-pointer"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden /> : <ShieldCheck className="w-5 h-5" aria-hidden />}
            {loading ? 'Sending…' : 'Send confirmation code'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label htmlFor="save-code" className={labelClass}>{t.auth.enterTheCode}</label>
            <p className="text-xs text-muted-foreground mb-2">
              Sent to <span className="font-semibold text-foreground">{email.trim()}</span>.
            </p>
            <div className="relative">
              <KeyRound
                className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none"
                aria-hidden
              />
              <input
                id="save-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className={`${inputClass} pl-12 font-[var(--font-mono)] tracking-[0.3em]`}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-14 inline-flex items-center justify-center gap-2 rounded-[var(--r-control)] bg-primary text-white font-bold text-base shadow-md hover:brightness-95 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 disabled:cursor-wait transition-all cursor-pointer"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden /> : <ShieldCheck className="w-5 h-5" aria-hidden />}
            {loading ? 'Confirming…' : 'Confirm and save my account'}
          </button>

          <button
            type="button"
            onClick={() => { setSent(false); setCode(''); setError(null); }}
            className="w-full h-11 rounded-[var(--r-control)] text-sm font-semibold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors cursor-pointer"
          >
            Use a different email
          </button>
        </form>
      )}
    </div>
  );
}
