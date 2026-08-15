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
  UserCircle, Bell, Monitor, Users, LifeBuoy, Globe, ShieldCheck, LogOut, ClipboardCheck, Link2, Palette, Droplets,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { useLanguage } from '@/context/language-context';
import { LOCALE_META } from '@/lib/i18n/locales';
import { clearNativeSchedule } from '@/lib/native/schedule-bridge';
import SettingsRow, { SettingsGroup } from '@/components/settings/settings-row';
import VersionLine from '@/components/settings/version-line';

export default function SettingsHub() {
  const { isElderly } = useUiMode();
  const { locale, t } = useLanguage();
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  const handleLogout = async () => {
    if (signingOut) return;
    // Sentence case, no shouting, and it says what actually happens — reminders are
    // native AlarmManager registrations on this device, so signing out DOES stop
    // them here. That is worth saying plainly; it is the one consequence a user
    // would not guess.
    if (!window.confirm(t.settings.logOutConfirm)) return;
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
          {t.settings.title}
        </h1>
      </header>

      {!isElderly && (
        <SettingsGroup>
          <SettingsRow icon={UserCircle} label={t.settings.account} href="/settings/account" />
          {/* Was /settings/account#notifications — an anchor that did not exist,
              because the preferences did not either. It now has a real page. */}
          <SettingsRow icon={Bell} label={t.settings.notifications} href="/settings/notifications" />
          {/* Its own row rather than a card inside Notifications: a full-height
              render of the alarm plus the controls that change it is a page. */}
          <SettingsRow icon={Palette} label={t.settings.notificationStyle} href="/settings/notification-style" />
          <SettingsRow icon={Monitor} label={t.settings.display} href="/settings/display" />
          {/* Opt-in and off by default. It lives here rather than under
              Notifications because it is a thing you set up, not a channel you
              switch on — and it is not medication, which is the distinction the
              scoped sky-blue exists to keep visible. */}
          <SettingsRow icon={Droplets} label={t.settings.water} href="/settings/water" />
        </SettingsGroup>
      )}

      {isElderly && (
        <SettingsGroup>
          {/* Display carries the lock. See the anti-jail note above. */}
          <SettingsRow icon={Monitor} label={t.settings.display} href="/settings/display" />
        </SettingsGroup>
      )}

      {!isElderly && (
        <SettingsGroup title={t.settings.groupCare}>
          {/* Connections is codes — share yours, enter theirs. Care circle is the
              relationships those codes create. Two rows because they are two tasks:
              you connect once and manage for months. */}
          <SettingsRow icon={Link2} label={t.settings.connections} href="/settings/connections" />
          <SettingsRow icon={Users} label={t.settings.careCircle} href="/care-circle" />
          <SettingsRow icon={ClipboardCheck} label={t.settings.setupGuide} href="/settings/setup-guide" />
        </SettingsGroup>
      )}

      <SettingsGroup title={t.settings.groupAbout}>
        {!isElderly && (
          /* The value shows the CURRENT language in its own script — the same
             reason the picker itself does. "English" written on a row whose page
             is in Telugu would be the one label a Telugu reader cannot check. */
          <SettingsRow
            icon={Globe}
            label={t.settings.language}
            value={LOCALE_META[locale].nativeName}
            href="/settings/language"
          />
        )}
        <SettingsRow icon={LifeBuoy} label={t.settings.help} href="/settings/help" />
        {!isElderly && (
          <SettingsRow icon={ShieldCheck} label={t.settings.legal} href="/settings/legal" />
        )}
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          icon={LogOut}
          label={signingOut ? t.settings.loggingOut : t.settings.logOut}
          tone="danger"
          onClick={handleLogout}
        />
      </SettingsGroup>

      {/* Below Log out on purpose: it is the last thing on the page because it is
          the least important, right up until someone is on a support call. */}
      <VersionLine />
    </div>
  );
}
