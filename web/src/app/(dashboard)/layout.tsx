import React from 'react';
import { redirect } from 'next/navigation';
import Navbar from '@/components/layout/navbar';
import DashboardMainLayout from '@/components/layout/dashboard-main-layout';
import { resolveUserData, getMedicalProfile } from '@/lib/supabase/cached-queries';
import { createClient } from '@/lib/supabase/server';
import { GuideProvider } from '@/components/guide/guide-context';
import GuideTour from '@/components/guide/guide-tour';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userData = await resolveUserData();

  if (!userData) {
    redirect('/login');
  }

  const { user, profile, userRole, myTelegramChatId, targetChatId, patientName, patientPhone } = userData;

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
      <div className="min-h-screen flex flex-col bg-background">
        {/* Navbar passing user profile details */}
        <Navbar
          user={{
            id: user.id,
            email: user.email!,
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
          {children}
        </DashboardMainLayout>
      </div>
      <GuideTour />
    </GuideProvider>
  );
}
