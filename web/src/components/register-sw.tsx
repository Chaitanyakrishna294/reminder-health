'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker app-wide on load, independent of push permission.
 *
 * The browser only fires `beforeinstallprompt` (which powers the /install page's
 * one-tap button and the install banner) once a service worker is registered.
 * Previously `/sw.js` was registered only inside registerPush() — on the dashboard,
 * after login, and only if the user granted notifications — so first-time visitors
 * arriving at a shared /install link never met the install criteria.
 *
 * `sw.js` handles push, and pre-caches ONLY the /launch.html splash and its mascot
 * (the installed app's start_url, so launch is instant and animated). Its fetch
 * handler answers for exactly those precached files and lets every other request —
 * SSR, API, everything — fall through to the network untouched. Registering the
 * same URL again is idempotent, so this coexists with registerPush().
 */
export default function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* ignore: the browser just won't offer install/push here */
      });
    }
  }, []);

  return null;
}
