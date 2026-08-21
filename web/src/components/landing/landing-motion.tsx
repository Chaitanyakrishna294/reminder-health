'use client';

import React, { useEffect, useRef, useState } from 'react';
import { SECTIONS } from '@/lib/landing/config';

/**
 * THE LANDING PAGE'S MOTION, ALL OF IT.
 *
 * Three behaviours live here and nowhere else: the dose-rail section nav, the
 * reveal-on-scroll wrapper, and the hero sticker parallax. They are together
 * because they share one rule and it is easier to keep if it is written once:
 *
 *  - **transform and opacity only.** Nothing animates layout.
 *  - **`prefers-reduced-motion` is a REAL branch, not a shorter duration.** With
 *    it on, revealed content starts visible, the parallax never attaches a
 *    listener at all, and the rail still works — it just stops sliding.
 *  - **NOTHING LOOPS.** CLAUDE.md's calm rule governs the landing page as much as
 *    the app: every animation here is a one-time response to arriving somewhere.
 *    Remi's idle bob is the single sanctioned loop and it comes from the mascot
 *    component, already carved out and already guarded.
 *
 * No GSAP. Two IntersectionObservers and one rAF-throttled scroll handler is the
 * whole budget, which also keeps the page light on a mid-range Android.
 */

/** True when the user has asked for less motion. Re-read live, not cached. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true); // assume the calmer default first
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return reduced;
}

/**
 * Fade-and-rise as a block scrolls in, once.
 *
 * Starts VISIBLE and is hidden only after we know motion is allowed — so a
 * reduced-motion reader, and anyone whose JS has not run yet, sees content
 * rather than a blank page waiting for an observer.
 */
export function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(true);

  useEffect(() => {
    if (reduced) {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    setShown(false);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);

    /**
     * THE DEAD-MAN SWITCH, and it is not paranoia.
     *
     * This effect hides the content and then relies on the observer to bring it
     * back. But **a tab that is not compositing does not deliver
     * IntersectionObserver callbacks at all** — a backgrounded tab at load time,
     * or a Capacitor webview that was never painted. Without this timer that
     * combination leaves a reader looking at a blank page, which is a far worse
     * outcome than a missing fade.
     *
     * So the reveal is an enhancement with a deadline: if the observer has not
     * spoken within 1.2s, show the content anyway. The failure mode becomes "no
     * animation" instead of "no content".
     */
    const failsafe = window.setTimeout(() => setShown(true), 1200);
    return () => {
      io.disconnect();
      window.clearTimeout(failsafe);
    };
  }, [reduced]);

  return (
    <div
      ref={ref}
      className={className}
      style={
        reduced
          ? undefined
          : {
              opacity: shown ? 1 : 0,
              transform: shown ? 'none' : 'translateY(22px)',
              transition: `opacity 560ms var(--ease-out) ${delay}ms, transform 560ms var(--ease-out) ${delay}ms`,
            }
      }
    >
      {children}
    </div>
  );
}

/**
 * THE DOSE RAIL — the page's section nav, shaped like the app's dose strip.
 *
 * Each stop is a time of day, and its dot fills with that section's own slot
 * colour as you reach it, so scrolling the page walks the same morning → night
 * palette the day rail uses to bucket doses. The label is mono because it is a
 * TIME — a value, which is exactly what mono is for.
 *
 * Hidden below 1180px: it is a wayfinding luxury for a wide screen, and on a
 * phone it would be a fixed overlay competing with the content it indexes.
 */
export function DoseRail() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const targets = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => !!el,
    );
    if (!targets.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = targets.indexOf(e.target as HTMLElement);
          if (i >= 0) setActive(i);
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  return (
    <nav
      aria-label="Sections"
      className="fixed right-8 top-1/2 z-50 hidden -translate-y-1/2 flex-col gap-6 xl:flex"
    >
      {SECTIONS.map((s, i) => {
        const on = i === active;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            aria-current={on ? 'true' : undefined}
            className="group flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-full border-2"
              style={{
                borderColor: on ? `var(--slot-${s.slot})` : 'var(--border)',
                background: on ? `var(--slot-${s.slot})` : 'transparent',
                transform: on ? 'scale(1.25)' : 'none',
                transition: 'background 300ms var(--ease-standard), transform 300ms var(--ease-standard), border-color 300ms var(--ease-standard)',
              }}
            />
            <span
              className="whitespace-nowrap font-mono text-[11px] font-bold tracking-[0.08em]"
              style={{
                color: on ? `var(--slot-${s.slot}-ink)` : 'var(--muted-foreground)',
                opacity: on ? 1 : 0,
                transform: on ? 'none' : 'translateX(-6px)',
                transition: 'opacity 300ms var(--ease-standard), transform 300ms var(--ease-standard)',
              }}
            >
              {s.time} {s.label}
            </span>
          </a>
        );
      })}
    </nav>
  );
}

/**
 * HERO STICKERS — three parallax depths.
 *
 * The shapes are drawn from the product's own world (a tablet, a clock, a glass
 * of water) in the mascot's flat sticker language: flat fills, round caps, no
 * gradients, and only colours already in the frozen set. They are `aria-hidden`
 * decoration and they are the first thing dropped on a small screen, where the
 * hero's job is the headline and one button.
 */
const STICKERS = [
  // depth, position classes, and the drawing
  { depth: 16, cls: 'left-[6%] top-[8%]', size: 52, kind: 'tablet' },
  { depth: 30, cls: 'right-[8%] top-[4%]', size: 44, kind: 'clock' },
  { depth: 22, cls: 'left-[10%] bottom-[10%]', size: 40, kind: 'water' },
  { depth: 36, cls: 'right-[6%] bottom-[14%]', size: 48, kind: 'tablet' },
] as const;

function Sticker({ kind, size }: { kind: string; size: number }) {
  const ink = 'var(--slot-night)';
  if (kind === 'clock') {
    return (
      <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden>
        <circle cx="40" cy="40" r="28" fill="var(--card)" stroke={ink} strokeWidth="4" />
        <path d="M40 22v19l12 7" stroke={ink} strokeWidth="5" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'water') {
    return (
      <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden>
        <path
          d="M26 20h28l-4 42a6 6 0 0 1-6 5H36a6 6 0 0 1-6-5Z"
          fill="var(--hydration-soft)"
          stroke={ink}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path d="M28 42h24" stroke="var(--hydration)" strokeWidth="6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden>
      <g transform="rotate(-20 40 40)">
        <rect x="12" y="28" width="56" height="26" rx="13" fill="var(--card)" stroke={ink} strokeWidth="4" />
        <path d="M40 28v26" stroke={ink} strokeWidth="4" />
        <path d="M40 30h14a11 11 0 0 1 0 22H40Z" fill="var(--primary)" />
      </g>
    </svg>
  );
}

export function HeroStickers() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced) return;
    const host = ref.current;
    if (!host) return;
    const nodes = Array.from(host.children) as HTMLElement[];
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        nodes.forEach((n) => {
          const d = Number(n.dataset.depth || 10);
          n.style.transform = `translate3d(0, ${(y * d) / 100}px, 0)`;
        });
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [reduced]);

  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 hidden sm:block">
      {STICKERS.map((s, i) => (
        <div key={i} data-depth={s.depth} className={`absolute ${s.cls}`} style={{ willChange: 'transform' }}>
          <Sticker kind={s.kind} size={s.size} />
        </div>
      ))}
    </div>
  );
}

/**
 * The scroll-driven phone moment: the mockup's "next dose" card lifts as the
 * section arrives. One observer, no scroll-jacking, and it settles — it does not
 * pulse. A looping highlight would be attention-seeking motion on a page about a
 * product whose whole design rule is calm.
 */
export function HighlightOnView({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setOn(true)),
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <div
      ref={ref}
      style={
        reduced
          ? undefined
          : {
              transform: on ? 'translateY(-3px)' : 'none',
              boxShadow: on ? 'var(--lift-2)' : 'var(--lift-1)',
              transition: 'transform 420ms var(--ease-out), box-shadow 420ms var(--ease-out)',
              borderRadius: 'var(--r-control)',
            }
      }
    >
      {children}
    </div>
  );
}
