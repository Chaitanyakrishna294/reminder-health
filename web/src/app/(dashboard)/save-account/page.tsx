import { redirect } from 'next/navigation';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import SaveAccountForm from './save-account-form';

/**
 * Convert a guest session into a permanent account.
 *
 * The conversion moves NO DATA. `signInAnonymously()` issued a real auth.uid()
 * and every medication, dose log and override is already keyed to it; adding a
 * verified email to the same auth user just makes that uid reachable from
 * another device. That is why this page can be a single email field instead of
 * an export/import.
 *
 * Server-guarded rather than client-guarded so a real user who bookmarks the URL
 * is bounced before any of it renders.
 */
export default async function SaveAccountPage() {
  const data = await resolveUserData();
  if (!data) redirect('/login');
  if (!data.isGuest) redirect('/settings');

  return (
    <SaveAccountForm
      currentName={data.profile?.full_name && data.profile.full_name !== 'User' ? data.profile.full_name : ''}
    />
  );
}
