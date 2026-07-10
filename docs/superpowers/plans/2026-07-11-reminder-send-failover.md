# Reminder Send-Failover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the Render bot is paused, make the Vercel cron route (`/api/cron/tick`) send browser-push medication reminders (initial dose, gentle reminder, caregiver escalation, snooze re-fire) so doses aren't silently missed.

**Architecture:** Heartbeat-takeover. The bot upserts a `scheduler_heartbeat` row each minute tick. The cron route reads it: if fresh (bot alive) it is a total no-op; if stale/missing (bot down) it acquires the shared `minute_tick` lock and replicates the bot's four *push-only* send paths, reusing the bot's exactly-once guards (`last_sent_at` OCC, `reminder_events` unique constraint, `push_logs` unique `(event_id,'SENT')`). Telegram is never sent by the route (it's dead anyway when the bot is down).

**Tech Stack:** Next.js 16 route handler (Node runtime), Supabase JS (service-role), `web-push` (VAPID), `moment-timezone`. Bot side: Node.js CommonJS. Tests: `node:test` (bot) and `node --experimental-strip-types` + `node:assert` (web).

## Global Constraints

- **Web deploys from `web/`** — the route may NOT import from the repo-root `src/`. All web code lives under `web/src/`. (Copied verbatim per spec + memory `vercel-deploy-process`.)
- **`moment-timezone` stays** — the web must match the bot's DST tz math; do not swap for `Intl`. (memory `moment-timezone-kept`.)
- **Service-role only** for the heartbeat table and all route DB access — the Render bot uses the service_role key and the route uses `createServiceClient()`. (memory `render-bot-uses-service-role`.)
- **Push-only** in the route — never send Telegram from `/api/cron/tick`.
- **Fail-safe default** — a missing/unparseable heartbeat counts as "bot dead" so failover activates rather than silently staying off.
- **Heartbeat staleness threshold: 180000 ms** (3 missed minute-ticks).
- **DB migrations are applied manually** by the maintainer via the Supabase SQL editor (project `jaflclnakwtikqbfhfdk`); a plan task that adds a migration ends by asking the maintainer to apply it, not by auto-applying.
- Commit message trailer for every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Heartbeat table migration

**Files:**
- Create: `db/migrations/migration_scheduler_heartbeat_2026_07.sql`

**Interfaces:**
- Produces: table `public.scheduler_heartbeat(id smallint PK =1, last_beat timestamptz not null, instance_id text)`, seeded with one row `id=1`.

- [ ] **Step 1: Write the migration SQL**

Create `db/migrations/migration_scheduler_heartbeat_2026_07.sql`:

```sql
-- Liveness heartbeat for the Render bot's minute-tick scheduler. The web failover
-- cron (/api/cron/tick) reads last_beat to decide whether the bot is alive; if it
-- is stale/missing the cron takes over sending. Single-row table (id is pinned to 1).
-- service_role only (bot + web service client bypass RLS); no anon/authenticated policy.
CREATE TABLE IF NOT EXISTS public.scheduler_heartbeat (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_beat   timestamptz NOT NULL,
  instance_id text
);

ALTER TABLE public.scheduler_heartbeat ENABLE ROW LEVEL SECURITY;

-- Seed the single row so the first read never 404s. A brand-new (pre-bot-deploy)
-- last_beat in the past reads as "dead" -> failover is active until the bot ships
-- its heartbeat write, which is the fail-safe behavior we want.
INSERT INTO public.scheduler_heartbeat (id, last_beat)
VALUES (1, now() - interval '1 hour')
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Commit**

```bash
git add db/migrations/migration_scheduler_heartbeat_2026_07.sql
git commit -m "$(printf 'feat(db): scheduler_heartbeat table for send-failover\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

- [ ] **Step 3: Ask the maintainer to apply it**

Post to the maintainer: "Apply `db/migrations/migration_scheduler_heartbeat_2026_07.sql` in the Supabase SQL editor (project `jaflclnakwtikqbfhfdk`), then confirm." Verify by running in the SQL editor:

```sql
SELECT id, last_beat FROM public.scheduler_heartbeat;
```

Expected: one row, `id = 1`.

---

### Task 2: Pure liveness + recent-send helpers (web)

**Files:**
- Create: `web/src/lib/schedule/bot-liveness.ts`
- Test: `web/src/lib/schedule/bot-liveness.test.ts`

**Interfaces:**
- Produces:
  - `isBotAlive(lastBeat: string | null | undefined, now?: number, thresholdMs?: number): boolean`
  - `isRecentlySent(lastSentAt: string | null | undefined, now?: number, windowMs?: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/schedule/bot-liveness.test.ts`:

```ts
// Dependency-free checks. Run:
//   node --experimental-strip-types src/lib/schedule/bot-liveness.test.ts
import assert from 'node:assert';
import { isBotAlive, isRecentlySent } from './bot-liveness.ts';

const now = Date.parse('2026-07-11T10:00:00.000Z');

// ── isBotAlive: fresh beat is alive, stale/edge/missing is dead (fail-safe) ──
assert.equal(isBotAlive(new Date(now - 60_000).toISOString(), now), true);   // 1 min ago
assert.equal(isBotAlive(new Date(now - 240_000).toISOString(), now), false); // 4 min ago
assert.equal(isBotAlive(new Date(now - 180_000).toISOString(), now), false); // exactly 3 min -> dead (not < threshold)
assert.equal(isBotAlive(new Date(now - 179_000).toISOString(), now), true);  // just under threshold
assert.equal(isBotAlive(null, now), false);
assert.equal(isBotAlive(undefined, now), false);
assert.equal(isBotAlive('not-a-date', now), false);

// ── isRecentlySent: 60s duplicate-send guard ──
assert.equal(isRecentlySent(new Date(now - 30_000).toISOString(), now), true);
assert.equal(isRecentlySent(new Date(now - 90_000).toISOString(), now), false);
assert.equal(isRecentlySent(null, now), false);

console.log('bot-liveness: all checks passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --experimental-strip-types src/lib/schedule/bot-liveness.test.ts`
Expected: FAIL — cannot find module `./bot-liveness.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/lib/schedule/bot-liveness.ts`:

```ts
// Liveness + duplicate-send guards for the reminder send-failover cron.
// Pure (no I/O) so they are cheap to unit-test.

/**
 * True if the Render bot ticked within `thresholdMs`. A null/blank/unparseable
 * beat returns false (fail-safe: the web cron then takes over sending).
 */
export function isBotAlive(
  lastBeat: string | null | undefined,
  now: number = Date.now(),
  thresholdMs = 180_000,
): boolean {
  if (!lastBeat) return false;
  const t = new Date(lastBeat).getTime();
  if (Number.isNaN(t)) return false;
  return now - t < thresholdMs;
}

/**
 * True if a medication was sent within `windowMs` (mirrors the bot's 60s
 * anti-duplicate guard). Null/unparseable returns false (not recently sent).
 */
export function isRecentlySent(
  lastSentAt: string | null | undefined,
  now: number = Date.now(),
  windowMs = 60_000,
): boolean {
  if (!lastSentAt) return false;
  const t = new Date(lastSentAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t < windowMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node --experimental-strip-types src/lib/schedule/bot-liveness.test.ts`
Expected: `bot-liveness: all checks passed` (exit 0). The `ExperimentalWarning`/`MODULE_TYPELESS_PACKAGE_JSON` lines are benign.

- [ ] **Step 5: Verify tsconfig already excludes the test from the build**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0. (`web/tsconfig.json` already has `"exclude": ["node_modules", "**/*.test.ts"]` from prior work — no change needed. If tsc reports an error about the `.ts` import extension in the test file, confirm the exclude line is present.)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/schedule/bot-liveness.ts web/src/lib/schedule/bot-liveness.test.ts
git commit -m "$(printf 'feat(web): bot-liveness + recent-send guards for failover\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Shared browser-push module (web)

**Files:**
- Modify: `web/package.json` (add `web-push` dep + `@types/web-push` devDep)
- Create: `web/src/lib/push/send-push.ts`

**Interfaces:**
- Consumes: `createServiceClient` from `@/lib/supabase/service-role`.
- Produces: `sendBrowserPush(telegramId: string, payload: { title: string; body: string; eventId?: number | string | null }): Promise<void>` — fire-and-forget; never throws.

- [ ] **Step 1: Install web-push in the web workspace**

Run: `cd web && npm install web-push@^3.6.7 && npm install -D @types/web-push`
Expected: `package.json` gains `"web-push"` under dependencies and `"@types/web-push"` under devDependencies; `package-lock.json` updates.

- [ ] **Step 2: Write the push module**

Create `web/src/lib/push/send-push.ts`:

```ts
// Server-side browser push, ported from the bot's src/scheduler.js sendBrowserPush
// so the web failover cron can deliver reminders when the bot is down. Uses the
// service client (bypasses RLS). Fire-and-forget: any failure is logged, never thrown.
import webpush from 'web-push';
import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/service-role';

let vapidReady = false;
function ensureVapid(): boolean {
  if (vapidReady) return true;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return false; // push disabled
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidReady = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  eventId?: number | string | null;
}

export async function sendBrowserPush(telegramId: string, payload: PushPayload): Promise<void> {
  if (!ensureVapid()) return;
  const supabase = createServiceClient();
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_chat_id', telegramId)
      .single();
    if (!profile) return; // user not on the web dashboard

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', profile.id);
    if (!subs || subs.length === 0) return;

    // Mint a tracking token so the Take/Skip push actions authorize against this event.
    let trackingToken: string | null = null;
    if (payload.eventId) {
      trackingToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(trackingToken).digest('hex');
      await supabase.from('push_tracking_tokens').insert([{
        event_id: payload.eventId,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }]);
    }

    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      eventId: payload.eventId ?? null,
      trackingToken,
    });

    for (const sub of subs) {
      const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      let gateway = 'Unknown Gateway';
      try { gateway = new URL(sub.endpoint).hostname; } catch { /* ignore */ }
      try {
        await webpush.sendNotification(subscription, pushPayload);
        await supabase.from('push_logs').upsert(
          [{ user_id: profile.id, event_id: payload.eventId ?? null, status: 'SENT', gateway }],
          { onConflict: 'event_id,status', ignoreDuplicates: true },
        );
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        let status = 'FAILED';
        if (e.statusCode === 410 || e.statusCode === 404) {
          status = 'EXPIRED';
          await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          console.error(`[send-push] gateway error sub ${sub.id} code ${e.statusCode ?? '?'}: ${e.message}`);
        }
        await supabase.from('push_logs').upsert(
          [{ user_id: profile.id, event_id: payload.eventId ?? null, status, gateway, error_message: e.message }],
          { onConflict: 'event_id,status', ignoreDuplicates: true },
        );
      }
    }
  } catch (err) {
    console.error('[send-push] error:', err);
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/package-lock.json web/src/lib/push/send-push.ts
git commit -m "$(printf 'feat(web): shared browser-push module for failover\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Bot heartbeat write

**Files:**
- Modify: `src/scheduler.js` (inside the every-minute `cron.schedule('* * * * *', ...)` handler, immediately after `lockHeld = true;`)

**Interfaces:**
- Consumes: `supabase` (already imported), `SCHEDULER_INSTANCE_ID` (already defined) in `src/scheduler.js`.
- Produces: an upsert to `public.scheduler_heartbeat` every tick the bot holds the lease.

- [ ] **Step 1: Add the heartbeat upsert**

In `src/scheduler.js`, find (inside the minute-tick handler):

```js
      lockHeld = true;

      console.log(`[Scheduler] Checking for due reminders at ${now.toISOString()}...`);
```

Replace with:

```js
      lockHeld = true;

      // Heartbeat: mark the scheduler alive so the web failover cron stays dormant
      // while this process is running. Written every tick we hold the lease.
      const { error: beatErr } = await supabase.from('scheduler_heartbeat').upsert(
        { id: 1, last_beat: new Date().toISOString(), instance_id: SCHEDULER_INSTANCE_ID },
        { onConflict: 'id' }
      );
      if (beatErr) console.error('[Scheduler] Failed to write heartbeat:', beatErr);

      console.log(`[Scheduler] Checking for due reminders at ${now.toISOString()}...`);
```

- [ ] **Step 2: Confirm the existing bot tests still pass**

Run: `npm test` (from repo root)
Expected: all `node:test` suites pass (no test covers the cron handler; this confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add src/scheduler.js
git commit -m "$(printf 'feat(bot): write scheduler_heartbeat each minute tick\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

- [ ] **Step 4: Note for deploy** — this file runs on **Render**, not Vercel. It ships when the bot is redeployed (Task 7 activation). Until then, `last_beat` stays at its seeded past value and the cron treats the bot as dead (fail-safe).

---

### Task 5: Failover logic in `/api/cron/tick`

**Files:**
- Modify: `web/src/app/api/cron/tick/route.ts` (full rewrite of the `GET` body; keep the existing `isAuthorized`/`CRON_SECRET`/`dynamic` scaffolding)

**Interfaces:**
- Consumes: `isBotAlive`, `isRecentlySent` from `@/lib/schedule/bot-liveness`; `sendBrowserPush` from `@/lib/push/send-push`; `calculateNextReminder` from `@/lib/medication-utils`; `createServiceClient` from `@/lib/supabase/service-role`.
- Produces: `GET /api/cron/tick` that no-ops when the bot is alive and runs the full push failover when it is not.

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `web/src/app/api/cron/tick/route.ts` with:

```ts
import { createServiceClient } from '@/lib/supabase/service-role';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import crypto from 'crypto';
import { isBotAlive, isRecentlySent } from '@/lib/schedule/bot-liveness';
import { sendBrowserPush } from '@/lib/push/send-push';
import { calculateNextReminder } from '@/lib/medication-utils';

// Reminder send-FAILOVER. The Render bot (src/scheduler.js) is primary and writes a
// heartbeat each tick. This route is pinged every minute by an external cron with a
// CRON_SECRET Bearer. If the heartbeat is fresh the bot is alive and this route is a
// total no-op. If it is stale/missing the bot is down: this route takes over and
// sends browser push (initial dose, gentle reminder, caregiver escalation, snooze
// re-fire) using the SAME exactly-once guards the bot uses. Telegram is never sent
// here (it is dead when the bot is down). See docs/superpowers/specs/2026-07-11-*.
export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Cron tick disabled.' }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const ranAt = new Date().toISOString();

  // 1. Bot alive? -> total no-op (do NOT touch send-coupled RPCs).
  const { data: hb } = await supabase
    .from('scheduler_heartbeat')
    .select('last_beat')
    .eq('id', 1)
    .maybeSingle();
  if (isBotAlive(hb?.last_beat)) {
    return NextResponse.json({ ok: true, skipped: 'bot_alive', ranAt });
  }

  // 2. Takeover — mutually exclusive with any other tick via the shared lease.
  const holder = `vercel-cron-${crypto.randomUUID()}`;
  const { data: lockAcquired, error: lockErr } = await supabase.rpc('try_acquire_scheduler_lock', {
    p_lock_name: 'minute_tick',
    p_ttl_seconds: 120,
    p_holder: holder,
  });
  if (lockErr) {
    console.error('[CronTick] lock acquire failed:', lockErr);
    return NextResponse.json({ error: lockErr.message, ranAt }, { status: 500 });
  }
  if (!lockAcquired) {
    return NextResponse.json({ ok: true, skipped: 'locked', ranAt });
  }

  const now = new Date();
  let initialSends = 0;
  let transitionSends = 0;
  let snoozeSends = 0;

  try {
    // 2a. INITIAL DUE DOSE — mirror src/scheduler.js step 1, push-only.
    const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: dueMeds } = await supabase
      .from('medications')
      .select('*')
      .eq('active', true)
      .lte('next_reminder_at', now.toISOString())
      .or(`last_sent_at.is.null,last_sent_at.lte.${sixtySecondsAgo}`);

    for (const med of dueMeds || []) {
      if (isRecentlySent(med.last_sent_at, now.getTime())) continue;

      // OCC-lock last_sent_at so only one process sends this dose.
      let lockQuery = supabase.from('medications').update({ last_sent_at: now.toISOString() }).eq('id', med.id);
      lockQuery = med.last_sent_at
        ? lockQuery.eq('last_sent_at', med.last_sent_at)
        : lockQuery.is('last_sent_at', null);
      const { data: locked } = await lockQuery.select();
      if (!locked || locked.length === 0) continue; // another process took it

      // Insert the SENT event; the (medication_id, scheduled_for) unique constraint dedupes.
      const scheduledFor = med.next_reminder_at;
      const { data: eventData, error: eventErr } = await supabase
        .from('reminder_events')
        .insert([{
          medication_id: med.id,
          telegram_id: med.telegram_id,
          scheduled_for: scheduledFor,
          reminder_status: 'SENT',
          retry_count: 0,
          snooze_count: 0,
          retry_reminder_at: null,
        }])
        .select();

      // On duplicate (23505) or success, advance next_reminder_at so it doesn't re-fire.
      const nextReminder = calculateNextReminder(med.reminder_times, med.timezone);
      await supabase
        .from('medications')
        .update({
          next_reminder_at: nextReminder.toISOString(),
          last_reminder_scheduled_at: med.next_reminder_at,
          retry_reminder_at: null,
          retry_count: 0,
        })
        .eq('id', med.id);

      if (eventErr || !eventData || eventData.length === 0) continue; // duplicate — already handled elsewhere

      await sendBrowserPush(med.telegram_id, {
        title: '💊 Medication Reminder',
        body: `Time to take ${med.drug_name}${med.dosage ? ` (${med.dosage})` : ''}.`,
        eventId: eventData[0].id,
      });
      initialSends++;
    }

    // 2b. GENTLE + ESCALATION — the RPC transitions state and returns what to send.
    const { data: transitions, error: scanErr } = await supabase.rpc('scan_and_escalate_overdue_reminders');
    if (scanErr) {
      console.error('[CronTick] scan_and_escalate failed:', scanErr);
    } else {
      for (const t of transitions || []) {
        if (t.new_status === 'GENTLE_REMINDER') {
          await sendBrowserPush(t.telegram_id, {
            title: '⏰ Gentle Reminder',
            body: `Please remember to take your ${t.drug_name}${t.dosage ? ` (${t.dosage})` : ''}.`,
            eventId: t.event_id,
          });
          transitionSends++;
        } else if (t.new_status === 'ESCALATED') {
          // Patient display name from profiles (no Telegram getChat available here).
          const { data: patient } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('telegram_chat_id', t.telegram_id)
            .maybeSingle();
          const patientName = patient?.full_name || 'Your patient';

          const { data: caregivers } = await supabase
            .from('active_caregiver_links')
            .select('caregiver_chat_id')
            .eq('patient_telegram_id', t.telegram_id)
            .eq('connection_status', 'ACCEPTED')
            .eq('is_active', true)
            .eq('can_receive_escalations', true);

          for (const cg of caregivers || []) {
            await sendBrowserPush(cg.caregiver_chat_id, {
              title: `⚠️ ${patientName} Missed Medication`,
              body: `${patientName} has not taken ${t.drug_name}. Action required.`,
              eventId: t.event_id,
            });
            transitionSends++;
          }
          await supabase.from('reminder_events').update({ caregiver_notified: true }).eq('id', t.event_id);
        }
      }
    }

    // 2c. SNOOZE RE-FIRE — expired snoozes back to SENT, push-only.
    const { data: expired } = await supabase
      .from('reminder_events')
      .select('*, medications:medication_id (*)')
      .eq('reminder_status', 'SNOOZED')
      .lte('retry_reminder_at', now.toISOString());

    for (const ev of expired || []) {
      const med = ev.medications;
      if (!med || !med.active) continue;
      const { data: updated } = await supabase
        .from('reminder_events')
        .update({ reminder_status: 'SENT', retry_reminder_at: null })
        .eq('id', ev.id)
        .eq('reminder_status', 'SNOOZED')
        .select();
      if (!updated || updated.length === 0) continue;
      await sendBrowserPush(med.telegram_id, {
        title: '⏰ Snooze Reminder',
        body: `Time to take ${med.drug_name}${med.dosage ? ` (${med.dosage})` : ''}.`,
        eventId: ev.id,
      });
      snoozeSends++;
    }

    // 2d. Day-end closure (idempotent).
    const { error: closeErr } = await supabase.rpc('close_daily_medications');
    if (closeErr) console.error('[CronTick] close_daily_medications failed:', closeErr);

    console.log(`[CronTick] FAILOVER ranAt=${ranAt} initial=${initialSends} transitions=${transitionSends} snoozes=${snoozeSends}`);
    return NextResponse.json({ ok: true, mode: 'failover', ranAt, initialSends, transitionSends, snoozeSends });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    console.error('[CronTick] failover error:', error);
    return NextResponse.json({ error: message, ranAt }, { status: 500 });
  } finally {
    const { error: relErr } = await supabase.rpc('release_scheduler_lock', {
      p_lock_name: 'minute_tick',
      p_holder: holder,
    });
    if (relErr) console.error('[CronTick] lock release failed:', relErr);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Production build**

Run: `cd web && npm run build`
Expected: `✓ Compiled successfully`; `/api/cron/tick` listed as a route; no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/cron/tick/route.ts
git commit -m "$(printf 'feat(web): push send-failover in /api/cron/tick\n\nHeartbeat-gated takeover of the bot minute tick: initial dose, gentle,\nescalation, and snooze re-fire via browser push when the bot is down.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: Local no-op verification (bot-alive path)

**Files:** none (verification only).

- [ ] **Step 1: Run the web dev server**

Use the project preview (`.claude/launch.json` "web", port 3001) or `cd web && npm run dev`.

- [ ] **Step 2: Simulate a fresh heartbeat**

In the Supabase SQL editor, run:

```sql
UPDATE public.scheduler_heartbeat SET last_beat = now() WHERE id = 1;
```

- [ ] **Step 3: Hit the endpoint with the Bearer**

Run (replace `<CRON_SECRET>` with the value set in the local `web/.env.local`; set one there first if absent):

```bash
curl -s -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3001/api/cron/tick
```

Expected JSON: `{"ok":true,"skipped":"bot_alive","ranAt":"..."}` — confirms the no-op path does not send or mutate when the bot is alive.

- [ ] **Step 4: Simulate a dead bot and confirm takeover shape**

```sql
UPDATE public.scheduler_heartbeat SET last_beat = now() - interval '10 minutes' WHERE id = 1;
```

Re-run the same `curl`. Expected JSON: `{"ok":true,"mode":"failover",...}` (counts may be 0 if nothing is due). Then restore liveness so local testing doesn't fight a real bot:

```sql
UPDATE public.scheduler_heartbeat SET last_beat = now() WHERE id = 1;
```

No commit (verification only).

---

### Task 7: Activation (env + external cron) and acceptance

**Files:** none (ops + production acceptance).

- [ ] **Step 1: Add env vars to Vercel**

In the Vercel project `reminder-health` → Settings → Environment Variables (Production), add (values from the Render env): `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET` (generate a fresh random `CRON_SECRET` if none exists).

- [ ] **Step 2: Deploy the web app**

From the repo ROOT: `npx vercel deploy --prod --yes` (per memory `vercel-deploy-process`; never from `web/`).

- [ ] **Step 3: Redeploy the bot to Render**

Deploy the current `main` to the Render bot service so the Task 4 heartbeat write goes live. Confirm in Render logs that the minute tick runs, then verify in the SQL editor that `last_beat` advances each minute:

```sql
SELECT last_beat, now() - last_beat AS age FROM public.scheduler_heartbeat;
```

Expected: `age` under ~1 minute while the bot runs.

- [ ] **Step 4: Wire the external cron**

In cron-job.org (free), create a job: URL `https://reminder-health.vercel.app/api/cron/tick`, method GET, every 1 minute, custom header `Authorization: Bearer <CRON_SECRET>`. Confirm the job's execution log shows `200` with `{"skipped":"bot_alive"}` while the bot is healthy.

- [ ] **Step 5: Acceptance — real failover**

Temporarily suspend the Render bot service. Within ~3 minutes the cron responses should flip from `skipped:bot_alive` to `mode:failover`. With a medication due, confirm:
- exactly one push notification arrives on a subscribed device;
- exactly one `push_logs` row exists for that `event_id` with `status='SENT'`:

```sql
SELECT event_id, status, count(*) FROM public.push_logs
WHERE status='SENT' GROUP BY event_id, status HAVING count(*) > 1;
```
Expected: **zero rows** (no double-send).
- tapping the push action resolves the dose (check `reminder_events.reminder_status`).

Resume the Render bot; confirm cron responses return to `skipped:bot_alive` (failback).

---

## Self-Review

**Spec coverage:**
- Push-only rationale → enforced by Task 5 (no Telegram) + Global Constraints. ✓
- Heartbeat takeover → Tasks 1 (table), 4 (bot write), 2 (`isBotAlive`), 5 (gate). ✓
- Full parity (initial/gentle/escalation/snooze) → Task 5 sections 2a–2c. ✓
- Shared push module + `web-push` dep → Task 3. ✓
- Exactly-once (OCC + unique constraints + `push_logs`) → Task 5 (2a OCC/insert; `send-push` upsert) + Task 7 Step 5 acceptance query. ✓
- Activation (env + cron-job.org) → Task 7. ✓
- Fail-safe on missing heartbeat → Task 1 seed (past `last_beat`) + `isBotAlive(null)=false` (Task 2). ✓
- Testing (pure helpers + real-deploy verification) → Task 2 tests; Tasks 6–7 verification. ✓
- Bot-redeploy risk → Task 4 Step 4 + Task 7 Step 3. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; every command has expected output. ✓

**Type consistency:** `sendBrowserPush(telegramId, {title, body, eventId})` defined in Task 3 and called with that exact shape in Task 5. `isBotAlive`/`isRecentlySent` signatures match between Task 2 definition and Task 5 usage. `calculateNextReminder(times, timezone)` matches `web/src/lib/medication-utils.ts`. ✓
