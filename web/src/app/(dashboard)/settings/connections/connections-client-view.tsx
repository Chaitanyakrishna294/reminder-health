'use client';

/**
 * Settings → Connections. Codes, both directions, on one page.
 *
 * Sharing your code and typing in someone else's are the same task from two sides,
 * and in the old single-page Settings they were three sections apart — your code
 * near the top, the entry form far below, with the setup guide between them. Nobody
 * connecting two phones reads them in that order.
 *
 * This page is codes ONLY. Managing the relationships that result — permissions,
 * accept/reject, removal — is /care-circle, which is canonical for that and has been
 * since the 2026-08-11 audit. Two screens owning the same relationships is exactly
 * how the caregiver dual-read happened.
 *
 * Written fresh rather than carved out of the old file: those sections shared
 * wrapper divs, so "keep the code, drop the profile" was not a line range.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Copy, Check, AlertCircle, Link2, Users, ArrowRight } from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';
import { isGuestGuardError } from '@/lib/auth/guest';
import AccessScopeSummary from '@/components/care-circle/access-scope-summary';
import { DEFAULT_ACCESS } from '@/lib/care-circle/access-scope';

export default function ConnectionsClientView({
  connectCode,
  hasTelegramChatId,
}: {
  connectCode: string;
  hasTelegramChatId: boolean;
}) {
  const supabase = createClient();
  const { isElderly } = useUiMode();

  const [copied, setCopied] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  /**
   * The resolved person, held between "who is this code?" and "send it".
   *
   * The flow used to do both in one tap: resolve a code to a name and
   * immediately grant standing access to a medication list. The consent was real
   * and the information was not. Nothing is sent while this is set — it is the
   * pause where the scope summary lives.
   */
  const [pendingInvite, setPendingInvite] = useState<{ profileId: string; name: string } | null>(null);

  const copyCode = () => {
    if (!connectCode) return;
    navigator.clipboard.writeText(connectCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const code = codeInput.trim().toUpperCase();
    // Two shapes are valid: the universal Connect Code (works for web-only accounts)
    // and the legacy CG-ID from the Telegram era. Both still exist in real data.
    const isConnectCode = /^RM[A-Z0-9]{6}$/.test(code);
    const isLegacyCgId = /^CG\d{6}$/.test(code);
    if (!isConnectCode && !isLegacyCgId) {
      setError('That code does not look right. It should look like RMAB12CD.');
      return;
    }
    if (!hasTelegramChatId) {
      setError('Your account is still being set up. Please try again in a moment.');
      return;
    }

    setBusy(true);
    try {
      // Resolve the code to a profile. Both lookups are SECURITY DEFINER, locked to
      // `authenticated`, and guarded with auth.uid() in the body since 2026-08-13.
      let profileId: string | null = null;
      let name = 'them';
      if (isConnectCode) {
        const { data, error: err } = await supabase.rpc('lookup_profile_by_connect_code', { p_code: code });
        if (err) throw err;
        const m = Array.isArray(data) ? data[0] : data;
        profileId = m?.profile_id ?? null;
        name = m?.full_name || 'them';
      } else {
        const { data, error: err } = await supabase.rpc('lookup_caregiver_by_code', { p_cg_id: code });
        if (err) throw err;
        const m = Array.isArray(data) ? data[0] : data;
        profileId = m?.caregiver_profile_id ?? null;
        name = m?.caregiver_name || 'them';
      }

      if (!profileId) {
        setError('No one found with that code. Ask them to check it.');
        return;
      }

      // STOP HERE. Resolving a code is not consent to share a medication
      // history — the summary below the form now says what this will grant, and
      // sending is a second, deliberate tap.
      setPendingInvite({ profileId, name });
    } catch (err) {
      console.error('[Connections] connect failed:', err);
      setError('Could not send the request. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const sendInvite = async () => {
    if (!pendingInvite) return;
    setBusy(true);
    setError(null);
    try {
      // invite_caregiver handles dedupe, reactivation and the request notification,
      // all under SECURITY DEFINER — never a direct INSERT from the browser.
      const { error: connErr } = await supabase.rpc('invite_caregiver', {
        caregiver_id: pendingInvite.profileId,
      });
      if (connErr) {
        if (isGuestGuardError(connErr)) {
          setError('Add an email to your account first, then you can connect with someone.');
        } else {
          console.error('[Connections] invite_caregiver failed:', connErr);
          setError('Could not send the request. Please try again.');
        }
        return;
      }
      setSuccess(`Request sent to ${pendingInvite.name}. They will see it on their phone.`);
      setCodeInput('');
      setPendingInvite(null);
    } catch (err) {
      console.error('[Connections] invite failed:', err);
      setError('Could not send the request. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const label = isElderly ? 'text-xl' : 'text-sm';
  const body = isElderly ? 'text-base' : 'text-xs';

  return (
    <div className={`max-w-2xl mx-auto ${isElderly ? 'space-y-7' : 'space-y-6'}`}>
      <header className="px-1">
        <h1 className={`font-black text-foreground tracking-tight ${isElderly ? 'text-4xl' : 'title-page'}`}>
          Connections
        </h1>
        <p className={`text-muted-foreground font-semibold mt-1 text-balance ${body}`}>
          Share your code, or enter someone else&apos;s to connect.
        </p>
      </header>

      {/* ── YOUR CODE ─────────────────────────────────────────────────────── */}
      <section className="card-lift p-5 space-y-3">
        <h2 className={`font-extrabold text-foreground ${label}`}>Your code</h2>
        <p className={`text-muted-foreground font-semibold ${body}`}>
          Give this to someone you want in your care circle.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Mono and wide-tracked: this is a value to read aloud and type, and the
              tracking is what stops O and 0 blurring together on a small screen. */}
          <code className={`font-mono font-black tracking-[0.2em] bg-muted border border-border rounded-[var(--r-control)] px-4 py-3 ${
            isElderly ? 'text-2xl' : 'text-lg'
          }`}>
            {connectCode || '—'}
          </code>
          <button
            type="button"
            onClick={copyCode}
            disabled={!connectCode}
            className={`inline-flex items-center gap-2 rounded-[var(--r-control)] border border-border font-bold hover:bg-muted transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              isElderly ? 'min-h-14 px-5 text-base' : 'min-h-11 px-4 text-xs'
            }`}
          >
            {copied ? <Check className="w-4 h-4 text-success-strong" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </section>

      {/* ── ENTER A CODE ──────────────────────────────────────────────────── */}
      <section className="card-lift p-5 space-y-3">
        <h2 className={`font-extrabold text-foreground ${label}`}>Enter a code</h2>
        <p className={`text-muted-foreground font-semibold ${body}`}>
          Ask them for their code, then type it here. They will get a request to accept.
        </p>

        <form onSubmit={connect} className="space-y-3">
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            placeholder="RMAB12CD"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Their code"
            className={`w-full font-mono font-bold tracking-[0.2em] bg-background border border-input rounded-[var(--r-control)] px-4 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring ${
              isElderly ? 'min-h-16 text-2xl' : 'min-h-12 text-base'
            }`}
          />
          <button
            type="submit"
            disabled={busy || !codeInput.trim()}
            className={`w-full inline-flex items-center justify-center gap-2 rounded-[var(--r-control)] bg-primary-strong text-primary-strong-foreground font-black hover:bg-primary-strong-hover active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              isElderly ? 'min-h-16 text-xl' : 'min-h-12 text-sm'
            }`}
          >
            <Link2 className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} />
            {/* No longer "Send request" — this step only looks the code up.
                Promising to send and then not sending is the kind of small lie
                that makes people tap twice. */}
            {busy ? 'Checking…' : 'Look up this code'}
          </button>
        </form>

        {/* THE PAUSE. Nothing has been sent yet: the code resolved to a person,
            and this is where the reader finds out what saying yes would grant
            before they say it. */}
        {pendingInvite && (
          <div className="space-y-3 pt-1">
            <AccessScopeSummary flags={DEFAULT_ACCESS} personName={pendingInvite.name} />
            <div className={`flex gap-2 ${isElderly ? 'flex-col' : ''}`}>
              <button
                type="button"
                onClick={sendInvite}
                disabled={busy}
                className={`flex-1 inline-flex items-center justify-center gap-2 rounded-[var(--r-control)] bg-primary-strong text-primary-strong-foreground font-black hover:bg-primary-strong-hover active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isElderly ? 'min-h-16 text-xl' : 'min-h-12 text-sm'
                }`}
              >
                <Link2 className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} aria-hidden />
                {busy ? 'Sending…' : `Send request to ${pendingInvite.name}`}
              </button>
              <button
                type="button"
                onClick={() => { setPendingInvite(null); setError(null); }}
                disabled={busy}
                className={`inline-flex items-center justify-center rounded-[var(--r-control)] border border-border font-bold text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isElderly ? 'min-h-16 text-lg' : 'min-h-12 px-5 text-sm'
                }`}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className={`flex items-start gap-2 text-danger-strong font-bold ${body}`} role="alert">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> {error}
          </p>
        )}
        {success && (
          <p className={`flex items-start gap-2 text-success-strong font-bold ${body}`} role="status">
            <Check className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> {success}
          </p>
        )}
      </section>

      {/* Managing the relationships themselves is /care-circle's job, not this page's. */}
      <Link
        href="/care-circle"
        className={`w-full card-lift px-5 flex items-center gap-3 hover:bg-muted/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
          isElderly ? 'min-h-[72px]' : 'min-h-[56px]'
        }`}
      >
        <span aria-hidden className={`shrink-0 bg-muted text-muted-foreground flex items-center justify-center ${isElderly ? 'rounded-2xl w-14 h-14' : 'rounded-[var(--r-control)] w-10 h-10'}`}>
          <Users className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
        </span>
        <span className={`flex-1 font-bold text-foreground ${isElderly ? 'text-xl' : 'text-[15px]'}`}>
          Manage your care circle
        </span>
        <ArrowRight aria-hidden className={`shrink-0 text-muted-foreground ${isElderly ? 'w-6 h-6' : 'w-4 h-4'}`} />
      </Link>
    </div>
  );
}
