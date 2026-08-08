import type { NextConfig } from "next";

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

export default nextConfig;
