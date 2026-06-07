# Re-MIND-eЯ — Engineering State (Post-Audit)

This document is the single source of truth for engineering work completed after the full project audit.
It is intended to be read by any engineer picking up the project without needing to re-read audit reports.

---

## 1. Security Remediation (DONE ✅)

### Problem
Three critical database vulnerabilities were confirmed and exploited in live security tests:

| # | Table | Vulnerability | Impact |
|---|-------|---------------|--------|
| 1 | `caregiver_info` | Permissive `Allow all...` RLS policies — any authenticated user could update any row | Relationship hijacking |
| 2 | `chat_messages` | No connection check before INSERT — unlinked users could send messages | Phishing / spam injection |
| 3 | `profiles` (SELECT) | Policy joined back to `profiles` inside `caregiver_info` subquery | Infinite recursion crash |

### Solution Applied
**File:** [`migration_security_fix_rls.sql`](./migration_security_fix_rls.sql)

- Introduced `public.get_my_telegram_chat_id()` — `SECURITY DEFINER` helper that safely reads the caller's Telegram ID without triggering RLS recursion.
- Introduced `public.are_profiles_connected(UUID, UUID)` — verifies an active `ACCEPTED` caregiver link exists before allowing chat.
- Dropped all permissive `"Allow all..."` / `"Allow ... for authenticated users"` policies on `caregiver_info`.
- Created least-privilege policies on `caregiver_info` (SELECT / INSERT / UPDATE) gated by the caller's chat ID.
- Created connection-verified policies on `chat_messages` (SELECT / INSERT).
- Both helpers: `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated`.

### Verification
**Diagnostic script:** `node scratch/diagnose_rls.js`  
**Security test suite:** `node scratch/test_security_fix.js`

Final test run result — all 6 assertions passed:
```
TEST 1: Attacker update BLOCKED by RLS ✅
TEST 2: Attacker message BLOCKED ✅
TEST 3.1: Caregiver accepted connection ✅
TEST 3.2: Caregiver message sent ✅
TEST 3.3: Patient retrieved 1 message ✅
```

Active policies in production (9 total, all least-privilege):
- `profiles` → `Allow users to read their own profile` (SELECT, authenticated)
- `profiles` → `Allow users to update their own profile` (UPDATE, authenticated)
- `caregiver_info` → `Allow select caregiver_info for linked users` (SELECT, authenticated)
- `caregiver_info` → `Allow insert caregiver_info for own linkages` (INSERT, authenticated)
- `caregiver_info` → `Allow update caregiver_info for own linkages` (UPDATE, authenticated)
- `chat_messages` → `Users can view chat messages if connection is accepted` (SELECT, authenticated)
- `chat_messages` → `Users can insert chat messages if connection is accepted` (INSERT, authenticated)
- `medications` → `Users can manage their own medications` (ALL, authenticated)
- `medications` → `Caregivers can view patient medications` (SELECT, authenticated)

---

## 2. Deployment 1 — Browser → RPC Architecture (READY TO APPLY)

### Problem
The browser was directly writing to `reminder_events` and `reminder_logs` via raw Supabase client calls.
This bypassed all business logic, allowed invalid state transitions, and violated the ownership model.

### Architecture Change

**Old:**
```
Browser → supabase.from('reminder_events').update(...)
Browser → supabase.from('reminder_logs').insert(...)
```

**New:**
```
Browser → supabase.rpc('resolve_reminder_event', {...})
         → validates ownership
         → validates caregiver authorization
         → validates scheduled time against medication.reminder_times
         → uses advisory lock to prevent double-resolution
         → writes reminder_events atomically
         → writes reminder_logs atomically
         → preserves existing trigger (notifications)
```

### Files Created / Modified

#### Step 1 — Trigger Fix
**File:** [`migration_fix_reminder_event_notifications.sql`](./migration_fix_reminder_event_notifications.sql)

- Rewrites `public.handle_reminder_event_state_change()` trigger function.
- Adds `is_status_transition` guard — only fires notifications on actual status changes, not no-op updates.
- Adds `resolved_by = 'CAREGIVER'` branch — sends correct notification text when caregiver resolves event.
- Uses `COALESCE` throughout to prevent null concatenation crashes.
- Wrapped in `BEGIN / COMMIT`.

#### Step 2 — RPC
**File:** [`migration_add_resolve_reminder_event_rpc.sql`](./migration_add_resolve_reminder_event_rpc.sql)

Creates `public.resolve_reminder_event(p_event_id, p_medication_id, p_scheduled_for, p_action, p_actor_role)`.

Validations performed (in order):
1. `auth.uid()` must be non-null → `AUTH_REQUIRED`
2. `p_actor_role` must be `PATIENT` or `CAREGIVER` → `INVALID_ACTOR_ROLE`
3. `p_action` must be `TAKEN` or `SKIP` → `INVALID_ACTION`
4. Profile must exist and have a `telegram_chat_id` → `PROFILE_NOT_LINKED`
5. Medication must exist and be `active = true` → `MEDICATION_NOT_FOUND`
6. `p_scheduled_for` time (in medication's timezone) must match a value in `medication.reminder_times` → `INVALID_SCHEDULED_TIME`
7. If PATIENT: `medication.telegram_id` must match caller's chat ID → `NOT_AUTHORIZED`
8. If CAREGIVER: an `ACCEPTED` caregiver_info row must link caller to patient → `NOT_AUTHORIZED`
9. If virtual event (no real event ID): must be today's date → `VIRTUAL_EVENT_MUST_BE_FOR_TODAY`
10. Advisory lock on `(medication_id, scheduled_for)` pair to prevent race conditions.
11. If event already in final state (`TAKEN`, `SKIPPED`, `RESOLVED_BY_CG`, `MISSED`) → returns `already_resolved: true` (no write).

Returns: `{ event_id, reminder_status, resolved_at, resolved_by, log_id, already_resolved }`.

`SECURITY DEFINER`, `SET search_path = public, auth`.  
`REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated`.

#### Step 3 — Lock Down Direct Writes (apply AFTER validation)
**File:** [`migration_remove_client_reminder_writes.sql`](./migration_remove_client_reminder_writes.sql)

- Drops all INSERT / UPDATE policies from `reminder_events`.
- Drops all INSERT policies from `reminder_logs`.
- Re-creates two read-only SELECT policies on `reminder_events` (patient owns / caregiver linked).
- This file must be applied **only after** Steps 1–3 are manually validated in production.

#### Web — Library Helper
**File:** [`web/src/lib/reminder-events.ts`](./web/src/lib/reminder-events.ts)

- Thin typed wrapper around `supabase.rpc('resolve_reminder_event', {...})`.
- Exports `resolveReminderEvent()` async function.
- Exports `ResolveReminderEventResult` interface.

#### Web — Component Updates
**File:** [`web/src/components/dashboard/todays-schedule.tsx`](./web/src/components/dashboard/todays-schedule.tsx)

- `handleResolve()` now calls `resolveReminderEvent()` (RPC) instead of `supabase.from('reminder_events').update()`.
- Handles `already_resolved: true` response with a user-facing toast.
- All event state is updated optimistically from the RPC return value.

**File:** [`web/src/components/dashboard/dashboard-client-view.tsx`](./web/src/components/dashboard/dashboard-client-view.tsx)

- Updated to pass `userRole` and `patientTelegramChatId` down to `TodaysSchedule`.

### Deployment Order

```
Step 1:  Apply migration_fix_reminder_event_notifications.sql   ← Supabase SQL Editor
Step 2:  Apply migration_add_resolve_reminder_event_rpc.sql     ← Supabase SQL Editor
Step 3:  Deploy web app (Vercel / npm run build)
Step 4:  Manual validation:
           - Patient resolves real event (TAKE / SKIP)
           - Patient resolves virtual event (no prior scheduler event row)
           - Caregiver resolves escalated patient event
Step 5:  Apply migration_remove_client_reminder_writes.sql      ← Supabase SQL Editor
```

> ⚠️ Do NOT apply Step 5 before Step 4 is fully validated. Step 5 permanently removes write access from the browser client.

---

## 3. Remaining Work (Not Started)

### Deployment 2 — `link_codes` Account Takeover Fix

**Risk:** A user who guesses or intercepts a 6-digit link code can link their web account to another user's Telegram ID.

**Plan:** Replace the client-side insert+delete on `link_codes` with a `verify_link_code()` RPC that:
- Validates the code is not expired
- Validates the code belongs to the session user's Telegram ID
- Atomically links `profiles.telegram_chat_id` and deletes the code
- Runs as `SECURITY DEFINER`

**Files to create:**
- `migration_add_verify_link_code_rpc.sql`
- Update `web/src/app/(dashboard)/link/page.tsx` or equivalent link-code verification screen

---

### Deployment 3 — Caregiver Acceptance Flow Fix

**Risk:** Caregiver relationships are created with `connection_status = 'ACCEPTED'` by default. There is no PENDING → ACCEPTED approval flow via the dashboard. A patient can connect any Telegram ID as their caregiver without that caregiver's consent.

**Plan:**
- New caregiver rows default to `connection_status = 'PENDING'`
- Caregiver dashboard shows pending requests with Accept / Decline
- Accept calls an `accept_caregiver_connection(caregiver_info_id)` RPC that:
  - Validates the caller's chat ID matches `caregiver_chat_id`
  - Sets `connection_status = 'ACCEPTED'`
- Decline deletes the row or sets `connection_status = 'DECLINED'`

**Files to create:**
- `migration_add_caregiver_acceptance_flow.sql`
- Update `web/src/components/dashboard/caregiver-console.tsx`

---

## 4. Do Not Touch

These files are stable and must not be modified:

| File | Reason |
|------|--------|
| `src/commands.js` | Telegram bot command handlers — not under review |
| `src/scheduler.js` | Reminder scheduler engine — not under review |
| `migration_security_fix_rls.sql` | Already applied and verified |
| `scratch/test_security_fix.js` | Canonical security regression test — do not alter assertions |
