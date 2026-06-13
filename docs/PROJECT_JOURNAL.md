# Re-MIND-eЯ — Project Journal

This file logs chronological updates, fixes, and sprint reviews.

---

## 2026-06-13: Sprint 5.7B Corrective Sprint Kickoff & RCA Review

### Summary of Activities
- Completed root-cause analysis for four production-critical P0/P1 issues:
  1. Cannot add a second caregiver (legacy 1-to-1 assumptions overwriting database fields).
  2. Request notifications failing due to RLS blocking client-side inserts.
  3. Accept-All connection glitch due to broad update filters in dashboard queries.
  4. Medication history showing `INVALID_SCHEDULE_TIME` due to timezone offset discrepancies.
- Formulated RCA report and proposed implementation plan (approved by user).
- Created trigger migration script `migration_carecircle_rca_fixes.sql`.
- Discovered network limits preventing direct SQL migrations via PG TCP client from within sandbox environment. Set manual user execution as the deployment plan.
- Updated `resolveUserData` in `cached-queries.ts` to be cookie-aware. Setting `view-mode` and `monitored-patient-id` cookies allows dynamic switching of dashboard space to the active monitored patient.

---

## 2026-06-13: Care Circle Request Creation RLS Fix & Profile SELECT RLS Update

### Root Cause Investigation & RLS Failure
- **RLS Failure on Insert**: Found that patient clients trying to add a caregiver were sending direct client-side `INSERT` statements to the `caregiver_connections` table. The active RLS policies only permitted caregiver-side inserts, causing patient invitations to silently fail with no rows created (leading to the empty "Requests You've Sent" list).
- **Profile Visibility Issue**: The SELECT policy for `profiles` joined against the deprecated `caregiver_info` table. Consequently, even if pending requests had existed, profile name resolution would fail and show users as "Unknown" in the request lists since the pending relationship details were not present in `caregiver_info`.

### Architectural Redesign & Security Implications
- **RPC Design Decision**: Shifted creation of caregiver connection requests to a database-level function `invite_caregiver(caregiver_id UUID)` running with `SECURITY DEFINER` privileges.
  - *Security implications*: This isolates insert permissions, preventing authenticated users from manipulating the table directly, while validating caregiver existence, preventing self-invitations, deduplicating records, and reactivating prior connections safely.
- **Profile RLS Redesign**: Rewrote the SELECT policy on `profiles` to join against `caregiver_connections`. It grants visibility for both `PENDING` and `ACCEPTED` relationships when `is_active = true`.

### Files Modified & Migrations Added
- **Frontend Changes**:
  - Modified [settings-client-view.tsx](file:///c:/Users/chait/OneDrive/Documents/GitHub/reminder-health/web/src/app/(dashboard)/settings/settings-client-view.tsx) to call the `invite_caregiver` RPC instead of direct client-side inserts.
- **Database Migrations**:
  - Added [migration_carecircle_rpc_and_profiles_rls.sql](file:///c:/Users/chait/OneDrive/Documents/GitHub/reminder-health/db/migrations/migration_carecircle_rpc_and_profiles_rls.sql).
- **Validation Script**:
  - Created [test_carecircle_rpc_flow.js](file:///c:/Users/chait/OneDrive/Documents/GitHub/reminder-health/scratch/test_carecircle_rpc_flow.js).

### Expected Validation & Next Actions
1. **Apply Migration**: Execute the SQL from `migration_carecircle_rpc_and_profiles_rls.sql` in the Supabase SQL editor (required due to sandbox TCP blocks).
2. **Execute Validation Script**: Run `node scratch/test_carecircle_rpc_flow.js` to verify:
   - Patient can call `invite_caregiver` successfully.
   - Connection row is created with state `PENDING`.
   - Patient can query caregiver profile (verifying updated RLS).
   - Caregiver can query patient profile (verifying updated RLS).
3. **Verify Settings Page**: Open settings panel on staging/development and verify name resolution for sent/received requests.

