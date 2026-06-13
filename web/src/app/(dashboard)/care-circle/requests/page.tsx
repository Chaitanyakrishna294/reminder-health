'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { 
  ArrowLeft, 
  Heart, 
  UserCheck, 
  UserX, 
  Shield, 
  Clock, 
  ChevronDown,
  Loader2,
  Inbox,
  CheckCircle2,
  XCircle,
  Undo2
} from 'lucide-react';

// --- Types ---
interface PendingRequest {
  id: string; // caregiver_connections.id
  caregiver_profile_id: string;
  caregiver_name: string;
  relationship_type: string;
  created_at: string;
  expires_at: string | null;
  connection_status: string;
}

interface SentRequest {
  id: string;
  patient_profile_id: string;
  patient_name: string;
  connection_status: string;
  created_at: string;
  expires_at: string | null;
}

type PermissionPreset = 'BASIC' | 'FAMILY' | 'FULL' | 'CUSTOM';

const RELATIONSHIP_OPTIONS = [
  { value: 'SON', label: 'Son' },
  { value: 'DAUGHTER', label: 'Daughter' },
  { value: 'SPOUSE', label: 'Spouse' },
  { value: 'PARENT', label: 'Parent' },
  { value: 'SIBLING', label: 'Sibling' },
  { value: 'FRIEND', label: 'Friend' },
  { value: 'DOCTOR', label: 'Doctor' },
  { value: 'OTHER', label: 'Other' },
];

const PERMISSION_PRESETS: Record<PermissionPreset, {
  label: string;
  description: string;
  flags: Record<string, boolean>;
}> = {
  BASIC: {
    label: 'Basic Support',
    description: 'View schedule and receive missed dose alerts.',
    flags: {
      can_view_medications: true,
      can_receive_escalations: true,
      can_view_reports: false,
      can_view_vault: false,
      can_edit_medications: false,
    },
  },
  FAMILY: {
    label: 'Family Support',
    description: 'View schedule, receive alerts, and check reports.',
    flags: {
      can_view_medications: true,
      can_receive_escalations: true,
      can_view_reports: true,
      can_view_vault: false,
      can_edit_medications: false,
    },
  },
  FULL: {
    label: 'Full Support',
    description: 'Full access to schedules, reports, alerts, and shared documents.',
    flags: {
      can_view_medications: true,
      can_receive_escalations: true,
      can_view_reports: true,
      can_view_vault: true,
      can_edit_medications: false,
    },
  },
  CUSTOM: {
    label: 'Custom',
    description: 'Manually choose what to share.',
    flags: {
      can_view_medications: true,
      can_receive_escalations: true,
      can_view_reports: false,
      can_view_vault: false,
      can_edit_medications: false,
    },
  },
};

// --- Component ---
export default function CareCircleRequestsPage() {
  const supabase = createClient();
  
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [sentRequests, setSentRequests] = useState<SentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Per-request configuration state
  const [selectedRelationship, setSelectedRelationship] = useState<Record<string, string>>({});
  const [selectedPreset, setSelectedPreset] = useState<Record<string, PermissionPreset>>({});
  const [customFlags, setCustomFlags] = useState<Record<string, Record<string, boolean>>>({});

  // Fetch pending requests (correct query direction: incoming = where I am the caregiver, outgoing = where I am the patient)
  const fetchRequests = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      // Incoming: requests where I am the caregiver (the recipient of a link request)
      const { data: incoming } = await supabase
        .from('caregiver_connections')
        .select(`
          id,
          patient_profile_id,
          relationship_type,
          created_at,
          expires_at,
          connection_status
        `)
        .eq('caregiver_profile_id', user.id)
        .eq('connection_status', 'PENDING')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (incoming && incoming.length > 0) {
        // Client-side expiration filter (defense-in-depth: pg_cron runs daily at 1AM UTC)
        const validRequests = incoming.filter(r => {
          if (!r.expires_at) return true;
          return new Date(r.expires_at).getTime() > Date.now();
        });

        // Resolve patient names
        const patientIds = validRequests.map(r => r.patient_profile_id);
        if (patientIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', patientIds);

          const nameMap = new Map(profiles?.map(p => [p.id, p.full_name]) || []);

          setPendingRequests(validRequests.map(r => ({
            ...r,
            caregiver_profile_id: r.patient_profile_id,
            caregiver_name: nameMap.get(r.patient_profile_id) || 'Unknown',
          })));
        } else {
          setPendingRequests([]);
        }
      } else {
        setPendingRequests([]);
      }

      // Outgoing: requests where I am the patient (I sent the request to a caregiver)
      const { data: outgoing } = await supabase
        .from('caregiver_connections')
        .select(`
          id,
          caregiver_profile_id,
          connection_status,
          created_at,
          expires_at
        `)
        .eq('patient_profile_id', user.id)
        .in('connection_status', ['PENDING', 'WITHDRAWN'])
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (outgoing && outgoing.length > 0) {
        const caregiverIds = outgoing.map(r => r.caregiver_profile_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', caregiverIds);

        const nameMap = new Map(profiles?.map(p => [p.id, p.full_name]) || []);

        setSentRequests(outgoing.map(r => ({
          ...r,
          patient_profile_id: r.caregiver_profile_id,
          patient_name: nameMap.get(r.caregiver_profile_id) || 'Unknown',
        })));
      } else {
        setSentRequests([]);
      }
    } catch (err) {
      console.error('[Requests] Error fetching:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // --- Actions ---
  const handleAccept = async (requestId: string) => {
    setProcessing(requestId);
    setErrorMsg(null);
    setSuccessMsg(null);

    const relationship = selectedRelationship[requestId] || 'OTHER';
    const preset = selectedPreset[requestId] || 'BASIC';
    const flags = preset === 'CUSTOM' 
      ? (customFlags[requestId] || PERMISSION_PRESETS.BASIC.flags) 
      : PERMISSION_PRESETS[preset].flags;

    try {
      const requestObj = pendingRequests.find(r => r.id === requestId);
      const patientId = requestObj ? requestObj.caregiver_profile_id : (currentUserId || '');

      // Check if patient already has a primary caregiver
      const { data: existingPrimary } = await supabase
        .from('caregiver_connections')
        .select('id')
        .eq('patient_profile_id', patientId)
        .eq('is_primary', true)
        .eq('is_active', true)
        .eq('connection_status', 'ACCEPTED')
        .maybeSingle();

      // First accepted caregiver becomes primary automatically
      const isPrimary = !existingPrimary;


      const { error } = await supabase
        .from('caregiver_connections')
        .update({
          connection_status: 'ACCEPTED',
          relationship_type: relationship,
          is_primary: isPrimary,
          ...flags,
        })
        .eq('id', requestId);

      if (error) throw error;

      // Ephemeral notification cleanup is handled by DB trigger
      // trg_cleanup_resolved_notifications automatically deletes
      // CARE_CIRCLE_ACCESS_REQUEST notifications when status leaves PENDING.

      const roleLabel = isPrimary ? 'Primary Care Coordinator' : 'Care Supporter';
      setSuccessMsg(`Connection accepted as ${roleLabel}! They can now view your shared health information.`);
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (err) {
      console.error('[Requests] Accept error:', err);
      setErrorMsg('Failed to accept request. Please try again.');
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (requestId: string) => {
    if (!confirm('Are you sure you want to decline this request?')) return;
    
    setProcessing(requestId);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const { error } = await supabase
        .from('caregiver_connections')
        .update({ 
          connection_status: 'REJECTED',
          is_active: false,
        })
        .eq('id', requestId);

      if (error) throw error;

      // Ephemeral notification cleanup is handled by DB trigger
      // trg_cleanup_resolved_notifications auto-deletes on PENDING → REJECTED

      setSuccessMsg('Request declined.');
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (err) {
      console.error('[Requests] Reject error:', err);
      setErrorMsg('Failed to decline request. Please try again.');
    } finally {
      setProcessing(null);
    }
  };

  const handleWithdraw = async (requestId: string) => {
    if (!confirm('Withdraw this request? The patient will no longer see it.')) return;
    
    setProcessing(requestId);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const { error } = await supabase
        .from('caregiver_connections')
        .update({ connection_status: 'WITHDRAWN' })
        .eq('id', requestId);

      if (error) throw error;

      setSuccessMsg('Request withdrawn successfully.');
      setSentRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (err) {
      console.error('[Requests] Withdraw error:', err);
      setErrorMsg('Failed to withdraw request.');
    } finally {
      setProcessing(null);
    }
  };

  // --- Helpers ---
  const getPresetFlags = (preset: PermissionPreset, requestId: string) => {
    if (preset === 'CUSTOM') {
      return customFlags[requestId] || PERMISSION_PRESETS.BASIC.flags;
    }
    return PERMISSION_PRESETS[preset].flags;
  };

  const toggleCustomFlag = (requestId: string, flag: string) => {
    setCustomFlags(prev => ({
      ...prev,
      [requestId]: {
        ...(prev[requestId] || PERMISSION_PRESETS.BASIC.flags),
        [flag]: !(prev[requestId]?.[flag] ?? PERMISSION_PRESETS.BASIC.flags[flag as keyof typeof PERMISSION_PRESETS.BASIC.flags]),
      },
    }));
  };

  const getDaysRemaining = (expiresAt: string | null) => {
    if (!expiresAt) return null;
    const diff = new Date(expiresAt).getTime() - Date.now();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto mt-16 flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground font-semibold">Loading requests...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-4">
      {/* Header */}
      <div className="space-y-4">
        <Link 
          href="/care-circle" 
          className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-all w-fit"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Care Circle
        </Link>

        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
            <Heart className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-foreground tracking-tight">Care Circle Requests</h1>
            <p className="text-xs text-muted-foreground font-medium">
              Manage who can support your medication routine.
            </p>
          </div>
        </div>
      </div>

      {/* Status Messages */}
      {successMsg && (
        <div className="bg-success/10 border border-success/30 text-success-foreground p-4 rounded-2xl flex items-start gap-2.5 animate-fade-in">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-success mt-0.5" />
          <p className="font-bold text-xs">{successMsg}</p>
        </div>
      )}
      {errorMsg && (
        <div className="bg-danger/10 border border-danger/30 text-danger-foreground p-4 rounded-2xl flex items-start gap-2.5 animate-fade-in">
          <XCircle className="w-5 h-5 shrink-0 text-danger mt-0.5" />
          <p className="font-bold text-xs">{errorMsg}</p>
        </div>
      )}

      {/* SECTION 1: Incoming Requests (I am the patient) */}
      <div className="bg-card border border-border rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h2 className="font-black text-foreground text-sm">Requests to Support You</h2>
          {pendingRequests.length > 0 && (
            <span className="ml-auto inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
              {pendingRequests.length}
            </span>
          )}
        </div>

        {pendingRequests.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <Inbox className="w-8 h-8 text-muted-foreground/40 mx-auto" />
            <p className="text-xs text-muted-foreground font-semibold">No pending requests</p>
            <p className="text-[10px] text-muted-foreground max-w-xs mx-auto">
              When someone wants to support your medication routine, their request will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingRequests.map(request => {
              const daysLeft = getDaysRemaining(request.expires_at);
              const currentPreset = selectedPreset[request.id] || 'BASIC';
              const isProcessing = processing === request.id;

              return (
                <div key={request.id} className="border border-primary/15 rounded-2xl overflow-hidden">
                  {/* Request Header */}
                  <div className="bg-primary/5 p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm border border-primary/20">
                          {request.caregiver_name.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-black text-foreground text-sm">{request.caregiver_name}</p>
                          <p className="text-[10px] text-muted-foreground font-medium">
                            Requested {new Date(request.created_at).toLocaleDateString(undefined, { 
                              month: 'short', day: 'numeric', year: 'numeric' 
                            })}
                          </p>
                        </div>
                      </div>
                      {daysLeft !== null && (
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${
                          daysLeft <= 5 ? 'bg-warning/10 text-warning border border-warning/20' : 'bg-muted text-muted-foreground border border-border'
                        }`}>
                          <Clock className="w-3 h-3" />
                          {daysLeft}d left
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <strong>{request.caregiver_name}</strong> would like to help support your medication routine. Choose how they are related to you and what information you&apos;d like to share.
                    </p>
                  </div>

                  {/* Configuration Panel */}
                  <div className="p-4 space-y-4">
                    {/* Relationship Selector */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-foreground block">
                        Who is {request.caregiver_name} to you?
                      </label>
                      <div className="relative">
                        <select
                          value={selectedRelationship[request.id] || 'OTHER'}
                          onChange={(e) => setSelectedRelationship(prev => ({
                            ...prev, [request.id]: e.target.value,
                          }))}
                          className="w-full h-10 px-3 pr-8 bg-white border border-border rounded-xl text-sm font-semibold text-foreground appearance-none cursor-pointer focus:outline-none focus:border-primary"
                        >
                          {RELATIONSHIP_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>

                    {/* Permission Preset Selector */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-foreground block">
                        What would you like to share?
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {(Object.keys(PERMISSION_PRESETS) as PermissionPreset[]).map(preset => (
                          <button
                            key={preset}
                            onClick={() => setSelectedPreset(prev => ({ ...prev, [request.id]: preset }))}
                            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                              currentPreset === preset
                                ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                                : 'border-border bg-white hover:border-primary/30'
                            }`}
                          >
                            <span className="text-xs font-bold text-foreground block">
                              {PERMISSION_PRESETS[preset].label}
                            </span>
                            <span className="text-[10px] text-muted-foreground leading-tight block mt-0.5">
                              {PERMISSION_PRESETS[preset].description}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Custom Toggles (only shown if Custom preset selected) */}
                    {currentPreset === 'CUSTOM' && (
                      <div className="bg-muted/30 border border-border rounded-xl p-3 space-y-2">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Custom Permissions</p>
                        {[
                          { key: 'can_view_medications', label: 'View medication schedules' },
                          { key: 'can_receive_escalations', label: 'Receive missed dose alerts' },
                          { key: 'can_view_reports', label: 'View compliance reports' },
                          { key: 'can_view_vault', label: 'Access shared health documents' },
                          { key: 'can_edit_medications', label: 'Modify medication schedules' },
                        ].map(perm => {
                          const flags = customFlags[request.id] || PERMISSION_PRESETS.BASIC.flags;
                          const isChecked = flags[perm.key] ?? false;
                          return (
                            <label key={perm.key} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleCustomFlag(request.id, perm.key)}
                                className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                              />
                              <span className="text-xs text-foreground font-medium">{perm.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={() => handleAccept(request.id)}
                        disabled={isProcessing}
                        className="flex-1 h-10 bg-primary text-primary-foreground font-black text-xs rounded-xl hover:bg-primary-hover transition-all shadow-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {isProcessing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <UserCheck className="w-4 h-4" />
                        )}
                        <span>Confirm & Share</span>
                      </button>
                      <button
                        onClick={() => handleReject(request.id)}
                        disabled={isProcessing}
                        className="h-10 px-5 bg-danger/10 text-danger font-bold text-xs rounded-xl hover:bg-danger/20 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <UserX className="w-4 h-4" />
                        <span>Decline</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 2: Sent Requests (I am the caregiver) */}
      <div className="bg-card border border-border rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-muted-foreground" />
          <h2 className="font-black text-foreground text-sm">Requests You&apos;ve Sent</h2>
          {sentRequests.length > 0 && (
            <span className="ml-auto inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground border border-border">
              {sentRequests.length}
            </span>
          )}
        </div>

        {sentRequests.length === 0 ? (
          <div className="text-center py-6 space-y-2">
            <Inbox className="w-8 h-8 text-muted-foreground/40 mx-auto" />
            <p className="text-xs text-muted-foreground font-semibold">No sent requests</p>
            <p className="text-[10px] text-muted-foreground max-w-xs mx-auto">
              When you request to support someone, pending requests will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sentRequests.map(request => {
              const daysLeft = getDaysRemaining(request.expires_at);
              const isProcessing = processing === request.id;

              return (
                <div key={request.id} className="border border-border rounded-2xl p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-muted text-muted-foreground flex items-center justify-center font-bold text-xs border border-border shrink-0">
                      {request.patient_name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-foreground text-sm truncate">{request.patient_name}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-warning font-bold">Pending</span>
                        {daysLeft !== null && (
                          <span className="text-[10px] text-muted-foreground">
                            · {daysLeft}d remaining
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleWithdraw(request.id)}
                    disabled={isProcessing}
                    className="h-8 px-3 bg-muted text-muted-foreground hover:bg-danger/10 hover:text-danger font-bold text-[10px] rounded-lg transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Undo2 className="w-3.5 h-3.5" />
                    )}
                    <span>Withdraw</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
