import React from 'react';
import { createClient } from '@/lib/supabase/server';
import DashboardClientView from '@/components/dashboard/dashboard-client-view';
import { ReminderEvent } from '@/components/dashboard/todays-schedule';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import { getCareCircleConnections } from '@/lib/supabase/care-circle-service';
import { Stethoscope } from 'lucide-react';


export const revalidate = 0; // Dynamic rendering, always fresh

export default async function DashboardPage() {
  const userData = await resolveUserData();
  if (!userData) return null;

  const { user, profile, userRole, myTelegramChatId, targetChatId, patientName } = userData;

  // Caregivers and Patients share the layout; unlinked status is evaluated inside the client view to support role switching
  const caregiverId = profile.telegram_chat_id ? `CG${profile.telegram_chat_id.substring(0, 6)}` : 'N/A';

  const supabase = await createClient();

  // 3. Fetch data for target patient in parallel
  const now = new Date();
  // Query a 48-hour window (24 hours before/after now) to ensure timezone changes don't drop events
  const startOfWindow = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const endOfWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [medsResult, eventsResult, logsResult, monthlyLogsResult] = await Promise.all([
    supabase
      .from('medications')
      .select('id, drug_name, dosage, frequency, tablet_count, low_stock_alert_enabled, reminder_times, priority_level, unit_type, dosage_amount, medication_reason')
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
      .select('id, response, scheduled_time, medications(drug_name)')
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

  const todayEvents = (rawEvents || []) as unknown as ReminderEvent[];

  const totalMonthlyDoses = monthlyLogs?.length || 0;
  const takenMonthlyDoses = monthlyLogs?.filter(l => l.response === 'TAKEN').length || 0;
  const monthlyAdherence = totalMonthlyDoses > 0 ? Math.round((takenMonthlyDoses / totalMonthlyDoses) * 100) : 100;

  // Active alerts (Low stock)
  const lowStockMedicines = (medications || [])
    .filter(m => {
      if (m.tablet_count === null || m.tablet_count === undefined) return false;
      const tabletsPerDay = m.frequency === 'once_daily' ? 1 : m.frequency === 'twice_daily' ? 2 : m.frequency === 'thrice_daily' ? 3 : 1;
      const daysRemaining = Math.floor(m.tablet_count / tabletsPerDay);
      return daysRemaining <= 3 && m.low_stock_alert_enabled;
    })
    .map(m => ({ drug_name: m.drug_name, tablet_count: m.tablet_count }));

  const lowStockCount = lowStockMedicines.length;

  // Group 7-day chart data points
  const chartDataMap: { [key: string]: { Taken: number; Skipped: number; Missed: number } } = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    chartDataMap[dateStr] = { Taken: 0, Skipped: 0, Missed: 0 };
  }

  logs?.forEach(log => {
    const dateStr = new Date(log.scheduled_time).toLocaleDateString([], { month: 'short', day: 'numeric' });
    if (chartDataMap[dateStr]) {
      if (log.response === 'TAKEN') chartDataMap[dateStr].Taken += 1;
      else if (log.response === 'SKIP') chartDataMap[dateStr].Skipped += 1;
      else if (log.response === 'MISSED') chartDataMap[dateStr].Missed += 1;
    }
  });

  const chartData = Object.entries(chartDataMap).map(([date, counts]) => ({
    date,
    ...counts
  }));

  // Find last medication taken from logs
  const takenLogs = (logs || [])
    .filter(l => l.response === 'TAKEN')
    .sort((a, b) => new Date(b.scheduled_time).getTime() - new Date(a.scheduled_time).getTime());

  // Pass raw scheduled_time to avoid timezone formatting mismatch on the server
  const lastTaken = takenLogs.length > 0 ? {
    drug_name: Array.isArray(takenLogs[0].medications)
      ? (takenLogs[0].medications[0]?.drug_name || 'Medication')
      : (takenLogs[0].medications as any)?.drug_name || 'Medication',
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

  return (
    <DashboardClientView 
      userRole={userRole}
      userName={profile.full_name || 'User'}
      patientName={patientName}
      monthlyAdherence={monthlyAdherence}
      todayTaken={0}
      todayTotal={0}
      todaySkipped={0}
      todayMissed={0}
      activeEscalations={0}
      lowStockCount={lowStockCount}
      todayEvents={todayEvents}
      medications={medications || []}
      myTelegramChatId={myTelegramChatId || ''}
      targetTelegramChatId={targetChatId || ''}
      chartData={chartData}
      lowStockMedicines={lowStockMedicines}
      hasPatientLinked={!!targetChatId}
      caregiverId={caregiverId}
      lastTaken={lastTaken}
      peopleICareFor={peopleICareFor}
      peopleCaringForMe={peopleCaringForMe}
    />
  );
}

