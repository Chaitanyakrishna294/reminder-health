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

  // Sprint 5.6C: Dual-source resolution
  // Check caregiver_connections first (new architecture), fall back to caregiver_info (legacy)

  // These five queries are independent of each other (each depends only on user.id /
  // myTelegramChatId, already known above) — firing them together instead of one-by-one
  // turns ~5 sequential round trips into 1, which is most of this page's load time.
  const [
    { data: codeRow },
    { data: ccData },
    { data: legacyCaregiverInfo },
    { data: cgInfo },
    { data: links },
  ] = await Promise.all([
    // The user's universal Connect Code (shareable to link any account type).
    supabase.from('profiles').select('connect_code').eq('id', user.id).maybeSingle(),
    // Load incoming caregiver connections (where I am the patient)
    supabase
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
      .order('created_at', { ascending: false }),
    // Legacy incoming-caregiver fallback, fetched unconditionally alongside ccData (rather
    // than only after ccData comes back empty) so this branch costs no extra round trip —
    // only used below if ccData turns out empty.
    myTelegramChatId
      ? supabase
          .from('caregiver_info')
          .select('id, caregiver_id, caregiver_name, caregiver_chat_id, connection_status')
          .eq('patient_telegram_id', myTelegramChatId)
          .eq('is_active', true)
      : Promise.resolve({ data: null as any[] | null }),
    // Caregiver ID registration record (where I am the caregiver)
    myTelegramChatId
      ? supabase
          .from('caregiver_info')
          .select('id, caregiver_id, caregiver_chat_id, is_active')
          .eq('caregiver_chat_id', myTelegramChatId)
          .eq('is_active', true)
          .maybeSingle()
      : Promise.resolve({ data: null as any }),
    // Outgoing patient connections (where I am the caregiver), via unified compatibility view
    myTelegramChatId
      ? supabase
          .from('active_caregiver_links')
          .select('connection_id, patient_telegram_id, connection_status, is_migrated')
          .eq('caregiver_chat_id', myTelegramChatId)
          .eq('is_active', true)
          .in('connection_status', ['PENDING', 'ACCEPTED'])
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: null as any[] | null }),
  ]);

  const connectCode: string = codeRow?.connect_code || '';
  const caregiverRecord = cgInfo;

  // The two dependent chains below (each needing a follow-up query keyed off the results
  // above) are independent of each other, so resolve them in parallel too.
  const [linkedCaregivers, linkedPatients] = await Promise.all([
    resolveLinkedCaregivers(supabase, ccData, legacyCaregiverInfo),
    resolveLinkedPatients(supabase, links),
  ]);

  return (
    <SettingsClientView
      user={{
        id: user.id,
        email: user.email!,
        fullName: profile.full_name || 'User',
        role: userRole,
        telegramChatId: myTelegramChatId || '',
        connectCode,
      }}
      linkedCaregivers={linkedCaregivers}
      caregiverRecord={caregiverRecord}
      linkedPatients={linkedPatients}
    />
  );
}

async function resolveLinkedCaregivers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ccData: any[] | null,
  legacyCaregiverInfo: any[] | null,
): Promise<any[]> {
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

    return ccData.map(cc => {
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
  }

  if (legacyCaregiverInfo) {
    return legacyCaregiverInfo.map(d => ({ ...d, source: 'legacy' as const }));
  }

  return [];
}

async function resolveLinkedPatients(
  supabase: Awaited<ReturnType<typeof createClient>>,
  links: any[] | null,
): Promise<any[]> {
  if (!links || links.length === 0) return [];

  const patientChatIds = links.map(l => l.patient_telegram_id).filter(Boolean);

  const { data: patientProfiles } = await supabase
    .from('profiles')
    .select('id, full_name, telegram_chat_id')
    .in('telegram_chat_id', patientChatIds);

  const profileMap = new Map(patientProfiles?.map(p => [p.telegram_chat_id, p]) || []);

  return links.map(link => {
    const prof = profileMap.get(link.patient_telegram_id);
    return {
      id: link.connection_id,
      patient_profile_id: prof?.id || null,
      patient_name: prof?.full_name || 'Patient',
      patient_telegram_id: link.patient_telegram_id,
      connection_status: link.connection_status,
      source: link.is_migrated ? ('connections' as const) : ('legacy' as const),
    };
  });
}
