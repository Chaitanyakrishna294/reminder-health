import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import MedicationList, { Medication } from '@/components/medications/medication-list';
import { resolveUserData } from '@/lib/supabase/cached-queries';

export const revalidate = 0; // Dynamic rendering, always fresh

export default async function MedicationsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');

  const { user, profile, userRole, myTelegramChatId, targetChatId, patientName } = userData;

  const supabase = await createClient();

  // 3. Fetch target patient medications (if linked)
  const { data: medications } = targetChatId
    ? await supabase
        .from('medications')
        .select('id, telegram_id, drug_name, dosage, frequency, reminder_times, tablet_count, priority_level, next_reminder_at, active, unit_type, dosage_amount, current_stock, stock_threshold, medication_reason')
        .eq('telegram_id', targetChatId)
    : { data: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">
          {userRole === 'CAREGIVER' ? `${patientName}'s Medications` : 'My Medications'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {userRole === 'CAREGIVER'
            ? 'Manage and schedule reminder routines for your linked patient.'
            : 'Configure your dosage intervals, timings, and tablet inventory logs.'}
        </p>
      </div>

      <MedicationList
        initialMeds={(medications || []) as Medication[]}
        targetTelegramChatId={targetChatId || ''}
        myTelegramChatId={myTelegramChatId || ''}
        userRole={userRole}
      />
    </div>
  );
}
