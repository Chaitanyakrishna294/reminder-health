import { resolveUserData } from '@/lib/supabase/cached-queries';
import CarePlusHub from '@/components/billing/care-plus-hub';

export const revalidate = 0; // always fresh (subscription state)

export default async function CarePlusPage() {
  const userData = await resolveUserData();
  if (!userData) return null;

  return <CarePlusHub telegramId={userData.myTelegramChatId} memberName={userData.profile.full_name} />;
}
