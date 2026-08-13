import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-role';
import PullToRefresh from '@/components/dashboard/pull-to-refresh';
import DashboardClientView from '@/components/dashboard/dashboard-client-view';
import { ReminderEvent } from '@/components/dashboard/todays-schedule';
import { resolveUserData, getMedicalProfile } from '@/lib/supabase/cached-queries';
import { getCareCircleConnections } from '@/lib/supabase/care-circle-service';
import { isLowStock, type LowStockMed } from '@/lib/medications/stock';
import { Stethoscope } from 'lucide-react';


export const revalidate = 0; // Dynamic rendering, always fresh

export default async function DashboardPage() {
  const userData = await resolveUserData();
  if (!userData) return null;

  const { user, profile, userRole, myTelegramChatId, targetChatId, patientName } = userData;

  // Caregivers and Patients share the layout; unlinked status is evaluated inside the client view to support role switching
  const caregiverId = profile.telegram_chat_id ? `CG${profile.telegram_chat_id.substring(0, 6)}` : 'N/A';

  const supabase = await createClient();

  // Logged-in user's profile photo for the greeting avatar (private bucket → signed URL).
  let avatarUrl: string | null = null;
  const ownMedical = await getMedicalProfile(user.id);
  if (ownMedical?.avatar_path) {
    const { data: signed } = await supabase.storage
      .from('avatars')
      .createSignedUrl(ownMedical.avatar_path, 600);
    avatarUrl = signed?.signedUrl ?? null;
  }

  // 3. Fetch data for target patient in parallel
  const now = new Date();
  // The day rail's date row shows the last 7 days, so the window reaches back 8 —
  // one spare day because a day boundary is per-medication (its own timezone), and
  // a dose at 00:30 IST on the oldest visible day is still the previous UTC day.
  // Forward stays at 24 hours: tomorrow is not selectable, but today's later doses
  // must survive a viewer whose clock sits behind the medication's zone.
  const startOfWindow = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const endOfWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [medsResult, eventsResult, logsResult, monthlyLogsResult] = await Promise.all([
    supabase
      .from('medications')
      .select('id, drug_name, dosage, frequency, tablet_count, current_stock, stock_threshold, low_stock_alert_enabled, active, reminder_times, priority_level, unit_type, dosage_amount, medication_reason, timezone, dose_days')
      .eq('telegram_id', targetChatId)
      .eq('active', true),
    supabase
      .from('reminder_events')
      .select(`
        id,
        medication_id,
        telegram_id,
        scheduled_for,
        reminder_status,
        snooze_count,
        medications:medication_id (
          drug_name,
          dosage,
          priority_level,
          unit_type,
          dosage_amount,
          medication_reason
        )
      `)
      .eq('telegram_id', targetChatId)
      .gte('scheduled_for', startOfWindow)
      .lte('scheduled_for', endOfWindow)
      .order('scheduled_for', { ascending: true }),
    supabase
      .from('reminder_logs')
      .select('id, response, scheduled_time, drug_name_snapshot, medications(drug_name)')
      .eq('telegram_id', targetChatId)
      .gte('scheduled_time', sevenDaysAgo.toISOString())
      .order('scheduled_time', { ascending: true }),
    supabase
      .from('reminder_logs')
      .select('response')
      .eq('telegram_id', targetChatId)
      .gte('created_at', thirtyDaysAgo.toISOString())
  ]);

  const medications = medsResult.data;
  const rawEvents = eventsResult.data;
  const logs = logsResult.data;
  const monthlyLogs = monthlyLogsResult.data;

  // Drop events whose medication no longer exists. Deleting a medication now nulls
  // medication_id instead of cascading away the dose history (see
  // migration_preserve_dose_history.sql), so the joined `medications` comes back null
  // and every consumer that reads event.medications.priority_level threw.
  //
  // Filtered here rather than null-guarded at ~28 call sites, because the semantics are
  // the point: a deleted medication is not something you can still take, so it does not
  // belong in today's actionable list. Its history survives in reminder_logs, which
  // adherence reads WITHOUT joining medications — so the record stays intact.
  //
  // Named `recentEvents`, not `todayEvents`: it now spans 8 days. The old name was
  // accurate when the window was ±24h and would be a trap here — the client splits
  // this into today (which drives the dose gate) and the past days the rail can show,
  // and confusing the two would let the gate ask about a dose from last Tuesday.
  const recentEvents = ((rawEvents || []) as unknown as ReminderEvent[])
    .filter(e => e.medications != null);

  const totalMonthlyDoses = monthlyLogs?.length || 0;
  const takenMonthlyDoses = monthlyLogs?.filter(l => l.response === 'TAKEN').length || 0;
  const monthlyAdherence = totalMonthlyDoses > 0 ? Math.round((takenMonthlyDoses / totalMonthlyDoses) * 100) : 100;

  // Low stock — one shared definition (web/src/lib/medications/stock.ts), mirrored in
  // the bot. This used to re-type a 3-day heuristic inline and never read
  // stock_threshold at all, so the value the user set in the wizard did nothing.
  const lowStockMedicines: LowStockMed[] = (medications || [])
    .map((m) => ({ med: m, status: isLowStock(m) }))
    .filter(({ status }) => status.low)
    .map(({ med, status }) => ({
      id: med.id,
      drug_name: med.drug_name,
      unit_type: med.unit_type ?? null,
      stock: Number(status.stock),
      threshold: status.threshold,
      daysLeft: status.daysLeft,
      reason: status.reason as 'threshold' | 'days',
    }));

  const lowStockCount = lowStockMedicines.length;

  // Adding stock is a medication write. A caregiver in monitor mode only has it with
  // can_edit_medications; without it the gate must say so rather than offer an input
  // that dies on RLS.
  let canEditStock = true;
  if (targetChatId && myTelegramChatId && targetChatId !== myTelegramChatId) {
    const { data: link } = await supabase
      .from('active_caregiver_links')
      .select('can_edit_medications')
      .eq('caregiver_chat_id', myTelegramChatId)
      .eq('patient_telegram_id', targetChatId)
      .eq('is_active', true)
      .maybeSingle();
    canEditStock = !!link?.can_edit_medications;
  }

  // The 7-day chart aggregation lived here, feeding the dashboard's Health Insights
  // card. Both removed 2026-08-12: the compliance ring is the adherence surface now,
  // and computing a `chartData` prop nothing renders is work on every dashboard load.
  // `logs` is still fetched — `takenLogs` below needs it.

  // Find last medication taken from logs
  const takenLogs = (logs || [])
    .filter(l => l.response === 'TAKEN')
    .sort((a, b) => new Date(b.scheduled_time).getTime() - new Date(a.scheduled_time).getTime());

  // Pass raw scheduled_time to avoid timezone formatting mismatch on the server
  const lastTaken = takenLogs.length > 0 ? {
    // Live medication first, then the name captured when the dose was logged. The
    // snapshot is what keeps history readable after a medication is deleted — without
    // it this degrades to "Medication", recording that a dose was taken but not of what.
    drug_name: (Array.isArray(takenLogs[0].medications)
      ? takenLogs[0].medications[0]?.drug_name
      : (takenLogs[0].medications as any)?.drug_name)
      || (takenLogs[0] as any).drug_name_snapshot
      || 'Medication',
    time: takenLogs[0].scheduled_time
  } : null;

  // Fetch active caregiver connections split into dual lists
  let peopleICareFor: any[] = [];
  let peopleCaringForMe: any[] = [];
  if (myTelegramChatId) {
    const connectionsData = await getCareCircleConnections(myTelegramChatId);
    peopleICareFor = connectionsData.peopleICareFor;
    peopleCaringForMe = connectionsData.peopleCaringForMe;
  }

  // Photos for the Care Circle card, keyed by telegram id.
  //
  // The avatars bucket is owner-only, so a URL for somebody else has to be minted with
  // the service client — and only where that person left the share toggle on. The flag
  // now covers BOTH directions by product decision (2026-08-09): the Medical Profile
  // toggle reads "Show my photo to my care circle", and it governs a patient's photo
  // shown to caregivers AND a caregiver's photo shown to their patients. One switch,
  // one meaning; the column name predates the broadening.
  const careCircleAvatars: Record<string, string> = {};
  const patientIds = [
    ...peopleICareFor.map(c => c.patient_telegram_id),
    ...peopleCaringForMe.map(c => c.caregiver_chat_id),
  ].filter((id): id is string => Boolean(id));
  if (patientIds.length > 0) {
    try {
      const admin = createServiceClient();
      const { data: profs } = await admin
        .from('profiles')
        .select('id, telegram_chat_id')
        .in('telegram_chat_id', patientIds);
      if (profs?.length) {
        const telegramById = new Map(profs.map(p => [p.id, p.telegram_chat_id]));
        const { data: medicals } = await admin
          .from('medical_profiles')
          .select('user_id, avatar_path, share_photo_with_caregivers')
          .in('user_id', profs.map(p => p.id));
        for (const mp of medicals ?? []) {
          if (!mp.avatar_path || mp.share_photo_with_caregivers === false) continue;
          const telegramId = telegramById.get(mp.user_id);
          if (!telegramId) continue;
          const { data: signed } = await admin.storage
            .from('avatars')
            .createSignedUrl(mp.avatar_path, 600);
          if (signed?.signedUrl) careCircleAvatars[telegramId] = signed.signedUrl;
        }
      }
    } catch (err) {
      // A missing photo must never take the dashboard down with it.
      console.error('Failed to resolve care circle avatars:', err);
    }
  }

  return (
    // Today is the one screen whose truth can change elsewhere — a caregiver's
    // phone, a Telegram reply, a dose the device queued offline. Pulling down is
    // what people already try when they doubt it.
    <PullToRefresh>
    <DashboardClientView 
      userRole={userRole}
      userName={profile.full_name || 'User'}
      avatarUrl={avatarUrl}
      patientName={patientName}
      monthlyAdherence={monthlyAdherence}
      todayTaken={0}
      todayTotal={0}
      todaySkipped={0}
      todayMissed={0}
      activeEscalations={0}
      lowStockCount={lowStockCount}
      recentEvents={recentEvents}
      medications={medications || []}
      myTelegramChatId={myTelegramChatId || ''}
      targetTelegramChatId={targetChatId || ''}
      lowStockMedicines={lowStockMedicines}
      canEditStock={canEditStock}
      hasPatientLinked={!!targetChatId}
      caregiverId={caregiverId}
      lastTaken={lastTaken}
      peopleICareFor={peopleICareFor}
      peopleCaringForMe={peopleCaringForMe}
      careCircleAvatars={careCircleAvatars}
    />
    </PullToRefresh>
  );
}

