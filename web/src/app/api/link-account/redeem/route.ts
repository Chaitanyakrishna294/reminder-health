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

    // redeem_link_code now RETURNS a status string ('ok'|'rate_limited'|'invalid'|'expired'|
    // 'already_linked') and only RAISEs on 'Not authenticated'. We still interpret error.message
    // below so a DB-only rollback (which restores the old RAISE-based, void-returning function)
    // keeps working without a simultaneous redeploy.
    const { data: status, error } = await supabase.rpc('redeem_link_code', { p_code: parsed.data.code });

    const expired = () => NextResponse.json(
      { error: 'This verification code has expired. Please request a new one by typing /linkweb in the bot.' },
      { status: 400 }
    );
    const invalid = () => NextResponse.json({ error: 'Invalid verification code. Please check and try again.' }, { status: 400 });
    const alreadyLinked = () => NextResponse.json(
      { error: 'That Telegram account is already linked to a different account.' },
      { status: 409 }
    );

    if (error) {
      // Old-style (RAISE-based) redeem, or the pre-increment 'Not authenticated' path.
      const m = (error.message || '').toLowerCase();
      if (m.includes('expired')) return expired();
      if (m.includes('invalid code')) return invalid();
      if (m.includes('already linked')) return alreadyLinked();
      if (m.includes('too many attempts')) return tooManyRequests();
      if (m.includes('not authenticated')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      console.error('[link-account/redeem] RPC error:', error);
      return NextResponse.json({ error: 'Failed to link account. Please try again.' }, { status: 500 });
    }

    switch (status) {
      case 'ok': return NextResponse.json({ success: true });
      case 'rate_limited': return tooManyRequests();
      case 'expired': return expired();
      case 'invalid': return invalid();
      case 'already_linked': return alreadyLinked();
      default:
        // Fail CLOSED on an unrecognized status — this endpoint binds a Telegram identity to
        // the account, so an unknown result must never be treated as a successful link.
        console.error('[link-account/redeem] unexpected status:', status);
        return NextResponse.json({ error: 'Failed to link account. Please try again.' }, { status: 500 });
    }
  } catch (error: unknown) {
    console.error('[link-account/redeem] error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
