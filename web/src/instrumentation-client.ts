/**
 * Browser + Android-webview observability.
 *
 * This runs inside the Capacitor webview too, so it is what reports errors from
 * the app's management UI. The native alarm core reports separately (Kotlin
 * Sentry) — deliberately, because the whole point of that core is that it keeps
 * working when the webview does not.
 *
 * NO SESSION REPLAY, here or anywhere. It records the screen, and on this app
 * that screen is a list of someone's medications.
 *
 * Inert without NEXT_PUBLIC_SENTRY_DSN — see sentry-shared.ts.
 */

import * as Sentry from '@sentry/nextjs';
import { sharedSentryOptions, SENTRY_ENABLED } from '@/lib/observability/sentry-shared';

if (SENTRY_ENABLED) {
  Sentry.init({
    ...sharedSentryOptions,
    // Default integrations minus anything that captures page contents.
    integrations: (defaults) =>
      defaults.filter((integration) => !integration.name.toLowerCase().includes('replay')),
  });
}

/** Next uses this to report client-side navigation timing when tracing is on. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
