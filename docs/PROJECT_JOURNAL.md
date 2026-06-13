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
