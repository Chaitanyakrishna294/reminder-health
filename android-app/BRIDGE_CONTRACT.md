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
**Step 4 is VERIFIED on device (2026-08-11):** full-screen alarm rendered with the S30 hierarchy,
local-time header, Taken dismissed instantly and cleanly, alarm re-registered for the next day, and
teardown logged `alarm resources released (sound, vibration)` with no wake lock held at all.
`setSession`, `getPendingActions` and the offline action queue are implemented (step 6):
Taken/Skip/Snooze are written to a local Room queue the instant they are tapped, then synced to
`resolve_reminder_event` / `snooze_reminder_event` — immediately if online, otherwise by a
connectivity-constrained WorkManager one-shot. `BootReceiver` re-registers alarms after a reboot or
app update (step 5). On-device verification of steps 5-6 pending. **`snooze_reminder_event` needs
its migration applied** (`db/migrations/migration_snooze_reminder_event_2026_08_11.sql`) before a
device snooze can reach the server; until then it reschedules locally and its sync stays queued and
retries. The throwaway `Ping` plugin from M1 is deleted, superseded by `ScheduleBridge`.

**Debug helper (temporary, remove after M2):** `ScheduleBridge.scheduleTestAlarm({ seconds })`
fires a real alarm through the same `AlarmManager` path a dose uses, so timing/delivery can be
verified without waiting for a real dose time. Uses medication id `-1`, which `AlarmReceiver`
recognises as having no row behind it and therefore skips rescheduling.

---

## 0. Retry ladder — what the three new payload fields are for (2026-08-14)

Between the first ring and the caregiver being told, the device re-asks. The
ladder is those re-asks, and it is **native**: chained exact alarms, same
offline and reboot guarantees as the first ring, no polling.

| priority | default ladder | offsets from the dose time |
|---|---|---|
| `normal` (Routine) | 15 x 1 | +15 |
| `important` | 10 x 2 | +10, +20 |
| `critical` | 5 x 5 | +5, +10, +15, +20, +25 |

`retryIntervalMinutes` / `retryCount` override the default for **important and
critical only**; NULL means "use the default", and that is the normal state.

**`interval * count` MAY NEVER EXCEED 30 MINUTES.** This is a safety property.
`scan_and_escalate_overdue_reminders` clamps its escalation anchor to
`created_at + 30 minutes` so a dose nobody re-prompted still escalates; a ladder
running past that would have the device politely re-asking the patient at +35
while the caregiver was already being told the dose was missed. Enforced by a DB
CHECK, by the edit form, and by `retryOffsets()` falling back to the priority
default rather than clamping. Do not raise it on the native side alone.

**The arithmetic is fixture-driven.** `test/retry-ladder-vectors.json` is shared
by `web/src/lib/schedule/retry-ladder.ts` and the Kotlin `RetryLadder` port —
same rule as `schedule-test-vectors.json`. Add cases there, never in one side's
test, or the two drift invisibly. **Fire times still come only from the native
core**; the fixture is offsets, not wall-clock instants.

### Rules the Kotlin half must honour

1. **Retries reuse the ORIGINAL `scheduledFor`.** `scheduleAt` already separates
   `fireAt` from `scheduledFor` — that split was the snooze fix, and a retry has
   exactly the same shape: a later ring about an earlier dose. Getting this wrong
   makes the answer unsaveable (`INVALID_SCHEDULED_TIME`).
2. **Retry is not snooze.** A user snooze suspends the ladder and reschedules per
   snooze rules; auto-retries never touch `scheduledFor` and never call
   `snooze_reminder_event`.
3. **Resolving from ANY surface cancels the pending chain** — notification
   action, app, or a caregiver on the web. An offline device keeps climbing until
   it learns, which is correct: it has no reason to believe the dose was taken.
4. **Boot reconstructs in-flight ladders.** `rescheduleAll` recomputes from
   `reminder_times`, so a reboot mid-ladder would otherwise drop a critical
   medication's remaining rungs silently — the exact failure this feature exists
   to prevent. This is a must-fix within the feature, not a follow-up.
5. **Presentation follows the standing rule**: locked or idle -> full-screen
   `AlarmActivity`; unlocked and in use -> heads-up notification, fully
   answerable on its own.
6. **One ring, N doses.** Rungs landing in the same minute coalesce. The ring
   lists **every still-unanswered dose from the same original scheduled time**,
   each answerable on its own — the patient takes their noon pills as one
   handful and must never be double-asked. Answered doses show their state
   immediately and the screen persists until every dose is answered or dismissed;
   at 8:01 the unanswered remainder must still be plainly visible. **In elderly
   mode the same handful presents ONE DOSE AT A TIME** (answer -> next appears),
   matching the one-question philosophy. Either way an unanswered dose never
   vanishes: its own ladder, the sticky, and the rail all keep holding it.
   Ladders stay independent in the scheduler; only presentation coalesces.
7. **Copy is zero-blame** — "Still time to take Telmikind", reminding rather than
   scolding. The sticky keeps its current honest record-keeping role.

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
  priorityLevel: string | null;   // medications.priority_level — 'normal' | 'important' | 'critical'
  retryIntervalMinutes: number|null; // medications.retry_ladder_interval_minutes, NULL = priority default
  retryCount: number | null;      // medications.retry_ladder_count, NULL = priority default
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

### Call-level fields alongside `medications`

```ts
syncSchedule({
  medications,
  userId?: string,
  elderly?: boolean,
  ringSeconds?: number,
  language?: string,   // 2026-08-15
})
```

- **`userId`** keys the native store to one identity (account-switch guard, 2026-08-11).
- **`ringSeconds`** (2026-08-14) is `profiles.alarm_ring_seconds` — how long **each
  dose** rings before the alarm screen moves on to the next dose in the same handful.
  **Per dose, not per screen:** four medicines at two minutes each is a lit, ringing
  phone for eight, which is why the settings copy states the total instead of leaving
  it to be discovered at 3am. Clamped to 60-300s on arrival as well as by the DB CHECK —
  it drives a wake-lit screen, so the device is safe against a bad sync as well as a bad
  form. Absent leaves the stored value alone (default 60s, today's behaviour).
  **Its query is deliberately separate on the web side**: PostgREST fails an entire
  select on an unknown column, so folding it into the medication read would mean
  deploying before the migration stops `syncSchedule` outright.
- **`elderly`** (2026-08-14) mirrors CLAUDE.md's third density so the **Kotlin alarm screen**
  can honour it. This is the same argument the planned `language` field rests on: the alarm is
  a separate process with no webview running, so it cannot read a React context, `localStorage`,
  or `profiles` — anything that changes how a dose is *presented* has to travel. It changes
  exactly one thing natively: a coalesced handful is asked about **one dose at a time** instead
  of as a list. Stored in `AlarmPrefs` (plain SharedPreferences, deliberately **not**
  `SessionStore`, which is wiped on sign-out — wiping "this person needs the simplified screen"
  at sign-out resets the person least able to put it back). Absent leaves the stored value
  alone, so an APK newer than the deployed web keeps whatever it last learned.
- **`language`** (2026-08-15) — **BUILT.** The field CLAUDE.md marked CRITICAL, and no longer
  "planned" anywhere above. BCP-47 base tag, one of `en · hi · te · ta · kn · ml · mr`.

  **Why a bridged value and not just `values-hi/`:** Android resource qualifiers select on the
  **device** locale, which is not the language the user chose in this app. A patient whose phone
  is in English but whose app is Telugu would get `values/` — an English alarm — on the one
  screen that has to work offline, at 3am, for the least technical person we have. Dropping
  translated resource folders in does **nothing** on its own; something has to force the
  configuration. That is `AlarmPrefs.localized(context)`, and **every user-facing native string
  goes through it**:
  - `AlarmActivity` via `attachBaseContext` — which also covers `activity_alarm.xml`, since the
    layout references string resources directly and an un-localized base context would resolve
    those against the device locale. Half a translated screen is the failure mode here.
  - `DoseNotifications` via a private `Context.t(...)` extension (17 call sites): notification
    actions, the coalesced-group titles, the retry rung copy (`alarm_title_retry`) and the
    sticky missed notice.
  - `WaterNudge` — title, progress and its single Taken action.
  - `AlarmPreview` explicitly, because it inflates the same XML by hand rather than through the
    Activity. A Settings miniature that stopped matching the real screen would be a promise
    about something the user next sees at 3am.

  Validated and narrowed in `AlarmPrefs.setLanguage` against a **supported-language allowlist**
  rather than passed through: an unknown tag would resolve to the default resources — the right
  outcome for the wrong reason — and the allowlist makes "which languages does the alarm speak"
  answerable from one Kotlin file. Absent or unrecognised leaves the stored value alone, same
  contract as `ringSeconds`, so an older APK is unaffected and a newer one is never reset to
  English by a missing field.

  **The web must re-sync when the language changes, not only on navigation.** `locale` is in
  `ScheduleSync`'s effect deps alongside `isElderly`; without it, switching to Telugu in Settings
  would leave the alarm in English until the next route change — and Settings → Language is a
  leaf, so the user's next action is usually *back*, not forward.

  **Frame only, in Kotlin as on the web.** Medication names reach the alarm and the notifications
  as `%1$s` format arguments straight from the Room store, exactly as the user typed them. Counts
  stay Western numerals. `app_name` and the URL-scheme strings are absent from the translated
  files on purpose — a brand and two machine tokens are not words.

  **Checked mechanically:** every key present in all six locales, and every format specifier
  identical to `values/`. A `%1$d` where the base has `%1$s` is not a cosmetic bug — it is an
  `IllegalFormatConversionException` on the alarm path.

---

## 1c. Alarm media — the one bridge area where NATIVE owns the data (2026-08-14)

```ts
getAlarmMedia()  -> { imageChoice, soundChoice, bundled: string[], hasCustomImage, hasCustomSound }
setAlarmImage({ choice })   -> AlarmMediaState   // a bundled key, or 'none'
pickAlarmImage()            -> { picked, imageChoice?, error? }
pickAlarmSound()            -> { picked, soundChoice?, error? }
clearAlarmSound()           -> AlarmMediaState
renderAlarmPreview({ width? }) -> { dataUri: string | null }   // a JPEG data: URI
previewAlarmSound()         -> { playing: boolean }
stopAlarmSoundPreview()     -> { playing: false }
```

**`renderAlarmPreview` returns a picture of the REAL screen, not a mock-up.**
Native inflates the same XML the alarm uses, binds it through the same
`AlarmScreenBinder`, resolves the backdrop through the same `AlarmMedia`, and draws
the result to a bitmap. A CSS recreation in Settings would have been a second
implementation of the most safety-critical screen in the product, and the moment the
two diverged the preview would be a lie about what someone sees at 3am — with no way
for them to check until then. `AlarmScreenBinder` exists solely so the two paths are
one; if the alarm layout changes, the miniature changes with it.

- **Measured at real screen size, then scaled.** Laying out at preview size would
  re-wrap the text and re-balance the weighted identity block, so a long medicine name
  could look fine in the miniature and overflow on the alarm.
- **Never rejects.** A null `dataUri` means "no preview"; a settings screen must not
  break because a picture could not be drawn. `Throwable` is caught, not `Exception` —
  an OOM drawing a full-screen bitmap is the realistic failure.
- **Sound is previewed by playing it** (`USAGE_ALARM`, so it answers "what will
  actually wake me"), non-looping and hard-stopped after 10s.

**Direction matters and it is the opposite of everything else here.** `elderly` and
`ringSeconds` are web data the device mirrors. The alarm's picture and sound are
**device data the web displays**: the webview cannot write to Android app-private
storage, and the alarm must show and play them in airplane mode with the app process
dead. So the picker runs in Kotlin, the bytes are copied in Kotlin, and the web only
ever learns *which* choice is active.

- **Files live in `filesDir/alarm-media/`, never Supabase, never a URL.** The copy is
  the feature: a gallery pick hands back a `content://` URI belonging to another app
  that can be revoked or deleted. Copying the bytes is what lets someone tidy their
  photos without their alarm quietly reverting to a grey screen.
- **`ACTION_OPEN_DOCUMENT`, not the photo picker or MediaStore** — it needs no
  permission on any API level this app supports, so the manifest's permission list is
  unchanged. CLAUDE.md treats that list as a promise; "the user picked a wallpaper" is
  not a reason to start reading their photo library.
- **Three bundled backdrops** ship in the APK as authored gradients (`alarm_bg_dawn`,
  `alarm_bg_calm`, `alarm_bg_night`), not photographs: legible by construction, about a
  kilobyte each, nothing to license. A photograph can arrive with a bright corner
  exactly where the medicine name sits.
- **Contrast is structural, not per-image.** Every backdrop sits under the same 55%
  black scrim, and the buttons keep their own opaque fills — so no image, bundled or
  picked, can affect whether Taken/Skip/Snooze are readable.
- **A picked image is decoded DOWNSAMPLED.** A 50-megapixel photo decoded whole is an
  OutOfMemoryError on a cheap phone, on the one screen that must never crash, and the
  picker puts exactly that file one tap away.
- **`picked: false` is a cancel, not an error.** Cancelling is the commonest outcome of
  opening a file picker; rejecting the call would show a failure to someone who simply
  changed their mind.

**GLOBAL, not per medication.** One image and one sound for every alarm, and in a
coalesced handful they belong to the *presentation* — one backdrop, one tone, not one
per row; swapping either as the focus moves would flicker the screen and stutter the
sound while someone is reading a medicine name. Per-medication override is the natural
next step and is **already half built**: `Medication.alarmAudioPath`/`alarmPhotoPath`
exist in Room v2, `AlarmMedia.resolveImage`/`resolveSound` already prefer them, and
`AlarmActivity` already passes them. What is missing is somewhere to *set* them — a
server column, a migration, per-medication UI. Global costs nothing later, because the
resolution order **is** the override's mechanism with one of its two inputs populated.

---

## 1b. `doseResolved({ doses })` and `getActiveLadders()` — the ladder-cancellation pair (2026-08-14)

**The device runs the retry ladder, so the device has to learn about every answer.** It sees
answers made on the alarm screen and on the notification, because both write to its local queue.
It does **not** see an answer made in the webview — the rail, the dose gate, elderly mode all
resolve straight to Supabase.

Found live on a real device, 2026-08-14: two **critical** medications marked SKIP from the app's
rail read as skipped everywhere on screen while `pending_retries` kept ringing about them every
five minutes. Phase 2 had proved the notification path cancelled correctly, which is exactly what
made the gap invisible — the choke point (`DoseActionQueue.record`) only ever saw
native-originated answers.

```ts
doseResolved({ doses: { medicationId: number; scheduledFor: string; action: 'TAKEN' | 'SKIP' }[] })
  -> { applied: number }
getActiveLadders() -> { ladders: { medicationId: number; scheduledFor: string }[] }
```

Two routes, because there are two ways an answer can reach the device:

1. **Immediately**, from `web/src/lib/reminder-events.ts` — the one function every web surface
   resolves through. It lives there rather than in each surface for the same reason the native
   cancellation lives inside `DoseActionQueue.record`: a surface added next month gets it
   without knowing it exists. Never throws; the dose is already recorded server-side by then, and
   a failure costs at most one extra ring.
2. **By reconciliation**, from `ScheduleSync` — ask native which ladders are in flight, ask the
   server whether those doses are already resolved, report back the ones that are. This is the
   only route for an answer the device was *never* part of: a **caregiver resolving from their
   own phone**. Ladder-first on purpose, so the usual app-open makes one bridge call, gets an
   empty list, and issues no query at all.

**`doseResolved` goes through `DoseActionQueue.record(alreadyOnServer = true)`, not straight to
`cancelLadder`.** Cancelling the ladder is only one of the things an answer must do — it also has
to leave the dose out of the coalesced alarm group, narrow or clear the notification, and reach a
visible alarm screen. A second cancellation path would have covered the first and silently missed
the rest. The row is written `synced = true`, so `ActionSync` correctly never tries to send a
server-originated answer back to the server.

**Honest bound:** reconciliation runs when the webview runs. A ladder is at most 30 minutes long
(the escalation clamp), so a caregiver's remote answer can still leave the phone re-asking until
the app is next opened. Closing that would mean the device polling the server, which CLAUDE.md
forbids and which would break the offline guarantee the alarm core exists for.

Both methods are **optional on the JS side** (`bridge.doseResolved?`). `server.url` means the web
and the APK ship separately, so a device can be running either combination; absence means "this
device cannot be told", never an error.

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

## 3. Offline action recording + sync — Taken / Skip / Snooze

There are **two** places a patient can answer a dose, and both go through the identical path
(`DoseActionQueue.record`, deliberately shared so neither can drift):

- the full-screen `AlarmActivity` — phone locked or idle;
- the **notification's own Taken / Skip / Snooze buttons**, handled by `DoseActionReceiver` with
  no UI at all — phone unlocked and in use, where Android suppresses the full-screen intent and
  shows a heads-up notification instead. See `DoseNotifications`' class comment; that suppression
  is correct Android behaviour and is not overridden.

Either way, native:
1. Records the action **locally first** (so it survives being fully offline, the process being
   killed, and a reboot), then
2. Attempts to sync immediately if online, else leaves it queued for `ActionSyncWorker` (one-shot,
   `NetworkType.CONNECTED`) to deliver after a reconnect.

Taken/Skip go to `resolve_reminder_event`; Snooze goes to `snooze_reminder_event` (§5) **and**
re-registers the device's own alarm — both halves, or a snooze either fails to re-ask the patient
or produces a false caregiver escalation.

> **`p_event_id` is always null from the device, and that has consequences.** The alarm is pure
> native and fires with no server round-trip, so all it ever knows is
> `(medication_id, scheduled_for)`. Until 2026-08-11 that meant every device action was treated as
> a client-fabricated "virtual" dose and hit two guards meant for the web, either of which killed
> the queue's whole purpose: `VIRTUAL_EVENT_MUST_BE_FOR_TODAY` rejected anything syncing after the
> local day rolled over (i.e. exactly the offline-overnight case), and `INVALID_SCHEDULED_TIME`
> rejected anything syncing after `reminder_times` was edited. Both are permanent failures, so the
> answer was retried 5 times and dropped. Fixed by
> `db/migrations/migration_resolve_event_device_queue_2026_08_11.sql`, which gates those guards on
> whether a `reminder_events` row actually exists rather than on whether the caller knew its id.
> **If that migration is not applied, the offline queue silently loses doses.**

**The RPC is real and its signature is exact** (`db/migrations/migration_resolve_event_device_queue_2026_08_11.sql`,
which supersedes `migration_fix_resolve_invalid_scheduled_time.sql`):

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
  action: 'TAKEN' | 'SKIP' | 'SNOOZE';
  recordedAt: string;      // ISO 8601 UTC, when the user actually tapped (device-local truth)
  snoozeMinutes: number | null;  // SNOOZE only; server clamps to 1..60
  synced: boolean;
  syncError: string | null;
  attempts: number;        // retry ceiling is 5; see the stranded-action note below
}
```

**Retry ceiling.** `DoseActionDao.pending()` stops returning an action after 5 failed attempts, so
a permanently-rejected one can't retry forever. That leaves it in the table but invisible to the
sync path — a patient's recorded answer existing only on the device. `ActionSync.flush` logs those
loudly (`STRANDED: …` with the last error) rather than letting them disappear quietly. Nothing on
the web surfaces them yet; `getPendingActions()` (§4) is the hook for that when it's built.

## 3b. `clearSchedule()` — web → native

**Must be called on sign-out, and before signing a different account in.** Wipes the local
medication store and cancels every registered alarm.

Not optional politeness — found on-device 2026-08-11: signed in as a **guest**, the native store
still held the previous account's 12 medications and rang for them. A device alarm for a dose the
current user does not have is worse than a missing alarm: it tells someone to take medication that
isn't theirs.

Wired on the web at every session exit: `components/layout/navbar.tsx` (logout),
`settings-client-view.tsx` (logout **and** account deletion — deletion matters more, since the
medications are gone server-side and any surviving alarm points at nothing).

Ordering inside native is deliberate:
1. flush the action queue FIRST, while the outgoing session is still valid — after this the
   credential is gone and an un-synced Taken/Skip could never reach the server;
2. cancel alarms, wipe the medication store;
3. keep the action queue itself (a stranded action is recoverable, a deleted one is not) and log
   how many were stranded;
4. clear the tokens.

**Second line of defence:** `syncSchedule` also takes `userId` and compares it to the stored
owner ([`SessionStore.ownerUserId`]). A different id wipes the store before syncing rather than
layering on top — so the store belongs to exactly one identity even if `clearSchedule` was never
called (a crash mid-logout, an older web build).

## 4. `getPendingActions()` — web → native (query) + native → web (event)

`getPendingActions(): Promise<QueuedAction[]>` — callable from the web page (e.g. the
dashboard) to show "N actions syncing" instead of silently disagreeing with the server for a
while. Also fire a `pendingActionsChanged` plugin event (`notifyListeners` on the native side,
`ScheduleBridge.addListener('pendingActionsChanged', cb)` on the web side) whenever the queue
changes, so the web doesn't have to poll.

---

## 5. Snooze — `snooze_reminder_event` (**closed**, was a known gap)

`resolve_reminder_event` has no `SNOOZED` outcome — its `p_action` only branches on `'TAKEN'` vs.
everything-else-is-`'SKIPPED'`. The only prior snooze implementation was the Telegram bot
(`src/commands.js:1557-1594`), which `UPDATE`s `reminder_events` directly using the **service_role**
key. A client can't do that: `reminder_events` is SELECT-only under RLS, so every client write goes
through a `SECURITY DEFINER` RPC.

Resolved by adding one — `db/migrations/migration_snooze_reminder_event_2026_08_11.sql`:

```sql
snooze_reminder_event(
  p_medication_id bigint,
  p_scheduled_for timestamptz,
  p_snooze_minutes integer DEFAULT 10,  -- clamped server-side to 1..60
  p_resolution_channel text DEFAULT NULL
) RETURNS TABLE(event_id, reminder_status, retry_reminder_at, snooze_count, capped, already_resolved)
```

Mirrors the bot exactly (`SNOOZE_MINUTES = 10`, `MAX_SNOOZES = 3`, sets `reminder_status='SNOOZED'`,
moves `retry_reminder_at`, increments `snooze_count`) and inserts the row if the device is ahead of
the server. Deliberately **patient-only** — narrower than `resolve_reminder_event`'s ReBAC — because
"not right now, ask me again" is a statement only the person taking the medication can make; a
caregiver deferring someone else's dose would suppress the very escalation they are the audience for.
It does **not** stamp `last_prompted_at`; the scheduler stamps that at re-fire, which is what keeps
the escalation ladder anchored on the last real prompt.

**Why this had to exist rather than snoozing device-locally:** a device-only snooze leaves the
server considering the dose unanswered, so the care circle gets a **false missed-dose alert** for a
patient who did respond. Unacceptable for a care-circle product.

A snooze therefore does **both halves** — call this RPC *and* re-register the device's own alarm.
Both the full-screen alarm and the notification's Snooze button go through the same path.

> **Landmine, fixed 2026-08-11 — this is what "snooze doesn't work" turned out to be.** The local
> re-registration must carry the **original dose instant**, not the re-fire time.
> `AlarmScheduler.scheduleAt` used to write `fireAt` into `EXTRA_SCHEDULED_FOR`; for a normal dose
> those are the same instant, so it was invisible. For a snooze they are not — the re-fire is 10
> minutes out while the dose it asks about is still the original one. The re-fired alarm therefore
> advertised its own re-fire time as the dose identity, and answering it queued a `scheduled_for`
> matching no `reminder_times` entry and no `reminder_events` row: permanent
> `INVALID_SCHEDULED_TIME`, five retries, **answer dropped**. `scheduleAt` now takes `scheduledFor`
> separately from `fireAt` (defaulting to `fireAt`, which stays correct for every normal dose).

> **Still PENDING application.** Both this and the device-queue migration above are written but must
> be applied by the maintainer in the Supabase SQL editor (see `db/migrations/APPLIED.md`). Until
> then a device snooze reaches an RPC that does not exist, fails, and retries.

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
