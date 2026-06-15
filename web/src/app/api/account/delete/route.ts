import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-role';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, tooManyRequests } from '@/lib/rate-limit';

/**
 * GDPR "right to erasure" — permanently delete the authenticated user's account.
 * 1. delete_my_account() RPC (runs as the user) removes all their app data +
 *    Health Vault storage objects + their profile row.
 * 2. The service client removes the auth.users row so they can't log back in.
 * 3. Sign the session out.
 */
export async function POST(request: Request) {
  try {
    if (!(await checkRateLimit(`account:delete:${getClientIp(request)}`, 5, 3600))) {
      return tooManyRequests();
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Erase all application data as the authenticated user.
    const { error: rpcErr } = await supabase.rpc('delete_my_account');
    if (rpcErr) {
      console.error('[Account Delete] delete_my_account RPC failed:', rpcErr);
      return NextResponse.json({ error: 'Failed to delete account data.' }, { status: 500 });
    }

    // 2. Remove the auth identity (requires service role).
    const admin = createServiceClient();
    const { error: authErr } = await admin.auth.admin.deleteUser(user.id);
    if (authErr) {
      console.error('[Account Delete] auth.admin.deleteUser failed:', authErr);
      // Data is already erased; surface partial failure so support can finish.
      return NextResponse.json(
        { error: 'Account data deleted, but the login could not be removed. Contact support.' },
        { status: 500 }
      );
    }

    // 3. Clear the now-orphaned session.
    await supabase.auth.signOut();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Account Delete] Error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}
