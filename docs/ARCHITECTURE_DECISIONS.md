# Re-MIND-eЯ — Architecture Decision Records (ADR)

This file documents the architectural decisions made during the evolution of the Re-MIND-eЯ platform.

---

## ADR-001: RLS Security Helpers for Infinite Recursion Avoidance
- **Date**: 2026-06-11
- **Status**: APPROVED
- **Decision**: Introduce database-level security definer helper functions (`get_my_telegram_chat_id()` and `are_profiles_connected()`) to bypass infinite recursion when joining tables inside RLS policies.
- **Reason**: The standard policies joined back to the same table, causing PostgreSQL to hit the stack depth limit and crash. Running security definer helpers with explicit `SET search_path = public` executes queries outside the standard RLS check stack, preventing recursive loops.
- **Impact**: All RLS policies are now extremely fast, recursive-free, and safe.

---

## ADR-002: ReBAC Permission Gating in Caregiver connections
- **Date**: 2026-06-12
- **Status**: APPROVED
- **Decision**: Transition the authorization model from checking profile roles (`profiles.role`) to checking granular permissions stored directly in `caregiver_connections` (`can_view_medications`, `can_view_vault`, etc.).
- **Reason**: Gating permissions strictly by role prevented granular sharing controls (e.g. allowing a caregiver to view medications but not the vault). granual columns in the connection record allow patients to customize caregiver access.
- **Impact**: Database view `active_caregiver_links` serves as the compatibility layer. Web and scheduler query this view to enforce access control.

---

## ADR-003: Many-to-Many Caregiver Connection Relationships
- **Date**: 2026-06-13
- **Status**: APPROVED
- **Decision**: Deprecate the legacy `patient_telegram_id` column in `caregiver_info` for tracking caregiver-patient links. Use `caregiver_connections` as the single source of truth for all relationships, enabling true many-to-many linkages.
- **Reason**: The legacy model assumed a caregiver could only support one patient and a patient could only have one caregiver. Overwrites occurred whenever a new caregiver linked to a patient, breaking notifications and dashboards.
- **Impact**: Dashboard and Telegram bot now query `active_caregiver_links` view (which aggregates connections) to resolve linkages.

---

## ADR-004: Trigger-Driven Access Request Notifications
- **Date**: 2026-06-13
- **Status**: APPROVED
- **Decision**: Shift the creation of caregiver connection request notifications from the client browser to database-level security definer triggers on the `caregiver_connections` table.
- **Reason**: Client-side inserts to the `notifications` table for other users (i.e. patient inserting a notification for caregiver) violate RLS boundaries and are blocked. Shifts notification creation to triggers executing in security definer context.
- **Impact**: No manual writes to `notifications` on client side. Trigger automatically handles notifications on `INSERT` or `UPDATE` trust events.

---

## ADR-005: Care Circle Request Creation RPC
- **Date**: 2026-06-13
- **Status**: APPROVED
- **Decision**: Patient caregiver invitations must be created through SECURITY DEFINER RPC `invite_caregiver()` rather than direct client inserts on the `caregiver_connections` table.
- **Reason**: RLS restrictions on `caregiver_connections` prevented direct client-side inserts by patients (only caregivers were authorized to insert connection requests directly). Moving request creation into a secure database RPC bypasses direct client-side write restrictions while enforcing business validations.
- **Impact**: All future caregiver invitation creation and reactivation flows must call `invite_caregiver()`. Direct client-side `INSERT`/`UPDATE` calls are deprecated.

---

## ADR-006: Caregiver Request Response RPC, Dual-Role Support, and State-Machine Hardening
- **Date**: 2026-06-13
- **Status**: APPROVED
- **Decision**:
  1. Acceptance/decline of a Care Circle request goes through a SECURITY DEFINER RPC `respond_to_caregiver_request(p_connection_id, p_action)` (`ACCEPT`/`REJECT` by the caregiver, `WITHDRAW` by the patient). `validate_caregiver_connection_updates` was relaxed to permit the caregiver transition `PENDING→ACCEPTED` (and `PENDING→REJECTED`).
  2. A profile may act as **both** patient and caregiver: `invite_caregiver()` no longer gates on `profiles.role = 'CAREGIVER'`; "is a caregiver" means the target has an active CG-ID in `caregiver_info`. `profiles.role` is now a default hint, not an exclusivity constraint.
  3. The accept notification is addressed to the **patient** (their caregiver accepted), and "access revoked" only fires for genuine teardown of an `ACCEPTED` relationship.
  4. `caregiver_info` is reduced to a CG-ID/identity directory only — no surface writes relationship state to it anymore (web link/accept and bot link no longer write `patient_telegram_id`).
- **Reason**: Under RLS + the validation trigger, no actor could accept a request (the patient invites, but the caregiver was forbidden from setting `ACCEPTED`, and `SECURITY DEFINER` does not change `auth.uid()` so triggers still fired). The single-role model also blocked mutual/family care. Primary reassignment during a caregiver's self-revoke tripped the validation trigger on the sibling row; an internal-bypass GUC (`app.cc_internal`) set by `reassign_primary_after_revoke()` resolves it.
- **Impact**: Web accept calls the RPC; the Telegram bot adds a pending-requests list with Accept/Decline (service-role direct update, ownership-checked). Verified end-to-end against real RLS via `scratch/verify_carecircle_auth.js` (15/15).
