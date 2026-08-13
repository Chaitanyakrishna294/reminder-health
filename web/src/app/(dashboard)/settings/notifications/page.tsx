import React from 'react';
import { redirect } from 'next/navigation';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import NotificationsClientView from './notifications-client-view';

export const revalidate = 0;

export default async function NotificationsSettingsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');
  return <NotificationsClientView telegramChatId={userData.myTelegramChatId || ''} />;
}
