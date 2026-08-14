'use client';

/**
 * Settings → Notifications.
 *
 * The hub's Notifications row pointed at /settings/account#notifications, an anchor
 * that did not exist — because notification preferences did not exist either. The
 * row was written from a spec of what SHOULD be there, and tapping it landed you on
 * Account with nothing highlighted. A row that goes nowhere is worse than no row: it
 * teaches people the app is broken.
 *
 * What exists here is what genuinely does something: browser/PWA push permission,
 * how long each dose alarm rings, and the picture and sound the full-screen alarm
 * uses. The rule has not changed — a control that changes nothing is a lie in a
 * nicer shape — the second and third simply stopped being nothing when the alarm
 * screen learned to read them (2026-08-14).
 *
 * ESCALATION TIMING IS STILL NOT HERE, and should not be: it is server-side in the
 * ladder, it is what protects a dose nobody answers, and it is not the patient's
 * to loosen from their own phone.
 *
 * THE HONEST FRAMING: push is the WEB channel. It is not what makes a dose alarm
 * fire on Android — that is a native AlarmManager registration, independent of the
 * webview and of this permission. Saying so here stops someone disabling push and
 * assuming their reminders are off, or enabling it and assuming they are covered.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { Bell, BellOff, ShieldCheck, ArrowRight } from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';
import { registerPush } from '@/lib/push/register-push';
import AlarmRingDuration from '@/components/settings/alarm-ring-duration';

type Permission = 'unsupported' | 'default' | 'granted' | 'denied';

export default function NotificationsClientView({
  telegramChatId,
  ringSeconds,
  largestHandful,
}: {
  telegramChatId: string;
  ringSeconds: number;
  /** Doses at the user's busiest reminder time — the ring-duration hint's input. */
  largestHandful: number;
}) {
  const { isElderly } = useUiMode();
  const [permission, setPermission] = useState<Permission>('unsupported');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  React.useEffect(() => {
    // Read in an effect, not during render: Notification.permission is a browser
    // API the server has no view of, and reading it while rendering would hydrate
    // a different state than it painted.
    const t = setTimeout(() => {
      if (typeof window === 'undefined' || !('Notification' in window)) return setPermission('unsupported');
      setPermission(Notification.permission as Permission);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const enable = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const ok = await registerPush(telegramChatId);
      setPermission(('Notification' in window ? Notification.permission : 'default') as Permission);
      setNote(ok
        ? 'Notifications are on for this device.'
        : 'Could not turn on notifications. Check your browser settings for this site.');
    } catch {
      setNote('Could not turn on notifications. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const label = isElderly ? 'text-xl' : 'text-sm';
  const body = isElderly ? 'text-base' : 'text-xs';

  return (
    <div className={`max-w-2xl mx-auto ${isElderly ? 'space-y-7' : 'space-y-6'}`}>
      <header className="px-1">
        <h1 className={`font-black text-foreground tracking-tight ${isElderly ? 'text-4xl' : 'text-2xl'}`}>
          Notifications
        </h1>
      </header>

      <section className="card-lift p-5 space-y-3">
        <div className="flex items-start gap-3">
          <span aria-hidden className={`shrink-0 rounded-2xl flex items-center justify-center ${
            isElderly ? 'w-14 h-14' : 'w-10 h-10'
          } ${permission === 'granted' ? 'bg-success/15 text-success-strong' : 'bg-muted text-muted-foreground'}`}>
            {permission === 'granted'
              ? <Bell className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
              : <BellOff className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />}
          </span>
          <div className="min-w-0">
            <p className={`font-extrabold text-foreground ${label}`}>
              {permission === 'granted' ? 'Notifications are on' : 'Notifications are off'}
            </p>
            <p className={`text-muted-foreground font-semibold mt-0.5 text-balance ${body}`} suppressHydrationWarning>
              {permission === 'granted'
                ? 'This device can show reminders in the browser.'
                : permission === 'denied'
                  ? 'Your browser is blocking them. You can allow them in its site settings.'
                  : permission === 'unsupported'
                    ? 'This browser does not support notifications.'
                    : 'Turn these on to get reminders in the browser.'}
            </p>
          </div>
        </div>

        {permission !== 'granted' && permission !== 'unsupported' && (
          <button
            type="button"
            onClick={enable}
            disabled={busy || permission === 'denied'}
            className={`w-full rounded-2xl bg-primary-strong text-primary-strong-foreground font-black hover:bg-primary-strong-hover active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              isElderly ? 'min-h-16 text-xl' : 'min-h-12 text-sm'
            }`}
          >
            {busy ? 'Turning on…' : 'Turn on notifications'}
          </button>
        )}

        {note && <p className={`font-bold text-muted-foreground ${body}`} role="status">{note}</p>}
      </section>

      {/* Configures the NATIVE alarm, which is why it sits under the reassurance
          below rather than above it: push is the web channel, and this is the
          thing that actually rings. The alarm's picture and sound moved to their
          own room (Settings -> Notification style) once the preview arrived —
          a full-height render of the alarm plus its controls is a page, and
          squeezed under the push card it was a scroll target rather than
          something anyone looked at. */}
      <AlarmRingDuration initialSeconds={ringSeconds} largestHandful={largestHandful} />

      {/* The line that matters most on this page. */}
      <section className="rounded-3xl border border-info/30 bg-info/5 p-5">
        <p className={`flex items-start gap-2 font-bold text-info-strong ${body}`}>
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          <span className="text-balance">
            Your dose alarms do not depend on this. On the app they are set on the phone
            itself and will ring even with notifications off, or with no internet.
          </span>
        </p>
      </section>

      <Link
        href="/settings/setup-guide"
        className={`w-full card-lift px-5 flex items-center gap-3 hover:bg-muted/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
          isElderly ? 'min-h-[72px]' : 'min-h-[56px]'
        }`}
      >
        <span className={`flex-1 font-bold text-foreground ${isElderly ? 'text-xl' : 'text-[15px]'}`}>
          Check your phone lets alarms through
        </span>
        <ArrowRight aria-hidden className={`shrink-0 text-muted-foreground ${isElderly ? 'w-6 h-6' : 'w-4 h-4'}`} />
      </Link>
    </div>
  );
}
