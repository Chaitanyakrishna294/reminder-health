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
into Capacitor. A prior Bubblewrap **TWA** attempt (`android-twa/`, gitignored) was abandoned —
never published, no obligation to its keystore/fingerprint (see Keystore below) — a TWA can't
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
Delete `web/public/.well-known/assetlinks.json` (TWA-only artifact). `android-twa/` stays
gitignored; may be deleted once the fresh keystore is backed up.

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
- No foreground service, no polling loops; wake locks always released.
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
- **M3 — Hardening.** OEM battery onboarding, RLS audit (incl. legacy `caregiver_info` branch),
  Sentry (webview + native), encryption at rest, Turnstile verified or disabled for app origin,
  disclaimer/policy pages, closed test track.
- **M4 — Widget.** Native Glance/RemoteViews widget showing next dose, reading the native
  schedule store. Update on data change or ≥15 min; never per-minute.
- **M5 (optional, later).** Per-device suppression of duplicate server sends; static export or
  RN migration only if the remote-webview model proves limiting.

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
