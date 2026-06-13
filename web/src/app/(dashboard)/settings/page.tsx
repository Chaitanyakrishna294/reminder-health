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

  let linkedCaregivers: any[] = [];
  let caregiverRecord = null;
  let linkedPatientProfile = null;

  // Sprint 5.6C: Dual-source resolution
  // Check caregiver_connections first (new architecture), fall back to caregiver_info (legacy)

  // Load incoming caregiver connections (where I am the patient)
  const { data: ccData } = await supabase
    .from('caregiver_connections')
    .select(`
      id,
      caregiver_profile_id,
      connection_status,
      relationship_type,
      is_primary,
      can_view_medications,
      can_receive_escalations,
      can_view_reports,
      can_view_vault,
      can_edit_medications,
      created_at
    `)
    .eq('patient_profile_id', user.id)
    .eq('is_active', true)
    .in('connection_status', ['PENDING', 'ACCEPTED'])
    .order('created_at', { ascending: false });

  if (ccData && ccData.length > 0) {
    const caregiverIds = ccData.map(cc => cc.caregiver_profile_id);
    const { data: cgProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, telegram_chat_id')
      .in('id', caregiverIds);

    const profileMap = new Map(cgProfiles?.map(p => [p.id, p]) || []);

    const cgChatIds = cgProfiles?.map(p => p.telegram_chat_id).filter(Boolean) || [];
    let cgInfoMap = new Map();
    if (cgChatIds.length > 0) {
      const { data: cgInfos } = await supabase
        .from('caregiver_info')
        .select('caregiver_chat_id, caregiver_id')
        .in('caregiver_chat_id', cgChatIds)
        .eq('is_active', true);
      if (cgInfos) {
        cgInfoMap = new Map(cgInfos.map(info => [info.caregiver_chat_id, info.caregiver_id]));
      }
    }

    linkedCaregivers = ccData.map(cc => {
      const cgProfile = profileMap.get(cc.caregiver_profile_id);
      const cgChatId = cgProfile?.telegram_chat_id || '';
      const cgId = cgInfoMap.get(cgChatId) || '';
      return {
        id: cc.id,
        caregiver_id: cgId,
        caregiver_name: cgProfile?.full_name || 'Caregiver',
        caregiver_chat_id: cgChatId,
        connection_status: cc.connection_status,
        source: 'connections' as const,
      };
    });
  } else if (myTelegramChatId) {
    const { data } = await supabase
      .from('caregiver_info')
      .select('id, caregiver_id, caregiver_name, caregiver_chat_id, connection_status')
      .eq('patient_telegram_id', myTelegramChatId)
      .eq('is_active', true);
    if (data) {
      linkedCaregivers = data.map(d => ({ ...d, source: 'legacy' as const }));
    }
  }

  // Load outgoing caregiver details (where I am the caregiver)
  if (myTelegramChatId) {
    const { data } = await supabase
      .from('caregiver_info')
      .select('id, caregiver_id, patient_telegram_id, connection_status')
      .eq('caregiver_chat_id', myTelegramChatId)
      .eq('is_active', true)
      .maybeSingle();
    caregiverRecord = data;

    const { data: ccOutgoing } = await supabase
      .from('caregiver_connections')
      .select('id, patient_profile_id, connection_status, created_at')
      .eq('caregiver_profile_id', user.id)
      .eq('is_active', true)
      .in('connection_status', ['PENDING', 'ACCEPTED'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ccOutgoing) {
      const { data: patientProf } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', ccOutgoing.patient_profile_id)
        .single();
      linkedPatientProfile = patientProf;
    } else if (caregiverRecord && caregiverRecord.patient_telegram_id) {
      const { data: patientProf } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('telegram_chat_id', caregiverRecord.patient_telegram_id)
        .maybeSingle();
      linkedPatientProfile = patientProf;
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
      linkedCaregivers={linkedCaregivers}
      caregiverRecord={caregiverRecord}
      linkedPatientName={linkedPatientProfile?.full_name || null}
    />
  );
}
