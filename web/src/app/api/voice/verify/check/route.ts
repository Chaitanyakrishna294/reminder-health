// Confirm the OTP and mark the patient's phone verified (P1b).
// Authed + rate-limited. On success sets voice_call_preferences.phone_verified = true
// under the user's own RLS. See docs/VOICE_CALLS_DESIGN.md.
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-role';
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';
import { checkRateLimit, getClientIp, tooManyRequests } from '@/lib/rate-limit';

const Schema = z.object({
  phone: z.string().regex(/^\+\d{8,15}$/),
  code: z.string().regex(/^\d{6}$/),
});
const MAX_ATTEMPTS = 5;

export async function POST(request: Request) {
  try {
    if (!(await checkRateLimit(`voice:otp:check:${getClientIp(request)}`, 10, 600))) {
      return tooManyRequests();
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = Schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 });
    const { phone, code } = parsed.data;

    const { data: profile } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', user.id)
      .single();
    const telegramId = profile?.telegram_chat_id;
    if (!telegramId) return NextResponse.json({ error: 'No account identifier found.' }, { status: 400 });

    const admin = createServiceClient();
    const { data: rec } = await admin
      .from('phone_verifications')
      .select('*')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (!rec) return NextResponse.json({ error: 'No active code. Request a new one.' }, { status: 400 });
    if (new Date(rec.expires_at) < new Date()) {
      await admin.from('phone_verifications').delete().eq('id', rec.id);
      return NextResponse.json({ error: 'Code expired. Request a new one.' }, { status: 400 });
    }
    if ((rec.attempts || 0) >= MAX_ATTEMPTS) {
      await admin.from('phone_verifications').delete().eq('id', rec.id);
      return NextResponse.json({ error: 'Too many attempts. Request a new code.' }, { status: 429 });
    }

    const codeHash = createHash('sha256').update(code).digest('hex');
    const matches = rec.phone_e164 === phone && rec.code_hash === codeHash;
    if (!matches) {
      await admin.from('phone_verifications').update({ attempts: (rec.attempts || 0) + 1 }).eq('id', rec.id);
      return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 400 });
    }

    // Success — mark verified on the user's own preferences row (RLS-scoped upsert).
    const { error: upErr } = await supabase
      .from('voice_call_preferences')
      .upsert(
        { telegram_id: telegramId, phone_e164: phone, phone_verified: true, updated_at: new Date().toISOString() },
        { onConflict: 'telegram_id' }
      );
    if (upErr) {
      console.error('[voice/verify/check] mark verified failed:', upErr);
      return NextResponse.json({ error: 'Verified, but could not save. Try again.' }, { status: 500 });
    }

    await admin.from('phone_verifications').delete().eq('id', rec.id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[voice/verify/check] error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
