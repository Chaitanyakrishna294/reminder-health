'use client';

/**
 * Send the request again, for an invitation that is still waiting.
 *
 * THE GAP THIS FILLS. A patient could send an invitation and disconnect one —
 * that is the revoke, and it already worked — but if the other person missed the
 * notification there was nothing to do about it except disconnect and re-enter
 * the code from memory. The commonest real outcome of an invitation is "they did
 * not see it", and it was the one outcome with no button.
 *
 * Calls `resend_caregiver_request`, which takes a CONNECTION id and resolves the
 * invitee inside the database. `invite_caregiver` would have needed the invitee's
 * profile id, which `active_caregiver_links` deliberately does not expose — and
 * widening that view to enable one button would hand every client a second
 * person's profile id permanently.
 *
 * Patient-only and pending-only, enforced in the RPC rather than here: a
 * caregiver resending their own invitation would be nagging someone about access
 * to that person's medication history, and re-asking after a decline is what
 * this must never become.
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';

export default function ResendInvite({
  connectionId,
  name,
}: {
  /** The connection to re-notify. The RPC resolves the invitee internally. */
  connectionId: string;
  name: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { isElderly } = useUiMode();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resend = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.rpc('resend_caregiver_request', {
        p_connection_id: connectionId,
      });
      if (e) throw e;
      setSent(true);
      router.refresh();
    } catch (err) {
      console.error('[CareCircle] resend failed:', err);
      setError('Could not send it again. Please try in a moment.');
    } finally {
      setBusy(false);
    }
  };

  // Confirmed and then left alone. A button that stays tappable invites someone
  // to send four notifications to their daughter in ten seconds.
  if (sent) {
    return (
      <span className={`font-bold text-success-strong ${isElderly ? 'text-base' : 'text-xs'}`} role="status">
        Sent again
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={resend}
        disabled={busy}
        aria-label={`Send the request to ${name} again`}
        className={`inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl border border-border font-bold text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isElderly ? 'text-base' : 'text-xs'
        }`}
      >
        <Send className="w-4 h-4 shrink-0" aria-hidden />
        {busy ? 'Sending…' : 'Send again'}
      </button>
      {error && (
        <span className="text-[11px] font-semibold text-danger-strong" role="alert">{error}</span>
      )}
    </span>
  );
}
