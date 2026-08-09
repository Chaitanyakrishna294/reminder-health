'use client';

// Accept / disconnect / monitor, for both directions of a care relationship.
//
// These actions used to live only in Settings, which meant care-circle management existed
// in two places: /care-circle listed the relationships but could not act on them, and
// Settings re-implemented the listing in order to offer the buttons. Two data paths, two
// accept implementations, and no answer to "which screen is the real one".
//
// /care-circle is the real one. The handler bodies here are ported unchanged from
// settings-client-view — including the legacy `caregiver_info` branches, which are still
// load-bearing and which /care-circle/requests does NOT cover.

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Check, Trash2, Stethoscope } from 'lucide-react';
import type { ConnectionSource } from '@/lib/care-circle/connection-source';

export function PatientConnectionActions({
  connectionId,
  patientName,
  patientTelegramId,
  status,
  source,
  userId,
}: {
  connectionId: string;
  patientName: string;
  patientTelegramId: string;
  status: string;
  source: ConnectionSource;
  userId: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { isElderly, setViewMode } = useUiMode();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = (status || '').toUpperCase() === 'PENDING';

  const accept = async () => {
    setProcessing(true);
    setError(null);
    try {
      if (source === 'connections') {
        // SECURITY DEFINER RPC is the authorization-checked entry point; a direct UPDATE
        // is still filtered by the validation trigger.
        const { error: e } = await supabase.rpc('respond_to_caregiver_request', {
          p_connection_id: connectionId,
          p_action: 'ACCEPT',
        });
        if (e) throw e;
      } else {
        const { error: e } = await supabase
          .from('caregiver_info')
          .update({ connection_status: 'ACCEPTED' })
          .eq('id', connectionId);
        if (e) throw e;
      }
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Could not accept this request.');
    } finally {
      setProcessing(false);
    }
  };

  const disconnect = async () => {
    const message = isPending
      ? `Reject the connection request from ${patientName}?`
      : `Disconnect from ${patientName}?`;
    if (!confirm(message)) return;

    setProcessing(true);
    setError(null);
    try {
      if (source === 'connections') {
        // Do NOT touch is_primary — the validation trigger forbids caregivers from
        // changing it, and the AFTER-UPDATE trigger promotes a replacement primary once
        // this row leaves the active-accepted set.
        const { error: e } = await supabase
          .from('caregiver_connections')
          .update({ connection_status: 'REJECTED', is_active: false })
          .eq('id', connectionId);
        if (e) throw e;
      } else {
        const { error: e } = await supabase
          .from('caregiver_info')
          .update({ patient_telegram_id: null })
          .eq('id', connectionId);
        if (e) throw e;
      }
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Could not disconnect.');
    } finally {
      setProcessing(false);
    }
  };

  const monitor = async () => {
    if (!patientTelegramId) return;
    setProcessing(true);
    try {
      await supabase.from('audit_logs').insert([{
        user_id: userId,
        action: 'Entered Monitoring Mode',
        details: { patient_name: patientName, patient_chat_id: patientTelegramId },
      }]);
    } catch (err) {
      console.error('[CareCircle] Compliance audit log error:', err);
    } finally {
      document.cookie = `monitored-patient-id=${patientTelegramId}; path=/; max-age=31536000; SameSite=Lax`;
      setViewMode('PATIENT_MONITOR');
      setProcessing(false);
      router.push('/dashboard');
      router.refresh();
    }
  };

  const h = isElderly ? 'h-16 text-lg' : 'h-11 text-xs';

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-[11px] font-semibold text-danger-strong bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        {isPending ? (
          <button
            onClick={accept}
            disabled={processing}
            /* `flex-1` in a `flex-col` parent divides HEIGHT, not width — it squashed
               this button to 16px on mobile. Full width below sm, flexible above it. */
            className={`w-full sm:flex-1 shrink-0 font-black rounded-xl bg-success text-success-foreground hover:bg-success/90 transition-all shadow-sm cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 ${h}`}
          >
            <Check className="w-4 h-4" />
            <span>{processing ? 'Working…' : 'Accept request'}</span>
          </button>
        ) : (
          <button
            onClick={monitor}
            disabled={processing || !patientTelegramId}
            /* `flex-1` in a `flex-col` parent divides HEIGHT, not width — it squashed
               this button to 16px on mobile. Full width below sm, flexible above it. */
            className={`w-full sm:flex-1 shrink-0 font-black rounded-xl bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all shadow-sm cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 ${h}`}
          >
            <Stethoscope className="w-4 h-4" />
            <span>Monitor dashboard</span>
          </button>
        )}
        {/* Destructive, so it is deliberately NOT a peer of the primary action.
            In the `flex-col` mobile layout the default `align-items: stretch` made this
            a FULL-WIDTH tinted red button sitting directly under "Monitor dashboard" —
            three same-sized stacked blocks where the third one disconnects a patient.
            `self-center` takes it back to its own width, and the fill drops to a ghost,
            matching the `danger-ghost` treatment the medication list already uses for
            delete. Still a 44px target, still red, still labelled. */}
        <button
          onClick={disconnect}
          disabled={processing}
          title={isPending ? 'Reject request' : 'Disconnect patient'}
          aria-label={isPending ? `Reject request from ${patientName}` : `Disconnect from ${patientName}`}
          className={`shrink-0 self-center sm:self-auto font-bold rounded-xl bg-transparent text-danger-strong border border-transparent hover:bg-danger/10 hover:border-danger/25 transition-all cursor-pointer flex items-center justify-center gap-1.5 px-4 disabled:opacity-50 ${h}`}
        >
          <Trash2 className="w-4 h-4" />
          <span>{isPending ? 'Reject' : 'Remove'}</span>
        </button>
      </div>
    </div>
  );
}

export function CaregiverConnectionActions({
  connectionId,
  caregiverName,
  source,
}: {
  connectionId: string;
  caregiverName: string;
  source: ConnectionSource;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { isElderly } = useUiMode();
  const [processing, setProcessing] = useState(false);

  const disconnect = async () => {
    if (!confirm(`Stop sharing your medication history with ${caregiverName}?`)) return;
    setProcessing(true);
    try {
      if (source === 'connections') {
        const { error } = await supabase
          .from('caregiver_connections')
          .update({ is_active: false, connection_status: 'REJECTED' })
          .eq('id', connectionId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('caregiver_info')
          .update({ patient_telegram_id: null })
          .eq('id', connectionId);
        if (error) throw error;
      }
      router.refresh();
    } catch (err) {
      console.error('[CareCircle] Disconnect caregiver failed:', err);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <button
      onClick={disconnect}
      disabled={processing}
      title="Disconnect caregiver"
      aria-label={`Disconnect from ${caregiverName}`}
      className={`shrink-0 flex items-center justify-center rounded-xl bg-danger/10 text-danger-strong border border-danger/25 hover:bg-danger/15 transition-all cursor-pointer disabled:opacity-50 ${
        isElderly ? 'w-14 h-14' : 'w-11 h-11'
      }`}
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
