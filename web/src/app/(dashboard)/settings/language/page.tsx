import React from 'react';
import { redirect } from 'next/navigation';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import LanguagePicker from './language-picker';

export const revalidate = 0;

/**
 * Settings → Language.
 *
 * This page used to be an honest placeholder — a single "English" row and a note
 * saying more was coming — because a picker whose entries did nothing would have
 * promised the one thing the visitor came here for. The picker is real now; see
 * ./language-picker.tsx for why every entry is written in its own script.
 *
 * Still a server component so the auth guard matches every other settings page. The
 * choice itself lives in the client (localStorage, via LanguageProvider), so the
 * picker is the client half.
 */
export default async function LanguageSettingsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');

  return <LanguagePicker />;
}
