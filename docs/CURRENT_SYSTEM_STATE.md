# Re-MIND-eЯ — Current System State

This document outlines the current features, database schema, APIs, permission model, and active development state of the Re-MIND-eЯ medication management and adherence platform.

---

## 1. Active Features

### Medication Management & Reminders
- Patients can configure medications with dosage, frequency, specific reminder times, priority level (`normal` vs. `critical`), unit type, and reasons.
- Automated system generates reminders on Telegram and web UI.
- Medication stock tracking: Low-stock warning is triggered when medication counts drop below a 3-day supply.

### Routine Scheduler & History
- Real database events are scheduled for active reminders.
- Dynamic client-side virtual events are generated for future daily slots or missed/unconfirmed doses not yet logged.
- Adherence logging: Tracks doses as `TAKEN`, `SKIP`, or `MISSED`.

### Care Circle (Many-to-Many caregiver relationship)
- Patients can invite multiple caregivers by entering their unique `Caregiver ID`.
- Caregivers can accept connection requests to monitor patient dashboards.
- Caregivers can be promoted to `Primary Coordinator` or have customized permissions (`can_view_medications`, `can_view_vault`, `can_view_reports`, `can_edit_medications`, `can_receive_escalations`).
- **Care Circle Request Lists**:
  - **Requests You've Sent**: Patients query the `caregiver_connections` table where `patient_profile_id = auth.uid()` to fetch invitations with status `PENDING` or `WITHDRAWN`.
  - **Requests To Support You**: Caregivers query the `caregiver_connections` table where `caregiver_profile_id = auth.uid()` to fetch invitations with status `PENDING`.


### Real-Time Notification & Alert System
- In-app notification bell updates instantly via realtime subscriptions.
- Reminders escalate to caregivers (`ESCALATED_TO_CG`) if patient fails to confirm taking a medication within a set window.
- Multi-caregiver escalation fan-out: When a medication escalates, all linked caregivers with `can_receive_escalations` enabled are notified.

---

## 2. Deployed Infrastructure

- **Frontend/Backend Web App**: Next.js (hosted on Vercel), React 19, TypeScript.
- **Database & Authentication**: Supabase (PostgreSQL), GoTrue Auth, Realtime engine.
- **Worker & Scheduler**: Node.js background worker executing routine scans for missed and overdue medications.
- **Telegram Bot**: Node.js server with Telegram Bot API integration.

---

## 3. Database Schema (Active Tables)

- `public.profiles`: Core user profile data. Columns: `id` (UUID), `full_name`, `telegram_chat_id` (Text), `role` (`PATIENT` or `CAREGIVER`), `phone_number`.
- `public.medications`: Prescription definitions. Columns: `id` (BigInt), `telegram_id` (Text), `drug_name`, `dosage`, `frequency`, `tablet_count`, `low_stock_alert_enabled`, `reminder_times` (Text[]), `priority_level`, `active` (Boolean), `timezone` (Text).
- `public.reminder_events`: Scheduled reminder rows. Columns: `id` (BigInt), `medication_id`, `telegram_id`, `scheduled_for` (Timestamp), `reminder_status` (`PENDING_PATIENT`, `TAKEN`, `SKIPPED`, `ESCALATED_TO_CG`, `UNCONFIRMED`), `snooze_count`.
- `public.reminder_logs`: Completed dose records. Columns: `id`, `telegram_id`, `medication_id`, `scheduled_time`, `response` (`TAKEN`, `SKIP`, `MISSED`).
- `public.notifications`: Alerts and requests. Columns: `id`, `user_id` (UUID), `title`, `message`, `type` (`CARE_CIRCLE_ACCESS_REQUEST`, `CARE_CIRCLE_ACCESS_GRANTED`, `CARE_CIRCLE_ACCESS_REVOKED`, `TAKEN`, `SKIPPED`, `ESCALATED`, `UNCONFIRMED`), `connection_id` (UUID), `created_at`.
- `public.caregiver_connections`: Many-to-many relationship linkages. Columns: `id` (UUID), `patient_profile_id`, `caregiver_profile_id`, `connection_status` (`PENDING`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `WITHDRAWN`), `is_active`, `relationship_type`, `is_primary`, `can_view_medications`, `can_view_vault`, `can_view_reports`, `can_edit_medications`, `can_receive_escalations`, `expires_at`.
- `public.caregiver_info`: Legacy registry for Caregiver ID exchanges. Columns: `id`, `caregiver_id` (`CG` + 6 digits), `caregiver_chat_id`, `caregiver_name`. **Note**: All relationship tracking columns (`patient_telegram_id`, `connection_status`, `is_active`) are fully deprecated and must not be used for new relationship logic; `caregiver_connections` is the sole source of truth.
- `public.caregiver_connection_audit_logs`: Audit logs tracking changes to caregiver connections.

---

## 4. APIs & RPC Functions

### Web/REST API
- Client app communicates using Supabase client libraries over HTTPS.
- Realtime websocket connections listen to inserts/updates on `reminder_events` and `notifications`.

### RPC Database Functions
- `invite_caregiver(caregiver_id)`: SECURITY DEFINER RPC that allows authenticated patients to request/invite caregivers securely. Handles insert validation, self-invite checks, duplication checks, and request reactivation.
- `resolve_reminder_event(p_event_id, p_medication_id, p_scheduled_for, p_action, p_actor_role)`: Atomically updates a reminder event's status, creates a reminder log, manages stock counts, and handles permissions and advisory locks.
- `get_my_telegram_chat_id()`: Resolves current user's `telegram_chat_id` securely for RLS checks without infinite recursion.
- `are_profiles_connected(profile_a_id, profile_b_id)`: Checks if there is an accepted connection between two profiles.

---

## 5. Security & Permission Model (RLS)

Row-Level Security (RLS) is active on all tables. Core rules:
- **Patients**: Can manage (ALL) their own profile, medications, reminder events, logs, and notifications. Can request caregiver links securely via the `invite_caregiver` RPC.
- **Care Circle Request Creation**: Bypasses direct client-side table writes (which are RLS restricted) by using the `invite_caregiver` SECURITY DEFINER RPC.
- **Profile SELECT Visibility**: The `profiles` table SELECT policy allows authenticated users to read profiles of users they are connected with in `caregiver_connections` (both `PENDING` and `ACCEPTED`), avoiding legacy `caregiver_info` checks.
- **Caregivers**:
  - Can view (`SELECT`) patient profiles, medications, events, logs, and vaults **only** if they have an active `ACCEPTED` connection in `caregiver_connections` and specific permission flags enabled.
  - Cannot directly write (`INSERT`/`UPDATE`) to patient reminder events or logs except via the `resolve_reminder_event` RPC.
  - Database triggers execute notifications as `SECURITY DEFINER` to bypass RLS restrictions safely when writing notifications from patients to caregivers.

---

## 6. Notification Architecture & Types

### Notification Pipeline
- **Medication Notifications**: Operational. Reminder events state change triggers handle notification record generation.
- **Care Circle Request Notifications**: Automatically generated via a database trigger flow on the `caregiver_connections` table to avoid RLS blockages on direct client writes:
  ```
  caregiver_connections (INSERT/UPDATE)
  ↓
  trg_audit_and_notify_caregiver_changes
  ↓
  handle_caregiver_connection_trust_events() (SECURITY DEFINER)
  ↓
  notifications table
  ```
- *No client-side notification creation*: Client browsers do not directly write notification rows to the database.

### Notification Types
- **Dose Updates**: `TAKEN` (patient/caregiver), `SKIPPED` (patient/caregiver), `ESCALATED` (critical reminder alert), `UNCONFIRMED` (missed dose).
- **Access Requests**: `CARE_CIRCLE_ACCESS_REQUEST` (connection request), `CARE_CIRCLE_ACCESS_GRANTED` (request accepted), `CARE_CIRCLE_ACCESS_REVOKED` (disconnected), `CARE_CIRCLE_ACCESS_UPDATED` (permissions edited), `CARE_CIRCLE_PRIMARY_CHANGED` (promoted to primary).

---

## 7. Telegram Bot Commands

- `/start`: Welcomes user and initializes onboarding.
- `/link [6-digit-code]`: Securely links user's Telegram chat ID to their web account.
- `/status`: Checks today's medication routine and compliance.
- `/unlink`: Disconnects caregivers from the patient.
- `/caregivers`: Lists all caregivers connected to the user.

---

## 8. Active Sprint

### Sprint 5.7B Corrective (In Progress)
- **Goal**: Resolve production-critical bugs in Care Circle many-to-many relationship structures, trigger-driven notifications, settings panel controls, and browser-vs-medication timezone offsets.

---

## 9. Technical Debt

1. **Legacy caregiver_info Columns**: The `patient_telegram_id` and `connection_status` columns in `caregiver_info` are legacy and are being phased out in favor of `caregiver_connections`. They are kept only for backward compatibility with the legacy bot/scheduler code.
2. **Bot Role Queries**: Some bot command handlers still query `caregiver_info` directly. These should be refactored to read from the compatibility view `active_caregiver_links`.
3. **Role Checks**: The system is migrating from a profile role check (`profiles.role`) to permissions stored directly in `caregiver_connections` for granular ReBAC.
