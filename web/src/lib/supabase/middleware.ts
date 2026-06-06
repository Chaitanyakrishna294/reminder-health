import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

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
          supabaseResponse = NextResponse.next({
            request,
          });
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
  const isProtectedRoute = ['/dashboard', '/medications', '/caregivers', '/events', '/stock', '/link-account', '/update-password'].some(path => url.pathname.startsWith(path));

  // Redirect to login if user is not authenticated and attempts to access protected routes
  if (!user && isProtectedRoute) {
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Redirect to dashboard if authenticated user attempts to access auth pages or root
  if (user) {
    // Check if the user has completed Telegram account linking
    const { data: profile } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', user.id)
      .single();

    const hasLinkedTelegram = profile && profile.telegram_chat_id;

    if (!hasLinkedTelegram) {
      // If Telegram is not linked, and the user is not already on the linking page or update-password page, redirect them
      if (url.pathname !== '/link-account' && url.pathname !== '/update-password') {
        url.pathname = '/link-account';
        return NextResponse.redirect(url);
      }
    } else {
      // If Telegram is linked, prevent accessing the link page
      if (url.pathname === '/link-account') {
        url.pathname = '/dashboard';
        return NextResponse.redirect(url);
      }
      
      // Prevent accessing auth pages
      if (isAuthPage || url.pathname === '/') {
        url.pathname = '/dashboard';
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}
