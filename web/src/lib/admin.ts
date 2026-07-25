import { createClient } from '@/lib/supabase/server';

// Admin gate for diagnostics surfaces. ADMIN_EMAILS is a comma-separated env var
// (e.g. "you@example.com,other@example.com"). Unset or empty = nobody is admin —
// fail closed, never open.
export async function getAdminUser() {
  const admins = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (admins.length === 0) return null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !admins.includes(user.email.toLowerCase())) return null;
  return user;
}
