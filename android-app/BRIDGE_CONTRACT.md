# Webview ↔ Native Bridge Contract

Defines the three bridge calls named in `CLAUDE.md`'s Android section (`syncSchedule`,
`setSession`, `getPendingActions`) with exact payload shapes, grounded in the live
`medications`/`reminder_events` schema and the real `resolve_reminder_event` RPC — not
invented.

**Status:** `syncSchedule` is implemented (2026-08-10) — `android/app/src/main/java/com/
reminderhealth/app/schedule/` (Room store + `ScheduleBridgePlugin`) on native,
`web/src/lib/native/schedule-bridge.ts` + `web/src/components/native/schedule-sync.tsx`
(mounted in the dashboard layout) on web. Verified on a real device (vivo I2202): 7 real
medications synced to the local store. `calculateNextReminder` is ported to Kotlin (2026-08-11,
`schedule/CalculateNextReminder.kt`), passing all 16 shared fixture vectors via
`CalculateNextReminderTest.kt` (`./gradlew testDebugUnitTest`). Exact alarms + notification
(`AlarmScheduler.kt`, `AlarmReceiver.kt`, `DoseNotifications.kt`) are **verified on the real
device (vivo I2202, 2026-08-11)** across five scenarios: fired 21ms and 25ms late (app alive);
**fired with the process DEAD — logcat shows the process cold-started at 01:35:00.912 purely to
deliver the alarm, then ALARM FIRED at 01:35:01.025**; fired during/after airplane mode and
appeared on the lock screen, persisting until tapped; POST_NOTIFICATIONS prompt granted. Each
firing re-registered the following dose. The full-screen alarm activity
(`AlarmActivity.kt` + `res/layout/activity_alarm.xml`, launched via the notification's
full-screen intent) is implemented with Taken/Skip/Snooze — on-device verification pending.
`setSession` and `getPendingActions`/the offline action queue are still spec-only, below — not
built yet, so **Taken/Skip currently stop the alarm but are not persisted or synced** (step 6). The throwaway `Ping` plugin from M1 is deleted,
superseded by `ScheduleBridge`.

**Debug helper (temporary, remove after M2):** `ScheduleBridge.scheduleTestAlarm({ seconds })`
fires a real alarm through the same `AlarmManager` path a dose uses, so timing/delivery can be
verified without waiting for a real dose time. Uses medication id `-1`, which `AlarmReceiver`
recognises as having no row behind it and therefore skips rescheduling.

---

## 1. `syncSchedule(medications: MedicationPayload[])` — web → native

Called by the web app after any medication create/edit/delete, and once on app foreground to
resync. Native replaces its entire local schedule store with this array (not a diff) and
recomputes/reschedules alarms for it.

```ts
interface MedicationPayload {
  id: number;                    // medications.id (bigint) — the join key to reminder_events
  drugName: string;               // medications.drug_name
  dosage: string | null;          // medications.dosage (free-text legacy field)
  dosageAmount: number;           // medications.dosage_amount (numeric, default 1)
  unitType: string | null;        // medications.unit_type
  reminderTimes: string[];        // medications.reminder_times (jsonb array of "HH:MM")
  doseDays: number[] | null;      // medications.dose_days (smallint[]); null = every day, 0=Sun..6=Sat
  timezone: string;               // medications.timezone (IANA tz string, e.g. "Asia/Kolkata")
  nextReminderAt: string;         // medications.next_reminder_at, ISO 8601 UTC — a server-computed
                                   // seed value; native recomputes locally via its own
                                   // calculateNextReminder port once this seed passes, it doesn't
                                   // trust the server value forever (schedule/CalculateNextReminder.kt)
  active: boolean;                // medications.active — inactive meds get no alarms
  medicationReason: string | null;// medications.medication_reason, optional context for the alarm UI
}
```

**Reserved for family voice alarms** (CLAUDE.md "Post-M2 features" — native side is already
built, web side is not). When that ships, `syncSchedule` gains two more fields *plus* a download
step, because these must be **local device paths, never URLs**:

```ts
  alarmAudioUrl: string | null;   // Supabase Storage path to the care-circle voice message
  alarmPhotoUrl: string | null;   // Supabase Storage path to their photo
```

Native downloads them during sync and stores the resulting local paths in
`medications.alarmAudioPath` / `alarmPhotoPath` (Room v2). `AlarmActivity` already reads those,
verifies the file is present and readable, and falls back to the default tone / no photo
otherwise — **so the alarm never waits on a network fetch at fire time**, which is what keeps it
working in airplane mode. Do not "simplify" this by passing a URL straight through to the alarm.

**Deliberately excluded** from this payload: stock fields (`current_stock`, `stock_threshold`,
`low_stock_*`), catalog link fields (`catalog_id`, `linked_*`), `priority_level`,
`retry_count`/`retry_reminder_at`/`last_sent_at`/`last_reminder_scheduled_at`. None of those
are needed to fire an alarm or render the full-screen alarm UI — pulling in less means less to
keep in sync and less that goes stale on the device.

`reminder_times` is confirmed **`jsonb`** live (not `TEXT[]` — see `db/migrations/APPLIED.md`
#64), so it deserializes to a plain JS/Kotlin string array with no special handling either side.

---

## 2. `setSession(session: BridgeSession)` — web → native

Called once after login/session-refresh so native can call Supabase RPCs on the user's own
behalf (RLS applies — native is not, and must never become, service-role).

```ts
interface BridgeSession {
  accessToken: string;   // Supabase session.access_token (short-lived JWT)
  refreshToken: string;  // Supabase session.refresh_token
  expiresAt: number;     // Supabase session.expires_at, epoch seconds
}
```

Stored native-side via `EncryptedSharedPreferences` (per `CLAUDE.md`). Native also needs two
values that are **not** secrets and don't come through this call — bake them into the app
config instead, same as `web/.env.local`'s `NEXT_PUBLIC_*` pair:
- `SUPABASE_URL` (`https://jaflclnakwtikqbfhfdk.supabase.co`)
- The Supabase **anon** key (never the service-role key — that must never ship in the APK,
  per `CLAUDE.md`'s hard rule)

Native calls RPCs directly over HTTPS (`POST {SUPABASE_URL}/rest/v1/rpc/<fn>`) with headers
`apikey: <anon key>` and `Authorization: Bearer <accessToken>` — the same two-header pattern
`supabase-js` uses under the hood, just without the JS client library.

**Token refresh is not specified here** — `accessToken` expires (`expiresAt`) and native has
no way to mint a new one itself (that requires the Supabase auth flow, which lives in the
webview). Options to decide when this is implemented: (a) native calls back into the webview
via a JS event asking it to refresh and re-call `setSession`, or (b) native just queues actions
whose sync fails on 401 and retries next time the webview is open and calls `setSession` again
on its own foreground-refresh cycle. **(b) is simpler and matches "the device is a delivery
channel + offline action queue, nothing more"** (CLAUDE.md) — recommended, but not decided here.

---

## 3. Offline action recording + sync — Taken / Skip

When the user taps Taken/Skip on the native full-screen alarm, native:
1. Records the action **locally first** (so it survives being fully offline), then
2. Attempts to sync it to `resolve_reminder_event` immediately if online, else queues it.

**The RPC is real and its signature is exact** (`db/migrations/migration_fix_resolve_invalid_scheduled_time.sql`):

```sql
resolve_reminder_event(
  p_event_id bigint,              -- reminder_events.id if known, else null (see below)
  p_medication_id bigint,
  p_scheduled_for timestamptz,
  p_action text,                  -- 'TAKEN' | 'SKIP' — matches the web's ReminderResolveAction
                                   -- type exactly (web/src/lib/reminder-events.ts); anything
                                   -- other than the literal string 'TAKEN' resolves as SKIPPED
                                   -- server-side, so send the exact strings, not synonyms
  p_actor_role text DEFAULT NULL, -- 'PATIENT' | 'CAREGIVER' — native M2 is patient-side only,
                                   -- always send 'PATIENT'; a caregiver-managing-a-device case
                                   -- is not in scope and not addressed here
  p_resolution_channel text DEFAULT NULL
) RETURNS TABLE(event_id, reminder_status, resolved_at, resolved_by, log_id, already_resolved)
```

`p_resolution_channel` has **no CHECK constraint** (verified — free text), so introducing a new
value for native syncs is safe without a migration. Suggested: `'ANDROID_ALARM'` (existing
values seen in code: `'PUSH_NOTIFICATION'`).

**Local queue entry shape** (what `getPendingActions()` below returns, and what a background
sync worker consumes):

```ts
interface QueuedAction {
  id: string;              // client-generated UUID, local idempotency key only
  medicationId: number;
  eventId: number | null;  // reminder_events.id if the alarm carried one, else null — the RPC
                            // accepts null and resolves by (medication_id, scheduled_for) instead
  scheduledFor: string;    // ISO 8601 UTC — must be the exact reminder_events.scheduled_for
                            // instant, not "now" at tap time
  action: 'TAKEN' | 'SKIP';
  recordedAt: string;      // ISO 8601 UTC, when the user actually tapped (device-local truth)
  synced: boolean;
  syncError: string | null;
}
```

## 4. `getPendingActions()` — web → native (query) + native → web (event)

`getPendingActions(): Promise<QueuedAction[]>` — callable from the web page (e.g. the
dashboard) to show "N actions syncing" instead of silently disagreeing with the server for a
while. Also fire a `pendingActionsChanged` plugin event (`notifyListeners` on the native side,
`ScheduleBridge.addListener('pendingActionsChanged', cb)` on the web side) whenever the queue
changes, so the web doesn't have to poll.

---

## 5. Known gap: **Snooze has no server sync path today**

`CLAUDE.md`'s bridge description lists "Taken/Skip/Snooze" as the offline-queued actions, but
only Taken/Skip have anywhere to go: `resolve_reminder_event`'s `p_action` only branches on
`'TAKEN'` vs. everything-else-is-`'SKIPPED'` — there's no `SNOOZED` outcome in that RPC at all.
The **only** existing snooze implementation is the Telegram bot
(`src/commands.js:1557-1594`), and it works by directly `UPDATE`-ing `reminder_events`
(`reminder_status: 'SNOOZED'`, `retry_reminder_at`, incremented `snooze_count`, capped by
`MAX_SNOOZES = 3`) using the bot's **service_role** key. A web/native client can't do the same
update: `reminder_events` is confirmed **SELECT-only via RLS** for `authenticated` — every
client write goes through a `SECURITY DEFINER` RPC, and no snooze RPC exists.

Two ways to close this before Snooze can be wired for real, neither implemented here:
- **(a) Add a `snooze_reminder_event` RPC** (new migration, `SECURITY DEFINER`, ownership check
  via `profiles.telegram_chat_id` like the others, capped at `MAX_SNOOZES`) mirroring the bot's
  logic but safely exposed to `authenticated`. Keeps caregiver-visible state consistent — a
  caregiver watching the web dashboard sees `SNOOZED` the same way regardless of which surface
  snoozed it.
- **(b) Device-local snooze only** — native just reschedules its own local alarm N minutes
  later and never tells the server. Simpler, ships sooner, but a caregiver's dashboard would
  keep showing the dose as merely "pending," not "snoozed," until it's finally resolved.

Recommend (a) for parity with the bot, but this needs a maintainer decision (and a migration)
before Snooze is implemented — not before the rest of M2.

---

## What I had to guess or infer (not grounded in existing code)

- The exact **plugin/method naming** (`ScheduleBridge`, `syncSchedule`, `setSession`,
  `getPendingActions`, `pendingActionsChanged`) — `CLAUDE.md` named the three methods but not a
  plugin name or the event name; these are reasonable but not previously-decided.
- **Token refresh strategy** (§2) — explicitly left as an open option, not a guess presented as
  fact.
- **`p_actor_role: 'PATIENT'`** for all native syncs — reasonable given M2's stated scope
  (device is "a delivery channel + offline action queue" for the primary user), but a
  caregiver-operates-a-device scenario was never discussed and isn't ruled in or out here.
- **`p_resolution_channel: 'ANDROID_ALARM'`** — a new value, not previously used anywhere;
  confirmed safe (no CHECK constraint) but the literal string is my choice, not an existing
  convention.
