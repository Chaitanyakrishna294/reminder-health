import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Only allow internal redirect targets. Rejects absolute URLs and
// protocol-relative paths like "//evil.com" or "/\evil.com" (open redirect).
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return '/dashboard';
  }
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Ensure user profile exists
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .single();

        if (!profile) {
          // Fallback registration insert
          await supabase.from('profiles').insert([{
            id: user.id,
            role: 'PATIENT',
            full_name: user.user_metadata?.full_name || 'Patient User',
            telegram_chat_id: `WEB-${user.id}`
          }]);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=Could not exchange session code`);
}
