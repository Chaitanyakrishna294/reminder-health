# Reminder Send-Failover — Design Spec

**Date:** 2026-07-11
**Status:** Approved design, pending implementation plan
**Related:** `docs/KNOWN_ISSUES.md` §3, `src/scheduler.js`, `web/src/app/api/cron/tick/route.ts`, memory `hosting-and-worker`

## Problem

The every-minute reminder loop runs only inside the bot process on Render
(`src/scheduler.js`). On Render Free that host pauses near month-end (750 hr/mo),
and while it is paused **no medication reminders are sent at all**. For a
medication-adherence product this is the worst failure mode: a silently dropped
reminder is a missed dose.

`web/src/app/api/cron/tick/route.ts` already exists and, when pinged, runs the
*DB-side* portion of the loop (`scan_and_escalate_overdue_reminders`,
`close_daily_medications`) but **does not send the actual notification**. This
spec closes that gap.

## Key constraint that shapes the design

When the Render bot is paused, **Telegram is doubly dead**: the bot can neither
send messages nor receive the Take/Skip button callbacks (callbacks arrive via
the bot's polling). **Browser push is the only channel that fully works without
the bot** — it can be sent from the always-up Vercel deployment, and its
Take/Skip actions route to `web/src/app/api/push/{acknowledge,opened}` which are
always online. Therefore the failover is **push-only**. A Telegram failover
would deliver dead-button messages and is intentionally out of scope.

## Goal / non-goals

**Goal:** When the bot is down, the Vercel cron route sends browser push for all
four cases the bot handles — initial due dose, gentle reminder, caregiver
escalation, snooze re-fire — with an exactly-once guarantee shared with the bot.

**Non-goals:** Telegram failover; retiring the Render bot (it stays primary);
changing the reminder state machine or the DB RPCs.

## Approach: heartbeat takeover

The bot writes a heartbeat each tick. The cron route does its entire tick — DB
RPCs **and** sends — **only** when the heartbeat is stale (bot down); while the
bot is healthy the route is a **no-op** (returns ok, touches nothing). This
gives automatic failover and failback, zero double-send, and — because failover
is push-only — no dead Telegram buttons.

**Why the no-op must be total (not "RPCs only"):**
`scan_and_escalate_overdue_reminders` **mutates** state as a side effect
(SENT→GENTLE_REMINDER→ESCALATED) and is coupled to the caller sending the
returned transitions. If the cron called it while the bot is alive but did not
send (because bot-alive suppresses sends), those transitions would be *consumed*
and the bot would never return/send them on its next tick. So when the bot is
alive the route must call **none** of the send-coupled RPCs. `close_daily_
medications` is safe to double-run, but for simplicity the alive branch runs
nothing and lets the bot own the whole loop.

Rejected alternatives:
- **Shared-lock race** (both contend for `minute_tick`, winner sends): simpler
  but when both are up a dose can randomly go push-only instead of push+Telegram,
  and the behavior is harder to reason about.
- **Reuse `scheduler_locks.minute_tick.locked_until` as the heartbeat:** avoids a
  migration but depends on `release_scheduler_lock`'s exact semantics and is less
  explicit. A dedicated heartbeat row is worth the tiny table.

## Components (units, each independently testable)

### 1. Heartbeat
- **New table** `public.scheduler_heartbeat` — single row: `id smallint PK
  default 1 CHECK (id = 1)`, `last_beat timestamptz not null`, `instance_id
  text`. RLS enabled, no anon/authenticated policy (service-role only writes/reads).
- **Bot write** (`src/scheduler.js`, inside the minute tick, ~1 line): upsert
  `{ id: 1, last_beat: now, instance_id: SCHEDULER_INSTANCE_ID }`. Written every
  tick regardless of whether any dose was due, so it is a true liveness signal.
- **Staleness helper** (pure, in `web/src/lib/schedule/`): `isBotAlive(lastBeat,
  now, thresholdMs = 180_000) → boolean`. Threshold 3 min = 3 missed ticks.

### 2. Shared push-send module
- **New file** `web/src/lib/push/send-push.ts` — port of `sendBrowserPush` from
  `src/scheduler.js`: resolve `profiles.id` by `telegram_chat_id`, load
  `push_subscriptions`, mint a tracking token into `push_tracking_tokens`, send
  via `web-push`, log to `push_logs`, delete `410/404` subscriptions. Uses the
  **service client** (`createServiceClient`).
- **New dependency:** `web-push` added to `web/package.json` (no VAPID hand-roll).
- **VAPID init:** module-scope `webpush.setVapidDetails(...)` from env, guarded so
  a missing key disables push instead of throwing.

### 3. Failover logic in `/api/cron/tick`
First read `scheduler_heartbeat`. **If `isBotAlive` is true, return `{ ok: true,
skipped: 'bot_alive' }` immediately** — no RPCs, no sends. Only when it is false
do the following, while holding the `minute_tick` lock, reusing the **same**
guards as the bot so the two are exactly-once even if they briefly overlap during
failover/failback:
- **Initial due dose:** select active meds with `next_reminder_at <= now` and
  `last_sent_at` null/stale; OCC-lock `last_sent_at`; insert `reminder_events`
  (`SENT`) — unique constraint dedupes; `send-push`; advance `next_reminder_at`
  via `calculateNextReminder(reminder_times, timezone)`.
- **Gentle / escalation:** call `scan_and_escalate_overdue_reminders`; for each
  returned transition, push to patient (`GENTLE_REMINDER`) or to caregivers with
  `can_receive_escalations` (`ESCALATED`), then set `caregiver_notified`.
- **Snooze re-fire:** select `reminder_events` where `SNOOZED` and
  `retry_reminder_at <= now`; transition to `SENT`; `send-push`.
- Then `close_daily_medications` (already present).
- **`push_logs` unique `(event_id, 'SENT')`** is the cross-process dedupe: even if
  the bot recovers mid-batch, the same event is pushed at most once.

The route keeps its existing `CRON_SECRET` Bearer auth (timing-safe compare) and
`503`-when-unconfigured behavior unchanged.

### 4. Activation (ops, no code)
- Add `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and
  `CRON_SECRET` to the **Vercel** project env (they currently live only in Render).
- Point **cron-job.org** (free) at `GET https://reminder-health.vercel.app/api/cron/tick`
  every minute with header `Authorization: Bearer <CRON_SECRET>`. Independent of
  both Render and the Vercel plan tier.

## Data flow (bot down)

```
cron-job.org --(GET + Bearer, 1/min)--> /api/cron/tick
  -> authorize (CRON_SECRET)
  -> read scheduler_heartbeat; isBotAlive? -> YES: no-op, return {ok, skipped:bot_alive}
                                             -> NO (takeover):
       acquire minute_tick lock (skip tick if not acquired)
       initial due-dose: OCC last_sent_at -> insert reminder_events(SENT)
                         -> send-push -> advance next_reminder_at
       scan_and_escalate -> push GENTLE (patient) / ESCALATED (caregivers)
       snooze re-fire: SNOOZED & retry_reminder_at<=now -> SENT -> send-push
       close_daily_medications
       release minute_tick lock
User taps push action -> /api/push/acknowledge|opened (always up) -> dose resolved
```

## Error handling
- Every send is wrapped; one failure never aborts the batch (mirrors the bot).
- `web-push` `410/404` → delete the dead `push_subscriptions` row (existing behavior).
- Route already returns `5xx` with `ranAt` on RPC error; unchanged.
- If `minute_tick` cannot be acquired (unexpected overlap), skip the tick rather
  than risk double-processing.
- Missing VAPID env → push disabled with a warning, route still 200s (DB RPCs run).

## Testing
- **Pure helpers** get dependency-free `assert` checks in the repo's existing
  style (`web/src/lib/schedule/dose-engine.test.ts`): `isBotAlive` staleness
  boundaries (fresh / exactly-threshold / stale / null), and the due-selection
  predicate.
- **Send path** is verified against the **real Vercel deploy** — per
  `KNOWN_ISSUES.md` §3 the failover cannot be validated locally. Manual
  acceptance: with the bot stopped, confirm a due dose produces exactly one push
  and one `push_logs` `SENT` row, and that Take/Skip resolves via the web routes.

## Exactly-once argument (why bot + cron can't double-send)
1. Only one process holds `minute_tick` per minute (DB lease).
2. Initial send is OCC-guarded on `last_sent_at` and the `reminder_events`
   `(medication_id, scheduled_for)` unique constraint.
3. Every push is gated by `push_logs` unique `(event_id, status='SENT')` with
   `ignoreDuplicates`.
Any one of these alone prevents a duplicate; together they hold across the
failover/failback transition.

## Risks / open items
- **Bot redeploy required** for the heartbeat write (Render), separate from the
  normal Vercel deploy. Until the bot ships the heartbeat, `scheduler_heartbeat`
  is empty → treat "no row / null last_beat" as **bot dead** so failover is
  fail-safe (it activates rather than silently staying off).
- **Serverless time budget:** one invocation sends to all due users. Fine at
  current scale; if the due set ever grows large, batch across invocations.
- **Failback window:** up to ~3 min (the staleness threshold) where both may run;
  the exactly-once guards cover it.
