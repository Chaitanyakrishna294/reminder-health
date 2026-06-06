import React from 'react';
import { redirect } from 'next/navigation';
import Navbar from '@/components/layout/navbar';
import DashboardMainLayout from '@/components/layout/dashboard-main-layout';
import { resolveUserData } from '@/lib/supabase/cached-queries';

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

  return (
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
          patientName
        }}
      />

      <DashboardMainLayout 
        userRole={profile.role as 'PATIENT' | 'CAREGIVER'}
        patientName={patientName}
        patientPhone={patientPhone}
      >
        {children}
      </DashboardMainLayout>
    </div>
  );
}
