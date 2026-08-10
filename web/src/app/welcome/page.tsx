'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock, Heart, UserRound, ShieldCheck, Loader2, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import Turnstile, { captchaEnabled } from '@/components/turnstile';

/**
 * The signed-out front door (mockup: "Never miss a dose") — a marketing moment,
 * not a product screen. Colours here are DELIBERATE fixed illustration values,
 * not theme tokens, for the same reason launch.html pins its palette: the pink
 * sweep + navy ink is the brand poster and must not re-skin in dark mode
 * (contrast is fixed by construction: #0F1C5A on #F59FB4 ≈ 8:1, white on
 * #CC3D64 ≈ 4.75:1). Only the hero backdrop shifts with the theme so the
 * mascot never sits on a glaring light panel at night.
 *
 * The email field is a hand-off, not a login: submit → /login?email=… so
 * nobody types their address twice. Routing: app/page.tsx sends signed-out
 * visitors here; the proxy bounces signed-in users to /dashboard.
 */
export default function WelcomePage() {
  const [email, setEmail] = useState('');
  const [guestLoading, setGuestLoading] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);
  // Only the guest button needs a token on this screen — the email field is a
  // hand-off to /login, which renders its own widget.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // The challenge is revealed ON TAP rather than rendered up front. This screen
  // is exactly one viewport tall by design, so an always-on 72px widget pushed
  // itself (and nearly the guest button) below the fold on a 375x812 phone —
  // measured 132px of overflow — and the pink panel reads as a bottom sheet, so
  // nobody thinks to scroll. Revealing it on demand keeps the default screen at
  // its original height and puts the challenge on screen exactly when it is
  // needed. It is also simply better: people signing in normally never see one.
  const [showCaptcha, setShowCaptcha] = useState(false);
  // Bumped to force a fresh Turnstile widget after a burnt token (the component
  // renders once per mount, so remounting is how you re-arm it).
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const captchaRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  /**
   * The guest button. When CAPTCHA is off this signs in immediately; when it is
   * on, the first tap reveals the challenge and scrolls it into view, and the
   * sign-in fires by itself as soon as the token arrives — so it stays a
   * one-tap action either way.
   */
  const handleGuestTap = () => {
    if (!captchaEnabled) return continueAsGuest(null);
    if (captchaToken) return continueAsGuest(captchaToken);

    setGuestError(null);
    setShowCaptcha(true);
  };

  // Scroll the revealed challenge into view. This has to be an effect, not a
  // requestAnimationFrame inside the tap handler: rAF fires before React has
  // committed the state change, so the ref is still null and the scroll is a
  // silent no-op (measured — the widget mounted at top 811 on an 812px screen
  // and the page never moved). An effect keyed on showCaptcha runs after the
  // commit, when the node actually exists.
  // Instant, not smooth, deliberately: `behavior: 'smooth'` was measured
  // silently no-oping here (scrollY 52 -> 52, while the same call without it
  // went 52 -> 176). This scroll is the only thing putting the challenge on
  // screen, and the challenge is the only path into the app for someone with no
  // account — so it cannot depend on an animation that might not run. A ~120px
  // jump needs no easing anyway.
  useEffect(() => {
    if (!showCaptcha) return;
    // Scroll to the very end rather than centring the element. Two reasons:
    // the challenge is the last thing on the page, so the end IS the target;
    // and Turnstile grows its own box AFTER this effect runs, which left
    // `block: 'center'` six pixels short (measured). Repeating on a short timer
    // catches that late layout without needing to observe the widget.
    const toBottom = () =>
      window.scrollTo({ top: document.documentElement.scrollHeight });
    toBottom();
    const t = setTimeout(toBottom, 400);
    return () => clearTimeout(t);
  }, [showCaptcha]);

  /** Turnstile resolved — continue the tap the user already made. */
  const handleCaptchaVerify = (token: string | null) => {
    setCaptchaToken(token);
    if (token && showCaptcha && !guestLoading) continueAsGuest(token);
  };

  const continueToLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    router.push(trimmed ? `/login?email=${encodeURIComponent(trimmed)}` : '/login');
  };

  /**
   * Start a no-signup guest session.
   *
   * This creates a REAL Supabase user (is_anonymous = true), so the existing
   * handle_new_user() trigger gives it a profile with a synthetic WEB-<uuid>
   * telegram_chat_id — which the proxy already routes straight to /dashboard
   * rather than the Telegram link page. Nothing else needed.
   *
   * router.refresh() before navigating so the server sees the cookie the
   * browser client just wrote; without it the proxy still reads "signed out"
   * and bounces straight back here.
   */
  const continueAsGuest = async (token: string | null) => {
    setGuestLoading(true);
    setGuestError(null);

    const supabase = createClient();
    // signInAnonymously() is an auth endpoint, so Supabase's CAPTCHA protection
    // covers it exactly like signUp/signInWithPassword. Without a token it dies
    // with "captcha protection: request disallowed" the moment CAPTCHA is
    // switched on — and it would look like guest mode itself was broken.
    const { error } = await supabase.auth.signInAnonymously({
      options: { captchaToken: token ?? undefined },
    });

    if (error) {
      // Two causes worth telling apart, because the fix differs and neither is
      // the user's fault: the dashboard toggle being off (Authentication ->
      // Sign In / Providers -> Anonymous sign-ins), or a rejected CAPTCHA token
      // (single-use — a retry needs a fresh one, hence the reload hint).
      const m = (error.message || '').toLowerCase();
      setGuestError(
        m.includes('captcha')
          ? 'Verification failed. Please reload the page and try again.'
          : m.includes('anonymous')
            ? 'Guest mode is not available right now. Please sign in or create an account.'
            : 'Could not start a guest session. Please try again.',
      );
      // Tokens are single-use, so a failed attempt burns this one. Drop it and
      // re-arm the challenge rather than leaving a dead token that can only
      // fail again.
      setCaptchaToken(null);
      setCaptchaNonce((n) => n + 1);
      setGuestLoading(false);
      return;
    }

    router.refresh();
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FBF7F8] dark:bg-[#0F1C5A]">
      {/* Hero: mascot over the app's auth wash + blurred bubble fields (the
          launch-splash colour family) — no flat white behind the art. */}
      {/* py-2, not py-6: the padding budget went to the larger artwork so the
          page still fits one 812px screen. */}
      {/* The hero collapses while the challenge is up. Measured at 375x640 (a
          realistic phone once browser chrome is subtracted): the mascot alone
          takes 308px of a 640px viewport, leaving a panel that needs ~560px
          with 332px to live in. No amount of scroll-into-view fixes that — the
          page was simply 349px taller than the screen, and the scroll landed
          72px short of the bottom, clipping the widget. Reclaiming the hero
          makes the whole panel fit outright, so the challenge is on screen
          without depending on scrolling at all. */}
      <div
        className={`relative overflow-hidden flex items-center justify-center ${
          showCaptcha ? 'hidden' : 'flex-1 min-h-[30vh] py-2'
        }`}
      >
        <div aria-hidden className="absolute inset-0" style={{ background: 'var(--auth-radial)' }} />
        {/* blur-2xl, not 3xl, and deeper tints — at 3xl the colour spread so
            thin the hero read as flat white (the exact complaint). */}
        <span
          aria-hidden
          className="absolute -left-12 top-2 w-52 h-52 rounded-full blur-2xl opacity-80 bg-[#F5B3CB] dark:bg-[#2C41A0]"
        />
        <span
          aria-hidden
          className="absolute -right-12 top-14 w-48 h-48 rounded-full blur-2xl opacity-75 bg-[#AFC9F2] dark:bg-[#22458C]"
        />
        <span
          aria-hidden
          className="absolute left-1/4 -bottom-14 w-48 h-48 rounded-full blur-2xl opacity-70 bg-[#F5D9AE] dark:bg-[#43307D]"
        />
        <span
          aria-hidden
          className="absolute left-3 top-1/2 w-28 h-28 rounded-full blur-xl opacity-70 bg-[#AFC9F2] dark:bg-[#22458C]"
        />
        <span
          aria-hidden
          className="absolute right-5 bottom-3 w-32 h-32 rounded-full blur-xl opacity-70 bg-[#F5B3CB] dark:bg-[#33488F]"
        />
        {/* Full hero scene — floats and blobs baked into the art (generated
            2026-08-09); the CSS blobs behind extend the wash to the edges. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mascot/welcome-mascot.png"
          alt=""
          aria-hidden
          width={690}
          height={528}
          className="relative w-[330px] max-w-[82vw] h-auto select-none pointer-events-none"
        />
      </div>

      {/* The pink sweep. */}
      <section className="relative rounded-t-[2.5rem] bg-[#F59FB4] px-7 pt-8 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-[#0F1C5A] shadow-[0_-12px_40px_rgba(15,28,90,0.10)]">
        <h1 className="font-mono font-black text-4xl leading-tight tracking-tight">
          Never miss a dose{' '}
          <Heart className="inline-block w-8 h-8 text-white align-[-0.12em]" strokeWidth={2.5} aria-hidden />
        </h1>
        <p className="mt-3 font-mono text-[15px] leading-relaxed text-[#0F1C5A]/80">
          Your friendly reminder to take medicines on time, every time.
        </p>

        {/* Sign-in form, divider and Create account all step aside while the
            challenge is up. Someone who has tapped "try without an account" is
            not choosing between three options any more — they are finishing one
            — and on a 320x560 screen those ~220px are the difference between
            the challenge fitting and being unreachable. Restored the moment the
            challenge is dismissed or completed. */}
        <form onSubmit={continueToLogin} className={`mt-6 space-y-3.5 ${showCaptcha ? 'hidden' : ''}`}>
          <div className="relative">
            <Mail
              className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#0F1C5A] pointer-events-none"
              aria-hidden
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email"
              placeholder="Enter your email"
              className="w-full h-14 pl-12 pr-4 rounded-2xl bg-[#FFFFFF] text-[#0F1C5A] placeholder-[#64748B] border border-[#0F1C5A]/10 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#CC3D64]/40 transition-all"
            />
          </div>
          <button
            type="submit"
            className="w-full h-14 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#CC3D64] text-white font-mono font-bold text-lg shadow-md hover:brightness-95 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 transition-all cursor-pointer"
          >
            <Lock className="w-5 h-5" aria-hidden />
            Sign in
          </button>
        </form>

        <div className={`relative flex items-center my-4 ${showCaptcha ? 'hidden' : ''}`} aria-hidden>
          <div className="flex-grow border-t border-[#0F1C5A]/25"></div>
          <span className="flex-shrink mx-4 font-mono font-bold text-sm text-[#0F1C5A]/70">or</span>
          <div className="flex-grow border-t border-[#0F1C5A]/25"></div>
        </div>

        <Link
          href="/register"
          className={`w-full h-12 inline-flex items-center justify-center gap-2 rounded-2xl font-mono font-bold text-lg text-[#0F1C5A] hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 transition-colors ${
            showCaptcha ? 'hidden' : ''
          }`}
        >
          <UserRound className="w-5 h-5" aria-hidden />
          Create account
        </Link>

        {/* Guest mode. Deliberately the quietest of the three actions but on the
            same screen: the point is that a first-time visitor can be adding a
            medicine in one tap, and be asked for an email only once the app has
            earned it. */}
        <button
          type="button"
          onClick={handleGuestTap}
          disabled={guestLoading}
          className="mt-1 w-full h-12 inline-flex items-center justify-center gap-2 rounded-2xl font-mono font-bold text-base text-[#0F1C5A]/85 underline underline-offset-4 decoration-[#0F1C5A]/30 hover:bg-white/25 hover:decoration-[#0F1C5A]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-60 disabled:cursor-wait transition-colors cursor-pointer"
        >
          {guestLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
              Setting things up…
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" aria-hidden />
              Try it without an account
            </>
          )}
        </button>

        {/* Mounted only after the guest button is tapped, so the default screen
            keeps its original height and nothing is pushed below the fold. The
            component itself also renders nothing until
            NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. */}
        {showCaptcha && captchaEnabled && (
          <div ref={captchaRef} className="mt-3">
            {/* Hint ABOVE the widget: the widget is then the last element on the
                page, so scrolling to the end lands it flush against the bottom
                edge instead of leaving its tail clipped. */}
            <p className="mb-2 text-center font-mono text-[11px] text-[#0F1C5A]/75">
              Quick check that you&apos;re not a robot — then you&apos;re in.
            </p>
            <Turnstile key={captchaNonce} onVerify={handleCaptchaVerify} />
            {/* Without this the focused state is a dead end: the sign-in form
                and Create account are hidden, so a user who changed their mind
                would have nothing to tap. */}
            <button
              type="button"
              onClick={() => { setShowCaptcha(false); setGuestError(null); }}
              className="mt-3 w-full h-10 rounded-2xl font-mono text-[13px] font-bold text-[#0F1C5A]/70 hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 transition-colors cursor-pointer"
            >
              Back
            </button>
          </div>
        )}

        {guestError && (
          <p role="alert" className="mt-2 text-center font-mono text-[12px] font-bold text-[#7A1029]">
            {guestError}
          </p>
        )}

        <p className="mt-3 flex items-center justify-center gap-1.5 font-mono text-[11px] text-[#0F1C5A]/80">
          <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden />
          Your health data is secure and private with us.
        </p>
      </section>
    </div>
  );
}
