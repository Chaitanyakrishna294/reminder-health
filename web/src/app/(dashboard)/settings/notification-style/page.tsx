import React from 'react';
import { redirect } from 'next/navigation';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import NotificationStyleClientView from './notification-style-client-view';

export const revalidate = 0;

/**
 * Settings → Notification style. Its own room, not a card inside Notifications.
 *
 * It earned the space: a full-height preview of the alarm plus the controls that
 * change it is a page, and squeezed under the push-permission card it was a
 * scroll target rather than something you look at. Nothing is fetched here —
 * every value on this screen lives on the phone, in app-private storage, because
 * the alarm must show and play them with no network at all.
 */
export default async function NotificationStylePage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');
  return <NotificationStyleClientView />;
}
