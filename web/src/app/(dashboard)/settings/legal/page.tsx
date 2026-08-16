import React from 'react';
import { redirect } from 'next/navigation';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import LegalLinks from './legal-links';

export const revalidate = 0;

/**
 * Settings → Privacy & terms. Three links, no prose.
 *
 * The pages themselves live OUTSIDE the dashboard group (/privacy, /terms,
 * /disclaimer) because they must be readable signed-out — they are linked from the
 * sign-in screen and from the Play listing. This page just makes them findable from
 * inside the app, which Play review also expects.
 *
 * Server component for the auth guard; the labels are translated in the client half
 * (./legal-links.tsx), since the locale lives in localStorage.
 */
export default async function LegalSettingsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');

  return <LegalLinks />;
}
