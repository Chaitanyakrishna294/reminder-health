'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock, Heart, UserRound, ShieldCheck } from 'lucide-react';

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
  const router = useRouter();

  const continueToLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    router.push(trimmed ? `/login?email=${encodeURIComponent(trimmed)}` : '/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FBF7F8] dark:bg-[#0F1C5A]">
      {/* Hero: mascot over the app's auth wash + blurred bubble fields (the
          launch-splash colour family) — no flat white behind the art. */}
      {/* py-2, not py-6: the padding budget went to the larger artwork so the
          page still fits one 812px screen. */}
      <div className="relative flex-1 min-h-[30vh] overflow-hidden flex items-center justify-center py-2">
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

        <form onSubmit={continueToLogin} className="mt-6 space-y-3.5">
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

        <div className="relative flex items-center my-4" aria-hidden>
          <div className="flex-grow border-t border-[#0F1C5A]/25"></div>
          <span className="flex-shrink mx-4 font-mono font-bold text-sm text-[#0F1C5A]/70">or</span>
          <div className="flex-grow border-t border-[#0F1C5A]/25"></div>
        </div>

        <Link
          href="/register"
          className="w-full h-12 inline-flex items-center justify-center gap-2 rounded-2xl font-mono font-bold text-lg text-[#0F1C5A] hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 transition-colors"
        >
          <UserRound className="w-5 h-5" aria-hidden />
          Create account
        </Link>

        <p className="mt-3 flex items-center justify-center gap-1.5 font-mono text-[11px] text-[#0F1C5A]/80">
          <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden />
          Your health data is secure and private with us.
        </p>
      </section>
    </div>
  );
}
