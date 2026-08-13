'use client';

/**
 * Pull down on Today to re-fetch it.
 *
 * WHY IT EARNS ITS PLACE ON A SCREEN THAT IS OTHERWISE DELIBERATELY CALM. Today
 * shows dose state that can change somewhere else entirely — a caregiver marks a
 * dose from their own phone, the bot records a Telegram reply, the device alarm
 * syncs a queued "taken" from this morning. When someone doubts what is on
 * screen, the gesture they already try is to pull down, and until now nothing
 * happened. The alternative they were left with was killing the app.
 *
 * `useTransition` drives the indicator, so it disappears when the refresh has
 * ACTUALLY completed rather than after a flattering fixed delay. A spinner that
 * lies about being finished is worse than no spinner: it teaches people the
 * refresh does not work.
 *
 * Touch only, by construction — it hangs off touch events, so a mouse never
 * triggers it and desktop keeps its scrollbar.
 */

import React, { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowDown } from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';

/** How far to pull before releasing counts as a refresh. */
const THRESHOLD = 72;
/** Beyond this the rubber band stops giving, so it never feels broken. */
const MAX_PULL = 110;
/** Pull is damped: fingers travel further than the content, as on iOS. */
const DAMPING = 0.5;

export default function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isElderly } = useUiMode();
  const [pull, setPull] = useState(0);
  const [pending, startTransition] = useTransition();
  const startY = useRef<number | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      // Only from the very top. Starting mid-scroll would hijack an ordinary
      // upward flick and make the page feel sticky.
      if (window.scrollY > 0 || e.touches.length !== 1) { startY.current = null; return; }
      startY.current = e.touches[0].clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current === null || pending) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) { setPull(0); return; }
      // Non-passive listener, so this can actually stop the browser's own
      // overscroll from competing with ours.
      if (e.cancelable) e.preventDefault();
      setPull(Math.min(delta * DAMPING, MAX_PULL));
    };

    const onEnd = () => {
      if (startY.current !== null && pull >= THRESHOLD) refresh();
      startY.current = null;
      setPull(0);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [pull, pending, refresh]);

  const armed = pull >= THRESHOLD;
  const visible = pull > 4 || pending;
  const iconSize = isElderly ? 'w-6 h-6' : 'w-5 h-5';

  return (
    <div ref={hostRef} className="relative">
      {/* The indicator rides the pull, then parks while the refresh runs. */}
      <div
        className="pointer-events-none absolute left-1/2 top-0 z-40 -translate-x-1/2"
        style={{
          transform: `translate(-50%, ${pending ? 12 : Math.max(0, pull - 44)}px)`,
          opacity: visible ? 1 : 0,
          transition: pull === 0 ? 'transform 200ms ease-out, opacity 200ms ease-out' : 'opacity 120ms linear',
        }}
        // The wording, not just the spin, is what tells someone whether letting
        // go will do anything. aria-live so it reaches a screen reader too.
        role="status"
        aria-live="polite"
      >
        <div className={`flex items-center gap-2 rounded-full border border-border bg-card/95 shadow-lg backdrop-blur ${isElderly ? 'px-5 py-3' : 'px-4 py-2'}`}>
          {pending ? (
            <Loader2 className={`${iconSize} animate-spin text-primary-strong`} aria-hidden />
          ) : (
            <ArrowDown
              className={`${iconSize} text-primary-strong transition-transform duration-200`}
              style={{ transform: armed ? 'rotate(180deg)' : 'none' }}
              aria-hidden
            />
          )}
          <span className={`font-bold text-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
            {pending ? 'Updating…' : armed ? 'Release to update' : 'Pull to update'}
          </span>
        </div>
      </div>

      {/* Content follows the finger. `translate3d` keeps it on the compositor —
          this runs on low-end Android and a janky pull reads as a broken app. */}
      <div
        style={{
          transform: `translate3d(0, ${pending ? 8 : pull}px, 0)`,
          transition: pull === 0 ? 'transform 260ms cubic-bezier(0.23, 1, 0.32, 1)' : 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}
