# Feature Inventory

## Authentication
Status: Production

## Medication Management
Status: Production

## Reminder Events
Status: Production

## Care Circle
Status: Stabilization

Current Sprint:
5.7C RCA Fixes

Implemented Features:
- **Many-to-Many Relationships**: Uses `caregiver_connections` as the sole source of truth; legacy relationship columns in `caregiver_info` are deprecated.
- **Invitation Flow**: Patients invite caregivers via the `invite_caregiver` SECURITY DEFINER RPC instead of direct client-side table writes.
- **Name Resolution**: RLS on the `profiles` table allows resolving names for both `PENDING` and `ACCEPTED` relationships in `caregiver_connections`.
- **Trigger-Driven Notifications**: Notifications for Care Circle updates are generated automatically in the database via the `trg_audit_and_notify_caregiver_changes` trigger rather than from client-side code.

Known Issues:
- Care Circle requests and names resolution verification pending database migration.


## Health Vault
Status: Beta

## Telegram Bot
Status: Production

## Health Knowledge Navigator
Status: Planned

## Mobile Push Notifications
Status: Planned
