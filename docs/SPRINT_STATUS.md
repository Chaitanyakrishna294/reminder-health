# Re-MIND-eЯ — Sprint Status

## Active Sprint: Sprint 5.7C RCA Fixes

**Objective**: Address production-critical P0/P1 issues related to Care Circle relationships, trigger-driven notifications, and browser-vs-medication timezone offsets.

---

### Completed
- **Care Circle RCA Completed**: Identified database RLS blocks on patient caregiver request creation and profiles SELECT permissions.
- **Notification Trigger Validation Completed**: Verified that connection notifications are trigger-driven and RLS-safe.
- **Care Circle Request Creation Root Cause Identified**: Direct client inserts failed due to RLS, causing missing PENDING requests.
- **invite_caregiver RPC Architecture Approved**: Created database security definer functions to safely insert connection requests.

---

### In Progress
- **RPC Deployment**: Implementing the `invite_caregiver` database migration script.
- **Profiles RLS Migration**: Migrating profiles SELECT policy to reference `caregiver_connections` instead of the legacy `caregiver_info`.
- **Request List Validation**: Updating Settings client view to invoke the RPC and test list populating logic.

---

### Pending Verification
- **Patient Sees Sent Requests**: Verify patient sees pending invitations under "Requests You've Sent" without "Unknown" names.
- **Caregiver Sees Received Requests**: Verify caregiver sees pending invitations under "Requests to Support You" without "Unknown" names.
- **Multiple Caregiver Validation**: Test linkage of multiple caregivers to a single patient.
- **Escalation Fan-Out Validation**: Verify alert broadcasting to all accepted caregivers.
