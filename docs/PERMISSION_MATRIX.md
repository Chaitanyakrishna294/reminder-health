# Relationship Permission Matrix

This document acts as the authoritative reference for access control and permissions (ReBAC) enforced within the Re-MIND-eЯ platform.

---

## Role Definitions & Capabilities

### Patient
**Can:**
- View Medications
- Edit Medications
- Share Vault
- View Adherence Logs & Charts
- Promote or Demote Caregivers
- Revoke Caregiver Access

### Caregiver
**Can:**
- View Shared Data (when `can_view_medications` or `can_view_reports` is enabled)
- Receive Escalations (when `can_receive_escalations` is enabled)
- Acknowledge alerts / confirm doses (via `resolve_reminder_event` RPC)
- Access Shared Health Vault files (when `can_view_vault` is enabled)

**Cannot:**
- Delete Patient Data
- Access Unshared Vault Files
- Edit Medications (unless `can_edit_medications` is explicitly granted)
- Modify other caregiver connection statuses or settings

### Family Member
*Note: In the Re-MIND-eЯ permission model, family members are linked as **Caregivers** with granular connection flags configured based on trust level.*

**Can:**
- View Adherence Logs & Charts
- Receive Escalations for missed doses
- View Shared Health Vault documents (e.g. prescriptions)

**Cannot:**
- Modify medication dosage or scheduling (unless explicitly promoted to a coordinator with write permissions)
- View sensitive vault files that are not shared
- Delete patient profiles or records

---

## Access Control Matrix

| Capability / Action | Patient (Self) | Caregiver (Active / Accepted) | Caregiver (Pending) | Unlinked User |
|---|---|---|---|---|
| **View own profile / info** | Allow | N/A | N/A | N/A |
| **View connected user profiles** | Allow | Allow (if active connection exists) | Allow (if active connection exists) | Deny |
| **View patient medications** | Allow | Allow (if `can_view_medications` is True) | Deny | Deny |
| **Edit patient medications** | Allow | Allow (if `can_edit_medications` is True) | Deny | Deny |
| **View patient reports / compliance** | Allow | Allow (if `can_view_reports` is True) | Deny | Deny |
| **Access Health Vault documents** | Allow | Allow (if `can_view_vault` is True) | Deny | Deny |
| **Acknowledge alerts / confirm doses** | Allow | Allow (via `resolve_reminder_event` RPC if accepted) | Deny | Deny |
| **Receive escalation notifications** | N/A | Allow (if `can_receive_escalations` is True) | Deny | Deny |
| **Promote primary coordinator** | Allow | Deny (managed by database validation rules) | Deny | Deny |
| **Revoke caregiver access** | Allow | Deny | Deny | Deny |
| **Create caregiver invitations** | Allow (via `invite_caregiver` RPC) | Deny | Deny | Deny |

---

## Technical Access Gating

1. **Row-Level Security (RLS)**:
   - **`profiles` table**: SELECT is restricted. Authenticated users can view their own profile, or the profile of any user with whom they have an active connection (both `PENDING` and `ACCEPTED` connection status) in `caregiver_connections`.
   - **Data tables** (`medications`, `reminder_events`, `reminder_logs`, `push_subscriptions`, etc.): Gate reads using the security definer function `are_profiles_connected(auth.uid(), patient_profile_id)`.
2. **`invite_caregiver` RPC**:
   - The database function is executing in `SECURITY DEFINER` mode. Authenticated patients call this RPC to request connections, bypassing patient-side client write blocks on `caregiver_connections`.
3. **`resolve_reminder_event` RPC**:
   - The database function validates that the caller has an active connection with `connection_status = 'ACCEPTED'` and `is_active = true` before writing confirmation states.
4. **Database Validation Triggers**:
   - Updates to `is_primary` are restricted; only the patient (owner) can change the primary caregiver.

