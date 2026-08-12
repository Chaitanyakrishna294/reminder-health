'use client';

/**
 * The Android hardware back button.
 *
 * back pops · root minimizes — the second half of the model in lib/navigation/stack.ts.
 *
 *   sub-page (notifications, med detail, legal…) → pop exactly one level
 *   root page (the five tabs)                    → ask, then background the app
 *
 * NOT a history hack. An earlier sketch used a pushState sentinel plus a popstate
 * listener, which works in any browser — and fights the App Router, which owns
 * history for its own navigations. Binding to Capacitor's real backButton event
 * keeps the two from disagreeing, at the cost of doing nothing off the app. That
 * cost is right: intercepting a browser tab's back button is user-hostile, and a web
 * page cannot minimize itself.
 *
 * Rendered once, in the (dashboard) layout, so every route inherits it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { onBackButton, minimizeApp } from '@/lib/native/app-bridge';
import { isRootPath } from '@/lib/navigation/stack';
import ExitDialog from '@/components/layout/exit-dialog';

export default function AndroidBack() {
  const pathname = usePathname();
  const router = useRouter();
  const [askingExit, setAskingExit] = useState(false);

  const handleBack = useCallback(() => {
    // A dialog is itself a level of "back": dismiss it rather than acting twice.
    setAskingExit((asking) => {
      if (asking) return false;
      if (isRootPath(pathname)) {
        // A deep link lands ON a root path but is not the root VIEW: a dose
        // notification opens /dashboard?day=…, and offering to exit the app from
        // there would be a jarring answer to "go back". Drop the param instead and
        // the rail returns to today — the URL is what it reads from.
        if (pathname === '/dashboard' && new URLSearchParams(window.location.search).has('day')) {
          router.replace('/dashboard');
          return false;
        }
        return true;
      }
      // Sub-page. router.back() rather than Capacitor's own canGoBack: the App
      // Router's history is what this app actually navigates, and a sub-page opened
      // by a deep link with nothing behind it still needs somewhere to land —
      // see the fallback below.
      if (window.history.length > 1) router.back();
      else router.replace('/dashboard');
      return false;
    });
  }, [pathname, router]);

  useEffect(() => onBackButton(handleBack), [handleBack]);

  return (
    <ExitDialog
      open={askingExit}
      onCancel={() => setAskingExit(false)}
      onExit={async () => {
        setAskingExit(false);
        // If the plugin is missing (an APK built before @capacitor/app landed) this
        // returns false and we simply stay put — a dead Exit button is a bad day,
        // but a dialog that cannot be dismissed is a worse one, and Cancel still works.
        await minimizeApp();
      }}
    />
  );
}
