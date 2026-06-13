# Re-MIND-eЯ — Sprint Status

## Active Sprint: Sprint 5.7B Corrective

**Objective**: Address production-critical P0/P1 issues related to Care Circle relationships, trigger-driven notifications, and browser-vs-medication timezone offsets.

---

### Sprint Goals & Checklist

- [ ] **1. Database Triggers Migration**
  - [ ] Apply trigger updates on `caregiver_connections` to handle trigger-driven request notifications.
  - [ ] Update trigger `handle_reminder_event_state_change` to loop and fan out status notifications to all accepted caregivers.

- [ ] **2. Web Settings Panel Multi-Caregiver Refactor**
  - [ ] Modify `page.tsx` loader to query all patients from `active_caregiver_links`.
  - [ ] Modify `settings-client-view.tsx` to state-manage multiple patients under "People I Care For" card.
  - [ ] Fix accept/unlink controls to update by specific connection `id` (fixing Accept-All and Unlink-All bugs).
  - [ ] Remove legacy `caregiver_info.patient_telegram_id` overwrites.
  - [ ] Remove client-side inserts to the `notifications` table.

- [ ] **3. Web Dashboard Timezone Alignment**
  - [ ] Select `timezone` in `medications` from server-side dashboard loader.
  - [ ] Update `dashboard-client-view.tsx` to generate virtual event `scheduled_for` ISO times in the medication's timezone.
  - [ ] Parse database events `scheduled_for` in the medication's timezone to avoid visual duplicates.

- [ ] **4. Telegram Bot Many-to-Many Compatibility**
  - [ ] Refactor `/link` handler in bot `commands.js` to write relationships to `caregiver_connections` instead of updating `caregiver_info`.
  - [ ] Update `handleCaregiverPanel` and `CG_MY_ID` callbacks to count/fetch patients from `active_caregiver_links`.

- [ ] **5. Verification & Testing**
  - [ ] Write `scratch/verify_rca_fixes.js` verification script.
  - [ ] Run test for linking multiple caregivers.
  - [ ] Run test for trigger-driven notifications.
  - [ ] Run test for caregiver revocation.
  - [ ] Run test for timezone scheduled time resolution.
  - [ ] Perform manual testing for UTC, US/Pacific, and Asia/Kolkata browser timezones.
