// Send an OTP to verify the patient's phone for voice reminders (P1b).
// Authed + rate-limited. Stores only a hash of the code. See docs/VOICE_CALLS_DESIGN.md.
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-role';
import { NextResponse } from 'next/server';
import { createHash, randomInt } from 'crypto';
import { z } from 'zod';
import { checkRateLimit, getClientIp, tooManyRequests } from '@/lib/rate-limit';
import { sendSms, smsConfigured } from '@/lib/sms';

const Schema = z.object({ phone: z.string().regex(/^\+\d{8,15}$/) });

export async function POST(request: Request) {
  try {
    if (!(await checkRateLimit(`voice:otp:send:${getClientIp(request)}`, 5, 600))) {
      return tooManyRequests();
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = Schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Enter a valid phone number in international format (e.g. +9198…).' }, { status: 400 });
    }
    const { phone } = parsed.data;

    const { data: profile } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', user.id)
      .single();
    const telegramId = profile?.telegram_chat_id;
    if (!telegramId) return NextResponse.json({ error: 'No account identifier found.' }, { status: 400 });

    if (!smsConfigured()) {
      return NextResponse.json({ error: 'Phone verification is not available yet. Please check back soon.' }, { status: 503 });
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = createHash('sha256').update(code).digest('hex');

    const admin = createServiceClient();
    // One active code per account: clear any prior, then insert the fresh one (5-min TTL).
    await admin.from('phone_verifications').delete().eq('telegram_id', telegramId);
    const { error: insErr } = await admin.from('phone_verifications').insert([{
      telegram_id: telegramId,
      phone_e164: phone,
      code_hash: codeHash,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }]);
    if (insErr) {
      console.error('[voice/verify/send] insert failed:', insErr);
      return NextResponse.json({ error: 'Could not start verification. Try again.' }, { status: 500 });
    }

    const sms = await sendSms({ to: phone, text: `Your Re-MIND-eR verification code is ${code}. It expires in 5 minutes.` });
    if (!sms.ok) {
      console.error('[voice/verify/send] sms failed:', sms.reason, sms.detail);
      return NextResponse.json({ error: 'Could not send the code. Please try again shortly.' }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[voice/verify/send] error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
