'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'cookie-consent-ack';
/** Read by any full-height surface that must not be sat on. See below. */
const INSET_VAR = '--cookie-inset';

/**
 * Lightweight cookie/privacy notice. The app uses only essential cookies
 * (authentication session), so this is an acknowledgment rather than a granular
 * consent manager. Choice is remembered in localStorage.
 *
 * IT MUST NEVER COVER THE ACTION IT INTERRUPTS. Measured on /welcome at 375px
 * before this pass: the floating card sat over BOTH first-time paths at 100%
 * coverage — "Create account" and "Try it without an account" were behind it on
 * the app's own front door — and over "Create account" on /login.
 *
 * A SPACER IN NORMAL FLOW DOES NOT FIX THAT, which is worth writing down because
 * it is the obvious first answer. The sheet is `position: fixed`, so it is
 * pinned to the viewport's bottom edge no matter how tall the document is; on a
 * `min-h-screen` page like /welcome the bottom of the viewport IS the bottom of
 * the content at scroll 0, so a spacer only helps someone who already scrolled.
 *
 * So the sheet PUBLISHES ITS MEASURED HEIGHT as --cookie-inset on <html>, and
 * the full-height auth surfaces reserve it with `pb-[var(--cookie-inset,0px)]`
 * (welcome's root, the (auth) layout). Measured rather than hardcoded because
 * the copy wraps to a different number of lines at different widths, and a
 * guessed constant is how the two silently drift apart. Cleared on dismiss and
 * on unmount, so nothing keeps padding a page for a sheet that is gone.
 *
 * Styling is the system's, not its own: --r-card, `card-overlay` (the fourth
 * elevation step — what an overlay gets), and NO border, because a card carries
 * elevation and a border layered on a shadow is exactly the off-system look the
 * audit flagged. Pink text is --primary-strong, never --primary: #F26B8A on
 * white measured 2.90:1 here, the same failure this project has now shipped
 * three times.
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      /* localStorage unavailable — don't block the app */
    }
  }, []);

  // Publish the sheet's real height, and keep it current if the copy rewraps on
  // rotation or a font swap. useLayoutEffect so the padding lands in the same
  // paint the sheet does — with useEffect the first frame shows the sheet
  // already covering the content it is meant to sit below.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!visible) {
      root.style.removeProperty(INSET_VAR);
      return;
    }
    const el = sheetRef.current;
    if (!el) return;
    const apply = () => root.style.setProperty(INSET_VAR, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty(INSET_VAR);
    };
  }, [visible]);

  const acknowledge = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-[100]"
    >
      <div
        ref={sheetRef}
        className="card-overlay bg-card rounded-t-[var(--r-card)] mx-auto max-w-3xl px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 flex flex-col sm:flex-row sm:items-center gap-3"
      >
        <p className="text-[13px] sm:text-sm text-muted-foreground flex-1">
          We use only essential cookies to keep you signed in. See our{' '}
          <Link href="/privacy" className="text-primary-strong font-semibold hover:underline">Privacy Policy</Link>{' '}
          and{' '}
          <Link href="/terms" className="text-primary-strong font-semibold hover:underline">Terms</Link>.
        </p>
        {/* h-11 is the 44px floor. This was px-5 py-2, which measured 36px. */}
        <button
          onClick={acknowledge}
          className="shrink-0 h-11 px-6 rounded-[var(--r-control)] bg-primary-strong text-primary-strong-foreground font-bold text-sm hover:bg-primary-strong-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-all cursor-pointer"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
