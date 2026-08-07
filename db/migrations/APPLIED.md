# Migration ledger

There is no runner and no schema-version table â€” this file is the record.
**Convention going forward:** name new files `migration_<slug>_YYYY_MM.sql`, write
idempotent SQL, and append a line to the "Applied order" list below when the
maintainer applies it in the Supabase SQL editor (project `jaflclnakwtikqbfhfdk`).

## Applied order (git first-commit date; same-date = listed order)

| # | File | Date |
|---|---|---|
| 0 | `00_baseline_pre_repo_tables.sql` | fresh envs only â€” **never on prod** |
| 1 | `setup_db.sql` | 2026-06-06 |
| 2 | `migration.sql` | 2026-05-26 (content predates setup_db; applied around it) |
| 3 | `migration_push_notifications.sql` | 2026-06-06 |
| 4 | `migration_fix_rls.sql` | 2026-06-06 |
| 5 | `migration_caregiver_accept.sql` | 2026-06-06 |
| 6 | `migration_fix_profiles_rls.sql` | 2026-06-07 |
| 7 | `migration_security_fix_rls.sql` | 2026-06-07 |
| 8 | `migration_chat.sql` | 2026-06-07 |
| 9 | `migration_fix_reminder_event_notifications.sql` | 2026-06-07 |
| 10 | `migration_add_resolve_reminder_event_rpc.sql` | 2026-06-07 |
| 11 | `migration_remove_client_reminder_writes.sql` | 2026-06-07 |
| 12 | `migration_push_reliability_diagnostics.sql` | 2026-06-11 |
| 13 | ~~`migration_health_records_upload.sql`~~ | superseded by health_vault_combined â€” skip on fresh envs |
| 14 | ~~`migration_health_vault_foundation.sql`~~ | superseded by health_vault_combined â€” skip on fresh envs |
| 15 | `migration_health_vault_combined.sql` | 2026-06-11 |
| 16 | `migration_health_records_index.sql` | 2026-06-11 |
| 17 | `migration_health_vault_stabilization.sql` | 2026-06-11 |
| 18 | `migration_optional_telegram.sql` | 2026-06-11 |
| 19 | `migration_medication_enhancements.sql` | 2026-06-12 |
| 20 | `migration_caregiver_decoupling_phase_a.sql` | 2026-06-12 |
| 21 | `migration_carecircle_access_requests_phase_c.sql` | 2026-06-12 |
| 22 | `migration_5.6c.1_expiration_and_primary.sql` | 2026-06-12 |
| 23 | `migration_5.6d_trust_center.sql` | 2026-06-12 |
| 24 | `migration_5.6e_vault_permissions.sql` | 2026-06-12 |
| 25 | `migration_5.7a_notification_observability.sql` | 2026-06-12 |
| 26 | `migration_remove_role_onboarding.sql` | 2026-06-13 |
| 27 | `migration_5.7b_escalation_outcomes_ddl.sql` | 2026-06-13 |
| 28 | `migration_5.7b_escalation_outcomes_logic.sql` | 2026-06-13 |
| 29 | `migration_5.7b_fix_snoozed_constraint.sql` | 2026-06-13 |
| 30 | `migration_carecircle_rca_fixes.sql` | 2026-06-13 |
| 31 | `migration_carecircle_rpc_and_profiles_rls.sql` | 2026-06-13 |
| 32 | `migration_carecircle_respond_rpc.sql` | 2026-06-13 |
| 33 | `migration_carecircle_lookup_rpc.sql` | 2026-06-13 |
| 34 | `migration_ensure_profile_selfheal.sql` | 2026-06-13 |
| 35 | `migration_fix_resolve_invalid_scheduled_time.sql` | 2026-06-14 |
| 36 | `migration_arch_hardening_2026_06.sql` | 2026-06-15 |
| 37 | `migration_compliance_2026_06.sql` | 2026-06-15 |
| 38 | `migration_medical_profiles.sql` | 2026-06-15 |
| 39 | `migration_carecircle_universal_connect.sql` | 2026-06-19 |
| 40 | `migration_dose_correction.sql` | 2026-06-19 |
| 41 | `migration_add_voice_calls_p0.sql` | 2026-06-27 (header's "NOT YET APPLIED" is stale â€” it IS live) |
| 42 | `migration_add_phone_verifications_p1b.sql` | 2026-06-27 |
| 43 | `migration_enable_rls_locks_ratelimits.sql` | 2026-06-28 |
| 44 | `migration_profiles_phone_number.sql` | 2026-07-06 |
| 45 | `migration_security_hardening_2026_07.sql` | 2026-07-09 |
| 46 | `migration_link_codes_hardening_2026_07.sql` | 2026-07-11 |
| 47 | `migration_scheduler_heartbeat_2026_07.sql` | 2026-07-11 |
| 48 | `migration_medication_catalog_2026_07.sql` | 2026-07-12 |
| 49 | `migration_push_logs_rls_2026_07.sql` | 2026-07-26 |
| 50 | `migration_notifications_no_client_insert_2026_07.sql` | 2026-07-26 |
| 51 | `migration_are_profiles_connected_dual_read_2026_07.sql` | 2026-07-26 (validated: dual-read + SECURITY DEFINER confirmed) |
| 52 | `migration_security_lockdown_2026_07_29.sql` | 2026-08-06 (validated: anon call to `try_acquire_scheduler_lock` / `release_scheduler_lock` now returns 42501 permission denied; has rollback + validation files) |

## PENDING (written, not yet applied)

| # | File | Date |
|---|---|---|
| — | `migration_escalation_anchor_2026_08_06.sql` | **NOT YET APPLIED** (written 2026-08-06; anchors the escalation ladder to the last real prompt — `last_prompted_at` if snooze-re-fired, else `created_at` — clamped to `created_at`+30m; apply-first is recommended but EITHER order is safe: the send paths never name the column on INSERT and the snooze-re-fire stamp is a separate best-effort write; on apply, move this row up and repoint the `scan_and_escalate_overdue_reminders` row in the function map below to this file; has rollback + validation files) |
| — | `migration_refill_reminder.sql` | **NOT YET APPLIED** (written 2026-08-06; adds `medications.low_stock_notified_at`, the `LOW_STOCK` notifications type, and `rearm_low_stock_notice()` / `trigger_rearm_low_stock_notice`; also drops the legacy `trigger_medication_low_stock` / `handle_medication_low_stock_trigger()` installed by entry 19 — the 09:00 low-stock cron becomes the single owner of every low-stock channel; on apply, move this row up and update the function map below (add `rearm_low_stock_notice`, remove `handle_medication_low_stock_trigger`); has rollback + validation files) |

> Lockdown note: if `try_acquire_scheduler_lock`, `release_scheduler_lock`,
> `close_daily_medications`, or `scan_and_escalate_overdue_reminders` is ever
> redefined via `DROP FUNCTION` + `CREATE`, its ACL resets to PUBLIC EXECUTE â€”
> re-run section A of the lockdown migration afterwards.

## Current function definitions (latest file wins)

Functions are redefined wholesale across migrations; when editing one, start from
the file listed here, not the first grep hit. Entries marked âš  are same-commit
ties â€” confirm with `SELECT pg_get_functiondef('public.<fn>'::regproc);` before
relying on them.

| Function | Current definition in |
|---|---|
| `resolve_reminder_event` | `migration_fix_resolve_invalid_scheduled_time.sql` |
| `correct_reminder_event` | `migration_dose_correction.sql` |
| `validate_reminder_event_status_transition` | `migration_dose_correction.sql` |
| `handle_reminder_event_state_change` | `migration_carecircle_rca_fixes.sql` âš  (vs remove_role_onboarding) |
| `scan_and_escalate_overdue_reminders` | `migration_5.7b_escalation_outcomes_logic.sql` |
| `close_daily_medications` | `migration_arch_hardening_2026_06.sql` |
| `handle_reminder_event_taken_stock_reduction` | `migration_arch_hardening_2026_06.sql` |
| `try_acquire_scheduler_lock` / `release_scheduler_lock` | `migration_arch_hardening_2026_06.sql` |
| `invite_caregiver` | `migration_carecircle_universal_connect.sql` |
| `validate_caregiver_connection_updates` | `migration_carecircle_universal_connect.sql` |
| `handle_caregiver_connection_trust_events` | `migration_carecircle_respond_rpc.sql` |
| `respond_to_caregiver_request` | `migration_carecircle_respond_rpc.sql` |
| `reassign_primary_after_revoke` | `migration_carecircle_respond_rpc.sql` |
| `auto_assign_primary_caregiver` | `migration_carecircle_rca_fixes.sql` |
| `handle_new_user` | `migration_carecircle_universal_connect.sql` |
| `ensure_my_profile` | `migration_carecircle_universal_connect.sql` |
| `gen_connect_code` / `lookup_profile_by_connect_code` | `migration_carecircle_universal_connect.sql` |
| `lookup_caregiver_by_code` | `migration_carecircle_lookup_rpc.sql` |
| `are_profiles_connected` | `migration_are_profiles_connected_dual_read_2026_07.sql` (applied 2026-07-26, entry #51 — supersedes `migration_security_fix_rls.sql`) |
| `get_my_telegram_chat_id` | `migration_security_fix_rls.sql` |
| `redeem_link_code` | `migration_link_codes_hardening_2026_07.sql` |
| `delete_my_account` / `check_rate_limit` / `cleanup_rate_limits` | `migration_compliance_2026_06.sql` |
| `search_medication_catalog` | `migration_medication_catalog_2026_07.sql` |
| `handle_new_user_health_categories` | `migration_health_vault_combined.sql` |
| `cleanup_expired_trash` | `migration_health_vault_stabilization.sql` |
| `cleanup_expired_link_codes` | `migration_arch_hardening_2026_06.sql` |
| `sync_medication_stock_fields` / `handle_medication_low_stock_trigger` | `migration_medication_enhancements.sql` |
| `expire_stale_connection_requests` / `cleanup_resolved_request_notifications` | `migration_5.6c.1_expiration_and_primary.sql` |
| `handle_profile_telegram_chat_id_update` | `migration_optional_telegram.sql` |
| `handle_health_records_storage_path` | `migration_5.6e_vault_permissions.sql` |
| `set_medical_profiles_updated_at` | `migration_medical_profiles.sql` |
| `update_caregiver_connection_updated_at` | `migration_caregiver_decoupling_phase_a.sql` |
| `clean_old_chat_messages` | `migration_caregiver_accept.sql` |
| `get_policies_debug` | `migration_security_fix_rls.sql` |
| `guard_caregiver_info_client_writes` | `migration_security_lockdown_2026_07_29.sql` (applied 2026-08-06) |
| `deactivate_legacy_caregiver_link_on_revoke` | `migration_security_lockdown_2026_07_29.sql` (applied 2026-08-06) |
| `rearm_low_stock_notice` | `migration_refill_reminder.sql` |
