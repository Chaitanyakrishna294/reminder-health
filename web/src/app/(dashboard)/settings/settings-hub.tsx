'use client';

/**
 * THE SETTINGS HUB — grouped rows, each pushing a sub-page.
 *
 * What it replaced: one page that expanded every control at once — theme, elderly
 * mode, the connect code, care-circle identity, the setup guide, delete account —
 * so finding anything meant reading everything, and Delete account shared a visual
 * language with a display preference.
 *
 * ELDERLY SEES FEWER ROOMS, SAME PATTERN. Not a different screen: the same hub,
 * filtered. Display · Help · Log out, and Display is NOT optional — it is where the
 * view lock lives, and the anti-jail rule in CLAUDE.md says the lock must never hide
 * the way to unlock it. If a future change trims this list further, Display stays.
 *
 * No Payment row. The reference pattern has one; this product takes no payments, and
 * a settings hub is not a place to advertise features that do not exist.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import {
  UserCircle, Bell, Monitor, Users, LifeBuoy, Globe, ShieldCheck, LogOut, ClipboardCheck, Link2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { clearNativeSchedule } from '@/lib/native/schedule-bridge';
import SettingsRow, { SettingsGroup } from '@/components/settings/settings-row';

export default function SettingsHub() {
  const { isElderly } = useUiMode();
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  const handleLogout = async () => {
    if (signingOut) return;
    // Sentence case, no shouting, and it says what actually happens — reminders are
    // native AlarmManager registrations on this device, so signing out DOES stop
    // them here. That is worth saying plainly; it is the one consequence a user
    // would not guess.
    if (!window.confirm('Log out?\n\nReminders on this phone will stop until you sign in again.')) return;
    setSigningOut(true);
    try {
      // BEFORE signOut, while the session is still valid: wipe the Android app's
      // local schedule and cancel its alarms, or this account's doses keep ringing
      // on a phone nobody is signed into.
      await clearNativeSchedule();
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace('/login');
    } catch {
      setSigningOut(false);
    }
  };

  return (
    <div className={`max-w-2xl mx-auto ${isElderly ? 'space-y-7' : 'space-y-6'}`}>
      <header className="px-1">
        <h1 className={`font-black text-foreground tracking-tight ${isElderly ? 'text-4xl' : 'text-2xl'}`}>
          Settings
        </h1>
      </header>

      {!isElderly && (
        <SettingsGroup>
          <SettingsRow icon={UserCircle} label="Account" href="/settings/account" />
          {/* Was /settings/account#notifications — an anchor that did not exist,
              because the preferences did not either. It now has a real page. */}
          <SettingsRow icon={Bell} label="Notifications" href="/settings/notifications" />
          <SettingsRow icon={Monitor} label="Display" href="/settings/display" />
        </SettingsGroup>
      )}

      {isElderly && (
        <SettingsGroup>
          {/* Display carries the lock. See the anti-jail note above. */}
          <SettingsRow icon={Monitor} label="Display" href="/settings/display" />
        </SettingsGroup>
      )}

      {!isElderly && (
        <SettingsGroup title="Care">
          {/* Connections is codes — share yours, enter theirs. Care circle is the
              relationships those codes create. Two rows because they are two tasks:
              you connect once and manage for months. */}
          <SettingsRow icon={Link2} label="Connections" href="/settings/connections" />
          <SettingsRow icon={Users} label="Care circle" href="/care-circle" />
          <SettingsRow icon={ClipboardCheck} label="Setup guide" href="/settings/setup-guide" />
        </SettingsGroup>
      )}

      <SettingsGroup title="About">
        {!isElderly && (
          /* Mono value, per the design rules — and it shows the CURRENT language
             rather than promising a picker that does not exist yet. */
          <SettingsRow icon={Globe} label="Language" value="English" href="/settings/language" />
        )}
        <SettingsRow icon={LifeBuoy} label="Help & support" href="/settings/help" />
        {!isElderly && (
          <SettingsRow icon={ShieldCheck} label="Privacy & terms" href="/settings/legal" />
        )}
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          icon={LogOut}
          label={signingOut ? 'Logging out…' : 'Log out'}
          tone="danger"
          onClick={handleLogout}
        />
      </SettingsGroup>
    </div>
  );
}
