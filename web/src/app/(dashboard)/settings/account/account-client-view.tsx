'use client';

/**
 * Settings → Account. Who you are, and how to stop being here.
 *
 * WHAT THIS PAGE IS NOT, and each was on it until now: the connect code (→ Settings
 * → Connections), the care-circle linking form (→ Connections), the setup guide (→
 * Settings → Setup guide), the legal links (→ Settings → Privacy & terms), and Sign
 * out (→ the hub's own row). Those all had full second copies here, which is how a
 * settings page becomes a page nobody can find anything on.
 *
 * Written fresh rather than carved out of the old 733-line view. The first attempt
 * sliced it along its comment markers and produced unbalanced JSX in both halves,
 * because those sections were not siblings — the profile block's wrapper enclosed
 * the connect-code block. A file that resists being cut is telling you it was never
 * really structured.
 *
 * DELETE ACCOUNT gets the whole bottom of the page and a typed confirmation. It used
 * to sit in the same visual language as a display preference. It also used
 * `window.prompt`, which installed PWAs and several mobile browsers suppress
 * outright — a suppressed prompt returns null, which the old code read as "not
 * confirmed", so the button silently did nothing and gave no reason. An in-app modal
 * always renders, and can say what is about to be destroyed.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { AlertCircle, Trash2, Mail, UserCircle, ShieldAlert, ArrowRight } from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';
import { clearNativeSchedule } from '@/lib/native/schedule-bridge';

interface AccountClientViewProps {
  fullName: string;
  email: string;
  role: 'PATIENT' | 'CAREGIVER';
  isGuest: boolean;
}

export default function AccountClientView({ fullName, email, role, isGuest }: AccountClientViewProps) {
  const router = useRouter();
  const supabase = createClient();
  const { isElderly } = useUiMode();

  const [modalOpen, setModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteAccount = async () => {
    if (confirmText.trim().toUpperCase() !== 'DELETE') return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not delete the account.');

      // This matters more here than on sign-out: the medications are gone
      // server-side, so any alarm left registered on the device would ring for a
      // dose that no longer exists anywhere.
      await clearNativeSchedule().catch((err) =>
        console.error('[Account] clearNativeSchedule failed after delete:', err));
      await supabase.auth.signOut();
      router.replace('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the account.');
      setDeleting(false);
      setModalOpen(false);
    }
  };

  const label = isElderly ? 'text-xl' : 'text-sm';
  const body = isElderly ? 'text-base' : 'text-xs';

  return (
    <div className={`max-w-2xl mx-auto ${isElderly ? 'space-y-7' : 'space-y-6'}`}>
      <header className="px-1">
        <h1 className={`font-black text-foreground tracking-tight ${isElderly ? 'text-4xl' : 'text-2xl'}`}>
          Account
        </h1>
      </header>

      {/* ── WHO YOU ARE ───────────────────────────────────────────────────── */}
      <section className="card-lift overflow-hidden divide-y divide-border">
        <div className={`flex items-center gap-3 px-5 ${isElderly ? 'py-5' : 'py-4'}`}>
          <span aria-hidden className={`shrink-0 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center ${isElderly ? 'w-14 h-14' : 'w-10 h-10'}`}>
            <UserCircle className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
          </span>
          <span className="min-w-0">
            <span className={`block text-muted-foreground font-semibold ${body}`}>Name</span>
            <span className={`block font-bold text-foreground truncate ${label}`}>{fullName}</span>
          </span>
        </div>

        <div className={`flex items-center gap-3 px-5 ${isElderly ? 'py-5' : 'py-4'}`}>
          <span aria-hidden className={`shrink-0 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center ${isElderly ? 'w-14 h-14' : 'w-10 h-10'}`}>
            <Mail className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
          </span>
          <span className="min-w-0">
            <span className={`block text-muted-foreground font-semibold ${body}`}>Email</span>
            {/* Mono: an address is a value you read character by character. */}
            <span className={`block font-mono font-bold text-foreground truncate ${isElderly ? 'text-base' : 'text-xs'}`}>
              {email || 'Not set'}
            </span>
          </span>
        </div>

        <div className={`flex items-center gap-3 px-5 ${isElderly ? 'py-5' : 'py-4'}`}>
          <span aria-hidden className={`shrink-0 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center ${isElderly ? 'w-14 h-14' : 'w-10 h-10'}`}>
            <ShieldAlert className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
          </span>
          <span className="min-w-0">
            <span className={`block text-muted-foreground font-semibold ${body}`}>Using this app as</span>
            <span className={`block font-bold text-foreground ${label}`}>
              {role === 'CAREGIVER' ? 'Someone caring for another person' : 'Someone taking medicines'}
            </span>
          </span>
        </div>
      </section>

      {/* A guest has no email, so there is nothing to sign back in with — the whole
          account lives in this browser's storage. Say that plainly here, where they
          came to look at the account, rather than only in a banner they dismissed. */}
      {isGuest && (
        <Link
          href="/save-account"
          className={`w-full bg-warning/10 border border-warning/35 rounded-3xl px-5 flex items-center gap-3 hover:bg-warning/15 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
            isElderly ? 'min-h-[80px] py-4' : 'min-h-[64px] py-3'
          }`}
        >
          <span className="flex-1 min-w-0">
            <span className={`block font-extrabold text-warning-strong ${label}`}>Add an email</span>
            <span className={`block text-warning-strong/90 font-semibold text-balance ${body}`}>
              Without one, your medicines are only on this device.
            </span>
          </span>
          <ArrowRight aria-hidden className={`shrink-0 text-warning-strong ${isElderly ? 'w-6 h-6' : 'w-4 h-4'}`} />
        </Link>
      )}

      {error && (
        <p className={`flex items-start gap-2 text-danger-strong font-bold px-1 ${body}`} role="alert">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> {error}
        </p>
      )}

      {/* ── DELETE ────────────────────────────────────────────────────────── */}
      <section className="rounded-3xl border border-danger/30 bg-danger/[0.03] p-5 space-y-3">
        <h2 className={`font-extrabold text-danger-strong ${label}`}>Delete this account</h2>
        <p className={`text-muted-foreground font-semibold text-balance ${body}`}>
          Removes your medicines, your dose history and your care circle. This cannot
          be undone.
        </p>
        <button
          type="button"
          onClick={() => { setConfirmText(''); setModalOpen(true); }}
          className={`inline-flex items-center gap-2 rounded-2xl border border-danger/40 text-danger-strong font-bold hover:bg-danger/10 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            isElderly ? 'min-h-14 px-6 text-base' : 'min-h-11 px-4 text-xs'
          }`}
        >
          <Trash2 className={isElderly ? 'w-5 h-5' : 'w-4 h-4'} aria-hidden />
          Delete account
        </button>
      </section>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-5 bg-foreground/40 backdrop-blur-[2px]"
          onClick={() => !deleting && setModalOpen(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm card-lift shadow-xl p-6 space-y-4"
          >
            <h2 id="delete-title" className="text-lg font-black text-foreground">Delete this account?</h2>
            <p className="text-xs text-muted-foreground font-semibold text-balance">
              Your medicines, dose history and care circle will be removed. This cannot
              be undone. Type DELETE to confirm.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoCapitalize="characters"
              autoCorrect="off"
              aria-label="Type DELETE to confirm"
              className="w-full min-h-12 font-mono font-bold tracking-widest bg-background border border-input rounded-2xl px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="space-y-2">
              {/* Cancel takes the accent, as in the exit dialog: the safe action gets
                  the emphasis when the other one cannot be undone. */}
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={deleting}
                className="w-full min-h-12 rounded-2xl bg-primary-strong text-primary-strong-foreground font-bold text-sm hover:bg-primary-strong-hover cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteAccount}
                disabled={deleting || confirmText.trim().toUpperCase() !== 'DELETE'}
                className="w-full min-h-12 rounded-2xl bg-danger-solid text-danger-solid-foreground font-bold text-sm hover:opacity-90 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting…' : 'Delete for ever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
