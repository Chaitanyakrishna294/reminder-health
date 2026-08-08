import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-role';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, tooManyRequests } from '@/lib/rate-limit';

// A caregiver refills a patient's medication stock from the patient console.
//
// This is a server route, not a client-side update, because RLS only lets a user
// UPDATE their own medications — caregivers hold SELECT-only policies, and the
// can_edit_medications flag on the connection is not consumed by any UPDATE policy.
// So the permission check happens HERE, against the live connection row, and the
// write goes through the service client. The client never gains a write path.
//
// The case this exists for: an elderly patient whose caregiver manages refills so
// the patient never has to touch stock numbers themselves.
export async function POST(request: Request) {
  try {
    if (!(await checkRateLimit(`care:patient-stock:${getClientIp(request)}`, 10, 300))) {
      return tooManyRequests();
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const medicationId = Number(body?.medicationId);
    const amount = Number(body?.amount);
    if (!Number.isFinite(medicationId) || medicationId <= 0) {
      return NextResponse.json({ error: 'Invalid medication.' }, { status: 400 });
    }
    // Same validation as the patient's own addStock path, plus a ceiling: a mistyped
    // 10000 on someone ELSE'S medical record should bounce, not persist.
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) {
      return NextResponse.json({ error: 'Enter how many units you added (1–1000).' }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, telegram_chat_id')
      .eq('id', user.id)
      .single();
    if (!profile?.telegram_chat_id) {
      return NextResponse.json({ error: 'No linked account.' }, { status: 400 });
    }

    const admin = createServiceClient();

    // The medication names its owner; the connection must tie THIS caregiver to that
    // owner, be accepted and active, and carry the edit permission. Checked against
    // the live rows on every call — a revoked permission takes effect immediately.
    const { data: med } = await admin
      .from('medications')
      .select('id, telegram_id, drug_name, current_stock, tablet_count')
      .eq('id', medicationId)
      .maybeSingle();
    if (!med) {
      return NextResponse.json({ error: 'Medication not found.' }, { status: 404 });
    }

    const { data: link } = await admin
      .from('active_caregiver_links')
      .select('connection_id, can_edit_medications')
      .eq('caregiver_chat_id', profile.telegram_chat_id)
      .eq('patient_telegram_id', med.telegram_id)
      .eq('is_active', true)
      .eq('connection_status', 'ACCEPTED')
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ error: 'You are not an accepted caregiver for this patient.' }, { status: 403 });
    }
    if (!link.can_edit_medications) {
      return NextResponse.json(
        { error: 'The patient has not granted you medication editing. Ask them to enable it in Shared Trust.' },
        { status: 403 },
      );
    }

    // current_stock ?? tablet_count: legacy rows keep the real count in tablet_count
    // with current_stock NULL; treating that as 0 would silently erase existing stock
    // on refill (20 + 30 -> 30). Same fallback as every other stock path.
    const newStock = Number(med.current_stock ?? med.tablet_count ?? 0) + amount;
    const { error: updateErr } = await admin
      .from('medications')
      .update({ current_stock: newStock })
      .eq('id', med.id);
    if (updateErr) {
      console.error('[Patient Stock] Update error:', updateErr);
      return NextResponse.json({ error: 'Failed to update stock.' }, { status: 500 });
    }

    // A caregiver writing to a patient's medical record is exactly what the audit
    // trail exists for.
    await admin.from('audit_logs').insert([{
      user_id: user.id,
      action: 'Refilled patient stock',
      details: {
        medication_id: med.id,
        drug_name: med.drug_name,
        amount_added: amount,
        new_stock: newStock,
        patient_telegram_id: med.telegram_id,
      },
    }]);

    // Tell the patient, in their bell. The point of caregiver refills is that the
    // patient doesn't have to manage stock — not that it changes without their
    // knowledge. Best-effort: a notification failure must not undo a refill that
    // already happened.
    const { data: patientProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('telegram_chat_id', med.telegram_id)
      .maybeSingle();
    if (patientProfile?.id) {
      const caregiverName = profile.full_name || 'Your caregiver';
      const { error: notifyErr } = await admin.from('notifications').insert([{
        user_id: patientProfile.id,
        title: 'Stock refilled',
        message: `${caregiverName} added ${amount} to ${med.drug_name}. You now have ${newStock} in stock.`,
        type: 'LOW_STOCK',
      }]);
      if (notifyErr) console.error('[Patient Stock] Notify error:', notifyErr);
    }

    return NextResponse.json({ success: true, newStock });
  } catch (error) {
    console.error('[Patient Stock] Error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
