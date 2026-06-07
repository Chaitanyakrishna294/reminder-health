import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import SettingsClientView from './settings-client-view';

export const revalidate = 0; // Dynamic rendering, always fresh

export default async function SettingsPage() {
  const userData = await resolveUserData();
  if (!userData) {
    redirect('/login');
  }

  const { user, profile, userRole, myTelegramChatId } = userData;

  const supabase = await createClient();

  let linkedCaregiver = null;
  let caregiverRecord = null;
  let linkedPatientProfile = null;

  if (userRole === 'PATIENT') {
    if (myTelegramChatId) {
      // Find caregiver linked to this patient
      const { data } = await supabase
        .from('caregiver_info')
        .select('id, caregiver_id, caregiver_name, caregiver_chat_id, connection_status')
        .eq('patient_telegram_id', myTelegramChatId)
        .eq('is_active', true)
        .maybeSingle();
      linkedCaregiver = data;
    }
  } else {
    if (myTelegramChatId) {
      // Find caregiver record for this caregiver
      const { data } = await supabase
        .from('caregiver_info')
        .select('id, caregiver_id, patient_telegram_id, connection_status')
        .eq('caregiver_chat_id', myTelegramChatId)
        .eq('is_active', true)
        .maybeSingle();
      caregiverRecord = data;

      if (caregiverRecord && caregiverRecord.patient_telegram_id) {
        // Fetch patient profile name
        const { data: patientProf } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('telegram_chat_id', caregiverRecord.patient_telegram_id)
          .maybeSingle();
        linkedPatientProfile = patientProf;
      }
    }
  }

  return (
    <SettingsClientView
      user={{
        id: user.id,
        email: user.email!,
        fullName: profile.full_name || 'User',
        role: userRole,
        telegramChatId: myTelegramChatId || '',
      }}
      linkedCaregiver={linkedCaregiver}
      caregiverRecord={caregiverRecord}
      linkedPatientName={linkedPatientProfile?.full_name || null}
    />
  );
}
