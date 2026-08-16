import React from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import BrainMascot, { mascotSlot } from '@/components/dashboard/brain-mascot';

/**
 * Auth shell, redesigned 2026-08-09 from the generated mockups: brand row kept
 * small and out of the way (content-first — the page headline is the focal
 * point, same direction as the med-gate redesign), form fields sit directly on
 * the soft --auth-radial wash instead of a frosted card, and the mascot peeks
 * from behind the bottom trust strip. The strip is in normal flow (not fixed),
 * so an open keyboard on mobile scrolls it away instead of colliding with it.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // `isolate` creates the stacking context that lets the -z-10 bubble layer
    // sit above this div's background but below every in-flow child.
    <div
      className="relative isolate flex min-h-screen flex-col"
      style={{ background: 'var(--auth-radial)' }}
    >
      {/* Blurred bubble fields (same treatment as /welcome, one notch quieter —
          a form screen's focal point is the form, not the backdrop). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <span className="absolute -left-14 top-8 w-48 h-48 rounded-full blur-2xl opacity-60 bg-[#F5B3CB] dark:bg-[#2C41A0]" />
        <span className="absolute -right-16 top-40 w-44 h-44 rounded-full blur-2xl opacity-55 bg-[#AFC9F2] dark:bg-[#22458C]" />
        <span className="absolute -left-10 bottom-40 w-36 h-36 rounded-full blur-2xl opacity-50 bg-[#AFC9F2] dark:bg-[#22458C]" />
        <span className="absolute -right-10 bottom-24 w-40 h-40 rounded-full blur-2xl opacity-60 bg-[#F5D9AE] dark:bg-[#43307D]" />
      </div>
      {/* Vertical budget is tight: at 375x812 the whole login screen — through the
          trust strip's Terms links — must fit WITHOUT scrolling (mockup parity).
          Change these paddings only with a scrollHeight check at 375x812. */}
      <header className="w-full max-w-sm mx-auto flex items-center gap-3 px-6 pt-5">
        <BrainMascot {...mascotSlot('welcome')} />
        <div className="leading-tight">
          <p className="font-mono font-black text-lg text-foreground tracking-tight">
            Re-MIND-eЯ
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Your health, our care
          </p>
        </div>
      </header>

      <main className="w-full max-w-sm mx-auto flex-1 px-6 pt-5 pb-2">
        {children}
      </main>

      {/* The mascot GRABS the trust strip: the image sits ABOVE the strip (z-20)
          and overlaps its top edge by EXACTLY the distance the art's fingertips
          hang below the brain's straight bottom line — measured 14px at the
          asset's 672px width ⇒ ~4px at the ~206px render (-mb-1). That puts
          the brain's edge line ON the strip edge with only the fingers curling
          onto its face. Re-measure if the asset changes
          (scratch/mascot-measure-hang.mjs). Decorative only, hence
          alt="" + aria-hidden. */}
      <footer className="relative mt-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mascot/login-peek.png"
          alt=""
          aria-hidden
          width={224}
          height={141}
          className="relative z-20 block mx-auto w-56 max-w-[55vw] h-auto -mb-1 select-none pointer-events-none"
        />
        <div className="relative z-10 bg-card rounded-t-[28px] px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center shadow-[0_-10px_30px_rgba(15,28,90,0.08)]">
          <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-success shrink-0" aria-hidden />
            Your health data is secure and private with us.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            <Link href="/privacy" className="hover:underline">
              Privacy Policy
            </Link>
            <span className="mx-2">·</span>
            <Link href="/terms" className="hover:underline">
              Terms of Service
            </Link>
            <span className="mx-2">·</span>
            <Link href="/disclaimer" className="hover:underline">
              Medical Disclaimer
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
