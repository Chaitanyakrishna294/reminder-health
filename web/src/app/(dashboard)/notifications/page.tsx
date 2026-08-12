import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import NotificationsClientView from './notifications-client-view';

export const revalidate = 0; // Dynamic rendering, always fresh

export default async function NotificationsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');

  const { user, targetChatId } = userData;
  const supabase = await createClient();

  // The reference zone for day grouping. Notifications carry no medication, so they
  // cannot be bucketed per-medication the way doses are — but the DAY BOUNDARY still
  // has to match the rail's, or a 01:40 IST dose notification files under the day
  // before the dose it is about. One medication's zone is enough to fix the boundary;
  // it is the same reference the dashboard's date row uses.
  let referenceTimeZone: string | null = null;
  if (targetChatId) {
    const { data } = await supabase
      .from('medications')
      .select('timezone')
      .eq('telegram_id', targetChatId)
      .eq('active', true)
      .not('timezone', 'is', null)
      .limit(1)
      .maybeSingle();
    referenceTimeZone = data?.timezone ?? null;
  }

  return <NotificationsClientView userId={user.id} referenceTimeZone={referenceTimeZone} />;
}
