import { redirect } from 'next/navigation';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import VoiceRemindersView from './voice-view';

export const revalidate = 0; // always fresh (plan/subscription state)

export default async function VoiceRemindersPage() {
  const userData = await resolveUserData();
  if (!userData) return null;

  // Care+ members only — free accounts are sent to the hub to upgrade.
  const supabase = await createClient();
  const plan = await getActivePlan(supabase, userData.myTelegramChatId);
  if (plan !== 'care_plus') redirect('/care-plus');

  return <VoiceRemindersView telegramId={userData.myTelegramChatId} />;
}
