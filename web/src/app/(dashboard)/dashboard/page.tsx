import React from 'react';
import { createClient } from '@/lib/supabase/server';
import DashboardClientView from '@/components/dashboard/dashboard-client-view';
import { ReminderEvent } from '@/components/dashboard/todays-schedule';
import { resolveUserData } from '@/lib/supabase/cached-queries';
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
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [medsResult, eventsResult, logsResult, monthlyLogsResult] = await Promise.all([
    supabase
      .from('medications')
      .select('id, drug_name, dosage, frequency, tablet_count, low_stock_alert_enabled, reminder_times, priority_level')
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
          priority_level
        )
      `)
      .eq('telegram_id', targetChatId)
      .gte('scheduled_for', startOfToday)
      .lte('scheduled_for', endOfToday)
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

  // Dynamically generate virtual pending events for future scheduled reminder times today
  const finalEvents: ReminderEvent[] = [...todayEvents];
  if (medications && medications.length > 0 && targetChatId) {
    medications.forEach((med) => {
      const times = (med.reminder_times || []) as string[];
      times.forEach((timeStr) => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        
        // Construct local time for this dose today
        const reminderDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        
        // Check if an actual event was already created for this medication at this time today
        const eventExists = todayEvents.some((e) => {
          const eDate = new Date(e.scheduled_for);
          return (
            e.medication_id === med.id &&
            eDate.getHours() === hours &&
            eDate.getMinutes() === minutes
          );
        });

        if (!eventExists) {
          const virtualId = -(med.id * 1000 + hours * 60 + minutes);
          finalEvents.push({
            id: virtualId,
            medication_id: med.id,
            telegram_id: targetChatId,
            scheduled_for: reminderDate.toISOString(),
            reminder_status: 'FUTURE_SCHEDULED',
            snooze_count: 0,
            medications: {
              drug_name: med.drug_name,
              dosage: med.dosage || 'N/A',
              priority_level: med.priority_level || 'normal',
            },
          });
        }
      });
    });

    // Sort all events chronologically
    finalEvents.sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
  }

  const totalMonthlyDoses = monthlyLogs?.length || 0;
  const takenMonthlyDoses = monthlyLogs?.filter(l => l.response === 'TAKEN').length || 0;
  const monthlyAdherence = totalMonthlyDoses > 0 ? Math.round((takenMonthlyDoses / totalMonthlyDoses) * 100) : 100;

  // Active alerts (Low stock)
  const lowStockMedicines = (medications || [])
    .filter(m => {
      const tabletsPerDay = m.frequency === 'once_daily' ? 1 : m.frequency === 'twice_daily' ? 2 : m.frequency === 'thrice_daily' ? 3 : 1;
      const daysRemaining = Math.floor(m.tablet_count / tabletsPerDay);
      return daysRemaining <= 3 && m.low_stock_alert_enabled;
    })
    .map(m => ({ drug_name: m.drug_name, tablet_count: m.tablet_count }));

  const lowStockCount = lowStockMedicines.length;

  // Today's metrics
  const todayTotal = finalEvents.length;
  const todayTaken = finalEvents.filter(e => e.reminder_status === 'TAKEN' || e.reminder_status === 'RESOLVED_BY_CG').length;
  const todaySkipped = finalEvents.filter(e => e.reminder_status === 'SKIPPED').length;
  const todayMissed = finalEvents.filter(e => e.reminder_status === 'MISSED').length;
  const activeEscalations = finalEvents.filter(e => e.reminder_status === 'ESCALATED_TO_CG').length;

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

  const lastTaken = takenLogs.length > 0 ? {
    drug_name: Array.isArray(takenLogs[0].medications)
      ? (takenLogs[0].medications[0]?.drug_name || 'Medication')
      : (takenLogs[0].medications as any)?.drug_name || 'Medication',
    time: new Date(takenLogs[0].scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } : null;

  return (
    <DashboardClientView 
      userRole={userRole}
      userName={profile.full_name || 'User'}
      patientName={patientName}
      monthlyAdherence={monthlyAdherence}
      todayTaken={todayTaken}
      todayTotal={todayTotal}
      todaySkipped={todaySkipped}
      todayMissed={todayMissed}
      activeEscalations={activeEscalations}
      lowStockCount={lowStockCount}
      todayEvents={finalEvents}
      myTelegramChatId={myTelegramChatId || ''}
      targetTelegramChatId={targetChatId || ''}
      chartData={chartData}
      lowStockMedicines={lowStockMedicines}
      hasPatientLinked={!!targetChatId}
      caregiverId={caregiverId}
      lastTaken={lastTaken}
    />
  );
}
