'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'cookie-consent-ack';

/**
 * Lightweight cookie/privacy notice. The app uses only essential cookies
 * (authentication session), so this is an acknowledgment rather than a
 * granular consent manager. Choice is remembered in localStorage.
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      /* localStorage unavailable — don't block the app */
    }
  }, []);

  const acknowledge = () => {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-[100] p-4 sm:p-6"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card shadow-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <p className="text-xs sm:text-sm text-muted-foreground flex-1">
          We use only essential cookies to keep you signed in. See our{' '}
          <Link href="/privacy" className="text-primary font-semibold hover:underline">Privacy Policy</Link>{' '}
          and{' '}
          <Link href="/terms" className="text-primary font-semibold hover:underline">Terms</Link>.
        </p>
        <button
          onClick={acknowledge}
          className="shrink-0 rounded-xl bg-primary text-primary-foreground font-bold px-5 py-2 text-sm hover:bg-primary-hover transition-all cursor-pointer"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
