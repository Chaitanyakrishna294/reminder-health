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
    id: number;
    caregiver_id: string;
    patient_telegram_id: string | null;
    connection_status?: string | null;
  } | null;
  linkedPatientName: string | null;
}

export default function SettingsClientView({
  user,
  linkedCaregivers: initialLinkedCaregivers = [],
  caregiverRecord: initialCaregiverRecord,
  linkedPatientName: initialLinkedPatientName,
}: SettingsClientViewProps) {
  const router = useRouter();
  const supabase = createClient();
  const { isElderly, toggleMode, viewMode, setViewMode } = useUiMode();

  // State management
  const [linkedCaregivers, setLinkedCaregivers] = useState(initialLinkedCaregivers);
  const [caregiverRecord, setCaregiverRecord] = useState(initialCaregiverRecord);
  const [linkedPatientName, setLinkedPatientName] = useState(initialLinkedPatientName);

  const [cgIdInput, setCgIdInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.refresh();
    router.push('/login');
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
      // 1. Fetch caregiver details from caregiver_info (legacy ID exchange)
      const { data: cgData, error: fetchErr } = await supabase
        .from('caregiver_info')
        .select('*')
        .eq('caregiver_id', formattedId)
        .eq('is_active', true);

      if (fetchErr || !cgData || cgData.length === 0) {
        setErrorMsg('Caregiver ID not found or inactive. Please ask your caregiver for their correct ID.');
        setProcessing(false);
        return;
      }

      const caregiver = cgData[0];

      // 2. Resolve caregiver's profile UUID from their telegram_chat_id
      const { data: cgProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('telegram_chat_id', caregiver.caregiver_chat_id)
        .single();

      if (!cgProfile) {
        setErrorMsg('Unable to resolve caregiver profile. Please contact support.');
        setProcessing(false);
        return;
      }

      // 3. Check for existing connection
      const { data: existingConn } = await supabase
        .from('caregiver_connections')
        .select('id, connection_status')
        .eq('caregiver_profile_id', cgProfile.id)
        .eq('patient_profile_id', user.id)
        .maybeSingle();

      if (existingConn) {
        if (existingConn.connection_status === 'ACCEPTED') {
          setErrorMsg('You are already connected with this caregiver.');
        } else if (existingConn.connection_status === 'PENDING') {
          setErrorMsg('A connection request is already pending with this caregiver.');
        } else {
          // Re-activate a previously rejected/withdrawn connection
          const { error: reactivateErr } = await supabase
            .from('caregiver_connections')
            .update({ 
              connection_status: 'PENDING', 
              is_active: true,
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .eq('id', existingConn.id);

          if (reactivateErr) throw reactivateErr;

          // Insert notification for the caregiver
          await supabase
            .from('notifications')
            .insert({
              user_id: cgProfile.id,
              title: 'Care Circle Request',
              message: `${user.fullName} would like you to support their medication routine.`,
              type: 'CARE_CIRCLE_ACCESS_REQUEST',
              connection_id: existingConn.id,
            });

          setSuccessMsg(`Connection request re-sent to ${caregiver.caregiver_name || 'Caregiver'}. Waiting for approval.`);
        }
        setProcessing(false);
        setCgIdInput('');
        router.refresh();
        return;
      }

      // 4. Create new connection in caregiver_connections
      const { data: newConn, error: connErr } = await supabase
        .from('caregiver_connections')
        .insert({
          caregiver_profile_id: cgProfile.id,
          patient_profile_id: user.id,
          connection_status: 'PENDING',
          is_active: true,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select('id')
        .single();

      if (connErr) throw connErr;

      // 5. Insert CARE_CIRCLE_ACCESS_REQUEST notification for the caregiver
      if (newConn) {
        await supabase
          .from('notifications')
          .insert({
            user_id: cgProfile.id,
            title: 'Care Circle Request',
            message: `${user.fullName} would like you to support their medication routine.`,
            type: 'CARE_CIRCLE_ACCESS_REQUEST',
            connection_id: newConn.id,
          });
      }

      // 6. Also update legacy caregiver_info for backward compatibility
      await supabase
        .from('caregiver_info')
        .update({ 
          patient_telegram_id: user.telegramChatId,
          connection_status: 'PENDING'
        })
        .eq('caregiver_id', formattedId);

      const newLinked = {
        id: newConn?.id || caregiver.id,
        caregiver_id: caregiver.caregiver_id,
        caregiver_name: caregiver.caregiver_name || 'Caregiver',
        caregiver_chat_id: caregiver.caregiver_chat_id || '',
        connection_status: 'PENDING',
        source: 'connections' as const,
      };
      setLinkedCaregivers(prev => [newLinked, ...prev]);
      setSuccessMsg(`Connection request sent to ${caregiver.caregiver_name || 'Caregiver'}. Waiting for approval.`);
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
        // New architecture: update caregiver_connections
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

  // --- CAREGIVER: Unlink Patient / Reject Connection Request ---
  const handleUnlinkPatient = async () => {
    if (!caregiverRecord) return;
    const isPending = caregiverRecord.connection_status === 'PENDING';
    const confirmMessage = isPending 
      ? 'Are you sure you want to reject this patient connection request?' 
      : 'Are you sure you want to disconnect from this patient?';
    
    if (!confirm(confirmMessage)) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    setProcessing(true);

    try {
      const { error } = await supabase
        .from('caregiver_info')
        .update({ 
          patient_telegram_id: null,
          connection_status: null 
        })
        .eq('id', caregiverRecord.id);

      if (error) throw error;

      setCaregiverRecord({
        ...caregiverRecord,
        patient_telegram_id: null,
        connection_status: null
      });
      setLinkedPatientName(null);
      setSuccessMsg(isPending ? 'Rejected patient connection request.' : 'Successfully disconnected from your patient.');
      router.refresh();
    } catch (err: any) {
      console.error('[Settings] Unlink Patient Error:', err);
      setErrorMsg('Failed to process request.');
    } finally {
      setProcessing(false);
    }
  };

  // --- CAREGIVER: Accept Patient Connection Request ---
  const handleAcceptPatient = async () => {
    if (!caregiverRecord) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    setProcessing(true);

    try {
      // Update legacy caregiver_info
      const { error } = await supabase
        .from('caregiver_info')
        .update({ connection_status: 'ACCEPTED' })
        .eq('id', caregiverRecord.id);

      if (error) throw error;

      // Also update caregiver_connections if a matching record exists
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        await supabase
          .from('caregiver_connections')
          .update({ connection_status: 'ACCEPTED' })
          .eq('caregiver_profile_id', authUser.id)
          .eq('connection_status', 'PENDING')
          .eq('is_active', true);
      }

      setCaregiverRecord({
        ...caregiverRecord,
        connection_status: 'ACCEPTED'
      });
      
      setSuccessMsg('Successfully accepted connection request! You are now linked.');
      router.refresh();
    } catch (err: any) {
      console.error('[Settings] Accept Patient Error:', err);
      setErrorMsg('Failed to accept patient connection.');
    } finally {
      setProcessing(false);
    }
  };

  const handleMonitorPatient = async () => {
    if (!caregiverRecord?.patient_telegram_id) return;
    setProcessing(true);
    try {
      // Compliance logging
      await supabase
        .from('audit_logs')
        .insert([{
          user_id: user.id,
          action: 'Entered Monitoring Mode',
          details: { 
            patient_name: linkedPatientName || 'Your Patient',
            patient_chat_id: caregiverRecord.patient_telegram_id
          }
        }]);
    } catch (err) {
      console.error('[Settings] Compliance audit log error:', err);
    } finally {
      setViewMode('PATIENT_MONITOR');
      setProcessing(false);
      router.push('/dashboard');
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
      <div className="bg-card border border-border rounded-3xl p-6 shadow-sm space-y-6">
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
                  className={`font-black rounded-xl bg-primary text-primary-foreground hover:bg-primary/95 transition-all shadow-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 ${
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

              {/* Patient Connection Status */}
              {caregiverRecord.patient_telegram_id ? (
                caregiverRecord.connection_status === 'ACCEPTED' ? (
                  <div className="border border-border rounded-2xl p-4 bg-success/5 space-y-4">
                    <div className="flex items-center justify-between border-b border-border/40 pb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-success/15 text-success flex items-center justify-center">
                          <User className="w-4 h-4" />
                        </div>
                        <div>
                          <span className={`block font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}>
                            Connected Patient: {linkedPatientName || 'Your Patient'}
                          </span>
                          <span className={`block text-muted-foreground font-semibold ${isElderly ? 'text-base' : 'text-[11px]'}`}>
                            Telegram Chat ID: {caregiverRecord.patient_telegram_id}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={handleUnlinkPatient}
                        disabled={processing}
                        className="p-2.5 text-danger bg-danger/10 hover:bg-danger/20 rounded-xl cursor-pointer transition-all disabled:opacity-50 shrink-0"
                        title="Disconnect Patient"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <button
                      onClick={handleMonitorPatient}
                      disabled={processing}
                      className={`w-full font-black rounded-xl bg-primary text-primary-foreground hover:bg-primary/95 transition-all shadow-sm cursor-pointer flex items-center justify-center gap-2 ${
                        isElderly ? 'h-[72px] text-2xl' : 'h-10 text-xs'
                      }`}
                    >
                      <Stethoscope className="w-4 h-4" />
                      <span>Monitor Patient Dashboard</span>
                    </button>
                  </div>
                ) : (
                  <div className="border border-warning/30 rounded-2xl p-4 bg-warning/5 space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/40 pb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-warning/15 text-warning flex items-center justify-center">
                          <User className="w-4 h-4 animate-bounce" />
                        </div>
                        <div>
                          <span className={`block font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}>
                            Pending Connection Request: {linkedPatientName || 'New Patient'}
                          </span>
                          <span className={`block text-muted-foreground font-semibold ${isElderly ? 'text-base' : 'text-[11px]'}`}>
                            Telegram Chat ID: {caregiverRecord.patient_telegram_id}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        onClick={handleAcceptPatient}
                        disabled={processing}
                        className={`flex-1 font-black rounded-xl bg-success text-success-foreground hover:bg-success/90 transition-all shadow-sm cursor-pointer flex items-center justify-center gap-2 ${
                          isElderly ? 'h-[72px] text-2xl' : 'h-10 text-xs'
                        }`}
                      >
                        <Check className="w-4 h-4" />
                        <span>Accept Connection Request</span>
                      </button>
                      <button
                        onClick={handleUnlinkPatient}
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
              ) : (
                <div className="border border-border border-dashed rounded-2xl p-6 text-center space-y-2 bg-muted/10">
                  <Smartphone className="w-8 h-8 text-muted-foreground mx-auto" />
                  <p className={`font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}>
                    Waiting for patient connection...
                  </p>
                  <p className={`text-muted-foreground max-w-md mx-auto font-semibold ${isElderly ? 'text-lg' : 'text-xs'}`}>
                    Provide your Caregiver ID (<b>{caregiverRecord.caregiver_id}</b>) to your patient. They can enter this ID in their profile settings or Telegram Bot to link up.
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
                className={`font-black rounded-xl bg-primary text-primary-foreground hover:bg-primary/95 transition-all shadow-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 mx-auto ${
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
    </div>
  );
}
