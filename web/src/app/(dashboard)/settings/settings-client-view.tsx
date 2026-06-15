'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUiMode } from '@/context/ui-mode-context';
import { createClient } from '@/lib/supabase/client';
import { 
  Settings, 
  User, 
  Shield, 
  LogOut, 
  Stethoscope, 
  Copy, 
  Check, 
  AlertCircle, 
  Trash2, 
  Link2, 
  Sparkles,
  Smartphone,
  Clock
} from 'lucide-react';

interface SettingsClientViewProps {
  user: {
    id: string;
    email: string;
    fullName: string;
    role: 'PATIENT' | 'CAREGIVER';
    telegramChatId: string;
  };
  linkedCaregivers: Array<{
    id: number | string;
    caregiver_id: string;
    caregiver_name: string;
    caregiver_chat_id: string;
    connection_status?: string | null;
    source: 'connections' | 'legacy';
  }>;
  caregiverRecord: {
    id: number | string;
    caregiver_id: string;
    caregiver_chat_id?: string | null;
    is_active?: boolean | null;
  } | null;
  // Many-to-many: every patient this caregiver is linked to (PENDING or ACCEPTED)
  linkedPatients: Array<{
    id: number | string;
    patient_profile_id: string | null;
    patient_name: string;
    patient_telegram_id: string | null;
    connection_status?: string | null;
    source: 'connections' | 'legacy';
  }>;
}

export default function SettingsClientView({
  user,
  linkedCaregivers: initialLinkedCaregivers = [],
  caregiverRecord: initialCaregiverRecord,
  linkedPatients: initialLinkedPatients = [],
}: SettingsClientViewProps) {
  const router = useRouter();
  const supabase = createClient();
  const { isElderly, toggleMode, viewMode, setViewMode } = useUiMode();

  // State management
  const [linkedCaregivers, setLinkedCaregivers] = useState(initialLinkedCaregivers);
  const [caregiverRecord, setCaregiverRecord] = useState(initialCaregiverRecord);
  const [linkedPatients, setLinkedPatients] = useState(initialLinkedPatients);

  const [cgIdInput, setCgIdInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [highlightCareCircle, setHighlightCareCircle] = useState(false);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const checkHash = () => {
        if (window.location.hash === '#care-circle') {
          setHighlightCareCircle(true);
          const timer = setTimeout(() => setHighlightCareCircle(false), 5000);
          return () => clearTimeout(timer);
        }
      };
      checkHash();
      window.addEventListener('hashchange', checkHash);
      return () => window.removeEventListener('hashchange', checkHash);
    }
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.refresh();
    router.push('/login');
  };

  // --- Account deletion (GDPR right to erasure) ---
  const [deleting, setDeleting] = useState(false);
  const handleDeleteAccount = async () => {
    const confirmText = window.prompt(
      'This permanently deletes your account and ALL your data (medications, reminders, ' +
      'health vault files, caregiver links). This cannot be undone.\n\n' +
      'Type DELETE to confirm.'
    );
    if (confirmText !== 'DELETE') return;

    setDeleting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to delete account.');
      }
      await supabase.auth.signOut();
      router.refresh();
      router.push('/login');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete account.');
      setDeleting(false);
    }
  };

  const handleCopyId = () => {
    if (!caregiverRecord?.caregiver_id) return;
    navigator.clipboard.writeText(caregiverRecord.caregiver_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // --- PATIENT: Link Caregiver (Sprint 5.6C: creates caregiver_connections + notification) ---
  const handleLinkCaregiver = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    
    const formattedId = cgIdInput.trim().toUpperCase();
    if (!/^CG\d{6}$/.test(formattedId)) {
      setErrorMsg('Invalid Caregiver ID. Format must be CG followed by 6 numbers (e.g., CG123456).');
      return;
    }

    if (!user.telegramChatId) {
      setErrorMsg('You must have a resolved account session to link a caregiver.');
      return;
    }

    setProcessing(true);
    try {
      // 1. Resolve the caregiver from their shareable CG-ID via a SECURITY DEFINER RPC.
      //    Direct reads of caregiver_info/profiles are RLS-restricted to already-linked rows,
      //    so a patient inviting a NEW caregiver must resolve the code through the RPC.
      const { data: lk, error: lkErr } = await supabase
        .rpc('lookup_caregiver_by_code', { p_cg_id: formattedId });
      if (lkErr) throw lkErr;

      const match = Array.isArray(lk) ? lk[0] : lk;
      if (!match || !match.caregiver_profile_id) {
        setErrorMsg('Caregiver ID not found or inactive. Please ask your caregiver for their correct ID.');
        setProcessing(false);
        return;
      }
      const cgName = match.caregiver_name || 'Caregiver';

      // 2. Create/reactivate the request via invite_caregiver (handles dedupe + reactivation
      //    + the request notification trigger, all under SECURITY DEFINER).
      const { data: connId, error: connErr } = await supabase
        .rpc('invite_caregiver', { caregiver_id: match.caregiver_profile_id });

      if (connErr) {
        const m = (connErr.message || '').toLowerCase();
        if (m.includes('already connected')) {
          setErrorMsg('You are already connected with this caregiver.');
        } else if (m.includes('already pending')) {
          setErrorMsg('A connection request is already pending with this caregiver.');
        } else if (m.includes('cannot invite yourself')) {
          setErrorMsg("You can't send a request to yourself.");
        } else if (m.includes('not registered as a caregiver')) {
          setErrorMsg('That user has not registered as a caregiver yet.');
        } else {
          console.error('[Settings] invite_caregiver error:', connErr);
          setErrorMsg('Could not send the connection request. Please try again.');
        }
        setProcessing(false);
        return;
      }

      const newLinked = {
        id: (connId as string) || formattedId,
        caregiver_id: formattedId,
        caregiver_name: cgName,
        caregiver_chat_id: '',
        connection_status: 'PENDING',
        source: 'connections' as const,
      };
      setLinkedCaregivers(prev => [newLinked, ...prev.filter(c => c.caregiver_id !== formattedId)]);
      setSuccessMsg(`Connection request sent to ${cgName}. Waiting for approval.`);
      setCgIdInput('');
      router.refresh();
    } catch (err: any) {
      console.error('[Settings] Link Caregiver Error:', err);
      setErrorMsg('An unexpected error occurred while linking caregiver.');
    } finally {
      setProcessing(false);
    }
  };

  // --- PATIENT: Unlink Caregiver (supports both caregiver_connections and legacy) ---
  const handleUnlinkCaregiver = async (id: number | string, source: 'connections' | 'legacy') => {
    if (!confirm('Are you sure you want to disconnect from this caregiver?')) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    setProcessing(true);

    try {
      if (source === 'connections') {
        // New architecture: update caregiver_connections. We deliberately do NOT touch
        // is_primary here — the DB validation trigger forbids caregivers from changing it,
        // and the AFTER-UPDATE reassign trigger promotes a replacement primary once this
        // row leaves the active-accepted set.
        const { error } = await supabase
          .from('caregiver_connections')
          .update({ is_active: false, connection_status: 'REJECTED' })
          .eq('id', id);
        if (error) throw error;
      } else {
        // Legacy: update caregiver_info
        const { error } = await supabase
          .from('caregiver_info')
          .update({ patient_telegram_id: null })
          .eq('id', id);
        if (error) throw error;
      }

      setLinkedCaregivers(prev => prev.filter(c => c.id !== id));
      setSuccessMsg('Successfully disconnected from caregiver.');
      router.refresh();
    } catch (err: any) {
      console.error('[Settings] Unlink Caregiver Error:', err);
      setErrorMsg('Failed to disconnect from caregiver.');
    } finally {
      setProcessing(false);
    }
  };

  // --- CAREGIVER: Register/Generate Caregiver ID ---
  const handleBecomeCaregiver = async () => {
    if (!user.telegramChatId) {
      setErrorMsg('You must have a resolved account session to register as a caregiver.');
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);
    setProcessing(true);

    try {
      let isUnique = false;
      let cgId = '';
      let attempts = 0;

      while (!isUnique && attempts < 10) {
        cgId = 'CG' + Math.floor(100000 + Math.random() * 900000);
        const { data, error } = await supabase
          .from('caregiver_info')
          .select('id')
          .eq('caregiver_id', cgId);

        if (!error && (!data || data.length === 0)) {
          isUnique = true;
        }
        attempts++;
      }

      if (!isUnique) {
        setErrorMsg('Failed to generate a unique ID. Please try again.');
        setProcessing(false);
        return;
      }

      const { data: newRecord, error: insertErr } = await supabase
        .from('caregiver_info')
        .insert([{
          caregiver_id: cgId,
          caregiver_chat_id: user.telegramChatId,
          caregiver_name: user.fullName,
          is_active: true
        }])
        .select()
        .single();

      if (insertErr) throw insertErr;

      setCaregiverRecord(newRecord);
      setSuccessMsg(`Registered successfully! Your Caregiver ID is ${cgId}.`);
      router.refresh();
    } catch (err: any) {
      console.error('[Settings] Become Caregiver Error:', err);
      setErrorMsg('An error occurred during caregiver registration.');
    } finally {
      setProcessing(false);
    }
  };

  type LinkedPatient = SettingsClientViewProps['linkedPatients'][number];

  // --- CAREGIVER: Unlink Patient / Reject a SPECIFIC Connection Request ---
  // Filters by the individual connection id so we never touch sibling patients (no "unlink-all").
  const handleUnlinkPatient = async (patient: LinkedPatient) => {
    const isPending = patient.connection_status === 'PENDING';
    const confirmMessage = isPending
      ? `Reject the connection request from ${patient.patient_name}?`
      : `Disconnect from ${patient.patient_name}?`;

    if (!confirm(confirmMessage)) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    setProcessing(true);

    try {
      if (patient.source === 'connections') {
        // Revoke this one relationship. We do NOT touch is_primary (the DB validation trigger
        // forbids caregivers from changing it). The AFTER-UPDATE triggers emit the revoke
        // notification and promote a replacement primary once this row is deactivated.
        const { error } = await supabase
          .from('caregiver_connections')
          .update({ connection_status: 'REJECTED', is_active: false })
          .eq('id', patient.id);
        if (error) throw error;
      } else {
        // Legacy row: clear the single caregiver_info link for this record only.
        const { error } = await supabase
          .from('caregiver_info')
          .update({ patient_telegram_id: null, connection_status: null })
          .eq('id', patient.id);
        if (error) throw error;
      }

      setLinkedPatients(prev => prev.filter(p => p.id !== patient.id));
      setSuccessMsg(isPending ? 'Rejected patient connection request.' : `Disconnected from ${patient.patient_name}.`);
      router.refresh();
    } catch (err: any) {
      console.error('[Settings] Unlink Patient Error:', err);
      setErrorMsg('Failed to process request.');
    } finally {
      setProcessing(false);
    }
  };

  // --- CAREGIVER: Accept a SPECIFIC Patient Connection Request ---
  // Filters by the individual connection id — fixes the "accept-all" glitch where every
  // pending request flipped to ACCEPTED at once.
  const handleAcceptPatient = async (patient: LinkedPatient) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setProcessing(true);

    try {
      if (patient.source === 'connections') {
        // Caregiver accepts via SECURITY DEFINER RPC. A direct UPDATE would still be filtered
        // through the validation trigger (auth.uid() is unchanged by SECURITY DEFINER); the RPC
        // is the canonical, authorization-checked entry point for responding to a request.
        const { error } = await supabase.rpc('respond_to_caregiver_request', {
          p_connection_id: patient.id,
          p_action: 'ACCEPT',
        });
        if (error) throw error;
      } else {
        // Legacy caregiver_info row (pre-migration link). Accept in place; no new relationship
        // writes are introduced — caregiver_connections is the source of truth going forward.
        const { error } = await supabase
          .from('caregiver_info')
          .update({ connection_status: 'ACCEPTED' })
          .eq('id', patient.id);
        if (error) throw error;
      }

      setLinkedPatients(prev =>
        prev.map(p => (p.id === patient.id ? { ...p, connection_status: 'ACCEPTED' } : p))
      );
      setSuccessMsg(`Accepted connection request from ${patient.patient_name}. You are now linked.`);
      router.refresh();
    } catch (err: any) {
      console.error('[Settings] Accept Patient Error:', err);
      setErrorMsg('Failed to accept patient connection.');
    } finally {
      setProcessing(false);
    }
  };

  const handleMonitorPatient = async (patient: LinkedPatient) => {
    if (!patient.patient_telegram_id) return;
    setProcessing(true);
    try {
      // Compliance logging
      await supabase
        .from('audit_logs')
        .insert([{
          user_id: user.id,
          action: 'Entered Monitoring Mode',
          details: {
            patient_name: patient.patient_name || 'Your Patient',
            patient_chat_id: patient.patient_telegram_id
          }
        }]);
    } catch (err) {
      console.error('[Settings] Compliance audit log error:', err);
    } finally {
      document.cookie = `monitored-patient-id=${patient.patient_telegram_id}; path=/; max-age=31536000; SameSite=Lax`;
      setViewMode('PATIENT_MONITOR');
      setProcessing(false);
      router.push('/dashboard');
      router.refresh();
    }
  };

  return (
    <div className={`max-w-3xl mx-auto space-y-6 ${isElderly ? 'p-6 md:p-8 space-y-10' : ''}`}>
      {/* Title Header */}
      <div className="flex items-center gap-3 border-b border-border/60 pb-5">
        <Settings className={`text-primary shrink-0 ${isElderly ? 'w-10 h-10' : 'w-7 h-7'}`} />
        <div>
          <h1 className={`font-black text-foreground tracking-tight ${isElderly ? 'text-4xl' : 'text-2xl'}`}>
            Account Settings
          </h1>
          <p className={`text-muted-foreground font-semibold ${isElderly ? 'text-xl mt-2' : 'text-xs mt-1'}`}>
            Manage your interface preferences, caregiver links, and account session.
          </p>
        </div>
      </div>

      {/* Notifications Alerts */}
      {errorMsg && (
        <div className="bg-danger/10 border border-danger/30 text-danger-foreground p-4 rounded-2xl flex items-start gap-2.5 animate-fade-in">
          <AlertCircle className="w-5 h-5 shrink-0 text-danger mt-0.5" />
          <p className={`font-bold ${isElderly ? 'text-lg' : 'text-xs'}`}>{errorMsg}</p>
        </div>
      )}

      {successMsg && (
        <div className="bg-success/10 border border-success/30 text-success-foreground p-4 rounded-2xl flex items-start gap-2.5 animate-fade-in">
          <Check className="w-5 h-5 shrink-0 text-success mt-0.5" />
          <p className={`font-bold ${isElderly ? 'text-lg' : 'text-xs'}`}>{successMsg}</p>
        </div>
      )}

      {/* SECTION 1: USER PROFILE OVERVIEW */}
      <div className="bg-card border border-border rounded-3xl p-6 shadow-sm space-y-4">
        <h3 className={`font-black text-foreground ${isElderly ? 'text-2xl' : 'text-sm'}`}>
          User Profile
        </h3>
        <div className="flex items-center gap-4">
          <div className={`rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold border border-primary/20 shrink-0 ${
            isElderly ? 'w-16 h-16 text-2xl' : 'w-12 h-12 text-lg'
          }`}>
            {user.fullName.substring(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h4 className={`font-black text-foreground truncate ${isElderly ? 'text-2xl' : 'text-base'}`}>
              {user.fullName}
            </h4>
            <p className={`text-muted-foreground font-semibold truncate ${isElderly ? 'text-lg mt-0.5' : 'text-xs'}`}>
              {user.email}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5 pt-2">
          {user.telegramChatId && !user.telegramChatId.startsWith('WEB-') ? (
            <span className={`inline-flex items-center px-3 py-1 rounded-full font-bold bg-muted text-muted-foreground border border-border ${
              isElderly ? 'text-base' : 'text-[10px]'
            }`}>
              Telegram Linked: {user.telegramChatId}
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center px-3 py-1 rounded-full font-bold bg-warning/10 text-warning border border-warning/30 ${
                isElderly ? 'text-base' : 'text-[10px]'
              }`}>
                Telegram Not Connected
              </span>
              <button
                onClick={() => router.push('/link-account')}
                className={`font-black rounded-lg border border-primary text-primary hover:bg-primary/5 transition-all cursor-pointer flex items-center justify-center ${
                  isElderly ? 'h-9 px-4 text-xs' : 'h-7 px-2.5 text-[10px]'
                }`}
              >
                Connect Telegram Bot
              </button>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 2: VISUAL MODE PREFERENCE */}
      <div className="bg-card border border-border rounded-3xl p-6 shadow-sm space-y-4">
        <div className="space-y-1">
          <h3 className={`font-black text-foreground ${isElderly ? 'text-2xl' : 'text-sm'}`}>
            Layout Preference
          </h3>
          <p className={`text-muted-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>
            Customize display density, touch target sizes, and readability factors.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-muted/30 border border-border/80 rounded-2xl p-4">
          <div className="space-y-0.5">
            <span className={`font-extrabold text-foreground block ${isElderly ? 'text-xl' : 'text-sm'}`}>
              Elderly Mode Layout
            </span>
            <span className={`text-muted-foreground block font-semibold ${isElderly ? 'text-base' : 'text-xs'}`}>
              Provides massive fonts, high-contrast items, and large touch targets.
            </span>
          </div>

          <button
            onClick={toggleMode}
            className={`flex items-center justify-center font-black rounded-xl transition-all border cursor-pointer hover:scale-[1.02] active:scale-[0.98] ${
              isElderly 
                ? 'bg-warning hover:bg-warning/90 border-warning text-warning-foreground h-[64px] px-8 text-xl shadow-md' 
                : 'bg-white hover:bg-muted border-border text-foreground px-4 py-2 text-xs font-semibold'
            }`}
          >
            {isElderly ? 'Disable Elderly Mode' : 'Enable Elderly Mode'}
          </button>
        </div>
      </div>

      {/* SECTION 3: UNIFIED CAREGIVER & CLIENT MANAGEMENT */}
      <div 
        id="care-circle"
        className={`bg-card border rounded-3xl p-6 shadow-sm space-y-6 transition-all duration-500 ${
          highlightCareCircle 
            ? 'border-primary ring-2 ring-primary/20 bg-primary/5 scale-[1.01]' 
            : 'border-border'
        }`}
      >
        <div className="space-y-1">
          <h3 className={`font-black text-foreground flex items-center gap-1.5 ${isElderly ? 'text-2xl' : 'text-sm'}`}>
            <Stethoscope className="w-5 h-5 text-primary" />
            Care Circle Management
          </h3>
          <p className={`text-muted-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>
            Connect with a health caregiver to support your medication progress, or register as a caregiver to support others.
          </p>
        </div>

        {/* INCOMING SUPPORT: PATIENT ROLE FLOW */}
        <div className="space-y-6 border-b border-border/40 pb-6">
          <h4 className="text-xs font-black text-foreground uppercase tracking-wider">People Who Care For Me</h4>
          {/* List of Connected Caregivers */}
          {linkedCaregivers.length > 0 && (
            <div className="space-y-4">
              {linkedCaregivers.map((cg) => (
                cg.connection_status === 'ACCEPTED' ? (
                  <div key={cg.id} className="border border-border rounded-2xl p-4 bg-success/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-success/15 text-success flex items-center justify-center">
                          <Stethoscope className="w-4 h-4" />
                        </div>
                        <div>
                          <span className={`block font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}>
                            {cg.caregiver_name}
                          </span>
                          <span className={`block text-muted-foreground font-semibold ${isElderly ? 'text-base' : 'text-[11px]'}`}>
                            Caregiver ID: {cg.caregiver_id || 'N/A'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href="/care-circle/manage"
                          className="px-3.5 py-2 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 rounded-xl cursor-pointer transition-all flex items-center gap-1 shrink-0"
                        >
                          Manage Shared Trust
                        </Link>
                        <button
                          onClick={() => handleUnlinkCaregiver(cg.id, cg.source || 'connections')}
                          disabled={processing}
                          className="p-2 text-danger bg-danger/10 hover:bg-danger/20 rounded-lg cursor-pointer transition-all disabled:opacity-50 shrink-0"
                          title="Disconnect Caregiver"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className={`p-3 bg-white border border-border rounded-xl text-muted-foreground font-medium ${isElderly ? 'text-base' : 'text-[11px]'}`}>
                      Connected! Your caregiver is now synced to your routine alerts and can review your compliance ring.
                    </div>
                  </div>
                ) : (
                  <div key={cg.id} className="border border-warning/30 rounded-2xl p-4 bg-warning/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-warning/15 text-warning flex items-center justify-center">
                          <Clock className="w-4 h-4 animate-pulse" />
                        </div>
                        <div>
                          <span className={`block font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}>
                            {cg.caregiver_name}
                          </span>
                          <span className={`block text-muted-foreground font-semibold ${isElderly ? 'text-base' : 'text-[11px]'}`}>
                            Connection Status: <b className="text-warning">PENDING APPROVAL</b>
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleUnlinkCaregiver(cg.id, cg.source || 'connections')}
                        disabled={processing}
                        className="px-3 py-1.5 text-xs font-bold text-danger bg-danger/10 hover:bg-danger/20 rounded-lg cursor-pointer transition-all disabled:opacity-50 shrink-0"
                        title="Cancel Request"
                      >
                        Cancel Request
                      </button>
                    </div>
                    <div className={`p-3 bg-white border border-border rounded-xl text-muted-foreground font-medium ${isElderly ? 'text-base' : 'text-[11px]'}`}>
                      Waiting for your caregiver to accept the link request. You can ask them to check their dashboard or settings page to approve.
                    </div>
                  </div>
                )
              ))}
            </div>
          )}

          {/* Form to Link Additional Caregiver (Always Visible) */}
          <form onSubmit={handleLinkCaregiver} className="space-y-4 pt-2">
            <div className="bg-muted/10 border border-border/80 rounded-2xl p-4 space-y-3">
              <p className={`text-muted-foreground font-semibold ${isElderly ? 'text-lg' : 'text-xs'}`}>
                {linkedCaregivers.length > 0 
                  ? 'Link another caregiver to support your routine. Enter their Caregiver ID below:' 
                  : 'You are currently not connected to a caregiver. Ask your caregiver for their Caregiver ID and enter it below:'}
              </p>
              
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  placeholder="CG123456"
                  value={cgIdInput}
                  onChange={(e) => setCgIdInput(e.target.value)}
                  disabled={processing}
                  maxLength={8}
                  className={`flex-1 bg-white border border-border rounded-xl focus:outline-none focus:border-primary font-mono uppercase font-black text-center ${
                    isElderly ? 'h-16 px-4 text-2xl border-2' : 'h-10 px-3 text-sm'
                  }`}
                />
                <button
                  type="submit"
                  disabled={processing || !cgIdInput.trim()}
                  className={`font-black rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover transition-all shadow-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 ${
                    isElderly ? 'h-16 px-8 text-xl' : 'h-10 px-5 text-xs'
                  }`}
                >
                  <Link2 className="w-4 h-4" />
                  <span>{processing ? 'Linking...' : 'Link Caregiver'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* OUTGOING SUPPORT: CAREGIVER ROLE FLOW */}
        <div className="space-y-4">
          <h4 className="text-xs font-black text-foreground uppercase tracking-wider">People I Care For</h4>
          {caregiverRecord ? (
            <div className="space-y-4">
              {/* ID Display Box */}
              <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <span className={`block text-muted-foreground font-semibold ${isElderly ? 'text-lg' : 'text-xs'}`}>
                    Your Caregiver ID (for others to link you)
                  </span>
                  <span className={`block font-black text-primary font-mono tracking-wide mt-1 ${isElderly ? 'text-3xl' : 'text-xl'}`}>
                    {caregiverRecord.caregiver_id}
                  </span>
                </div>

                <button
                  onClick={handleCopyId}
                  type="button"
                  className={`flex items-center gap-1.5 font-bold rounded-xl border border-primary/30 bg-white hover:bg-primary/5 text-primary transition-all cursor-pointer ${
                    isElderly ? 'h-14 px-6 text-lg' : 'h-9 px-3.5 text-xs'
                  }`}
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copy ID</span>
                    </>
                  )}
                </button>
              </div>

              {/* Patient Connections (many-to-many): one card per linked patient */}
              {linkedPatients.length > 0 ? (
                <div className="space-y-4">
                  {linkedPatients.map((patient) => (
                    patient.connection_status === 'ACCEPTED' ? (
                      <div key={patient.id} className="border border-border rounded-2xl p-4 bg-success/5 space-y-4">
                        <div className="flex items-center justify-between border-b border-border/40 pb-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-success/15 text-success flex items-center justify-center">
                              <User className="w-4 h-4" />
                            </div>
                            <div>
                              <span className={`block font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}>
                                Connected Patient: {patient.patient_name || 'Your Patient'}
                              </span>
                              <span className={`block text-muted-foreground font-semibold ${isElderly ? 'text-base' : 'text-[11px]'}`}>
                                Telegram Chat ID: {patient.patient_telegram_id || 'N/A'}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleUnlinkPatient(patient)}
                            disabled={processing}
                            className="p-2.5 text-danger bg-danger/10 hover:bg-danger/20 rounded-xl cursor-pointer transition-all disabled:opacity-50 shrink-0"
                            title="Disconnect Patient"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <button
                          onClick={() => handleMonitorPatient(patient)}
                          disabled={processing || !patient.patient_telegram_id}
                          className={`w-full font-black rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover transition-all shadow-sm cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 ${
                            isElderly ? 'h-[72px] text-2xl' : 'h-10 text-xs'
                          }`}
                        >
                          <Stethoscope className="w-4 h-4" />
                          <span>Monitor Patient Dashboard</span>
                        </button>
                      </div>
                    ) : (
                      <div key={patient.id} className="border border-warning/30 rounded-2xl p-4 bg-warning/5 space-y-4">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/40 pb-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-warning/15 text-warning flex items-center justify-center">
                              <User className="w-4 h-4 animate-bounce" />
                            </div>
                            <div>
                              <span className={`block font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}>
                                Pending Connection Request: {patient.patient_name || 'New Patient'}
                              </span>
                              <span className={`block text-muted-foreground font-semibold ${isElderly ? 'text-base' : 'text-[11px]'}`}>
                                Telegram Chat ID: {patient.patient_telegram_id || 'N/A'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3">
                          <button
                            onClick={() => handleAcceptPatient(patient)}
                            disabled={processing}
                            className={`flex-1 font-black rounded-xl bg-success text-success-foreground hover:bg-success/90 transition-all shadow-sm cursor-pointer flex items-center justify-center gap-2 ${
                              isElderly ? 'h-[72px] text-2xl' : 'h-10 text-xs'
                            }`}
                          >
                            <Check className="w-4 h-4" />
                            <span>Accept Connection Request</span>
                          </button>
                          <button
                            onClick={() => handleUnlinkPatient(patient)}
                            disabled={processing}
                            className={`font-bold rounded-xl bg-danger/10 text-danger hover:bg-danger/20 transition-all cursor-pointer flex items-center justify-center gap-2 ${
                              isElderly ? 'h-[72px] px-8 text-2xl' : 'h-10 px-5 text-xs'
                            }`}
                          >
                            <Trash2 className="w-4 h-4" />
                            <span>Reject</span>
                          </button>
                        </div>
                      </div>
                    )
                  ))}
                </div>
              ) : (
                <div className="border border-border border-dashed rounded-2xl p-6 text-center space-y-2 bg-muted/10">
                  <Smartphone className="w-8 h-8 text-muted-foreground mx-auto" />
                  <p className={`font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}>
                    Waiting for patient connection...
                  </p>
                  <p className={`text-muted-foreground max-w-md mx-auto font-semibold ${isElderly ? 'text-lg' : 'text-xs'}`}>
                    Provide your Caregiver ID (<b>{caregiverRecord.caregiver_id}</b>) to your patients. They can enter this ID in their profile settings or Telegram Bot to link up. You can support multiple patients at once.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-muted/10 border border-border rounded-2xl p-6 text-center space-y-4">
              <p className={`text-muted-foreground max-w-md mx-auto font-semibold ${isElderly ? 'text-xl' : 'text-xs'}`}>
                You do not have a Caregiver ID generated yet. Generate your registration ID to link up with your patient.
              </p>
              <button
                onClick={handleBecomeCaregiver}
                disabled={processing}
                className={`font-black rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover transition-all shadow-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 mx-auto ${
                  isElderly ? 'h-[72px] px-10 text-2xl' : 'h-10 px-6 text-xs'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                <span>{processing ? 'Registering...' : 'Register Caregiver ID'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 4: SESSION CONTROLS */}
      <div className="bg-card border border-border rounded-3xl p-6 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="space-y-0.5">
          <span className={`font-extrabold text-foreground block ${isElderly ? 'text-xl' : 'text-sm'}`}>
            Sign Out
          </span>
          <span className={`text-muted-foreground block font-semibold ${isElderly ? 'text-base' : 'text-xs'}`}>
            Safely disconnect and end your session on this device.
          </span>
        </div>

        <button
          onClick={handleLogout}
          className={`flex items-center justify-center font-black rounded-xl transition-all cursor-pointer shadow-sm ${
            isElderly 
              ? 'bg-danger text-danger-foreground hover:bg-danger/90 h-[80px] px-10 text-2xl gap-2' 
              : 'bg-danger/10 hover:bg-danger/20 text-danger px-4 py-2.5 text-xs font-semibold gap-1.5'
          }`}
        >
          <LogOut className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} />
          <span>Sign Out</span>
        </button>
      </div>

      {/* SECTION 5: DANGER ZONE — DELETE ACCOUNT */}
      <div className="bg-card border-2 border-danger/40 rounded-3xl p-6 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="space-y-0.5">
          <span className={`font-extrabold text-danger block ${isElderly ? 'text-xl' : 'text-sm'}`}>
            Delete Account
          </span>
          <span className={`text-muted-foreground block font-semibold ${isElderly ? 'text-base' : 'text-xs'}`}>
            Permanently erase your account and all data (medications, reminders, health vault,
            caregiver links). This cannot be undone.
          </span>
        </div>

        <button
          onClick={handleDeleteAccount}
          disabled={deleting}
          className={`flex items-center justify-center font-black rounded-xl transition-all cursor-pointer shadow-sm disabled:opacity-60 disabled:cursor-not-allowed ${
            isElderly
              ? 'bg-danger text-danger-foreground hover:bg-danger/90 h-[80px] px-10 text-2xl gap-2'
              : 'bg-danger/10 hover:bg-danger/20 text-danger px-4 py-2.5 text-xs font-semibold gap-1.5'
          }`}
        >
          <Trash2 className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} />
          <span>{deleting ? 'Deleting…' : 'Delete Account'}</span>
        </button>
      </div>
    </div>
  );
}
