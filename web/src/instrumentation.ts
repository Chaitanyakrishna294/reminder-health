/**
 * Server + edge observability (Next 16 `instrumentation.ts` convention — see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
 *
 * `register()` runs once per server instance before any request is handled;
 * `onRequestError` is how Next hands server-side errors to a reporter.
 *
 * Inert without NEXT_PUBLIC_SENTRY_DSN — see sentry-shared.ts.
 */

import * as Sentry from '@sentry/nextjs';
import { sharedSentryOptions, SENTRY_ENABLED } from '@/lib/observability/sentry-shared';

export async function register() {
  if (!SENTRY_ENABLED) return;

  // The runtimes need separate init calls; edge cannot load the Node SDK.
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({ ...sharedSentryOptions });
  }
}

/**
 * Server errors, including those thrown inside Server Components and route
 * handlers. Sentry's helper attaches the routing context Next provides; the
 * scrubbing in beforeSend still applies to whatever it produces.
 */
export const onRequestError = Sentry.captureRequestError;
