import React from 'react';
import { redirect } from 'next/navigation';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import SettingsHub from './settings-hub';

export const revalidate = 0; // Dynamic rendering, always fresh

/**
 * The hub itself needs no data — every row is a link, and each sub-page fetches
 * what it owns. That is most of the point: /settings used to run five queries
 * before it could paint, on a tab someone opens to change one thing.
 */
export default async function SettingsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');
  return <SettingsHub />;
}
