import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-role';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, tooManyRequests } from '@/lib/rate-limit';

/**
 * GDPR "right to erasure" — permanently delete the authenticated user's account.
 * 1. Collect the user's storage object paths (SQL can't delete from storage.objects).
 * 2. delete_my_account() RPC (runs as the user) removes all their app DB data + profile row.
 * 3. Remove the storage objects via the Storage API (health-vault files + avatar).
 * 4. The service client removes the auth.users row so they can't log back in.
 * 5. Sign the session out.
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

    const admin = createServiceClient();

    // 1. Collect storage paths BEFORE the RPC erases health_records / cascades medical_profiles.
    // Supabase forbids `DELETE FROM storage.objects` in SQL (42501), so the RPC no longer touches
    // storage — we remove the objects here via the Storage API instead.
    const { data: vaultRecs } = await admin
      .from('health_records').select('file_url').eq('user_id', user.id);
    const vaultPaths = (vaultRecs ?? []).map((r) => r.file_url).filter(Boolean) as string[];
    const { data: mp } = await admin
      .from('medical_profiles').select('avatar_path').eq('user_id', user.id).maybeSingle();
    const avatarPath = (mp?.avatar_path as string | null) || null;

    // 2. Erase all application DB data as the authenticated user.
    const { error: rpcErr } = await supabase.rpc('delete_my_account');
    if (rpcErr) {
      console.error('[Account Delete] delete_my_account RPC failed:', rpcErr);
      return NextResponse.json({ error: 'Failed to delete account data.' }, { status: 500 });
    }

    // 3. Remove the storage objects (Storage API — cannot be done in SQL). Best-effort:
    // the DB data + auth identity are the record of truth; an orphaned file must not block deletion.
    if (vaultPaths.length) {
      const { error: e } = await admin.storage.from('health-vault').remove(vaultPaths);
      if (e) console.error('[Account Delete] health-vault cleanup failed:', e);
    }
    if (avatarPath) {
      const { error: e } = await admin.storage.from('avatars').remove([avatarPath]);
      if (e) console.error('[Account Delete] avatar cleanup failed:', e);
    }

    // 4. Remove the auth identity (requires service role).
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
