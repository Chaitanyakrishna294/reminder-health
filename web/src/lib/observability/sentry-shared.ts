/**
 * Shared Sentry configuration — and, more importantly, the scrubbing.
 *
 * This app handles medication names, dose times, adherence history and care-circle
 * relationships for named people. A crash reporter is a pipe to a third party, so
 * the default posture here is "send the least that is still useful for debugging"
 * rather than "send everything and hope the defaults are safe".
 *
 * What is deliberately NOT enabled anywhere:
 *  - **Session Replay.** It records the screen. On this app that screen is a list
 *    of someone's medications. There is no masking configuration that makes
 *    filming a patient's dose schedule an acceptable default.
 *  - **sendDefaultPii.** Off explicitly, not merely by default, so a future SDK
 *    changing its default cannot quietly turn it on.
 *  - **Performance tracing**, unless a sample rate is set in env — it multiplies
 *    event volume, and this project is deliberately run on free tiers.
 *
 * DISABLED WITHOUT A DSN. No env var means `enabled: false` and every SDK call
 * becomes a no-op, so the app behaves exactly as it did before Sentry existed —
 * and costs nothing — until someone opts in.
 */

import type { ErrorEvent, EventHint, Breadcrumb } from '@sentry/nextjs';

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';

/** Everything is a no-op without a DSN, so shipping this is free and inert. */
export const SENTRY_ENABLED = SENTRY_DSN.length > 0;

/**
 * Query strings routinely carry ids (`?patient=…`, `?token=…`). Sentry groups by
 * URL, so unscrubbed they end up in issue titles as well as in the payload.
 */
function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const cut = url.indexOf('?');
  return cut === -1 ? url : `${url.slice(0, cut)}?[scrubbed]`;
}

/**
 * Breadcrumbs are the sneaky one: fetch/xhr crumbs carry full request URLs, and
 * console crumbs carry whatever the app happened to log. Keep the shape of what
 * happened, drop the contents.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') {
    // Keep that a log happened and at what level; drop the text, which is the
    // part that could name a drug or a person.
    return { ...breadcrumb, message: '[console output removed]', data: undefined };
  }

  if (breadcrumb.data && typeof breadcrumb.data === 'object') {
    const data = { ...(breadcrumb.data as Record<string, unknown>) };
    if (typeof data.url === 'string') data.url = scrubUrl(data.url);
    // Request/response bodies are never worth the risk.
    delete data.body;
    delete data.input;
    return { ...breadcrumb, data };
  }

  return breadcrumb;
}

/**
 * Last gate before anything leaves the device or the server.
 *
 * Note the honest limit: an exception MESSAGE can still contain data if the app
 * put it there (`Failed to save "Telmikind"`). That is inherent to crash
 * reporting — the fix is not logging patient data into error strings in the first
 * place, not a regex here pretending to catch every case.
 */
export function scrubEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  // Identify the account, never the person. An opaque uuid is enough to tell
  // "one user hit this 40 times" from "40 users hit it once", which is the only
  // thing user context is actually needed for.
  if (event.user) {
    event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  }

  if (event.request) {
    event.request.url = scrubUrl(event.request.url);
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.headers) {
      // Auth headers and cookies are credentials; the rest is rarely worth it.
      const { 'user-agent': userAgent } = event.request.headers;
      event.request.headers = userAgent ? { 'user-agent': userAgent } : {};
    }
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((b): b is Breadcrumb => b !== null);
  }

  return event;
}

/** Options shared by the client, server and edge runtimes. */
export const sharedSentryOptions = {
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
  // Explicit rather than relying on the SDK default staying false.
  sendDefaultPii: false,
  // Opt-in only: tracing multiplies event volume and this runs on free tiers.
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0),
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
} as const;
