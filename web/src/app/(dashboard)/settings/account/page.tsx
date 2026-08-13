import React from 'react';
import { redirect } from 'next/navigation';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import AccountClientView from './account-client-view';

export const revalidate = 0;

/**
 * Everything this page needs is already on `resolveUserData`, which the layout has
 * resolved anyway — so it runs NO queries of its own.
 *
 * The version this replaced fired five: the connect code, incoming caregiver
 * connections, the legacy caregiver_info fallback, the caregiver registration row,
 * and outgoing patient links — then resolved two more dependent chains to turn them
 * into names. All of that belonged to sections that now live on Connections and
 * Care Circle, and none of it was needed to show someone their own name.
 */
export default async function AccountSettingsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');

  const { user, profile, userRole, isGuest } = userData;

  return (
    <AccountClientView
      fullName={profile.full_name || 'User'}
      // A guest has no email at all; the old code's non-null assertion typed
      // `undefined` as a string and let it reach the UI.
      email={user.email ?? ''}
      role={userRole}
      isGuest={!!isGuest}
    />
  );
}
