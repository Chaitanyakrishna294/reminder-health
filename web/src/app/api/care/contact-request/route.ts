import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-role';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, tooManyRequests } from '@/lib/rate-limit';

// Patient taps "Request Caregiver Contact" → in-app notification for every
// linked, accepted caregiver (their realtime bell + browser notification).
export async function POST(request: Request) {
  try {
    if (!(await checkRateLimit(`care:contact-request:${getClientIp(request)}`, 5, 300))) {
      return tooManyRequests();
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, telegram_chat_id')
      .eq('id', user.id)
      .single();
    if (!profile?.telegram_chat_id) {
      return NextResponse.json({ error: 'No linked account.' }, { status: 400 });
    }

    // Service role: caregiver rows aren't visible to the patient under RLS,
    // and notifications RLS only allows inserting for yourself.
    const admin = createServiceClient();
    const { data: links } = await admin
      .from('active_caregiver_links')
      .select('caregiver_chat_id')
      .eq('patient_telegram_id', profile.telegram_chat_id)
      .eq('is_active', true)
      .eq('connection_status', 'ACCEPTED');

    const caregiverChatIds = (links ?? []).map(l => l.caregiver_chat_id).filter(Boolean);
    if (caregiverChatIds.length === 0) {
      return NextResponse.json({ error: 'No caregiver is linked to your account yet.' }, { status: 404 });
    }

    const { data: caregivers } = await admin
      .from('profiles')
      .select('id')
      .in('telegram_chat_id', caregiverChatIds);
    if (!caregivers || caregivers.length === 0) {
      return NextResponse.json({ error: 'No caregiver is linked to your account yet.' }, { status: 404 });
    }

    const patientName = profile.full_name || 'Your patient';
    // ponytail: reuses the ESCALATED type (constraint-safe); add a CONTACT_REQUEST
    // type via migration if it ever needs distinct styling in the bell.
    const { error: insertErr } = await admin.from('notifications').insert(
      caregivers.map(c => ({
        user_id: c.id,
        title: 'Contact Request',
        message: `${patientName} tapped "Request Caregiver Contact" and would like you to call or check on them.`,
        type: 'ESCALATED',
      }))
    );
    if (insertErr) {
      console.error('[Contact Request] Insert error:', insertErr);
      return NextResponse.json({ error: 'Failed to notify caregivers.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, notified: caregivers.length });
  } catch (error) {
    console.error('[Contact Request] Error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
