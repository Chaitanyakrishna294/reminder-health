# Re-MIND-eЯ — Known Issues

This document lists confirmed bugs, technical limitations, and security issues in the Re-MIND-eЯ application.

---

## 1. Active Issues (P0/P1)

### Care Circle Overwrite & Limit Bug
- **Status**: Under Remediation (Sprint 5.7B Corrective)
- **Problem**: Caregiver connection relationships are stored across both the legacy `caregiver_info` table and the new `caregiver_connections` table. Linking a second caregiver overwrites the patient's existing caregiver entry, restricting Care Circle connections.
- **Remediation**: Shift relationship tracking to `caregiver_connections` as the single source of truth.

### Request Notifications RLS Failure
- **Status**: Under Remediation (Sprint 5.7B Corrective)
- **Problem**: Patient browser tries to write notification rows directly to caregivers' inbox in the `notifications` table, which is blocked by Row-Level Security policies.
- **Remediation**: Transition notification creation to database-level security definer triggers.

### Timezone Mismatches on Virtual Events
- **Status**: Under Remediation (Sprint 5.7B Corrective)
- **Problem**: Client browser generates virtual events using the client's local browser timezone (e.g. UTC). This mismatch with the medication's database timezone (e.g. Asia/Kolkata) causes incorrect `scheduled_for` parameters, resulting in `INVALID_SCHEDULED_TIME` RPC failures.
- **Remediation**: Use `moment-timezone` to align client boundaries and scheduled times with the medication's timezone.

---

## 2. Technical Limitations & Sandbox Issues

### Direct Database TCP Traffic Blocked
- **Status**: ACTIVE LIMITATION
- **Details**: Direct PostgreSQL TCP traffic (ports 5432 and 6543) is blocked from within the agent's sandbox by firewall rules. Programmatic migrations using `pg` node client fail.
- **Workaround**: SQL migrations must be run manually by the developer in the Supabase SQL editor dashboard.
