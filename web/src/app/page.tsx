import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Signed-in → dashboard; signed-out → the /welcome first-impression screen
// (the proxy would bounce a signed-out /dashboard hit to /login anyway — this
// just gives new visitors the friendly front door instead of a bare form).
export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  redirect(user ? '/dashboard' : '/welcome');
}
