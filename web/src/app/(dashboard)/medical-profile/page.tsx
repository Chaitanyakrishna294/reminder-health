import { redirect } from 'next/navigation';
import { resolveUserData, getMedicalProfile } from '@/lib/supabase/cached-queries';
import { createClient } from '@/lib/supabase/server';
import MedicalProfileClientView from './medical-profile-client-view';

export default async function MedicalProfilePage() {
  const data = await resolveUserData();
  if (!data) redirect('/login');

  const { user, profile } = data;
  const medical = await getMedicalProfile(user.id);

  // Sign the avatar for display (private bucket).
  let avatarUrl: string | null = null;
  if (medical?.avatar_path) {
    const supabase = await createClient();
    const { data: signed } = await supabase.storage
      .from('avatars')
      .createSignedUrl(medical.avatar_path, 600);
    avatarUrl = signed?.signedUrl ?? null;
  }

  return (
    <MedicalProfileClientView
      userId={user.id}
      fullName={profile.full_name || ''}
      email={user.email || ''}
      initial={medical}
      initialAvatarUrl={avatarUrl}
    />
  );
}
