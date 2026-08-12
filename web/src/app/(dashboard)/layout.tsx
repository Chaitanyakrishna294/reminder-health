import React from 'react';
import { redirect } from 'next/navigation';
import Navbar from '@/components/layout/navbar';
import DashboardMainLayout from '@/components/layout/dashboard-main-layout';
import { resolveUserData, getMedicalProfile } from '@/lib/supabase/cached-queries';
import { createClient } from '@/lib/supabase/server';
import { GuideProvider } from '@/components/guide/guide-context';
import GuideTour from '@/components/guide/guide-tour';
import GuestBanner from '@/components/guest/guest-banner';
import ScheduleSync from '@/components/native/schedule-sync';
import ReliabilityCheck from '@/components/native/reliability-check';
import AndroidBack from '@/components/layout/android-back';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userData = await resolveUserData();

  if (!userData) {
    redirect('/login');
  }

  const { user, profile, userRole, myTelegramChatId, targetChatId, patientName, patientPhone, isGuest } = userData;

  if (!profile.telegram_chat_id) {
    redirect('/link-account');
  }

  // Profile photo for the navbar avatar (private avatars bucket → signed URL).
  let avatarUrl: string | null = null;
  const medical = await getMedicalProfile(user.id);
  if (medical?.avatar_path) {
    const supabase = await createClient();
    const { data: signed } = await supabase.storage
      .from('avatars')
      .createSignedUrl(medical.avatar_path, 600);
    avatarUrl = signed?.signedUrl ?? null;
  }

  return (
    <GuideProvider>
      <ScheduleSync />
      {/* Owns the Android hardware back button for every route in this group:
          sub-pages pop one level, the five tab roots ask before backgrounding.
          Renders nothing until the dialog is open, and nothing at all in a
          browser. See lib/navigation/stack.ts for the model. */}
      <AndroidBack />
      <div className="min-h-screen flex flex-col bg-background">
        {/* Navbar passing user profile details */}
        <Navbar
          user={{
            id: user.id,
            // A guest has no email at all, so the old non-null assertion handed
            // the navbar `undefined` and typed it as a string. Empty string
            // keeps the contract honest until they save the account.
            email: user.email ?? '',
            fullName: profile.full_name || 'User',
            role: profile.role,
            telegramChatId: profile.telegram_chat_id,
            patientChatId: targetChatId,
            patientName,
            avatarUrl
          }}
        />

        <DashboardMainLayout
          patientName={patientName}
          patientPhone={patientPhone}
          patientChatId={targetChatId}
        >
          {isGuest && <GuestBanner />}
          {/* Android only, and only when this device has a setting that would
              stop alarms — renders nothing otherwise. Above the page content
              because a phone that silently kills reminders outranks whatever
              the user navigated here to do. */}
          <ReliabilityCheck />
          {children}
        </DashboardMainLayout>
      </div>
      <GuideTour />
    </GuideProvider>
  );
}
