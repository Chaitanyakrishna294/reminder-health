import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Next 16 renamed the "middleware" file convention to "proxy" — same functionality.
// The exported function must be named `proxy` (or be the default export).
// See node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md.
//
// CSP lives here (not next.config.ts) because it carries a per-request nonce, which is
// what lets script-src drop 'unsafe-inline'. A fresh nonce per request means every page
// renders dynamically (Next injects the nonce during SSR) — an accepted trade-off.
// See node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' + nonce: the nonced Next runtime transitively trusts the framework
    // and page bundles; CSP3 browsers ignore 'self'/host allowlists in script-src here (that
    // is the point). 'unsafe-eval' ONLY in dev (React's error overlay uses eval; never prod).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // style-src keeps 'unsafe-inline' deliberately: React `style={{}}` and the intentional
    // inline-style surfaces (lib/billing/luxe.ts) cannot carry a nonce, and style injection
    // is a far weaker vector than script injection.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:", // Supabase REST + realtime (wss) + storage signed URLs
    "frame-src 'self' blob: https:", // vault PDF <iframe>/<object> previews
    "object-src 'self' blob: https:", // vault PDF <object> previews
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  return await updateSession(request, nonce, csp);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files (images, SVGs etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
