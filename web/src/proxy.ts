import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Next 16 renamed the "middleware" file convention to "proxy" — same functionality,
// clearer name. The exported function must be named `proxy` (or be the default export).
// See node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md.
// The auth policy itself still lives in @/lib/supabase/middleware (updateSession) — that
// is a plain module, not a file convention, so it keeps its name.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
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
