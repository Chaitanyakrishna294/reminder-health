'use client';

// M3 OEM onboarding: tells the user when THIS device will stop their alarms.
//
// Renders nothing outside the Android app, and nothing when everything is
// already granted — which is the common case, and a permanent "all good" card
// is just noise that teaches people to ignore the spot where real warnings
// appear.
//
// Every item here is something only the USER can grant. The app cannot flip any
// of these switches; the most it can do is name the problem in plain language
// and open the exact screen. That is why each row is a link out, not a toggle.
//
// Ordering is by consequence, not by tidiness: an alarm that never fires
// outranks one that fires without taking over the screen.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  getReliabilityStatus,
  openReliabilitySetting,
  type ReliabilityStatus,
  type ReliabilityTarget,
} from '@/lib/native/schedule-bridge';
import { AlarmClockOff, BatteryWarning, BellOff, ChevronRight, Power, ShieldAlert } from 'lucide-react';

interface Issue {
  target: ReliabilityTarget;
  icon: typeof BatteryWarning;
  title: string;
  /** What actually goes wrong for the patient, not what the setting is called. */
  detail: string;
  action: string;
  severe: boolean;
}

/**
 * The autostart row is offered on aggressive OEM skins even though there is no
 * way to READ its state — those managers expose no API. So it is advisory: shown
 * once as a "please check", never as a confirmed failure, and dismissible. The
 * alternative (silently hoping) is how a Xiaomi user discovers at 3am that their
 * reminders stopped a week ago.
 */
const AUTOSTART_DISMISS_KEY = 'reliabilityAutostartAcknowledged';

function buildIssues(status: ReliabilityStatus, autostartAcknowledged: boolean): Issue[] {
  const issues: Issue[] = [];

  if (!status.notificationsEnabled) {
    issues.push({
      target: 'notifications',
      icon: BellOff,
      title: 'Notifications are turned off',
      detail: 'Dose alarms cannot appear at all. This is the one that stops everything.',
      action: 'Turn on notifications',
      severe: true,
    });
  }

  if (!status.canScheduleExactAlarms) {
    issues.push({
      target: 'exactAlarms',
      icon: AlarmClockOff,
      title: 'Exact alarms are not allowed',
      detail: 'Reminders can be delayed by minutes or hours instead of arriving on time.',
      action: 'Allow exact alarms',
      severe: true,
    });
  }

  if (!status.ignoringBatteryOptimizations) {
    issues.push({
      target: 'battery',
      icon: BatteryWarning,
      title: 'Battery optimisation can stop reminders',
      detail:
        'While the phone is idle, Android may delay or skip alarms from this app — usually overnight, which is when doses get missed.',
      action: 'Allow unrestricted battery use',
      severe: true,
    });
  }

  // Shown on aggressive OEMs whether or not a direct link was found. These
  // manufacturers rename their autostart screens freely — the iQOO test device
  // matched none of the known names — and gating the warning on finding a
  // shortcut would silence it exactly on the ROMs nobody has catalogued.
  if (status.isAggressiveOem && !autostartAcknowledged) {
    issues.push({
      target: 'autostart',
      icon: Power,
      title: `Check autostart in your ${status.manufacturer} settings`,
      detail: status.hasAutostartSettings
        ? 'Phones from this manufacturer can block apps from restarting after a reboot. If that happens, reminders stop until you next open the app — with no warning.'
        : `Phones from this manufacturer can block apps from restarting after a reboot, which stops reminders silently. We could not open that screen directly on your model — look in your phone's security or battery app for "Autostart", "Auto-launch" or "Background start", and allow Re-MIND-eЯ.`,
      action: status.hasAutostartSettings ? 'Open autostart settings' : 'Open app settings',
      severe: false,
    });
  }

  if (!status.canUseFullScreenIntent) {
    issues.push({
      target: 'notifications',
      icon: ShieldAlert,
      title: 'Full-screen alarms are blocked',
      detail:
        'Reminders still arrive as notifications, but they will not take over the screen when the phone is locked.',
      action: 'Review notification settings',
      severe: false,
    });
  }

  return issues;
}

export default function ReliabilityCheck() {
  const pathname = usePathname();
  const [status, setStatus] = useState<ReliabilityStatus | null>(null);
  const [autostartAcknowledged, setAutostartAcknowledged] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // The bridge is an external system, so state lands in a promise callback
    // rather than synchronously in the effect body — which is what the React
    // guidance asks for, and avoids a cascading render on every navigation.
    const refresh = () => {
      getReliabilityStatus()
        .then((next) => {
          if (cancelled) return;
          setStatus(next);
          // Read here rather than in a lazy useState initialiser: localStorage
          // does not exist during SSR, so seeding from it would hydrate
          // mismatched.
          try {
            setAutostartAcknowledged(localStorage.getItem(AUTOSTART_DISMISS_KEY) === '1');
          } catch {
            setAutostartAcknowledged(false);
          }
        })
        .catch(() => {
          // An older APK without the bridge method, or a native error. Showing
          // nothing is correct: this component must never become the problem it
          // is meant to warn about.
          if (!cancelled) setStatus(null);
        });
    };

    refresh();

    // Re-check on return from the settings screen we just sent them to —
    // otherwise the warning sits there having already been fixed, which teaches
    // people the warnings are wrong.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pathname]);

  if (!status) return null;

  const issues = buildIssues(status, autostartAcknowledged);
  if (issues.length === 0) return null;

  const acknowledgeAutostart = () => {
    try {
      localStorage.setItem(AUTOSTART_DISMISS_KEY, '1');
    } catch {
      /* a non-persisted dismissal is better than none */
    }
    setAutostartAcknowledged(true);
  };

  return (
    <section
      aria-labelledby="reliability-heading"
      className="mb-4 rounded-2xl border border-warning/40 bg-warning/10 p-4"
    >
      <h2 id="reliability-heading" className="text-sm font-bold text-foreground font-mono">
        Your phone may stop these reminders
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        These are settings only you can change. Each one takes a few seconds.
      </p>

      <ul className="mt-3 space-y-2">
        {issues.map((issue) => {
          const Icon = issue.icon;
          return (
            <li
              key={`${issue.target}-${issue.title}`}
              className="rounded-xl border border-border bg-card p-3"
            >
              <div className="flex items-start gap-2.5">
                <Icon
                  className={`mt-0.5 h-4 w-4 shrink-0 ${issue.severe ? 'text-danger' : 'text-warning-strong'}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{issue.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{issue.detail}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openReliabilitySetting(issue.target)}
                      className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 cursor-pointer"
                    >
                      {issue.action}
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>

                    {issue.target === 'autostart' && (
                      <button
                        type="button"
                        onClick={acknowledgeAutostart}
                        className="min-h-11 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        Already done
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
