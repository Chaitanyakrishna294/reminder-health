import { createServiceClient } from '@/lib/supabase/service-role';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

// Failover maintenance tick (mitigates the single-host scheduler SPOF).
//
// The every-minute reminder loop normally runs only inside the bot process on
// Render (src/scheduler.js). On Render Free that host can pause near month-end,
// stalling escalations and day-end closure. This endpoint lets an external/Vercel
// cron run the *idempotent, DB-side* portion of that loop so the adherence ledger,
// caregiver-escalation state, and the "complete your history" review queue keep
// advancing even while the bot host is down.
//
// It calls exactly the same SECURITY DEFINER RPCs the bot already invokes every
// minute, so it introduces no new writer semantics and is safe to run alongside a
// healthy bot. It does NOT (yet) re-send the initial Telegram/browser-push reminder
// — that delivery still requires the bot. Full send-failover is the follow-on
// (see docs/KNOWN_ISSUES.md §3).
//
// Activation (no effect until configured):
//   1. Set CRON_SECRET in the web app's environment.
//   2. Add a Vercel Cron (or external cron) hitting GET /api/cron/tick every minute
//      with `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this header
//      automatically when CRON_SECRET is set).

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // disabled until a secret is configured

  const header = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // Length check first; timingSafeEqual throws on length mismatch.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    // Feature not enabled in this environment.
    return NextResponse.json({ error: 'Cron tick disabled.' }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const ranAt = new Date().toISOString();

  try {
    const { data: escalations, error: escalateErr } = await supabase.rpc(
      'scan_and_escalate_overdue_reminders',
    );
    if (escalateErr) {
      console.error('[CronTick] scan_and_escalate_overdue_reminders failed:', escalateErr);
      return NextResponse.json({ error: escalateErr.message, ranAt }, { status: 500 });
    }

    const { error: closeErr } = await supabase.rpc('close_daily_medications');
    if (closeErr) {
      console.error('[CronTick] close_daily_medications failed:', closeErr);
      return NextResponse.json({ error: closeErr.message, ranAt }, { status: 500 });
    }

    const transitionCount = Array.isArray(escalations) ? escalations.length : 0;
    console.log(`[CronTick] OK ranAt=${ranAt} transitions=${transitionCount}`);
    return NextResponse.json({ ok: true, ranAt, transitions: transitionCount });
  } catch (error: any) {
    console.error('[CronTick] Error:', error);
    return NextResponse.json({ error: error?.message || 'Server error', ranAt }, { status: 500 });
  }
}
