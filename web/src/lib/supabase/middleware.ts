import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// `nonce` + `cspHeader` are generated per-request by proxy.ts. We do two things with them:
//   1. Forward them on the REQUEST headers (x-nonce + Content-Security-Policy) so the server
//      render can nonce its scripts — Next parses the CSP header to nonce its own framework/
//      bundle scripts, and app/layout.tsx reads x-nonce to nonce the inline theme/launch scripts.
//   2. Set the CSP on every RESPONSE (including redirects) so the browser enforces it.
// The Supabase auth/cookie logic and the routing rules below are unchanged from before.
export async function updateSession(request: NextRequest, nonce: string, cspHeader: string) {
  // Rebuilt whenever cookies change so the REFRESHED auth cookies and the nonce both reach
  // the downstream render (request.cookies.set syncs into request.headers' cookie header).
  const forwardHeaders = () => {
    const h = new Headers(request.headers);
    h.set('x-nonce', nonce);
    h.set('content-security-policy', cspHeader);
    return h;
  };
  const withCsp = (res: NextResponse) => {
    res.headers.set('content-security-policy', cspHeader);
    return res;
  };

  let supabaseResponse = NextResponse.next({ request: { headers: forwardHeaders() } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request: { headers: forwardHeaders() } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session if expired
  const { data: { user } } = await supabase.auth.getUser();

  const url = request.nextUrl.clone();
  const isAuthPage = ['/login', '/register', '/forgot-password'].includes(url.pathname);
  // Every (dashboard)-group route + the two standalone authed pages. Keep in sync
  // with src/app/(dashboard)/* — (dashboard)/layout.tsx is the second gate.
  const isProtectedRoute = [
    '/dashboard',
    '/medications',
    '/schedule-planner',
    '/health-vault',
    '/medical-profile',
    '/emergency',
    '/settings',
    '/notifications',
    '/care-circle',
    '/care-plus',
    '/admin-diagnostics',
    '/link-account',
    '/update-password',
    '/save-account',
  ].some(path => url.pathname.startsWith(path));

  // Redirect to login if user is not authenticated and attempts to access protected routes
  if (!user && isProtectedRoute) {
    url.pathname = '/login';
    return withCsp(NextResponse.redirect(url));
  }

  // Redirect to dashboard if authenticated user attempts to access auth pages or root
  if (user) {
    // Check if the user has completed Telegram account linking
    const { data: profile } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', user.id)
      .single();

    const hasTelegramChatId = profile && profile.telegram_chat_id;
    const isSynthetic = profile && profile.telegram_chat_id && profile.telegram_chat_id.startsWith('WEB-');
    const isRealTelegram = hasTelegramChatId && !isSynthetic;

    if (!hasTelegramChatId) {
      // If Telegram is not linked, and the user is not already on the linking page or update-password page, redirect them
      if (url.pathname !== '/link-account' && url.pathname !== '/update-password') {
        url.pathname = '/link-account';
        return withCsp(NextResponse.redirect(url));
      }
    } else {
      // If Telegram is linked with a real account, prevent accessing the link page
      if (isRealTelegram && url.pathname === '/link-account') {
        url.pathname = '/dashboard';
        return withCsp(NextResponse.redirect(url));
      }

      // Prevent accessing auth pages (and the signed-out welcome screen)
      if (isAuthPage || url.pathname === '/' || url.pathname === '/welcome') {
        url.pathname = '/dashboard';
        return withCsp(NextResponse.redirect(url));
      }
    }
  }

  return withCsp(supabaseResponse);
}
