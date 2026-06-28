# Re‑MIND‑eЯ — Project Reference (`reminder-health`)

A medication‑adherence and caregiver‑coordination platform. Patients track medications and get
reminders (browser push + Telegram); caregivers form a "Care Circle" to monitor adherence and
receive escalations; patients store medical documents in a private "Health Vault."

This single file documents the **what**, the **how**, the **tech stack**, the **database schema**,
the **features**, and the **layout** of the project. It reflects the live system on Supabase project
`jaflclnakwtikqbfhfdk` (`reminder-health-db`).

---

## 1. The three surfaces

| Surface | Tech | Where | Purpose |
|---|---|---|---|
| **Web app** | Next.js 16 (App Router, React 19) | `web/` | Primary UI: dashboard, medications, Care Circle, Health Vault, settings |
| **Telegram bot** | Node.js + `node-telegram-bot-api` | `src/` | Reminders & quick actions for Telegram users; caregiver panel |
| **Scheduler** | Node.js + `node-cron` (runs with the bot) | `src/scheduler.js` | Fires due reminders, escalations, daily summaries, browser push |
| **Database / auth / storage** | Supabase (Postgres 17, Auth, Storage, RLS) | cloud | Source of truth, business logic in RPCs/triggers, file storage |

All three talk to the **same Supabase Postgres**. Business rules live in the DB (RPCs + triggers +
RLS), so every surface enforces the same logic.

---

## 2. Tech stack

**Web (`web/package.json`)**
- **Next.js 16.2.7** (App Router, Server Components), **React 19.2**
- **Tailwind CSS v4** (`@tailwindcss/postcss`)
- **@supabase/ssr** + **@supabase/supabase-js** (auth + data, cookie‑based SSR sessions)
- **lucide-react** (icons), **recharts** (adherence charts), **moment-timezone**, **clsx** + **tailwind-merge**, **sharp** (image opt)
- TypeScript 5

**Bot / scheduler (`package.json`)**
- **node-telegram-bot-api** (Telegram), **node-cron** (scheduling), **web-push** (browser push / VAPID)
- **express** (webhook/health endpoint), **moment-timezone**, **dotenv**, **@supabase/supabase-js** (service-role key → bypasses RLS), **sharp**

**Platform**
- **Supabase**: Postgres 17, Auth (email/password), Storage (`health-vault` private bucket), `pg_cron`, RLS everywhere.
- **Vercel**: hosts the web app (project `reminder-health`). Bot/scheduler run on a separate Node host.

---

## 3. Repository layout

```
reminder-health/
├── PROJECT.md                ← this file
├── README.md
├── index.js                  ← bot entry (starts Telegram bot + express + scheduler)
├── src/                      ← Telegram bot + scheduler
│   ├── bot.js                ← bot instance / token
│   ├── commands.js           ← all command + callback handlers (reminders, caregiver panel, linking)
│   ├── scheduler.js          ← node-cron jobs: due reminders, escalation, snooze, daily summaries
│   ├── constants.js          ← STATES, FREQUENCIES, CALLBACK_ACTIONS, menus
│   ├── utils.js              ← time/format helpers
│   └── db.js                 ← Supabase client (service-role key)
├── web/                      ← Next.js app
│   └── src/
│       ├── app/
│       │   ├── (auth)/       ← login, register, forgot/update password
│       │   ├── (dashboard)/  ← dashboard, medications, care-circle, health-vault, settings, schedule-planner, admin-diagnostics
│       │   ├── link-account/ ← link Telegram ↔ web account
│       │   └── api/          ← route handlers (push, etc.)
│       ├── components/       ← dashboard cards, schedule, charts, layout, ui
│       ├── lib/              ← supabase clients, reminder-events, care-circle-service, push, medication-utils
│       └── context/          ← UI mode (elderly/normal), etc.
├── db/                       ← all SQL (source of truth for DB changes)
│   ├── migrations/           ← migration_*.sql (+ setup_db.sql)
│   ├── rollbacks/            ← rollback_*.sql
│   └── validations/          ← validation_*.sql
├── docs/                     ← ADRs, sprint status, RCA reports, handoff docs
└── scratch/                  ← local one-off scripts & verification (gitignored)
```

---

## 4. Features

### 4.1 Authentication & accounts
- Email/password via Supabase Auth. On signup, a DB trigger `handle_new_user` creates a `profiles`
  row (default `role = PATIENT`, `telegram_chat_id = 'WEB-<uuid>'`) and `handle_new_user_health_categories`
  seeds default Health Vault folders.
- A **profile self-heal** RPC `ensure_my_profile()` recreates a missing profile on login (so deleting
  a `profiles` row no longer strands the account).
- **Telegram linking**: `link_codes` table issues a short-lived code so a Telegram user can bind their
  chat id to a web profile (`/link-account`).

### 4.2 Medications
- CRUD under `(dashboard)/medications` (+ `new`, `[id]`). Fields: name, dosage, unit type
  (TABLET/CAPSULE/ML/DROP/…), frequency (once/twice/thrice daily), `reminder_times` (JSON array of
  `HH:MM`), `timezone` (default `Asia/Kolkata`), priority, stock/inventory + low-stock alerts.
- Stock auto-decrements on "taken" (`handle_reminder_event_taken_stock_reduction`); low-stock triggers alerts.

### 4.3 Reminder lifecycle (the core engine)
Statuses on `reminder_events.reminder_status`:
`SENT → DISPLAYED → OPENED → GENTLE_REMINDER → ESCALATED → CAREGIVER_ACKNOWLEDGED → (TAKEN | SKIPPED | SNOOZED | UNCONFIRMED | PENDING_REVIEW)`.

1. **Scheduler** (`src/scheduler.js`, every minute) finds due meds, creates a `reminder_events` row
   (`SENT`), sends Telegram message (skipped for `WEB-…` ids) and **browser push** (`web-push`).
2. The patient acts (Telegram buttons or web). Unanswered reminders escalate via
   `scan_and_escalate_overdue_reminders` → `GENTLE_REMINDER` → `ESCALATED` (caregivers notified).
3. `close_daily_medications` marks unresolved doses `UNCONFIRMED` at day-end → they appear in the
   web **"Help Us Complete Your Medication History"** review queue.
4. **`resolve_reminder_event(...)`** RPC is the single authorized way to mark a dose TAKEN/SKIP. It
   validates ownership (ReBAC), and for *virtual* (client-computed) doses checks the time matches
   `reminder_times`; for *real* persisted events it trusts the stored `scheduled_for`.
- The web dashboard generates **virtual "future" doses** client-side in each med's timezone
  (moment-timezone) so the schedule shows even before the scheduler fires; once a real event exists,
  the dose stays in "Next Medication" (with Take/Skip) until resolved.

### 4.4 Care Circle (caregiver ↔ patient, many-to-many)
- Source of truth: **`caregiver_connections`** (patient↔caregiver, `connection_status`
  PENDING/ACCEPTED/REJECTED/EXPIRED/WITHDRAWN, granular `can_view_*` / `can_edit_*` /
  `can_receive_escalations` permissions, `is_primary`). Compatibility read view:
  **`active_caregiver_links`** (`security_invoker=on`) which unions connections + legacy `caregiver_info`.
- **Caregiver identity**: a user "becomes a caregiver" by generating a **CG‑ID** (`caregiver_info`,
  e.g. `CG123456`) which they share with patients.
- **Flow** (all RLS/trigger-enforced):
  1. Patient enters caregiver's CG‑ID → `lookup_caregiver_by_code()` resolves the profile →
     **`invite_caregiver()`** creates a `PENDING` connection (SECURITY DEFINER; direct client INSERT
     is RLS-blocked).
  2. A trigger creates the in-app request **notification** for the caregiver (client can't write
     other users' notifications).
  3. Caregiver accepts/declines via **`respond_to_caregiver_request()`** (web) or the Telegram
     "Pending Requests" panel. The patient is notified on accept.
  4. **Primary caregiver** auto-assigned on first accept; on revoke, an AFTER trigger promotes a
     replacement (guarded by a transaction-local bypass so it doesn't trip validation).
- **Dual role**: a single user can be both patient and caregiver (`invite_caregiver` keys off CG‑ID,
  not the single `profiles.role`).
- Caregivers get web in-app notifications for all events; **Telegram** caregiver delivery is limited
  to **escalations** + the **nightly 9:30 PM summary** (both via `active_caregiver_links`).
- Consent changes are audited in `caregiver_connection_audit_logs`.

### 4.5 Health Vault (medical document storage)
- Private Supabase Storage bucket **`health-vault`**; metadata in `health_records`, organized by
  `health_categories` folders (Prescriptions, Lab Reports, Scans, Discharge Summaries by default).
- Upload wizard (category → file → details → save), 20 MB limit, allowed: pdf/jpg/jpeg/png/webp/doc/docx/txt/zip.
- **Preview** via short-lived signed URLs: images inline; **PDFs** render inline on desktop (`<object>`)
  and open in the device's **native viewer** on mobile via an "Open" action (iframe PDF preview is
  unreliable on mobile). Correct content-type is set on upload.
- Soft delete → Trash (30-day) → permanent purge; full audit logging; caregivers get read-only access
  when granted `can_view_vault`.

### 4.6 Notifications & realtime
- `notifications` table (in-app bell), types: TAKEN/SKIPPED/MISSED/ESCALATED/UNCONFIRMED + the
  CARE_CIRCLE_* events. RLS: a user sees only `user_id = auth.uid()`; all cross-user notifications are
  created by SECURITY DEFINER triggers.
- **Browser push**: `push_subscriptions` (per device, VAPID), with `push_logs` / `push_tracking_tokens`
  for delivery observability.
- The dashboard subscribes to `reminder_events` via Supabase Realtime and refreshes on change.

### 4.7 Other
- **Chat** (`chat_messages`) between connected profiles. **Audit logs** (`audit_logs`) for compliance.
- **Elderly Mode** UI toggle (giant fonts/buttons) across the app.
- **Light/Dark theme toggle** (navbar Sun/Moon; `.dark` class on `<html>`, localStorage-persisted).
- **Admin diagnostics** + **schedule planner** dashboard pages.

### 4.8 Voice calls + Care+ subscription (SCAFFOLDED, feature-flagged OFF)
- An automated **voice-call reminder** channel (India-first, **Exotel** IVR) + **Care+** subscription
  (**Razorpay**) to cover call costs. **All dormant behind `VOICE_CALLS_ENABLED`** + Razorpay/Exotel
  keys — zero impact on the live reminder pipeline until enabled. Full design in
  `docs/VOICE_CALLS_DESIGN.md`; activation steps in `docs/VOICE_LAUNCH_CHECKLIST.md`.
- **v1 MVP scope:** (1) patient daily confirmation call, (2) caregiver call only on an
  unconfirmed/missed critical dose (after the confirmation runs, to avoid false alarms).
- **Worker:** `src/voice-scheduler.js` — its OWN cron + OWN `voice_minute_tick` lock (isolated from
  the medication tick); `src/voice/exotel.js` — Exotel adapter (connect-to-flow).
- **Web routes:** `/api/voice/{twiml,response,status}` (IVR webhooks, 404 until flag on),
  `/api/voice/verify/{send,check}` (phone OTP), `/api/billing/{subscribe,webhook,start-trial}`.
  Call responses resolve through the same `resolve_reminder_event` RPC (one adherence ledger).
- **Care+ UI:** `components/billing/care-plus-card.tsx` (Free-vs-Care+ comparison + 7-day **free
  trial, no card**), gated via `lib/plan.ts`; voice setup lives in `components/settings/call-schedule.tsx`.
- **Blocked on external:** Exotel DLT + call flow, SMS-OTP provider, Razorpay keys, pricing validation.

---

## 5. Database schema (public)

> 16 tables, RLS enabled on all. Key ones:

**Identity & access**
- **`profiles`** — `id` (FK→`auth.users`), `role` (PATIENT|CAREGIVER), `full_name`,
  `telegram_chat_id` (unique; `WEB-…` for web-only), `phone_number`, `is_patient`, `is_caregiver`.
- **`caregiver_info`** — legacy/identity directory: `caregiver_id` (CG‑ID, unique), `caregiver_chat_id`
  (FK→`profiles.telegram_chat_id`), `caregiver_name`, `patient_telegram_id` (deprecated link),
  `connection_status`, `is_active`.
- **`caregiver_connections`** — **source of truth** for relationships: `patient_profile_id`,
  `caregiver_profile_id` (both FK→profiles), `connection_status`, `is_active`, `is_primary`,
  `relationship_type`, `can_view_medications/vault/reports`, `can_edit_medications`,
  `can_receive_escalations`, `expires_at`.
- **`caregiver_connection_audit_logs`** — consent history (`action_type`: GRANTED/MODIFIED/REVOKED/PRIMARY_PROMOTED).
- **`patient_escalation_state`** — per-patient escalation cooldown.
- **`link_codes`** — short-lived Telegram↔web binding codes.

**Medications & reminders**
- **`medications`** — `telegram_id` (owner), `drug_name`, `dosage`, `frequency`, `reminder_times`
  (jsonb), `timezone`, `unit_type`, `dosage_amount`, stock fields, `priority_level`, `next_reminder_at`.
- **`reminder_events`** — lifecycle rows (statuses above), `scheduled_for`, `resolved_by`
  (PATIENT|CAREGIVER_CONFIRMED|SYSTEM), `resolution_channel`, review fields.
- **`reminder_logs`** — historical responses (TAKEN/SKIP/MISSED) for adherence charts.

**Notifications & push**
- **`notifications`** (in-app bell, typed), **`push_subscriptions`** (devices),
  **`push_logs`** (SENT/DISPLAYED/OPENED/EXPIRED/FAILED), **`push_tracking_tokens`**.

**Health Vault**
- **`health_categories`** (folders), **`health_records`** (metadata + `file_url`/`storage_path`,
  `deleted_at` soft delete).

**Other**: **`chat_messages`**, **`audit_logs`**.

**Voice calls & billing (added for the voice feature — all RLS-enabled, mostly service-role-only):**
- **`voice_call_preferences`** — per-patient voice config: `phone_e164`, `phone_verified`, `enabled`,
  `mode`, per-window times (morning/afternoon/night), `nightly_confirm`, `consent_at`, `dnd_optout`.
- **`voice_calls`** — per-call state machine (`provider_call_sid`, `status`, `attempts`, `responses`,
  `billed_seconds`, `cost_inr`); idempotent per (telegram_id, call_type, window_key, scheduled_for).
- **`voice_call_usage`** — monthly metering for quota/billing.
- **`subscriptions`** — Care+ plan state (`plan`, `status` incl. `trialing`, `current_period_end`,
  `razorpay_*`).
- **`phone_verifications`** — short-lived hashed OTP codes (service-role only; RLS, no policies).

**Compatibility view**: `active_caregiver_links` (unions `caregiver_connections` + `caregiver_info`,
`security_invoker=on`).

---

## 6. RPCs (callable functions)

| RPC | Security | Purpose |
|---|---|---|
| `ensure_my_profile()` | definer | Recreate a missing profile for the logged-in user (self-heal) |
| `lookup_caregiver_by_code(p_cg_id)` | definer | Resolve a CG‑ID → caregiver profile (RLS-safe directory lookup) |
| `invite_caregiver(caregiver_id)` | definer | Patient creates/reactivates a PENDING care request |
| `respond_to_caregiver_request(p_connection_id, p_action)` | definer | Caregiver ACCEPT/REJECT, patient WITHDRAW |
| `resolve_reminder_event(p_event_id, p_medication_id, p_scheduled_for, p_action, …)` | definer | Mark a dose TAKEN/SKIP (ownership + time validation) |
| `scan_and_escalate_overdue_reminders()` | definer | Advance overdue reminders → gentle/escalated (called by scheduler) |
| `close_daily_medications()` | definer | Day-end: mark unresolved doses UNCONFIRMED |
| `expire_stale_connection_requests()` | definer | Expire stale PENDING requests (pg_cron daily 01:00) |
| `cleanup_expired_trash()` | definer | Purge Health Vault trash > 30 days |
| `are_profiles_connected(a,b)`, `get_my_telegram_chat_id()` | definer | RLS helper functions (recursion-safe) |

---

## 7. Triggers & automation

**Triggers (selected)**
- `handle_new_user` / `handle_new_user_health_categories` — seed profile + vault folders on signup.
- `handle_reminder_event_state_change` — on reminder state change, write `notifications` to the
  patient **and fan out to all accepted caregivers** (TAKEN/SKIPPED/ESCALATED/UNCONFIRMED).
- `handle_caregiver_connection_trust_events` — create request/grant/revoke/primary notifications +
  audit logs (RLS-safe).
- `validate_caregiver_connection_updates` — enforces allowed state transitions per role
  (honors an internal-bypass GUC for system updates).
- `auto_assign_primary_caregiver` (BEFORE) + `reassign_primary_after_revoke` (AFTER) — single active
  primary per patient.
- `validate_reminder_event_status_transition`, `handle_reminder_event_taken_stock_reduction`,
  `handle_medication_low_stock_trigger`, `cleanup_resolved_request_notifications`,
  `handle_health_records_storage_path`.

**Scheduled jobs**
- **pg_cron**: `expire_stale_connection_requests` daily 01:00 (+ trash cleanup).
- **node-cron** (in `src/scheduler.js`): every-minute due-reminder scan + escalation + snooze checks;
  nightly **9:30 PM Asia/Kolkata** caregiver summary.

---

## 8. Security model

- **RLS on every table.** Users read/write only their own rows (`auth.uid()` / `telegram_chat_id`).
- **SECURITY DEFINER RPCs** perform privileged cross-user writes (invites, accept, notifications) so
  the client never writes another user's data directly.
- **ReBAC permissions** on `caregiver_connections` (`can_view_*`/`can_edit_*`) gate caregiver access,
  surfaced through `active_caregiver_links`.
- The **Telegram bot uses the service-role key** (bypasses RLS) — it is a trusted backend and enforces
  ownership in code.
- Recursion-safe RLS via helper functions (`get_my_telegram_chat_id`, `are_profiles_connected`).
- **RLS is enabled on every table**, including `scheduler_locks` and `rate_limits` (closed an advisor
  finding — both are reached only via SECURITY DEFINER RPCs / the service role, so RLS-on with no
  policies blocks anon while legitimate callers keep working).

---

## 9. Deployment

- **Web** → Vercel project **`reminder-health`** (monorepo repo-link at the repo root, app
  `directory: web`). Deploy from the **repo root**: `npx vercel deploy --prod --yes`.
  ⚠️ Do **not** deploy from `web/` (its `.vercel` points to a different/wrong project `reminder-health-web`).
  No GitHub→Vercel auto-deploy; push to `main` for history, then deploy explicitly.
- **Bot/scheduler** → **Render** service `reminder-health` (`reminder-health.onrender.com`, runs
  `node index.js`; kept awake by an UptimeRobot ping). ⚠️ On Render **Free** it uses ~all 750
  monthly instance-hours, so it can **pause near month-end and auto-resume on the 1st**. Deferred ₹0
  fix (see `memory`/discussion): move the minute-tick to a Vercel function triggered by Supabase
  pg_cron / external cron — reuses the existing lock, no double-send.
- **Database** → Supabase project `jaflclnakwtikqbfhfdk`. Apply SQL from `db/migrations/` (live changes
  go through Supabase; keep the `.sql` files as source of truth).
- Secrets: web uses Supabase URL + anon/publishable key (+ server env); bot uses `SUPABASE_URL` +
  `SUPABASE_KEY` (service role), Telegram token, and VAPID keys for web-push, from the repo-root `.env`.

---

## 10. Notable design decisions (see `docs/ARCHITECTURE_DECISIONS.md` for full ADRs)

- ADR-001 RLS helper functions to avoid infinite recursion.
- ADR-002 ReBAC permission gating in `caregiver_connections`.
- ADR-003 Many-to-many caregiver relationships; `caregiver_info` deprecated to identity-only.
- ADR-004 Trigger-driven (not client-side) notifications.
- ADR-005 `invite_caregiver()` RPC for request creation; profiles RLS via `caregiver_connections`.
- ADR-006 `respond_to_caregiver_request()` RPC + dual-role support + state-machine hardening.
