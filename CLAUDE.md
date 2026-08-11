# reminder-health

Medication-reminder system for Indian patients + caregivers. Three surfaces, one Supabase Postgres:
Telegram bot + schedulers (`index.js`, `src/`, Render, service_role), Next.js 16 web PWA
(`web/`, Vercel, anon key + RLS), and SQL state machines (`db/migrations/`, applied manually).

**Before searching the repo, read [docs/WORK_LEDGER.md](docs/WORK_LEDGER.md)** — the canonical map:
file/route/table/RPC inventory, "how to add X" recipes, env vars, known landmines, and which docs
are stale. Keep it updated when you add or move anything.

## Hard rules
- **Migrations are applied manually** by the maintainer in the Supabase SQL editor. Never attempt to apply one; just write `db/migrations/migration_<slug>.sql` (+ rollback/validation when warranted).
- **moment-timezone stays** — `src/utils.js` and `web/src/lib/medication-utils.ts` must keep identical DST math. No Intl migration.
- **Dashboard nav = exactly 5 icons** (`dashboard-main-layout.tsx`); secondary pages go in the profile dropdown.
- **Medication catalog links are human-select-only** — never auto-match a nickname to a real drug (patient safety).
- Web deploys from **repo root**: `npx vercel deploy --prod --yes --scope chaitanya-krishnas-projects-397d3a53`. **The `--scope` is required** — without it the CLI returns `Not authorized` even though `vercel whoami` succeeds, because `.vercel/repo.json` pins an `orgId` that no longer resolves for the logged-in user. Root `.vercel/repo.json` maps the repo to project `reminder-health` with `directory: web`, so deploy from the ROOT, never from `web/`. Vercel ships the **working tree, not the commit** — check `git status` first, or uncommitted work goes to production too.
- For nontrivial Next.js work, heed `web/AGENTS.md`: this Next 16 differs from training data; check `node_modules/next/dist/docs/`.
- Exclude `.claude/worktrees/` from repo-wide greps (stale full checkout).

## Android conversion (Capacitor) — plan v2, 2026-08-10
Supersedes the v1 sketch after a full repo read. Correction from v1: `web/` is Next.js 16 App
Router (server components, 19 API routes, proxy/middleware) — **cannot be statically bundled**
into Capacitor. A prior Bubblewrap **TWA** attempt was abandoned and **deleted 2026-08-10**
(`android-twa/`, never published, no obligation to its keystore/fingerprint — see Keystore
below) — a TWA can't
host native alarms and is not the path forward.

**Architecture: native-first alarm core + remote webview.** Capacitor `server.url` mode — the
webview loads the deployed Vercel site (medication CRUD, care circle, vault, settings); the
native bridge stays available to that page (this is NOT a TWA — the page can call Kotlin
plugins). A Kotlin alarm core owns everything reliability-critical with **zero webview
dependency**: a local schedule store (Room/SQLite or DataStore — device-side copy of
`reminder_times`/`timezone`/`dose_days`/next-fire-time) · `AlarmManager.setExactAndAllowWhileIdle()`
for only the next few upcoming doses, rescheduled after each fires, no polling/timers/foreground
service · full-screen alarm activity via **notification full-screen intent** (not
`SYSTEM_ALERT_WINDOW`) with Taken/Skip/Snooze, wake lock released on dismiss or 60s auto-timeout ·
`BOOT_COMPLETED` receiver re-registers alarms · an offline action queue (Taken/Skip/Snooze
recorded locally, synced via the existing `resolve_reminder_event` RPC when online).

**Testing on a real device needs BOTH sides shipped, every time.** `server.url` mode means the
webview always loads the *deployed* Vercel site, never local `web/` source — so a web-side change
(e.g. a new bridge call in `web/src/lib/native/`) is invisible on-device until it's actually
deployed to production, even if the APK itself was just rebuilt with the matching native code.
Conversely a native-only change needs a fresh APK install; the deployed web doesn't change that.
Concretely: **rebuild+reinstall the APK AND `npx vercel deploy --prod --yes --scope
chaitanya-krishnas-projects-397d3a53` from repo root** before assuming a webview↔native feature
is actually testable — mismatched-side testing is a real, already-hit failure mode (2026-08-10:
`ScheduleSync`'s success log never appeared on-device because only the APK had shipped, not the
web deploy carrying `schedule-sync.tsx`).

**Bridge contract (webview ↔ native):** `syncSchedule(medications)` — web calls after any
medication create/edit/delete, native store + alarms update immediately · `setSession(accessToken,
refreshToken)` — web hands off the Supabase session so native can call RPCs, stored via
EncryptedSharedPreferences · `getPendingActions()` / native→web events as needed. Offline: alarms
+ alarm UI + action recording work fully offline; the management UI needs network (accepted for
v1 — the existing service worker's offline splash covers that failure mode). A static-export or
RN rewrite stays a later option; nothing here forecloses it.

**Server pipeline stays — do not retire.** Web-only and Telegram-only users depend entirely on
the bot-tick + Vercel-failover pipeline (see WORK_LEDGER §1/§3). End state: server pipeline
unchanged for all users; Android users get device alarms **as well as** server push/Telegram —
duplicate notifications are an accepted v1 cost (`reminder_events` `UNIQUE(medication_id,
scheduled_for)` already keeps state consistent). Per-device suppression of server sends (an
`android_active` flag) is a later optimization, not v1. The server keeps owning the
`reminder_events` state machine and caregiver escalation; the device is a delivery channel +
offline action queue, nothing more — device actions reconcile via `resolve_reminder_event`.

**Scheduling math: fixture first, Kotlin second (hard rule).** The two "lockstep" JS copies of
`calculateNextReminder` (`src/utils.js` / `web/src/lib/medication-utils.ts`) have already drifted
(bot throws on empty `reminder_times`; web returns `new Date()`), and no DST regression test
exists. Before any Kotlin scheduling code: (1) create `schedule-test-vectors.json` —
`(reminder_times, timezone, dose_days, now) → expected UTC`, covering empty/invalid input,
once-weekly offset-7 rollover, multi-time days, DST spring-forward/fall-back (`America/New_York`,
`Europe/London` — `Asia/Kolkata` has no DST), midnight edges; (2) wire it into both the bot
(`node:test`) and web tests, resolving the empty-input drift (pick one behavior — the bot's
pre-filter + throw is the safer contract); (3) the Kotlin implementation must pass the same
fixture — port from the fixture + algorithm spec, not by transcribing JS from memory.

**Keystore decision (resolved).** Generate a **fresh** keystore for the Capacitor app; package
name `com.reminderhealth.app` may be reused. Back the new keystore + passwords up in ≥2 places
outside the repo (password manager + cloud drive) **before** the first Play Console upload.
`web/public/.well-known/assetlinks.json` (TWA-only artifact) and `android-twa/` (old keystore
included) were both **deleted 2026-08-10** — the TWA was never published, so neither carried any
obligation. Back up the *new* Capacitor app's keystore per the paragraph above once it exists.

**Pre-code checklist (before `npm i @capacitor/core`):**
- [x] Live schema check (done 2026-08-10 via PostgREST OpenAPI introspection, read-only):
      `medications.reminder_times` is **`jsonb`** (the baseline reconstruction's `TEXT[]` guess
      was wrong). `medications.dose_days` exists live. `reminder_events`/`reminder_logs` both
      have `drug_name_snapshot`, confirming `migration_preserve_dose_history.sql` applied — FK is
      `ON DELETE SET NULL`. See `db/migrations/APPLIED.md` entries #62–64.
- [x] Both "PENDING" migrations (`migration_dose_days_2026_08_10.sql`,
      `migration_anonymous_guests_2026_08_10.sql`) turned out to already be live — found during
      the same schema check; `APPLIED.md`'s PENDING section had simply never been updated. Ledger
      fixed (entries #63–64). Nothing left to apply. Still confirm the Supabase dashboard
      Anonymous-sign-ins + CAPTCHA toggle separately — that can't be checked from the DB side.
- [x] Fixed `web/src/components/turnstile.tsx` (2026-08-10): script `onerror` handler + 8s
      timeout → visible error + Retry instead of the silent dead-end. Verified live in-browser
      (happy path, forced-failure path, and recovery via Retry all confirmed).
- [x] Minimal CI added (`.github/workflows/ci.yml`, 2026-08-10): runs worker `npm test` and every
      `web/src/lib/**/*.test.ts` on push/PR.
- [x] `test/schedule-test-vectors.json` fixture built + wired into both `test/utils.test.js` and
      the new `web/src/lib/medication-utils.test.ts` (2026-08-10). Also fixed the confirmed
      empty-input drift: `medication-utils.ts` used to silently `return new Date()`, now throws
      like the bot — closed the gap safely by adding the same pre-filter guard `src/scheduler.js`
      already had to `web/src/app/api/cron/tick/route.ts`, the medication add form, and the edit
      form (the add-form's step validation had a real, reachable hole: it never required at least
      one reminder time — fixed in `web/src/lib/medications/form-logic.ts`). 39/39 bot tests and
      13/13 web fixture vectors pass.
- [ ] Back up the (new) keystore per above. **Still open — needs the maintainer** (password
      manager + cloud drive are outside what an agent should touch).

**Constraints carried over from v1 (still binding):**
- Permissions: `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM`, `USE_FULL_SCREEN_INTENT`,
  `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` — nothing else, no `SYSTEM_ALERT_WINDOW`.
  - **`VIBRATE` added 2026-08-11** (one beyond the original list, flagged rather than slipped in):
    the alarm activity vibrates in a loop alongside the sound, which is what wakes a sleeping
    user when the ringer is down. Normal permission — auto-granted at install, no prompt, no
    privacy surface. If this is unwanted, deleting `startVibration()` in `AlarmActivity` and the
    manifest line removes it cleanly; the notification channel's own vibration would remain.
  - **`WAKE_LOCK` is deliberately NOT declared — do not add it.** An earlier `AlarmActivity`
    acquired a `PARTIAL_WAKE_LOCK` and crashed on launch (`SecurityException: ...has
    android.permission.WAKE_LOCK`, 2026-08-11). The right fix was removing the lock, not adding
    the permission: `setTurnScreenOn` + `FLAG_KEEP_SCREEN_ON` already wake the display and hold
    it while the alarm is visible, and a lit screen keeps the CPU running — so the lock bought
    nothing. Holding none is also the strongest possible form of the "wake locks always
    released" rule below: there is nothing that *can* leak.
- No foreground service, no polling loops; wake locks always released (currently: none held at
  all — see above).
- OEM battery managers (Xiaomi/Oppo/Vivo/Realme) kill background alarms — onboarding must detect
  the OEM and walk the user through battery-optimization exemption + autostart; test on a real
  device from one of these brands before release.
- No secrets in anything shipped; anon key is fine. RLS is the only real defence — the M3 audit
  must specifically revisit the legacy `caregiver_info` dual-read branch that bypasses the
  `can_*` permission flags (see WORK_LEDGER §5 / risk list) before any Android caregiver feature
  ships. Encrypt native-stored data; disable webview debugging in release builds; minify.
- Still a reminder tool only — no feature may recommend, adjust, or interpret medication/dosage.
- Release paperwork: privacy policy URL, ToS, in-app + listing medical disclaimer, Sentry, Play
  closed test (~12 testers / 14 days), support email.

**Milestones (revised):**
- **M0 — Groundwork.** Full pre-code checklist above, plus the schedule-test-vector fixture wired
  into bot + web tests with the empty-input drift resolved.
- **M1 — Shell. ✅ DONE 2026-08-10.** Capacitor project in `android-app/` (fresh, not derived from
  the old TWA), `server.url` pointed at the deployed site, icon/splash, proof the remote page can
  call a trivial native plugin. **Verified on a real device (vivo I2202):** app built, installed,
  and launched; logcat showed the Ping bridge round-trip (`[Ping] native replied: pong: hello from
  webview`) multiple times; the live site loads in the webview with the full flow working end to
  end (Turnstile renders and executes, login, dashboard, guest login all work). Bonus finding:
  **Turnstile works fine inside the Capacitor webview** — the M0 checklist's "may need to drop it
  on the app build" concern is closed; keep the onerror/timeout fallback (2026-08-10) as insurance
  regardless.
- **M2 — Alarm core.** Kotlin module: local schedule store, `syncSchedule` bridge, exact alarms
  passing the shared fixture, full-screen alarm activity with Taken/Skip/Snooze, boot receiver,
  offline action queue calling `resolve_reminder_event` via the bridged session. Server pipeline
  untouched, running in parallel. Deliverable: phone in airplane mode, app force-closed, reboot —
  alarm still fires full-screen at the right local time; action syncs when back online.
  - Steps 1-3 ✅ **verified on the real device (vivo I2202, 2026-08-11)**: Room schedule store +
    `syncSchedule` (7 real medications), Kotlin `calculateNextReminder` passing all 16 shared
    fixture vectors, and exact alarms firing 21-25ms late — including **with the app process dead**
    (Android cold-started it purely to deliver the alarm), **in airplane mode**, and **on the lock
    screen**. Each firing re-registers the following dose, so the chain is self-sustaining with no
    polling. Steps 4-6 (full-screen activity, boot receiver, offline queue) still to come.
  - **Known gap found during step-3 testing:** tapping the notification while offline opens the
    remote webview to a blank white screen (`server.url` mode can't load the site without
    network). A local `offline.html` fallback now covers that; the deeper answer is step 4 — the
    full-screen alarm activity is pure native, so alarm *interaction* never depends on the network.
  - Step 4 (full-screen alarm) ✅ **verified on device 2026-08-11**: rendered with the dose's local
    time and the §4/S30 hierarchy; Taken dismissed cleanly and the loop re-registered the next dose.
  - **Unattended-alarm hardening ✅ verified on device 2026-08-11** (commit `e9ab3ac`). Prompted by
    an overnight 100%→0% battery drain that vivo's own battery stats later attributed to **Pillo**,
    the competitor app installed for the teardown — **not this app**. The audit was still worth
    doing and found a genuine bug: the 60s auto-timeout called `dismiss()`, which *cancels the
    notification*, so an alarm that rang while the patient slept **erased its own trace**. Now the
    timeout posts a quiet persistent "Missed: take X" on an IMPORTANCE_LOW channel and leaves the
    dose UNRESOLVED, so server-side escalation still owns missed doses. Verified: alarm rang exactly
    60000ms with no action, auto-dismissed, `ALARM SCREEN-ON RELEASED`, fallback posted, process
    ended cleanly. Bonus: `BootReceiver` fired on `MY_PACKAGE_REPLACED` and re-registered 13 alarms
    from the store — that is step 5's `rescheduleAll` path proven end to end.
  - **`clearSchedule()` on account change ✅ verified on device 2026-08-11.** Signed in as a guest,
    the native store had still held the previous account's 12 medications and rang for them —
    telling someone to take medication that isn't theirs. Verified: logout wiped the store and
    cancelled alarms on **both** exits (navbar + settings), a guest synced 0 meds and stayed silent,
    a tripwire dose passed in silence while logged out, re-login re-synced and re-registered, and
    unsynced actions were kept rather than deleted.
  - **Still open: test C** — a clean overnight battery reading with Pillo uninstalled and alarms
    scheduled (expect a single-digit drop). Not blocking; runs on the next overnight.
  - **Steps 5-6 ✅ VERIFIED on device 2026-08-11 — M2's alarm core is complete.**
    - Step 6: alarm fired for med 136, **Taken tapped on the notification alone** → queued in 26ms
      → synced 1.2s later, no screen opened, no `STRANDED` lines.
    - Step 5: a **real reboot** on the vivo produced
      `BootReceiver: android.intent.action.BOOT_COMPLETED — re-registering alarms from the local
      store` → `rescheduleAll: 19 medication(s)`. This was the one genuinely in doubt, since vivo's
      autostart restrictions target `BOOT_COMPLETED` specifically. **No autostart exemption was
      needed on this device** — do not assume that generalises to Xiaomi/Oppo/Realme; M3's OEM
      onboarding still stands.
    - Snooze: `synced SNOOZE for med 137 (Op) scheduled 2026-08-11T10:30:00Z` — the **original**
      dose instant while the re-fire sat at `10:40:13Z`, proving both the `scheduledFor` split and
      the 42702 fix. The action had failed twice before the migration landed and recovered by
      itself afterwards, which is the offline queue's entire promise demonstrated on real data.
  - **Known gap — a reboot cancels an in-flight snooze (device side only).** A snooze is a
    transient `AlarmManager` re-registration; it is NOT persisted in the Room store, and
    `BootReceiver`'s `rescheduleAll` recomputes purely from `reminder_times`. So rebooting between
    a snooze and its re-fire silently drops the device's re-prompt — observed 2026-08-11, where med
    137's post-boot alarm jumped straight to the next day. **Not urgent:** the server has the dose
    `SNOOZED` with `retry_reminder_at` set, so Telegram/push re-prompts and the escalation ladder
    still cover it — the device just goes quiet. Fixing it properly means persisting a pending
    snooze (dose instant + re-fire time) in the store and having `rescheduleAll` honour one that
    has not yet passed. Worth doing before release; not a blocker for M2.
  - **Two migrations applied 2026-08-11** (validations all DONE):
    `migration_snooze_reminder_event_2026_08_11.sql` and
    `migration_resolve_event_device_queue_2026_08_11.sql`. The second exists because the alarm is
    pure native and can never send `p_event_id`, so every device action was treated as a
    client-fabricated dose and hit two guards meant for the web —
    `VIRTUAL_EVENT_MUST_BE_FOR_TODAY` (killed anything syncing after the local day rolled over,
    i.e. exactly the offline-overnight case) and `INVALID_SCHEDULED_TIME` (killed anything syncing
    after `reminder_times` was edited). Both permanent, so the device retried 5× and dropped a
    patient's recorded "I took it". The guards are now gated on whether a `reminder_events` row
    exists rather than on whether the caller knew its id.
  - **Snooze bug found and fixed 2026-08-11.** `AlarmScheduler.scheduleAt` wrote `fireAt` into
    `EXTRA_SCHEDULED_FOR`. Identical for a normal dose, so invisible — but a snooze re-fires 10
    minutes out while still asking about the *original* dose, so the re-fired alarm carried its own
    re-fire time as the dose identity. Answering it queued a `scheduled_for` matching no
    `reminder_times` entry and no event row → permanent `INVALID_SCHEDULED_TIME` → answer dropped.
    `scheduleAt` now takes `scheduledFor` separately from `fireAt`. **Snooze still needs on-device
    re-verification.**

**Alarm presentation: two shapes, both correct (confirmed on device 2026-08-11 — do not "fix").**
Android decides how to present the dose alarm's full-screen intent:
- phone **locked or idle** → the full-screen `AlarmActivity` takes over the screen;
- phone **unlocked and in active use** → a **heads-up notification** instead (tapping it opens the
  full alarm screen).

That second case is Android deliberately not hijacking the screen of someone who is demonstrably
already using their phone. It is correct and desirable. **Never attempt to override it** — the ways
to do so are exactly the ones CLAUDE.md already forbids (`SYSTEM_ALERT_WINDOW`, a foreground
service). The design consequence is that **the notification must be fully answerable on its own**:
- **Taken / Skip / Snooze 10 min are action buttons on the notification itself**, handled by
  `DoseActionReceiver` (a BroadcastReceiver — no UI opens) and routed through the *same*
  `DoseActionQueue` as the full-screen buttons. Snooze does both halves: local re-registration
  **and** `snooze_reminder_event`. Nobody should have to open a takeover screen to answer a dose
  they are awake for.
- Both the live alarm and the "Missed: take X" fallback are **persistent** (`setOngoing(true)` +
  `setAutoCancel(false)`) and stay until the dose is actually resolved. The missed fallback carries
  the same three buttons — it has to, since a persistent notification with no way to answer it is
  just a stuck notification.
- **Android 14+ caveat:** a user can still *deliberately* dismiss an ongoing notification; the
  platform stopped treating `setOngoing` as absolute. Accepted, not fought — the missed-dose
  fallback and above all the **server-side escalation ladder** are the real backstop. A
  notification the OS lets someone dismiss was never the last line of defence.

**Alarm presentation: two shapes, both correct (confirmed on device 2026-08-11 — do not "fix").**
Android decides how to present the dose alarm's full-screen intent:
- phone **locked or idle** → the full-screen `AlarmActivity` takes over the screen;
- phone **unlocked and in active use** → a **heads-up notification** instead (tapping it opens the
  full alarm screen).

That second case is Android deliberately not hijacking the screen of someone who is demonstrably
already using their phone. It is correct and desirable. **Never attempt to override it** — the ways
to do so are exactly the ones CLAUDE.md already forbids (`SYSTEM_ALERT_WINDOW`, a foreground
service). The design consequence is that **the notification must be fully answerable on its own**:
- **Taken / Skip / Snooze 10 min are action buttons on the notification itself**, handled by
  `DoseActionReceiver` (a BroadcastReceiver — no UI opens) and routed through the *same*
  `DoseActionQueue` as the full-screen buttons. Snooze does both halves: local re-registration
  **and** `snooze_reminder_event`. Nobody should have to open a takeover screen to answer a dose
  they are awake for.
- Both the live alarm and the "Missed: take X" fallback are **persistent** (`setOngoing(true)` +
  `setAutoCancel(false)`) and stay until the dose is actually resolved. The missed fallback carries
  the same three buttons — it has to, since a persistent notification with no way to answer it is
  just a stuck notification.
- **Android 14+ caveat:** a user can still *deliberately* dismiss an ongoing notification; the
  platform stopped treating `setOngoing` as absolute. Accepted, not fought — the missed-dose
  fallback and above all the **server-side escalation ladder** are the real backstop. A
  notification the OS lets someone dismiss was never the last line of defence.
  - **Steps 5-6 built 2026-08-11, awaiting device verification.** `BootReceiver` (step 5's
    `rescheduleAll` already proven via `MY_PACKAGE_REPLACED`; a real reboot still to test — vivo
    autostart restrictions target `BOOT_COMPLETED` specifically, so that is the one that matters).
    Step 6: the offline action queue, `snooze_reminder_event`, notification action buttons, and the
    `resolve_reminder_event` fix that makes the queue actually survive (see below). **Two migrations
    are PENDING and must be applied before step 6 works end to end** —
    `migration_snooze_reminder_event_2026_08_11.sql` and
    `migration_resolve_event_device_queue_2026_08_11.sql`, then their validation files.
  - **Why the second migration exists (found while wiring step 6):** the alarm is pure native and
    fires with no server round-trip, so it can never send `p_event_id`. Every device action was
    therefore treated as a client-fabricated dose and hit two guards meant for the web —
    `VIRTUAL_EVENT_MUST_BE_FOR_TODAY` (killed anything syncing after the local day rolled over, i.e.
    exactly the offline-overnight case the queue exists for) and `INVALID_SCHEDULED_TIME` (killed
    anything syncing after `reminder_times` was edited). Both permanent, so the device retried 5×
    and dropped a patient's recorded "I took it". The guards are now gated on whether a
    `reminder_events` row exists rather than on whether the caller knew its id.
- **M3 — Hardening.** OEM battery onboarding, RLS audit (incl. legacy `caregiver_info` branch),
  Sentry (webview + native), encryption at rest, Turnstile verified or disabled for app origin,
  disclaimer/policy pages, closed test track.
  - **RLS audit ✅ DONE 2026-08-11** (`migration_caregiver_legacy_branch_gated_2026_08_11.sql`,
    APPLIED.md #67, all 7 validation checks DONE). **The flagged `caregiver_info` dual-read is
    closed.** Three caregiver SELECT policies (`medications`, `reminder_events`, `reminder_logs`)
    `UNION`ed a modern branch gated on a `can_*` flag with a legacy branch gated on nothing but
    ACCEPTED + is_active — and a `UNION` grants if *either* side matches, so any caregiver with an
    accepted legacy row read the patient's medications, doses and adherence history **regardless of
    that patient's permission toggles**. The toggles were decorative for those relationships.
    Audited first (`db/audits/audit_rls_caregiver_dual_read_2026_08_11.sql`): 3 legacy rows, 0
    without a modern counterpart, 0 currently over-granted — so removal cost nobody anything and
    closed the bypass permanently. Of those 3, only **one** is a live relationship; the other two
    are abandoned half-written invitations with a NULL `patient_telegram_id` that never granted
    anything. **`caregiver_info` is therefore far less load-bearing than the docs implied** —
    retiring it entirely is now a realistic future cleanup, not a rewrite.
    - Same audit also confirmed, and these are worth not re-deriving: **no policy grants the `anon`
      role** (which matters because the APK ships the anon key and can be unpacked — anon's reach
      *is* the app's worst case), no `public` table has RLS disabled, `FORCE RLS` is still on both
      PHI tables, and the six policy-less tables (`link_codes`, `phone_verifications`,
      `push_tracking_tokens`, `rate_limits`, `scheduler_heartbeat`, `scheduler_locks`) match
      WORK_LEDGER's documented service-role-only list exactly, with no extras.
    - **Still in M3 scope for the voice feature:** Storage-bucket RLS for family voice recordings
      (see Post-M2 §1). Unblocked now — "who counts as this patient's care circle" finally has one
      answer instead of two.
  - **Encryption at rest ✅ DONE 2026-08-11, verified on device.** `schedule.db` is SQLCipher-
    encrypted via Room's `openHelperFactory`, so entities and DAOs are untouched. Passphrase lives
    in its own EncryptedSharedPreferences file, **deliberately separate from `SessionStore`** —
    that one is wiped on sign-out, and wiping the DB key on sign-out would make the store
    unreadable rather than merely empty. Stored as a **hex string, not raw bytes**: SQLCipher
    derives a key from a passphrase, so the conversion (SQL string literal) and Room (byte array)
    must agree on what the passphrase *is*, or the store converts and then cannot be opened.
    - **In-place upgrade, not a wipe:** an existing plaintext store is read out through Room,
      written to a staged encrypted DB, then swapped; the plaintext file is deleted only after the
      copy is closed, so a process death mid-conversion leaves the original intact. Row-by-row
      rather than SQLCipher's `ATTACH` + `sqlcipher_export()` recipe — that ATTACH **silently did
      not take** on this device ("unknown database encrypted").
    - **`getInstance` never throws.** It runs inside the alarm and boot receivers, where an
      exception means no reminders at all. The native-library load is checked first and separately
      (a missing `.so` is an environment problem, not corruption, and must never reach the
      delete-and-resync path); a Keystore that cannot supply a key means running unencrypted with a
      loud log rather than encrypting under a key nobody wrote down.
    - **Landmine, paid for once:** the plaintext detector compared against `"SQLite format 3 "`
      with a trailing **space**; the real header ends in a **NUL**. The check never matched, so
      SQLCipher was pointed at a plaintext file and the recovery path deleted a live local store.
      Recovered from the server exactly as designed — but a data-deleting path was one wrong byte
      from being reachable by accident.
- **M4 — Widget.** Native Glance/RemoteViews widget showing next dose, reading the native
  schedule store. Update on data change or ≥15 min; never per-minute.
- **M5 (optional, later).** Per-device suppression of duplicate server sends; static export or
  RN migration only if the remote-webview model proves limiting.

## Post-M2 features (decided 2026-08-11 — do not start before M2 is done)

### 1. Family voice alarms — flagship differentiator, build immediately after M2
A care-circle member records a short voice message (**~30s hard cap**) and sets a photo from the
web app; the dose alarm then plays *that person's voice* and shows their face instead of a generic
tone. This is the feature the product is differentiated on, not a nice-to-have.

**UI placement (decided 2026-08-11 — settled, not open for re-litigation):**
- **Recording UI lives on the Care Circle page**: a per-patient "Voice & Photo reminder" card —
  record ≤30s, pick a photo, preview, re-record, delete. Care-circle members record *for* the
  patient; the patient can also record their own.
- **Phase 1 is ONE voice + photo per patient**, used for all of that patient's alarms.
- **Per-medication override** ("custom alarm for this medicine") lives in the medication edit
  form — **phase 2, not the first build.**
- **Settings holds listener-side controls only**, alongside the planned Alarm-style setting:
  Family voice vs Default tone · alarm volume · show/hide photo. Nothing is *recorded* from
  Settings; that would split one feature across two pages.

- **Files live in Supabase Storage**, uploaded from the web (care circle side).
- **The app downloads them to LOCAL device storage during `ScheduleSync`.** Non-negotiable:
  the alarm must work in airplane mode, so it **must never stream at fire time** — if the file
  isn't already on disk when the alarm fires, the alarm falls back rather than waiting on network.
- **The native alarm activity plays the local audio and shows the photo full-screen**, falling
  back to the default alarm tone + mascot art when either is absent or unreadable.
- **Storage RLS: only the patient's own care circle may upload for them.** Add this to the
  **M3 RLS audit scope** — and note it interacts with the already-flagged legacy `caregiver_info`
  dual-read branch that bypasses the `can_*` flags, since "who counts as this patient's care
  circle" is exactly the question that branch answers inconsistently today.
- Health-data sensitivity: a voice recording of a family member is personal data. Same
  on-device-encryption and private-bucket discipline as the vault.
- ✅ **Step 4 is already built to receive this** (2026-08-11): `AlarmActivity` accepts an optional
  local photo path and optional local audio path per medication, with verified-readable checks and
  clean fallbacks, and the Room store carries `alarmAudioPath`/`alarmPhotoPath`. So the voice
  feature plugs in by populating those two columns + adding the download step — **the alarm screen
  does not need rebuilding.**

### 2. Multi-language — phased, deliberately
- **Phase 1 is the voice feature itself.** A recorded message in the patient's own language from
  their own family solves the alarm-language problem *without any translation work*. This is why
  voice comes first.
- **Phase 2 translates only patient-facing surfaces** — the native alarm screen's buttons, elderly
  mode, onboarding — into **Hindi + Telugu** plus 1-2 more, via **next-intl**.
- **Full-app i18n only if demand shows.** Do not translate the caregiver console, settings, vault,
  or admin surfaces on spec; that is a large ongoing cost for an unproven need.
- Practical note for phase 2: the alarm screen's strings already live in
  `android-app/android/app/src/main/res/values/strings.xml`, so its translation is a `values-hi/`
  `values-te/` drop, independent of the web's next-intl work.

**Placement (decided 2026-08-11 — settled):**
- **Language picker lives in Settings** as a "Language" row, with **every language shown in its
  own script**: English / తెలుగు / हिन्दी. A language list written only in English is unusable by
  exactly the person who needs to change it.
- **Also asked ONCE at first-launch onboarding, before any other screen**, so the permission and
  setup screens themselves render in the chosen language — those are the screens where a
  misunderstanding costs the user their alarms.
- **CRITICAL — the choice must cross the bridge.** `AlarmActivity` is Kotlin, not web, so the
  native alarm's button labels cannot read a web-side locale. The selected language must sync into
  the native store the way the session does (add a `language` field to `syncSchedule` and document
  it in BRIDGE_CONTRACT.md when this is built), or the alarm screen silently stays English — and
  it is the one screen that must work **offline, at 3am, for the least technical user**. Android
  resource qualifiers (`values-hi/`) pick up the *device* locale, which is NOT necessarily the
  language chosen in-app; the bridged value is what makes the two agree.

## UI Redesign (planned — not started, do not begin without explicit go-ahead)
Recorded 2026-08-10. Design-inspired by **"Pillo: Pill Reminder & Alarm"** (Play Store,
pillo.care) — calm card-based UI, soft colors + one strong accent, a today-timeline of dose
cards, huge one-tap Take/Skip, visible pill counts, alarm-first identity. Build OUR identity
around the cartoon-brain mascot on top of that feeling — **inspired by, never a copy of**: no
similar name/icon, no near-identical screens. Pillo is a direct competitor in our Play Store
category, so this matters beyond taste — general UX patterns (card layouts, timelines, big tap
targets) aren't ownable, but specific screens/icons/copy/art must stay clearly our own.

**Reference:** [`docs/design/pillo-teardown.md`](docs/design/pillo-teardown.md) — a 32-screenshot
UI/UX teardown of Pillo, added 2026-08-10. Standing rules for using it:
- **§8 (Adopt / Adapt / Reject) is pre-approved** — those are already-made design decisions for
  this redesign, not options to re-litigate when design work starts.
- **§7 (Pillo's own defects) is a do-not-inherit list** — every ranked issue there (progress bar
  not advancing, no back button on the first question, `Done` overlapping the last settings row,
  etc.) is a mistake to design around from the start, not something to discover independently.
- **§1's color/typography tokens are approximations of THEIR design, for inspiration only.** We
  define our own palette and identity around our brain mascot — same discipline (one accent hue
  doing all the interactive work, calm cards, big one-tap actions), different look. Never clone
  their screens, name, icon, or colors — direct Play Store competitor, this matters beyond taste.
- **§4's S30 (full-screen alarm) breakdown is the reference blueprint for M2's native Kotlin
  full-screen alarm activity** — same hierarchy (primary action big and on top, honest decline
  grey below, deferral smallest), styled with our own tokens once the redesign defines them.
- **Known gaps in the teardown** (fill later, not blockers): Pillo's "Taken" confirmation screen,
  the snooze/reschedule picker, what the alarm does when ignored (re-fire timing), the Progress
  and Me tabs, and dark-mode values. The teardown's own §8 "Adapt" section already improves on
  the biggest gap (Pillo's flow ends at "Take now") with a 5-minute countdown + dose-form
  instruction spec — that's pre-approved too, per §8 above.

**Rules for when this starts:**
1. Web-side only. Because M1's Capacitor shell loads the deployed site (`server.url` mode), a
   web redesign *is* the app redesign — no separate native UI work needed for this. Do not touch
   the bot, scheduler, RPCs, or database.
2. Every existing feature keeps working: elderly mode, guest mode, guided tour, care circle,
   dose gate, health vault, settings.
3. Mobile-first stays the priority (renders inside the Android webview) — the current dashboard
   nav's rail/dock breakpoint-switch pattern is the kind of thing to preserve, not something this
   redesign is expected to replace wholesale.
4. Tailwind v4 stays, config-free, through the existing `@theme inline` setup in `globals.css` —
   redesign happens through tokens + components, not a new styling system.
5. The native full-screen alarm activity (M2) is out of scope here, but the color/typography
   tokens chosen in this redesign **will** define its look — document them somewhere the Kotlin
   side can reuse (not just as CSS vars). Practically: lock the token decisions before M2's
   alarm-UI visuals are built, even if the rest of the redesign ships later.
6. First deliverable when this starts is a **design proposal, not code**: palette, typography,
   a visual mock of the redesigned Today screen. No changes to any of the 27 pages until approved.

**Sequencing:** M1 (Capacitor shell) first, so every design deploy shows up instantly inside the
app once it starts. Redesign begins after M1 — see the token-lock caveat in rule 5 above re: M2.

**Carries over unchanged:** all existing Hard rules still bind during the redesign, especially
**exactly 5 nav icons** and **medication-catalog links stay human-select-only** — a calm
card-based visual direction doesn't relax either.

**Conflict check against the Android plan (v2) above: none found.** The remote-webview
architecture is what makes "web redesign = app redesign" true, rather than a coincidence to
reconcile. The only real interaction is the M2 token-reuse dependency captured in rule 5.

## Commands
- Worker tests: `npm test` (node:test). Web: no test script; `web/src/lib/schedule/*.test.ts` and `web/src/lib/medication-utils.test.ts` run via `node --experimental-strip-types`. CI (`.github/workflows/ci.yml`) runs both on every push.
- `test/schedule-test-vectors.json` is the shared `calculateNextReminder` fixture (bot + web + future Kotlin port) — add cases there, not ad hoc in either test file.
- Web dev server: `.claude/launch.json` → `web` (port 3001).
