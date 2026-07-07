'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { 
  ArrowLeft, 
  Settings, 
  Stethoscope, 
  Trash2, 
  ShieldAlert, 
  CheckCircle, 
  Clock, 
  Heart,
  HeartOff,
  Calendar,
  FileText,
  UserCheck,
  UserX,
  History,
  Info
} from 'lucide-react';
import moment from 'moment-timezone';

interface CareCircleConnection {
  connection_id: string;
  caregiver_chat_id: string | null;
  caregiver_name: string | null;
  patient_telegram_id: string | null;
  connection_status: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  relationship_type: string;
  is_primary: boolean;
  can_view_medications: boolean;
  can_view_vault: boolean;
  can_view_reports: boolean;
  can_edit_medications: boolean;
  can_receive_escalations: boolean;
  can_view_medical_profile: boolean;
  resolved_name?: string;
}

interface ConsentAuditLog {
  id: string;
  action_type: 'GRANTED' | 'MODIFIED' | 'REVOKED' | 'PRIMARY_PROMOTED';
  created_at: string;
  patient_name: string;
  caregiver_name: string;
  details: {
    before?: Record<string, any>;
    after?: Record<string, any>;
  };
}

type PermissionPreset = 'BASIC' | 'FAMILY' | 'FULL' | 'CUSTOM';

const PERMISSION_PRESETS = {
  BASIC: {
    name: 'Basic Support',
    flags: {
      can_view_medications: true,
      can_view_vault: false,
      can_view_reports: false,
      can_edit_medications: false,
      can_receive_escalations: true,
      can_view_medical_profile: false,
    }
  },
  FAMILY: {
    name: 'Family Support',
    flags: {
      can_view_medications: true,
      can_view_vault: false,
      can_view_reports: true,
      can_edit_medications: false,
      can_receive_escalations: true,
      can_view_medical_profile: true,
    }
  },
  FULL: {
    name: 'Full Support',
    flags: {
      can_view_medications: true,
      can_view_vault: true,
      can_view_reports: true,
      can_edit_medications: true,
      can_receive_escalations: true,
      can_view_medical_profile: true,
    }
  },
  CUSTOM: {
    name: 'Custom Support',
    flags: {}
  }
};

export default function SharedTrustCenter() {
  const supabase = createClient();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [peopleSupportingMe, setPeopleSupportingMe] = useState<CareCircleConnection[]>([]);
  const [peopleISupport, setPeopleISupport] = useState<CareCircleConnection[]>([]);
  const [auditLogs, setAuditLogs] = useState<ConsentAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal / Editor State
  const [editingConnection, setEditingConnection] = useState<CareCircleConnection | null>(null);
  const [editPreset, setEditPreset] = useState<PermissionPreset>('BASIC');
  const [editRelationship, setEditRelationship] = useState<string>('OTHER');
  const [editFlags, setEditFlags] = useState<Record<string, boolean>>({});

  const resolvePreset = (conn: CareCircleConnection): PermissionPreset => {
    const isBasic = conn.can_view_medications && !conn.can_view_vault && !conn.can_view_reports && !conn.can_edit_medications && conn.can_receive_escalations;
    if (isBasic) return 'BASIC';
    
    const isFamily = conn.can_view_medications && !conn.can_view_vault && conn.can_view_reports && !conn.can_edit_medications && conn.can_receive_escalations;
    if (isFamily) return 'FAMILY';
    
    const isFull = conn.can_view_medications && conn.can_view_vault && conn.can_view_reports && conn.can_edit_medications && conn.can_receive_escalations;
    if (isFull) return 'FULL';
    
    return 'CUSTOM';
  };

  const fetchTrustData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUser(user);

      // Resolve user's telegram ID
      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_chat_id')
        .eq('id', user.id)
        .single();

      if (!profile?.telegram_chat_id) return;
      const myTelegramId = profile.telegram_chat_id;

      // Fetch active caregiver connections
      const { data: links, error: linksErr } = await supabase
        .from('active_caregiver_links')
        .select('*')
        .eq('is_active', true);

      if (linksErr) throw linksErr;

      const supportingMe: CareCircleConnection[] = [];
      const iSupport: CareCircleConnection[] = [];
      const partnerTelegramIds: string[] = [];

      links.forEach((link: any) => {
        if (link.caregiver_chat_id === myTelegramId) {
          iSupport.push(link);
          if (link.patient_telegram_id) partnerTelegramIds.push(link.patient_telegram_id);
        } else if (link.patient_telegram_id === myTelegramId) {
          supportingMe.push(link);
          if (link.caregiver_chat_id) partnerTelegramIds.push(link.caregiver_chat_id);
        }
      });

      // Fetch profile names in bulk
      if (partnerTelegramIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('telegram_chat_id, full_name')
          .in('telegram_chat_id', partnerTelegramIds);

        if (profiles) {
          const profileMap = new Map(profiles.map(p => [p.telegram_chat_id, p.full_name || 'User']));
          supportingMe.forEach(c => {
            if (c.caregiver_chat_id) c.resolved_name = profileMap.get(c.caregiver_chat_id) || c.caregiver_name || 'Caregiver';
          });
          iSupport.forEach(c => {
            if (c.patient_telegram_id) c.resolved_name = profileMap.get(c.patient_telegram_id) || 'Patient';
          });
        }
      }

      setPeopleSupportingMe(supportingMe);
      setPeopleISupport(iSupport);

      // Fetch Consent History Logs
      const { data: rawLogs, error: logsErr } = await supabase
        .from('caregiver_connection_audit_logs')
        .select('*')
        .or(`patient_profile_id.eq.${user.id},caregiver_profile_id.eq.${user.id}`)
        .order('created_at', { ascending: false })
        .limit(10);

      if (logsErr) throw logsErr;

      if (rawLogs && rawLogs.length > 0) {
        const userIds = new Set<string>();
        rawLogs.forEach((l: any) => {
          userIds.add(l.patient_profile_id);
          userIds.add(l.caregiver_profile_id);
        });

        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', Array.from(userIds));

        const nameMap = new Map(profiles?.map(p => [p.id, p.full_name || 'User']) || []);

        setAuditLogs(rawLogs.map((l: any) => ({
          ...l,
          patient_name: nameMap.get(l.patient_profile_id) || 'Patient',
          caregiver_name: nameMap.get(l.caregiver_profile_id) || 'Caregiver',
        })));
      } else {
        setAuditLogs([]);
      }

    } catch (err) {
      console.error('[SharedTrust] Fetch error:', err);
      setErrorMsg('Failed to load trust center settings.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchTrustData();
  }, [fetchTrustData]);

  // Actions
  const handleOpenEdit = (conn: CareCircleConnection) => {
    setEditingConnection(conn);
    setEditRelationship(conn.relationship_type);
    const currentPreset = resolvePreset(conn);
    setEditPreset(currentPreset);
    setEditFlags({
      can_view_medications: conn.can_view_medications,
      can_view_vault: conn.can_view_vault,
      can_view_reports: conn.can_view_reports,
      can_edit_medications: conn.can_edit_medications,
      can_receive_escalations: conn.can_receive_escalations,
      can_view_medical_profile: conn.can_view_medical_profile,
    });
  };

  const handlePresetChange = (preset: PermissionPreset) => {
    setEditPreset(preset);
    if (preset !== 'CUSTOM') {
      setEditFlags(PERMISSION_PRESETS[preset].flags);
    }
  };

  const toggleFlag = (flagName: string) => {
    setEditPreset('CUSTOM');
    setEditFlags(prev => ({
      ...prev,
      [flagName]: !prev[flagName]
    }));
  };

  const handleSaveChanges = async () => {
    if (!editingConnection) return;
    setProcessing(editingConnection.connection_id);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const { error } = await supabase
        .from('caregiver_connections')
        .update({
          relationship_type: editRelationship,
          ...editFlags,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingConnection.connection_id);

      if (error) throw error;

      setSuccessMsg('Shared trust permissions updated successfully.');
      setEditingConnection(null);
      await fetchTrustData();
    } catch (err) {
      console.error('[SharedTrust] Save error:', err);
      setErrorMsg('Failed to update permissions.');
    } finally {
      setProcessing(null);
    }
  };

  const handlePromotePrimary = async (conn: CareCircleConnection) => {
    const confirmed = window.confirm(
      `Make ${conn.resolved_name || 'Caregiver'} the Primary Care Coordinator? They will receive priority alerts and become the main family coordinator.`
    );
    if (!confirmed) return;

    setProcessing(conn.connection_id);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // 1. Demote any current primary connection first
      const { error: demoteErr } = await supabase
        .from('caregiver_connections')
        .update({ is_primary: false, updated_at: new Date().toISOString() })
        .eq('patient_profile_id', currentUser.id)
        .eq('is_primary', true)
        .eq('connection_status', 'ACCEPTED')
        .eq('is_active', true);

      if (demoteErr) throw demoteErr;

      // 2. Promote this connection to primary
      const { error: promoteErr } = await supabase
        .from('caregiver_connections')
        .update({ is_primary: true, updated_at: new Date().toISOString() })
        .eq('id', conn.connection_id);

      if (promoteErr) throw promoteErr;

      setSuccessMsg(`${conn.resolved_name || 'Caregiver'} is now the Primary Coordinator.`);
      await fetchTrustData();
    } catch (err) {
      console.error('[SharedTrust] Promote error:', err);
      setErrorMsg('Failed to promote primary caregiver.');
    } finally {
      setProcessing(null);
    }
  };

  const handleRevokeConnection = async (conn: CareCircleConnection, isCaregiverView: boolean) => {
    const confirmMsg = isCaregiverView
      ? `Are you sure you want to disconnect from patient ${conn.resolved_name || 'Patient'}? You will no longer view their schedule or logs.`
      : `Revoke caregiving access for ${conn.resolved_name || 'Caregiver'}? They will no longer be able to view schedules, reports, or support your routine.`;

    const confirmed = window.confirm(confirmMsg);
    if (!confirmed) return;

    setProcessing(conn.connection_id);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const { error } = await supabase
        .from('caregiver_connections')
        .update({
          connection_status: 'REJECTED',
          is_active: false,
          is_primary: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', conn.connection_id);

      if (error) throw error;

      setSuccessMsg('Successfully revoked caregiver connection.');
      await fetchTrustData();
    } catch (err) {
      console.error('[SharedTrust] Revoke error:', err);
      setErrorMsg('Failed to disconnect connection.');
    } finally {
      setProcessing(null);
    }
  };

  const formatNarrativeAudit = (log: ConsentAuditLog) => {
    const timeStr = moment(log.created_at).fromNow();
    
    if (log.action_type === 'GRANTED') {
      return (
        <div className="space-y-0.5">
          <p className="text-xs text-foreground font-bold flex items-center gap-1.5"><Heart className="w-3.5 h-3.5 text-primary shrink-0" /> Shared Trust Granted</p>
          <p className="text-[11px] text-muted-foreground">You approved request and shared your Care Circle with <b>{log.caregiver_name}</b>.</p>
          <span className="text-[9px] text-muted-foreground block pt-0.5">{timeStr}</span>
        </div>
      );
    }
    if (log.action_type === 'PRIMARY_PROMOTED') {
      return (
        <div className="space-y-0.5">
          <p className="text-xs text-foreground font-bold flex items-center gap-1.5"><Heart className="w-3.5 h-3.5 text-primary shrink-0" /> Care Circle Coordinator Updated</p>
          <p className="text-[11px] text-muted-foreground"><b>{log.caregiver_name}</b> was promoted to Primary Care Coordinator.</p>
          <span className="text-[9px] text-muted-foreground block pt-0.5">{timeStr}</span>
        </div>
      );
    }
    if (log.action_type === 'REVOKED') {
      return (
        <div className="space-y-0.5">
          <p className="text-xs text-danger font-bold flex items-center gap-1.5"><HeartOff className="w-3.5 h-3.5 shrink-0" /> Shared Trust Access Revoked</p>
          <p className="text-[11px] text-muted-foreground">Access revoked for caregiver <b>{log.caregiver_name}</b>.</p>
          <span className="text-[9px] text-muted-foreground block pt-0.5">{timeStr}</span>
        </div>
      );
    }
    if (log.action_type === 'MODIFIED') {
      // Find diff details
      const beforeKeys = Object.keys(log.details.before || {});
      const changeDescriptions: string[] = [];
      beforeKeys.forEach(k => {
        const afterVal = log.details.after?.[k];
        if (k === 'can_view_vault') {
          changeDescriptions.push(afterVal ? 'shared health documents' : 'revoked health documents access');
        } else if (k === 'can_view_reports') {
          changeDescriptions.push(afterVal ? 'shared compliance reports' : 'revoked reports access');
        } else if (k === 'can_view_medications') {
          changeDescriptions.push(afterVal ? 'shared medication schedule' : 'revoked medication schedule access');
        } else if (k === 'can_edit_medications') {
          changeDescriptions.push(afterVal ? 'authorized schedule edits' : 'revoked schedule editing');
        } else if (k === 'can_receive_escalations') {
          changeDescriptions.push(afterVal ? 'enabled routine alerts' : 'disabled routine alerts');
        } else if (k === 'can_view_medical_profile') {
          changeDescriptions.push(afterVal ? 'shared medical profile' : 'revoked medical profile access');
        }
      });

      // Rendered as JSX (not dangerouslySetInnerHTML) so caregiver_name — a
      // user-controlled value — cannot inject HTML/script (stored XSS).
      return (
        <div className="space-y-0.5">
          <p className="text-xs text-foreground font-bold flex items-center gap-1.5"><Heart className="w-3.5 h-3.5 text-primary shrink-0" /> Shared Trust Updated</p>
          <p className="text-[11px] text-muted-foreground">
            You updated permissions for <b>{log.caregiver_name}</b>
            {changeDescriptions.length > 0 ? ` (${changeDescriptions.join(', ')}).` : '.'}
          </p>
          <span className="text-[9px] text-muted-foreground block pt-0.5">{timeStr}</span>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto py-12 text-center text-xs text-muted-foreground">
        Loading trust center details...
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12 font-sans">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <Link href="/care-circle" className="p-2 hover:bg-muted rounded-xl transition-all border border-transparent hover:border-border text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-foreground">Shared Trust Center</h1>
            <p className="text-xs text-muted-foreground font-semibold mt-1">
              Manage who helps support your health journey.
            </p>
          </div>
        </div>
      </div>

      {/* Success/Error Alerts */}
      {successMsg && (
        <div className="p-4 bg-success/10 border border-success/20 text-success text-xs font-bold rounded-2xl flex items-center gap-2">
          <CheckCircle className="w-4 h-4" /> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-4 bg-danger/10 border border-danger/20 text-danger text-xs font-bold rounded-2xl flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" /> {errorMsg}
        </div>
      )}

      {/* Patient Reassurance Banner */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3 text-primary">
        <Heart className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="text-xs">
          <p className="font-black text-foreground flex items-center gap-1.5 text-sm">
            <span>❤️</span> Shared Trust
          </p>
          <p className="text-foreground font-bold mt-1">You stay in control of who can support you.</p>
          <p className="text-muted-foreground font-semibold mt-0.5">Access can be changed or revoked at any time.</p>
        </div>
      </div>

      {/* Grid Layout split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Columns: Connection managers */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Patients Column: People Supporting Me */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-primary" />
              <h2 className="text-xs font-black text-foreground uppercase tracking-wider">People Supporting Me</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-bold">
                {peopleSupportingMe.length}
              </span>
            </div>

            {peopleSupportingMe.length === 0 ? (
              <div className="bg-card border border-border rounded-3xl p-8 text-center text-muted-foreground shadow-sm">
                <Info className="w-8 h-8 mx-auto text-muted-foreground mb-2 opacity-50" />
                <p className="text-xs font-bold text-foreground">No caregiver access granted yet</p>
                <p className="text-[10px] text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
                  Go to Settings to add a caregiver using their ID. Once they request, you can configure presets and share schedules.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {peopleSupportingMe.map((conn) => {
                  const preset = resolvePreset(conn);
                  const daysCaring = Math.max(1, moment().diff(moment(conn.created_at), 'days'));
                  
                  return (
                    <div key={conn.connection_id} className="bg-card border border-border rounded-3xl p-6 shadow-sm space-y-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold border border-primary/20">
                            {conn.resolved_name?.substring(0, 2).toUpperCase() || 'CG'}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-black text-foreground text-sm tracking-tight">{conn.resolved_name}</h3>
                              {conn.is_primary && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold border border-primary/20">
                                  Primary Coordinator
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground font-semibold mt-0.5 capitalize">
                              {conn.relationship_type.toLowerCase()} • Caring together for {daysCaring} day{daysCaring !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenEdit(conn)}
                            className="px-2.5 py-1.5 text-[10px] font-bold text-primary bg-primary/10 hover:bg-primary/20 rounded-lg cursor-pointer transition-all"
                          >
                            Edit Access
                          </button>
                          {!conn.is_primary && (
                            <button
                              onClick={() => handlePromotePrimary(conn)}
                              className="px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground bg-muted hover:bg-slate-100 rounded-lg cursor-pointer transition-all border border-border"
                              title="Promote Coordinator"
                            >
                              Make Primary
                            </button>
                          )}
                          <button
                            onClick={() => handleRevokeConnection(conn, false)}
                            className="p-1.5 text-danger bg-danger/10 hover:bg-danger/20 rounded-lg cursor-pointer transition-all"
                            title="Revoke Access"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <hr className="border-border" />

                      {/* Shared Trust preset info */}
                      <div className="space-y-3">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-muted-foreground font-semibold">Access Level:</span>
                          <span className="font-extrabold text-foreground">{PERMISSION_PRESETS[preset].name}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[10px] font-semibold text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <span className={conn.can_view_medications ? 'text-success' : 'text-muted-foreground opacity-50'}>
                              {conn.can_view_medications ? '✓' : '✕'}
                            </span>
                            <span className={conn.can_view_medications ? 'text-foreground font-bold' : ''}>Medication Schedule</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={conn.can_receive_escalations ? 'text-success' : 'text-muted-foreground opacity-50'}>
                              {conn.can_receive_escalations ? '✓' : '✕'}
                            </span>
                            <span className={conn.can_receive_escalations ? 'text-foreground font-bold' : ''}>Missed Dose Alerts</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={conn.can_view_reports ? 'text-success' : 'text-muted-foreground opacity-50'}>
                              {conn.can_view_reports ? '✓' : '✕'}
                            </span>
                            <span className={conn.can_view_reports ? 'text-foreground font-bold' : ''}>Compliance Reports</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={conn.can_view_vault ? 'text-success' : 'text-muted-foreground opacity-50'}>
                              {conn.can_view_vault ? '✓' : '✕'}
                            </span>
                            <span className={conn.can_view_vault ? 'text-foreground font-bold' : ''}>Health Vault Documents</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={conn.can_edit_medications ? 'text-success' : 'text-muted-foreground opacity-50'}>
                              {conn.can_edit_medications ? '✓' : '✕'}
                            </span>
                            <span className={conn.can_edit_medications ? 'text-foreground font-bold' : ''}>Modify Schedules</span>
                          </div>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Caregivers Column: People I Support */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-primary" />
              <h2 className="text-xs font-black text-foreground uppercase tracking-wider">People I Support</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-bold">
                {peopleISupport.length}
              </span>
            </div>

            {peopleISupport.length === 0 ? (
              <div className="bg-card border border-border rounded-3xl p-8 text-center text-muted-foreground shadow-sm">
                <Info className="w-8 h-8 mx-auto text-muted-foreground mb-2 opacity-50" />
                <p className="text-xs font-bold text-foreground">You support no active patients</p>
                <p className="text-[10px] text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
                  You are currently not registered to support any family members. Share your Caregiver ID from settings with a patient to be invited.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {peopleISupport.map((conn) => {
                  const preset = resolvePreset(conn);
                  return (
                    <div key={conn.connection_id} className="bg-card border border-border rounded-2xl p-5 shadow-sm flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold border border-primary/20">
                          {conn.resolved_name?.substring(0, 2).toUpperCase() || 'PT'}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="font-bold text-foreground text-sm">{conn.resolved_name}</h3>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-semibold border border-border capitalize">
                              {conn.relationship_type.toLowerCase()}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground font-semibold mt-0.5">
                            Role: {conn.is_primary ? 'Primary Coordinator' : 'Secondary Caregiver'} • Preset: {PERMISSION_PRESETS[preset].name}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleRevokeConnection(conn, true)}
                        className="px-3 py-1.5 text-[10px] font-bold text-danger bg-danger/10 hover:bg-danger/20 rounded-lg cursor-pointer transition-all border border-danger/20 shrink-0"
                      >
                        Disconnect
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* Right Column: Consent Audits Log */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            <h2 className="text-xs font-black text-foreground uppercase tracking-wider">Consent History Log</h2>
          </div>

          <div className="bg-card border border-border rounded-3xl p-5 shadow-sm space-y-4">
            {auditLogs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-8">No consent history logged yet.</p>
            ) : (
              <div className="relative border-l border-border pl-4 space-y-5 text-xs">
                {auditLogs.map((log) => (
                  <div key={log.id} className="relative">
                    {/* Circle Indicator */}
                    <div className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-border border-2 border-white ring-2 ring-primary/20" />
                    {formatNarrativeAudit(log)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Editor Permissions Modal Overlay */}
      {editingConnection && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border border-border rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-6">
            <div className="space-y-1">
              <h2 className="text-base font-black text-foreground">Edit Shared Trust: {editingConnection.resolved_name}</h2>
              <p className="text-[11px] text-muted-foreground">Adjust presets or customize individual permissions directly.</p>
            </div>

            {/* Relationship selector */}
            <div className="space-y-2">
              <label className="block text-[10px] font-black text-foreground uppercase tracking-wider">Relationship Type</label>
              <select
                value={editRelationship}
                onChange={(e) => setEditRelationship(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-border rounded-xl focus:outline-none focus:border-primary text-xs font-bold"
              >
                <option value="SON">Son</option>
                <option value="DAUGHTER">Daughter</option>
                <option value="SPOUSE">Spouse</option>
                <option value="PARENT">Parent</option>
                <option value="SIBLING">Sibling</option>
                <option value="FRIEND">Friend</option>
                <option value="DOCTOR">Doctor</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            {/* Presets selector slider */}
            <div className="space-y-3">
              <label className="block text-[10px] font-black text-foreground uppercase tracking-wider">Access Presets</label>
              <div className="grid grid-cols-4 gap-2">
                {(['BASIC', 'FAMILY', 'FULL', 'CUSTOM'] as PermissionPreset[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => handlePresetChange(p)}
                    className={`py-2 rounded-xl border text-[10px] font-extrabold cursor-pointer transition-all ${
                      editPreset === p 
                        ? 'bg-primary/10 border-primary text-primary' 
                        : 'border-border bg-card text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {PERMISSION_PRESETS[p].name.replace(' Support', '').replace(' Access', '')}
                  </button>
                ))}
              </div>
            </div>

            <hr className="border-border" />

            {/* Granular checkboxes */}
            <div className="space-y-3 text-xs font-semibold">
              <label className="block text-[10px] font-black text-foreground uppercase tracking-wider">Granular Toggles</label>
              
              <div className="space-y-2.5">
                {[
                  { key: 'can_view_medications', label: 'View medication schedules' },
                  { key: 'can_receive_escalations', label: 'Receive missed dose alerts' },
                  { key: 'can_view_reports', label: 'View compliance reports' },
                  { key: 'can_view_vault', label: 'Access shared health documents' },
                  { key: 'can_view_medical_profile', label: 'View medical profile (blood group, allergies, conditions)' },
                  { key: 'can_edit_medications', label: 'Modify medication schedules' }
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center justify-between cursor-pointer group">
                    <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
                    <input
                      type="checkbox"
                      checked={!!editFlags[key]}
                      onChange={() => toggleFlag(key)}
                      className="w-4 h-4 accent-primary cursor-pointer rounded border-border"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEditingConnection(null)}
                className="flex-1 py-2.5 border border-border text-foreground hover:bg-muted font-bold text-xs rounded-xl cursor-pointer transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveChanges}
                disabled={processing !== null}
                className="flex-1 py-2.5 bg-primary hover:bg-primary-hover text-white font-bold text-xs rounded-xl cursor-pointer transition-all disabled:opacity-50"
              >
                {processing ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
