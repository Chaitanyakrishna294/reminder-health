import React from 'react';
import { redirect } from 'next/navigation';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import DisplayClientView from './display-client-view';

export const revalidate = 0;

export default async function DisplaySettingsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');
  return <DisplayClientView />;
}
