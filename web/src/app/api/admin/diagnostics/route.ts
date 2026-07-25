import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/admin';
import { createServiceClient } from '@/lib/supabase/service-role';

// Data backend for /admin-diagnostics. push_logs RLS is own-rows-only
// (migration_push_logs_rls_2026_07.sql), so the cross-user telemetry the admin
// page needs is served here via the service client, gated by ADMIN_EMAILS.
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const db = createServiceClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [subs, logs, statusRows, adhEvents] = await Promise.all([
    db.from('push_subscriptions').select('*', { count: 'exact', head: true }),
    db.from('push_logs')
      .select('id, user_id, status, gateway, error_message, created_at, profiles:user_id (full_name)')
      .order('created_at', { ascending: false })
      .limit(50),
    db.from('push_logs').select('status, created_at').gte('created_at', sevenDaysAgo),
    db.from('reminder_events')
      .select('reminder_status, reviewed_at, reviewed_from_status, resolution_channel')
      .gte('scheduled_for', thirtyDaysAgo),
  ]);

  const firstError = subs.error || logs.error || statusRows.error || adhEvents.error;
  if (firstError) {
    console.error('[AdminDiagnostics] query failed:', firstError);
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  return NextResponse.json({
    subCount: subs.count || 0,
    logs: logs.data || [],
    statusRows: statusRows.data || [],
    adhEvents: adhEvents.data || [],
  });
}

export async function DELETE() {
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const db = createServiceClient();
  const { error } = await db.from('push_logs').delete().neq('id', 0);
  if (error) {
    console.error('[AdminDiagnostics] purge failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
