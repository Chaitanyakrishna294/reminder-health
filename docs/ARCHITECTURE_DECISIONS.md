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
