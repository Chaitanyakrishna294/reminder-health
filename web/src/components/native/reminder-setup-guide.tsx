'use client';

// The permanent home for reminder-reliability setup, in Settings.
//
// The dashboard banner is dismissible-by-fixing and disappears once everything
// passes; this does not. Someone who fixed a setting months ago, or who wants to
// re-check after a system update, needs somewhere to look that is not "wait for
// the warning to come back".
//
// Unlike the banner, this shows satisfied items too — the value of a checklist
// is partly in seeing what is already handled.

import SetupStepCard from '@/components/native/setup-step-card';
import { useReliability } from '@/components/native/use-reliability';
import { brandLabel } from '@/lib/native/setup-guide';
import { ShieldCheck } from 'lucide-react';

export default function ReminderSetupGuide() {
  const { status, items, satisfied, markDone, undoDone } = useReliability();

  // Not the Android app (or an APK predating the bridge method). The web app has
  // no device alarms, so none of this applies and a stub would only confuse.
  if (!status) return null;

  const brand = brandLabel(status);
  const done = items.filter(satisfied).length;
  const allDone = done === items.length;

  return (
    <section id="reminder-setup" className="scroll-mt-20 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-2.5">
        <ShieldCheck
          className={`mt-0.5 h-5 w-5 shrink-0 ${allDone ? 'text-success' : 'text-warning-strong'}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-foreground font-mono">Reminder setup guide</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {allDone
              ? 'Everything is set up. Your reminders should fire on time, even overnight and after a restart.'
              : 'Android can stop reminders in ways the app cannot override. These settings are what keep alarms firing on time, overnight, and after a restart.'}
          </p>
          {brand && (
            <p className="mt-1 text-xs text-muted-foreground">
              Steps below are for <span className="font-semibold text-foreground">{brand}</span> phones.
            </p>
          )}
          <p className="mt-1.5 text-xs font-semibold text-foreground">
            {done} of {items.length} done
          </p>
        </div>
      </div>

      <ul className="mt-3.5 space-y-2">
        {items.map((item) => (
          <SetupStepCard
            key={item.id}
            item={item}
            satisfied={satisfied(item)}
            onMarkDone={markDone}
            onUndoDone={undoDone}
          />
        ))}
      </ul>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Autostart cannot be checked automatically — Android does not report it — so that one is
        marked done by you. Everything else is read from the system each time you open this page.
      </p>
    </section>
  );
}
