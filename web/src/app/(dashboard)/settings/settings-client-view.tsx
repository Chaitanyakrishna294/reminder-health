'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUiMode } from '@/context/ui-mode-context';
import { createClient } from '@/lib/supabase/client';
import {
  Settings,
  LogOut,
  Stethoscope,
  Copy,
  Check,
  AlertCircle,
  Trash2,
  Link2,
  Sparkles,
  Share2,
  Users,
  ArrowRight
} from 'lucide-react';
import { CARE_LABELS } from '@/lib/design/semantics';
import { isGuestGuardError } from '@/lib/auth/guest';
import { clearNativeSchedule } from '@/lib/native/schedule-bridge';
import ReminderSetupGuide from '@/components/native/reminder-setup-guide';

interface SettingsClientViewProps {
  user: {
    id: string;
    email: string;
    fullName: string;
    role: 'PATIENT' | 'CAREGIVER';
    telegramChatId: string;
    connectCode?: string;
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
  const { isElderly, toggleMode } = useUiMode();

  // State management. `linkedCaregivers` and `linkedPatients` are only counts on this
  // screen now — /care-circle owns the lists and every mutation on them.
  const [linkedCaregivers, setLinkedCaregivers] = useState(initialLinkedCaregivers);
  const [caregiverRecord, setCaregiverRecord] = useState(initialCaregiverRecord);
  const linkedPatients = initialLinkedPatients;

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
    // See navbar.tsx: wipe the Android app's local alarms before the session
    // goes, or this account's doses ring for whoever signs in next.
    await clearNativeSchedule().catch((err) => {
      console.error('[Settings] clearNativeSchedule failed:', err);
    });
    await supabase.auth.signOut();
    router.refresh();
    router.push('/login');
  };

  // --- Account deletion (GDPR right to erasure) ---
  // The confirmation used to be `window.prompt`. Installed PWAs and several mobile
  // browsers suppress it outright, and a suppressed prompt returns null — which this
  // code reads as "not confirmed", so the button did nothing at all and gave no reason.
  // An in-app modal always renders, and can spell out what is about to be destroyed.
  const [deleting, setDeleting] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const handleDeleteAccount = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') return;

    setDeleting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to delete account.');
      }
      // Deleting the account matters even more than logging out: the medications
      // are gone server-side, so any alarm left registered on the device would
      // ring for a dose that no longer exists anywhere.
      await clearNativeSchedule().catch((clearErr) => {
        console.error('[Settings] clearNativeSchedule failed after delete:', clearErr);
      });
      await supabase.auth.signOut();
      router.refresh();
      router.push('/login');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete account.');
      setDeleting(false);
      setDeleteModalOpen(false);
    }
  };

  const handleCopyId = () => {
    if (!caregiverRecord?.caregiver_id) return;
    navigator.clipboard.writeText(caregiverRecord.caregiver_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [copiedCode, setCopiedCode] = useState(false);
  const handleCopyConnectCode = () => {
    if (!user.connectCode) return;
    navigator.clipboard.writeText(user.connectCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // --- PATIENT: Link Caregiver (Sprint 5.6C: creates caregiver_connections + notification) ---
  const handleLinkCaregiver = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    
    const formattedId = cgIdInput.trim().toUpperCase();
    const isConnectCode = /^RM[A-Z0-9]{6}$/.test(formattedId);
    const isLegacyCgId = /^CG\d{6}$/.test(formattedId);
    if (!isConnectCode && !isLegacyCgId) {
      setErrorMsg('Invalid code. Enter a Connect Code (e.g. RMAB12CD) or a legacy Caregiver ID (e.g. CG123456).');
      return;
    }

    if (!user.telegramChatId) {
      setErrorMsg('You must have a resolved account session to link a caregiver.');
      return;
    }

    setProcessing(true);
    try {
      // Resolve the invitee's profile. A Connect Code (universal, works for web-only
      // accounts) resolves any profile; a legacy CG-ID resolves a Telegram caregiver.
      let targetProfileId: string | null = null;
      let targetName = 'Caregiver';
      if (isConnectCode) {
        const { data: lk, error: lkErr } = await supabase
          .rpc('lookup_profile_by_connect_code', { p_code: formattedId });
        if (lkErr) throw lkErr;
        const match = Array.isArray(lk) ? lk[0] : lk;
        targetProfileId = match?.profile_id ?? null;
        targetName = match?.full_name || 'Caregiver';
      } else {
        const { data: lk, error: lkErr } = await supabase
          .rpc('lookup_caregiver_by_code', { p_cg_id: formattedId });
        if (lkErr) throw lkErr;
        const match = Array.isArray(lk) ? lk[0] : lk;
        targetProfileId = match?.caregiver_profile_id ?? null;
        targetName = match?.caregiver_name || 'Caregiver';
      }

      if (!targetProfileId) {
        setErrorMsg('Code not found or inactive. Please ask them for their correct Connect Code.');
        setProcessing(false);
        return;
      }
      const cgName = targetName;

      // 2. Create/reactivate the request via invite_caregiver (handles dedupe + reactivation
      //    + the request notification trigger, all under SECURITY DEFINER).
      const { data: connId, error: connErr } = await supabase
        .rpc('invite_caregiver', { caregiver_id: targetProfileId });

      if (connErr) {
        const m = (connErr.message || '').toLowerCase();
        // The caregiver_connections guard trigger fired: this is a guest session.
        // Checked FIRST — the generic fallback below would tell them to "try
        // again", which can never succeed until they save the account.
        if (isGuestGuardError(connErr)) {
          setErrorMsg('Save your account with an email before connecting with a caregiver.');
        } else if (m.includes('already connected')) {
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

  // Accept / reject / disconnect / monitor for care relationships moved to
  // components/care-circle/connection-actions.tsx when /care-circle became the
  // canonical screen for them. They were implemented twice before that.


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
        <div className="bg-danger/10 border border-danger/30 text-danger-strong p-4 rounded-2xl flex items-start gap-2.5 animate-fade-in">
          <AlertCircle className="w-5 h-5 shrink-0 text-danger mt-0.5" />
          <p className={`font-bold ${isElderly ? 'text-lg' : 'text-xs'}`}>{errorMsg}</p>
        </div>
      )}

      {successMsg && (
        <div className="bg-success/10 border border-success/30 text-success-strong p-4 rounded-2xl flex items-start gap-2.5 animate-fade-in">
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
            <h4 className={`font-black text-foreground ${isElderly ? 'text-2xl break-words' : 'text-base truncate'}`}>
              {user.fullName}
            </h4>
            <p className={`text-muted-foreground font-semibold ${isElderly ? 'text-lg mt-0.5 break-all' : 'text-xs truncate'}`}>
              {user.email}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5 pt-2">
          {user.telegramChatId && !user.telegramChatId.startsWith('WEB-') ? (
            <span className={`inline-flex items-center px-3 py-1 rounded-full font-bold bg-muted text-muted-foreground border border-border ${
              isElderly ? 'text-base' : 'text-[11px]'
            }`}>
              Telegram Linked: {user.telegramChatId}
            </span>
          ) : (
            /* The "Telegram Not Connected" badge sat right beside a button reading
               "Connect Telegram Bot" — two controls' worth of space saying the same
               thing once. The button already carries the state. It was also 28px tall,
               well under a usable touch target. */
            <button
              onClick={() => router.push('/link-account')}
              className={`font-black rounded-xl border border-primary text-primary hover:bg-primary/5 transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 ${
                isElderly ? 'h-14 px-6 text-base' : 'h-11 px-4 text-xs'
              }`}
            >
              Connect Telegram Bot
            </button>
          )}
        </div>

        {/* Universal Connect Code — share to let anyone (web or Telegram) link with you */}
        {user.connectCode && (
          /* There are two codes on this page and a field for typing in a third. The
             share-out cards and the type-in field looked nearly identical, so "the code
             I give people" and "the code someone gave me" were easy to confuse. Every
             outbound code now wears the info tint and an outbound arrow; the inbound
             field stays neutral. */
          <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-info/5 border border-info/25 rounded-2xl p-4">
            <div className="space-y-0.5">
              <span className={`font-extrabold text-foreground flex items-center gap-1.5 ${isElderly ? 'text-lg' : 'text-sm'}`}>
                <Share2 className="w-4 h-4 text-info shrink-0" aria-hidden="true" />
                Your Connect Code — give this out
              </span>
              <span className={`text-muted-foreground block ${isElderly ? 'text-base' : 'text-xs'}`}>
                Share this so others can connect with you in Care Circle. Works for any account.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <code className={`font-mono font-black tracking-widest bg-card border border-border rounded-xl px-3 py-2 ${isElderly ? 'text-xl' : 'text-base'}`}>
                {user.connectCode}
              </code>
              <button
                onClick={handleCopyConnectCode}
                aria-label="Copy connect code"
                className="flex items-center gap-1.5 font-bold rounded-xl bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all cursor-pointer h-11 px-3 text-xs"
              >
                {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedCode ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 1b: REMINDER SETUP GUIDE (Android app only — renders nothing on
          the web, where there are no device alarms to protect). Placed high on
          purpose: a phone silently killing alarms outranks every preference
          below it. */}
      <ReminderSetupGuide />

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

          {/* Was a plain button whose only state signal was its own label — you had to
              read "Enable"/"Disable" and reason backwards to work out whether the mode
              was currently on. It's a setting with two states, so it's a switch: the
              knob's position shows the state without being read, and `role="switch"` +
              `aria-checked` say the same thing to a screen reader. Matches the inventory
              toggle in the medication wizard. */}
          <button
            type="button"
            role="switch"
            aria-checked={isElderly}
            onClick={toggleMode}
            className={`shrink-0 self-start sm:self-center inline-flex items-center gap-3 rounded-2xl border transition-all cursor-pointer bg-card hover:bg-muted border-border ${
              isElderly ? 'h-16 px-5' : 'h-12 px-4'
            }`}
          >
            <span className={`font-bold text-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>
              {isElderly ? 'On' : 'Off'}
            </span>
            <span
              aria-hidden="true"
              className={`relative shrink-0 rounded-full transition-colors ${
                isElderly ? 'w-16 h-9 bg-primary' : 'w-11 h-6 bg-input'
              }`}
            >
              <span
                className={`absolute top-[2px] bg-white border border-border rounded-full transition-all ${
                  isElderly
                    ? 'h-8 w-8 left-[calc(100%-2.125rem)]'
                    : 'h-5 w-5 left-[2px]'
                }`}
              />
            </span>
          </button>
        </div>
      </div>

      {/* SECTION 3: CARE CIRCLE — IDENTITY ONLY.
          This section used to duplicate /care-circle wholesale: it re-queried the
          caregiver and patient lists through a THIRD data path (caregiver_connections +
          legacy caregiver_info + active_caregiver_links, with its own name-resolution
          helpers), and carried a second, independent implementation of accept/reject.
          Two screens owning the same relationships meant they could disagree, and neither
          was obviously the real one.

          /care-circle is canonical now. What stays here is identity — the codes you hand
          out and the code you type in — because that is genuinely account settings. The
          relationships themselves live one tap away. */}
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
            Care Circle
          </h3>
          <p className={`text-muted-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>
            Your connect codes live here. To see who you are linked to, accept requests, or
            change what a caregiver can view, open the Care Circle.
          </p>
        </div>

        {/* Summary + the one route to the lists. */}
        <Link
          href="/care-circle"
          className={`flex items-center justify-between gap-4 rounded-2xl border border-border bg-muted/30 hover:bg-muted transition-all cursor-pointer ${
            isElderly ? 'p-6' : 'p-4'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`shrink-0 rounded-2xl bg-primary/10 text-primary flex items-center justify-center ${
              isElderly ? 'w-14 h-14' : 'w-11 h-11'
            }`}>
              <Users className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
            </div>
            <div className="min-w-0">
              <span className={`block font-extrabold text-foreground text-balance ${isElderly ? 'text-xl' : 'text-sm'}`}>
                Open your Care Circle
              </span>
              <span className={`block text-muted-foreground font-semibold ${isElderly ? 'text-base' : 'text-xs'}`}>
                {CARE_LABELS.asPatient}: {linkedCaregivers.length}
                {' · '}
                {CARE_LABELS.asCaregiver}: {linkedPatients.length}
              </span>
            </div>
          </div>
          <ArrowRight className={`shrink-0 text-muted-foreground ${isElderly ? 'w-7 h-7' : 'w-5 h-5'}`} />
        </Link>

        {/* INBOUND: a code someone gave me. Deliberately neutral, so it never reads like
            one of the outbound share cards above and below it. */}
        <form onSubmit={handleLinkCaregiver} className="space-y-3">
          <h4 className="text-xs font-black text-foreground uppercase tracking-wider">
            Link a caregiver — enter their code
          </h4>
          <div className="bg-muted/10 border border-border/80 rounded-2xl p-4 space-y-3">
            <p className={`text-muted-foreground font-semibold ${isElderly ? 'text-lg' : 'text-xs'}`}>
              Ask your caregiver for their Connect Code (or legacy Caregiver ID) and enter it here.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                placeholder="RMAB12CD or CG123456"
                aria-label="Caregiver connect code"
                value={cgIdInput}
                onChange={(e) => setCgIdInput(e.target.value)}
                disabled={processing}
                maxLength={8}
                className={`w-full sm:flex-1 shrink-0 bg-white border border-border rounded-xl focus:outline-none focus:border-primary font-mono uppercase font-black text-center ${
                  isElderly ? 'h-16 px-4 text-2xl border-2' : 'h-11 px-3 text-sm'
                }`}
              />
              <button
                type="submit"
                disabled={processing || !cgIdInput.trim()}
                className={`font-black rounded-xl bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all shadow-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 ${
                  isElderly ? 'h-16 px-8 text-xl' : 'h-11 px-5 text-xs'
                }`}
              >
                <Link2 className="w-4 h-4" />
                <span>{processing ? 'Linking...' : 'Link Caregiver'}</span>
              </button>
            </div>
          </div>
        </form>

        {/* OUTBOUND: my caregiver ID, for patients to enter on their side. */}
        <div className="space-y-3 pt-2 border-t border-border/40">
          {/* NOT `CARE_LABELS.asCaregiver` — that names a LIST of people, which lives on
              /care-circle now. This block is about your own caregiver identity. */}
          <h4 className="text-xs font-black text-foreground uppercase tracking-wider">
            Being a caregiver — your ID
          </h4>
          {caregiverRecord ? (
            <div className="bg-info/5 border border-info/25 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <span className={`text-muted-foreground font-semibold flex items-center gap-1.5 ${isElderly ? 'text-lg' : 'text-xs'}`}>
                  <Share2 className="w-4 h-4 text-info shrink-0" aria-hidden="true" />
                  Your Caregiver ID — give this to your patients
                </span>
                <span className={`block font-black text-primary-strong font-mono tracking-wide mt-1 ${isElderly ? 'text-3xl' : 'text-xl'}`}>
                  {caregiverRecord.caregiver_id}
                </span>
              </div>

              <button
                onClick={handleCopyId}
                type="button"
                className={`flex items-center gap-1.5 font-bold rounded-xl border border-primary/30 bg-white hover:bg-primary/5 text-primary-strong transition-all cursor-pointer ${
                  isElderly ? 'h-14 px-6 text-lg' : 'h-11 px-4 text-xs'
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
          ) : (
            <div className="bg-muted/10 border border-border rounded-2xl p-6 text-center space-y-4">
              {/* "People I Care For" as a heading above a button called "Register
                  Caregiver ID" never explained which direction it went. Say it. */}
              <p className={`text-muted-foreground max-w-md mx-auto font-semibold ${isElderly ? 'text-xl' : 'text-xs'}`}>
                Looking after someone else? Generate an ID they can enter to add you as
                their caregiver.
              </p>
              <button
                onClick={handleBecomeCaregiver}
                disabled={processing}
                className={`font-black rounded-xl bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all shadow-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 mx-auto ${
                  isElderly ? 'h-[72px] px-10 text-2xl' : 'h-11 px-6 text-xs'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                <span>{processing ? 'Registering...' : "Become someone's caregiver"}</span>
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

        {/* Sign Out and Delete Account used to be class-for-class IDENTICAL — same red
            tint, same weight, same size, sitting in adjacent cards. One ends a session;
            the other erases everything permanently. Sign Out is a neutral secondary
            action; only Delete gets the solid red. */}
        <button
          onClick={handleLogout}
          className={`shrink-0 flex items-center justify-center font-bold rounded-xl transition-all cursor-pointer bg-card border border-border text-foreground hover:bg-muted ${
            isElderly ? 'h-[72px] px-8 text-xl gap-2' : 'h-11 px-4 text-xs gap-1.5'
          }`}
        >
          <LogOut className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} />
          <span>Sign Out</span>
        </button>
      </div>

      {/* SECTION 5: DANGER ZONE — DELETE ACCOUNT */}
      <div className="bg-card border-2 border-danger/40 rounded-3xl p-6 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="space-y-0.5">
          <span className={`font-extrabold text-danger-strong block ${isElderly ? 'text-xl' : 'text-sm'}`}>
            Delete Account
          </span>
          <span className={`text-muted-foreground block font-semibold ${isElderly ? 'text-base' : 'text-xs'}`}>
            Permanently erase your account and all data (medications, reminders, health vault,
            caregiver links). This cannot be undone.
          </span>
        </div>

        <button
          onClick={() => { setDeleteConfirmText(''); setDeleteModalOpen(true); }}
          disabled={deleting}
          className={`shrink-0 flex items-center justify-center font-black rounded-xl transition-all cursor-pointer shadow-md shadow-danger/25 bg-danger-solid text-danger-solid-foreground hover:brightness-95 disabled:opacity-60 disabled:cursor-not-allowed ${
            isElderly ? 'h-[80px] px-10 text-2xl gap-2' : 'h-11 px-5 text-xs gap-1.5'
          }`}
        >
          <Trash2 className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} />
          <span>{deleting ? 'Deleting…' : 'Delete Account'}</span>
        </button>
      </div>

      {/* SECTION 6: LEGAL */}
      <div className="text-center text-xs text-muted-foreground pt-2">
        <Link href="/privacy" className="inline-flex items-center min-h-11 px-1 hover:underline">Privacy Policy</Link>
        <span className="mx-2">·</span>
        <Link href="/terms" className="inline-flex items-center min-h-11 px-1 hover:underline">Terms of Service</Link>
      </div>

      {/* Delete-account confirmation. Type-to-confirm rather than a single OK, because
          this is the one action in the app with nothing behind it. */}
      {deleteModalOpen && (
        <div
          className="fixed inset-0 bg-foreground/50 backdrop-blur-sm flex items-center justify-center p-4 z-[100] animate-fade-in"
          onClick={() => !deleting && setDeleteModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            className="bg-card border-2 border-danger/40 rounded-3xl p-6 w-full max-w-md shadow-lg space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-11 h-11 rounded-2xl bg-danger/10 text-danger flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 id="delete-account-title" className={`font-black text-foreground ${isElderly ? 'text-2xl' : 'text-base'}`}>
                  Delete your account?
                </h3>
                <p className={`text-muted-foreground mt-1 ${isElderly ? 'text-base' : 'text-xs'}`}>
                  This permanently erases your medications, reminder history, health vault
                  files and caregiver links. It cannot be undone, and your caregivers will
                  stop receiving alerts about you.
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="delete-confirm" className={`block font-bold text-foreground mb-1.5 ${isElderly ? 'text-lg' : 'text-xs'}`}>
                Type <span className="font-mono text-danger-strong">DELETE</span> to confirm
              </label>
              <input
                id="delete-confirm"
                type="text"
                autoComplete="off"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                disabled={deleting}
                className={`w-full px-4 rounded-2xl bg-background border border-input text-foreground font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-danger ${
                  isElderly ? 'h-16 text-xl' : 'h-12 text-sm'
                }`}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleting}
                className={`font-bold rounded-xl bg-card border border-border text-foreground hover:bg-muted transition-all cursor-pointer disabled:opacity-50 ${
                  isElderly ? 'h-16 px-6 text-lg' : 'h-11 px-4 text-xs'
                }`}
              >
                Keep my account
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                className={`font-black rounded-xl bg-danger-solid text-danger-solid-foreground shadow-md shadow-danger/25 hover:brightness-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  isElderly ? 'h-16 px-6 text-lg' : 'h-11 px-5 text-xs'
                }`}
              >
                {deleting ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
