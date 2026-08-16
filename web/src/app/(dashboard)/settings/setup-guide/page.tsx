import React from 'react';
import { redirect } from 'next/navigation';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import ReminderSetupGuide from '@/components/native/reminder-setup-guide';

export const revalidate = 0;

/**
 * Settings → Setup guide. The permanent home for the OEM battery/autostart walkthrough.
 *
 * It used to be pinned at the TOP of the single Settings page, above every
 * preference, on the reasoning that a phone silently killing alarms outranks any
 * display choice. That reasoning still holds — which is why the component keeps its
 * own logic for surfacing itself when this device actually has a setting that would
 * stop alarms (ReliabilityCheck, rendered in the dashboard layout). This page is the
 * place you can always come back to, not the place you first find out.
 */
export default async function SetupGuideSettingsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header className="px-1">
        <h1 className="title-page text-foreground">Setup guide</h1>
        <p className="text-xs text-muted-foreground font-semibold mt-1 text-balance">
          Steps to make sure your phone lets reminders through.
        </p>
      </header>
      <ReminderSetupGuide />
    </div>
  );
}
