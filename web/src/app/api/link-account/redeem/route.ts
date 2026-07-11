// Redeem a Telegram link code and attach it to the caller's profile. Replaces the old
// direct-client link_codes/profiles access (now blocked by RLS) with a rate-limited,
// atomic SECURITY DEFINER RPC call. See docs/superpowers/specs/2026-07-11-link-codes-hardening-design.md.
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, getClientIp, tooManyRequests } from '@/lib/rate-limit';

const Schema = z.object({ code: z.string().min(1).max(32) });

export async function POST(request: Request) {
  try {
    if (!(await checkRateLimit(`link-account:redeem:${getClientIp(request)}`, 10, 600))) {
      return tooManyRequests();
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = Schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Enter the verification code.' }, { status: 400 });
    }

    const { error } = await supabase.rpc('redeem_link_code', { p_code: parsed.data.code });

    if (error) {
      const m = (error.message || '').toLowerCase();
      if (m.includes('expired')) {
        return NextResponse.json(
          { error: 'This verification code has expired. Please request a new one by typing /linkweb in the bot.' },
          { status: 400 }
        );
      }
      if (m.includes('invalid code')) {
        return NextResponse.json({ error: 'Invalid verification code. Please check and try again.' }, { status: 400 });
      }
      console.error('[link-account/redeem] RPC error:', error);
      return NextResponse.json({ error: 'Failed to link account. Please try again.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[link-account/redeem] error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
