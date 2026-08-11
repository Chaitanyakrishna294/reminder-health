import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// NOTE: Content-Security-Policy is NOT here anymore. It carries a per-request nonce
// (script-src 'nonce-…' 'strict-dynamic', no 'unsafe-inline'), so it is set dynamically
// in src/proxy.ts / src/lib/supabase/middleware.ts. The headers below are static and safe
// to serve from the config.
const securityHeaders = [
  // Defense-in-depth against clickjacking alongside CSP frame-ancestors.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

// Sentry (M3). Applied ONLY when a DSN is configured, so a project without one
// builds byte-for-byte as it did before — no source-map generation, no build
// plugin, no behaviour change, no cost. The SDK itself is inert without the DSN
// too (see src/lib/observability/sentry-shared.ts); this is the build half of
// the same "opt in or it does not exist" rule.
//
// CSP note: connect-src above already allows `https:`, so Sentry's ingest
// endpoint is reachable without loosening anything. If that ever tightens to an
// allow-list, the Sentry host has to be added or reports fail silently — which
// is the worst failure mode for a crash reporter.
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      silent: true,
      // Without SENTRY_AUTH_TOKEN the plugin skips source-map upload. Stack
      // traces are then minified but still grouped correctly — worth having,
      // and better than making the build fail on a missing token.
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      // The tunnel would route Sentry traffic through this app's own domain to
      // dodge ad blockers. Deliberately NOT enabled: it would make the app a
      // proxy for third-party traffic, which is a poor trade on a health app.
      disableLogger: true,
    })
  : nextConfig;
