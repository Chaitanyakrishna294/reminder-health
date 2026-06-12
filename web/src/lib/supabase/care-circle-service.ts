import { cache } from 'react';
import { createClient } from './server';
import moment from 'moment-timezone';

export interface CareCircleConnection {
  connection_id: string;
  caregiver_chat_id: string | null;
  caregiver_name: string | null;
  patient_telegram_id: string | null;
  connection_status: string;
  is_active: boolean;
  created_at: string;
  relationship_type: string;
  is_primary: boolean;
  can_view_medications: boolean;
  can_view_vault: boolean;
  can_view_reports: boolean;
  can_edit_medications: boolean;
  can_receive_escalations: boolean;
  is_migrated: boolean;
  resolved_name?: string;
  resolved_phone?: string;
}

// 1. Fetch Care Circle connection list for a specific profile (checks both patient and caregiver paths)
export const getCareCircleConnections = cache(async (telegramChatId: string): Promise<{
  peopleICareFor: CareCircleConnection[];
  peopleCaringForMe: CareCircleConnection[];
}> => {
  const supabase = await createClient();

  // Query compatibility read-layer active_caregiver_links
  const { data: links, error } = await supabase
    .from('active_caregiver_links')
    .select('*')
    .eq('is_active', true);

  if (error || !links) {
    console.error('[CareCircleService] Error fetching caregiver links:', error);
    return { peopleICareFor: [], peopleCaringForMe: [] };
  }

  const peopleICareFor: CareCircleConnection[] = [];
  const peopleCaringForMe: CareCircleConnection[] = [];

  // Filter connections dynamically without global switcher state
  const targetTelegramIds: string[] = [];

  links.forEach((link: any) => {
    if (link.caregiver_chat_id === telegramChatId) {
      peopleICareFor.push(link);
      if (link.patient_telegram_id) targetTelegramIds.push(link.patient_telegram_id);
    } else if (link.patient_telegram_id === telegramChatId) {
      peopleCaringForMe.push(link);
      if (link.caregiver_chat_id) targetTelegramIds.push(link.caregiver_chat_id);
    }
  });

  // Fetch profiles in bulk to resolve names and avoid N+1 queries
  if (targetTelegramIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('telegram_chat_id, full_name, phone_number')
      .in('telegram_chat_id', targetTelegramIds);

    if (profiles && profiles.length > 0) {
      const profileMap = new Map(profiles.map(p => [p.telegram_chat_id, p]));
      
      peopleICareFor.forEach(conn => {
        if (conn.patient_telegram_id) {
          const prof = profileMap.get(conn.patient_telegram_id);
          conn.resolved_name = prof ? prof.full_name || 'Patient' : 'Patient';
          conn.resolved_phone = prof ? prof.phone_number || '' : '';
        }
      });

      peopleCaringForMe.forEach(conn => {
        if (conn.caregiver_chat_id) {
          const prof = profileMap.get(conn.caregiver_chat_id);
          conn.resolved_name = prof ? prof.full_name || conn.caregiver_name || 'Caregiver' : conn.caregiver_name || 'Caregiver';
          conn.resolved_phone = prof ? prof.phone_number || '' : '';
        }
      });
    }
  }

  return { peopleICareFor, peopleCaringForMe };
});

// 2. Fetch specific caregiver connection by patient profile id and caregiver profile id
export const getConnectionBetween = cache(async (caregiverProfileId: string, patientProfileId: string) => {
  const supabase = await createClient();
  const { data: connection } = await supabase
    .from('caregiver_connections')
    .select('*')
    .eq('caregiver_profile_id', caregiverProfileId)
    .eq('patient_profile_id', patientProfileId)
    .eq('is_active', true)
    .maybeSingle();
  return connection;
});

// 3. Resolve single relationship metadata by patient telegram chat id
export const getActiveConnectionForPatient = cache(async (caregiverChatId: string, patientChatId: string): Promise<CareCircleConnection | null> => {
  const { peopleICareFor } = await getCareCircleConnections(caregiverChatId);
  return peopleICareFor.find(c => c.patient_telegram_id === patientChatId) || null;
});

// 4. Compile patient health snapshot metrics (reusable helper)
export interface PatientHealthMetrics {
  adherenceRate: number;
  activeMedicationsCount: number;
  minStockDaysRemaining: number;
  missedDosesCountToday: number;
  relationshipHealthScore: number;
  nextScheduledDoseTime: string | null;
  complianceStatus: 'stable' | 'scheduled' | 'missed';
}

export const getPatientHealthMetrics = async (patientChatId: string): Promise<PatientHealthMetrics> => {
  const supabase = await createClient();
  const thirtyDaysAgo = moment().tz('Asia/Kolkata').subtract(30, 'days').toISOString();
  const startOfToday = moment().tz('Asia/Kolkata').startOf('day').toISOString();
  const endOfToday = moment().tz('Asia/Kolkata').endOf('day').toISOString();

  // Fetch medications, logs, and events in parallel
  const [medsResult, logsResult, todayEventsResult] = await Promise.all([
    supabase.from('medications').select('*').eq('telegram_id', patientChatId).eq('active', true),
    supabase.from('reminder_logs').select('response').eq('telegram_id', patientChatId).gte('created_at', thirtyDaysAgo),
    supabase.from('reminder_events').select('*').eq('telegram_id', patientChatId).gte('scheduled_for', startOfToday).lte('scheduled_for', endOfToday)
  ]);

  const medications = medsResult.data || [];
  const logs = logsResult.data || [];
  const todayEvents = todayEventsResult.data || [];

  // Calculate Adherence Rate (30-day compliance)
  const totalLogsCount = logs.length;
  const takenLogsCount = logs.filter(l => l.response === 'TAKEN').length;
  const adherenceRate = totalLogsCount > 0 ? Math.round((takenLogsCount / totalLogsCount) * 100) : 100;

  // Calculate lowest stock count days remaining
  let minStockDaysRemaining = 999;
  medications.forEach(med => {
    if (med.tablet_count !== null && med.tablet_count !== undefined) {
      const tabletsPerDay = med.frequency === 'once_daily' ? 1 : med.frequency === 'twice_daily' ? 2 : med.frequency === 'thrice_daily' ? 3 : 1;
      const days = Math.floor(med.tablet_count / tabletsPerDay);
      if (days < minStockDaysRemaining) {
        minStockDaysRemaining = days;
      }
    }
  });
  if (minStockDaysRemaining === 999) minStockDaysRemaining = 0;

  // Count missed doses today
  const missedDosesCountToday = todayEvents.filter(e => e.reminder_status === 'MISSED' || e.reminder_status === 'SKIPPED').length;

  // Resolve Next Scheduled Dose time
  let nextScheduledDoseTime: string | null = null;
  const futureEvents = todayEvents
    .filter(e => e.reminder_status === 'REMINDED' || e.reminder_status === 'SNOOZED')
    .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
  if (futureEvents.length > 0) {
    nextScheduledDoseTime = moment(futureEvents[0].scheduled_for).tz('Asia/Kolkata').format('h:mm A');
  }

  // Determine compliance status
  let complianceStatus: 'stable' | 'scheduled' | 'missed' = 'stable';
  const hasMissed = todayEvents.some(e => e.reminder_status === 'MISSED' || e.reminder_status === 'ESCALATED_TO_CG');
  if (hasMissed) {
    complianceStatus = 'missed';
  } else if (futureEvents.length > 0) {
    complianceStatus = 'scheduled';
  }

  // Calculate relationship monitoring health score (arbitrary compliance heuristic)
  // Base score 100, deduct for missed doses (-20 each), stock shortage (-10 if <= 3 days), low adherence
  let relationshipHealthScore = 100;
  relationshipHealthScore -= (missedDosesCountToday * 20);
  if (minStockDaysRemaining <= 3 && medications.length > 0) relationshipHealthScore -= 15;
  const adherencePenalty = Math.max(0, 100 - adherenceRate);
  relationshipHealthScore -= Math.round(adherencePenalty * 0.5);
  relationshipHealthScore = Math.max(0, Math.min(100, relationshipHealthScore));

  return {
    adherenceRate,
    activeMedicationsCount: medications.length,
    minStockDaysRemaining,
    missedDosesCountToday,
    relationshipHealthScore,
    nextScheduledDoseTime,
    complianceStatus
  };
};

// 5. Update caregiver connection permissions
export async function updateConnectionPermissions(
  connectionId: string,
  relationshipType: string,
  flags: {
    can_view_medications: boolean;
    can_view_vault: boolean;
    can_view_reports: boolean;
    can_edit_medications: boolean;
    can_receive_escalations: boolean;
  }
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('caregiver_connections')
    .update({
      relationship_type: relationshipType,
      ...flags,
      updated_at: new Date().toISOString()
    })
    .eq('id', connectionId)
    .select()
    .single();

  if (error) {
    console.error('[CareCircleService] Error updating permissions:', error);
    throw error;
  }
  return data;
}

// 6. Promote connection to Primary Caregiver
export async function promoteToPrimaryCaregiver(connectionId: string, patientProfileId: string) {
  const supabase = await createClient();
  
  // We demote any active primary first to respect the unique index constraint
  const { error: demoteError } = await supabase
    .from('caregiver_connections')
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq('patient_profile_id', patientProfileId)
    .eq('is_primary', true)
    .eq('connection_status', 'ACCEPTED')
    .eq('is_active', true);

  if (demoteError) {
    console.error('[CareCircleService] Error demoting previous primary:', demoteError);
    throw demoteError;
  }

  // Promote new caregiver to primary
  const { data, error } = await supabase
    .from('caregiver_connections')
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq('id', connectionId)
    .select()
    .single();

  if (error) {
    console.error('[CareCircleService] Error promoting primary caregiver:', error);
    throw error;
  }
  return data;
}

// 7. Remove caregiver connection (Revoke/disconnect)
export async function removeCaregiverConnection(connectionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('caregiver_connections')
    .update({
      connection_status: 'REJECTED',
      is_active: false,
      is_primary: false,
      updated_at: new Date().toISOString()
    })
    .eq('id', connectionId)
    .select()
    .single();

  if (error) {
    console.error('[CareCircleService] Error removing caregiver connection:', error);
    throw error;
  }
  return data;
}

// 8. Fetch connection consent audit history logs
export interface ConsentAuditLog {
  id: string;
  connection_id: string | null;
  patient_profile_id: string;
  caregiver_profile_id: string;
  action_type: 'GRANTED' | 'MODIFIED' | 'REVOKED' | 'PRIMARY_PROMOTED';
  changed_by: string | null;
  details: {
    before?: Record<string, any>;
    after?: Record<string, any>;
  };
  created_at: string;
  patient_name?: string;
  caregiver_name?: string;
  changed_by_name?: string;
}

export const getConsentHistory = cache(async (profileId: string): Promise<ConsentAuditLog[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('caregiver_connection_audit_logs')
    .select('*')
    .or(`patient_profile_id.eq.${profileId},caregiver_profile_id.eq.${profileId}`)
    .order('created_at', { ascending: false });

  if (error || !data) {
    console.error('[CareCircleService] Error fetching consent audit logs:', error);
    return [];
  }

  const logs = data as ConsentAuditLog[];
  
  // Resolve profile names to prevent N+1 rendering
  const profileIds = new Set<string>();
  logs.forEach(l => {
    profileIds.add(l.patient_profile_id);
    profileIds.add(l.caregiver_profile_id);
    if (l.changed_by) profileIds.add(l.changed_by);
  });

  if (profileIds.size > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', Array.from(profileIds));

    if (profiles) {
      const nameMap = new Map(profiles.map(p => [p.id, p.full_name || 'User']));
      logs.forEach(l => {
        l.patient_name = nameMap.get(l.patient_profile_id) || 'Patient';
        l.caregiver_name = nameMap.get(l.caregiver_profile_id) || 'Caregiver';
        if (l.changed_by) l.changed_by_name = nameMap.get(l.changed_by) || 'User';
      });
    }
  }

  return logs;
});
