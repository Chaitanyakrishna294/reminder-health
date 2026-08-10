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
| 53 | `migration_fix_reminder_logs_anon_read.sql` | 2026-08-08 (A1 — closes the anon-read PHI leak: FORCE RLS on reminder_logs + reminder_events, rebuild scoped SELECT policies; caregiver logs policy gated on `can_view_reports`. Validated via `STATE_CHECK` + anon probe `*/0`; has rollback + validation) |
| 54 | `migration_rpc_grant_lockdown_2026_08_08.sql` | 2026-08-08 (A2 — `check_rate_limit` EXECUTE → service_role only; **dropped `get_policies_debug`**; `REVOKE PUBLIC` on `redeem_link_code` + `search_medication_catalog`; has rollback) |
| 55 | `migration_redeem_link_code_ratelimit_2026_08_08.sql` | 2026-08-08 (A3 — `redeem_link_code` now RETURNS text + in-RPC per-user rate limit 5/300s; RETURNs status instead of RAISE so the counter INSERT commits. Supersedes link_codes_hardening def; has rollback) |
| 56 | `migration_pin_search_path_2026_08_08.sql` | 2026-08-08 (A4 — `ALTER FUNCTION SET search_path=public` on 7 SECURITY DEFINER helper/trigger fns; no body change; has rollback) |
| 57 | `migration_profile_telegram_id_immutable_2026_08_08.sql` | 2026-08-08 (B1 — closes account/PHI takeover: BEFORE UPDATE trigger `guard_profile_telegram_chat_id` (**SECURITY INVOKER** — must NOT be DEFINER or it no-ops) blocks client changes to `telegram_chat_id`, exempts redeem_link_code + the own-`WEB-<id>` self-heal; has rollback + validation) |
| 58 | `migration_profiles_select_accepted_2026_08_08.sql` | 2026-08-08 (B2 — profiles SELECT requires `connection_status='ACCEPTED'` (was is_active only); adds `get_connection_counterpart_names` RPC (id+full_name only) so the pending-requests UI still resolves names without leaking PII; has rollback + validation) |
| 59 | `migration_escalation_anchor_2026_08_06.sql` | 2026-08-08 (written 2026-08-06; adds `reminder_events.last_prompted_at` and redefines `scan_and_escalate_overdue_reminders` to anchor the ladder on the last real prompt — `last_prompted_at` if snooze-re-fired else `created_at`, clamped to `created_at`+30m. Verified applied via `VERIFY_REFILL_ESCALATION_2026_08_08.sql` (E1–E3 DONE); has rollback + validation) |
| 60 | `migration_refill_reminder.sql` | 2026-08-08 (written 2026-08-06; adds `medications.low_stock_notified_at`, the `LOW_STOCK` notifications type, and `rearm_low_stock_notice()` / `trigger_rearm_low_stock_notice`; drops the legacy `trigger_medication_low_stock` / `handle_medication_low_stock_trigger()` from entry 19 — the 09:00 cron is now the single low-stock owner. Verified via `VERIFY_REFILL_ESCALATION_2026_08_08.sql` (R1–R4 DONE); has rollback + validation) |
| 61 | `migration_delete_account_storage_fix_2026_08_09.sql` | 2026-08-09 (redefines `delete_my_account` WITHOUT the illegal `DELETE FROM storage.objects` line — it failed with 42501 "Direct deletion from storage tables is not allowed" and blocked ALL in-app account deletion; storage cleanup moved to the app route via the Storage API. Has rollback) |
| 62 | `migration_preserve_dose_history.sql` | written 2026-08-08 (commit `d43d38a`); **was never entered in this ledger when applied — found live during the 2026-08-10 Android-M0 schema check**, confirmed via PostgREST introspection: `reminder_logs.drug_name_snapshot` and `reminder_events.drug_name_snapshot` both exist. Single-transaction migration, so the co-located FK change also committed — `reminder_logs`/`reminder_events`.`medication_id` is now `ON DELETE SET NULL` (was `CASCADE`), so deleting a medication no longer erases its dose history. Exact apply date unknown; has rollback + validation. |
| 63 | `migration_anonymous_guests_2026_08_10.sql` | written 2026-08-10 (commit `a90a3d2`); **found live during the same 2026-08-10 schema check** (moved out of PENDING below — it had been sitting there since being written, but was actually already applied): `public.is_anonymous_user()` RPC responds live. Exact apply date unknown. Still needs its manual dashboard step if not already done — Authentication → Sign In / Providers → *Anonymous sign-ins* ON, plus CAPTCHA (cannot be verified from the DB side; confirm separately). Has rollback + validation. |
| 64 | `migration_dose_days_2026_08_10.sql` | written 2026-08-10 (commit `a90a3d2`); **found live during the same 2026-08-10 schema check** (moved out of PENDING below): `medications.dose_days` column responds live with the expected `smallint[]` format. `medications.reminder_times` was confirmed `jsonb` in the same check (the `00_baseline_pre_repo_tables.sql` reconstruction's `TEXT[]` guess was wrong — every RPC reading it via `jsonb_array_elements_text` had it right). Exact apply date unknown. Has rollback + validation. |

## PENDING (written, not yet applied)

| File | Notes |
| --- | --- |
| `migration_snooze_reminder_event_2026_08_11.sql` | Adds `public.snooze_reminder_event(p_medication_id, p_scheduled_for, p_snooze_minutes DEFAULT 10, p_resolution_channel)` — SECURITY DEFINER, `search_path` pinned, EXECUTE granted to `authenticated` only with `anon` **and PUBLIC** both revoked (revoking anon alone is a no-op when the privilege is held via PUBLIC). Written for the Android full-screen alarm's Snooze: `resolve_reminder_event` only knows TAKEN-vs-SKIPPED, and `reminder_events` is SELECT-only under RLS, so a client had no way to snooze at all. **Why it matters:** a device-only snooze would leave the server thinking the dose was unanswered and escalate to the care circle — a false caregiver alert for a patient who did respond. Mirrors the bot exactly (`src/commands.js` / `src/constants.js`): `SNOOZE_MINUTES=10`, `MAX_SNOOZES=3`, sets `reminder_status='SNOOZED'` + `retry_reminder_at` + increments `snooze_count`; deliberately does NOT stamp `last_prompted_at` (the scheduler stamps that at re-fire, which is what keeps the escalation ladder anchored). Patient-only authorization — narrower than `resolve_reminder_event`'s ReBAC on purpose, since a caregiver deferring someone else's dose would suppress the escalation they are the audience for. Clamps `p_snooze_minutes` to 1..60 so a client can't park a dose indefinitely and dodge escalation. Inserts the `reminder_events` row if the device alarm beat the server to the dose. Uses `CREATE OR REPLACE` (never DROP+CREATE — that resets the ACL to PUBLIC EXECUTE, which has bitten this repo before; see the lockdown note below). Has rollback + validation. **Order-independent w.r.t. the code deploy:** without it a device snooze just fails its sync attempt and stays queued, retrying after the migration lands — nothing is lost. |

> Previously listed here and since resolved: `migration_anonymous_guests_2026_08_10.sql` and
> `migration_dose_days_2026_08_10.sql` turned out to already be live; see #63–64 above. **This
> section drifting out of sync with reality is exactly why it's worth a live check before trusting
> it** — verify against the DB rather than this file alone when in doubt.

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
| `scan_and_escalate_overdue_reminders` | `migration_escalation_anchor_2026_08_06.sql` (applied 2026-08-08, entry #59 — anchors thresholds on `last_prompted_at`/`created_at`; supersedes `migration_5.7b_escalation_outcomes_logic.sql`) |
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
| `redeem_link_code` | `migration_redeem_link_code_ratelimit_2026_08_08.sql` (applied 2026-08-08, entry #55 — RETURNS text + in-RPC rate limit; supersedes `migration_link_codes_hardening_2026_07.sql`) |
| `delete_my_account` | `migration_delete_account_storage_fix_2026_08_09.sql` (applied 2026-08-09, entry #61 — no longer deletes from `storage.objects`; storage cleanup lives in the app route. Supersedes `migration_compliance_2026_06.sql`) |
| `check_rate_limit` / `cleanup_rate_limits` | `migration_compliance_2026_06.sql` (`check_rate_limit` EXECUTE locked to service_role by `migration_rpc_grant_lockdown_2026_08_08.sql`, entry #54) |
| `search_medication_catalog` | `migration_medication_catalog_2026_07.sql` |
| `handle_new_user_health_categories` | `migration_health_vault_combined.sql` |
| `cleanup_expired_trash` | `migration_health_vault_stabilization.sql` |
| `cleanup_expired_link_codes` | `migration_arch_hardening_2026_06.sql` |
| `sync_medication_stock_fields` | `migration_medication_enhancements.sql` (its `handle_medication_low_stock_trigger` was **DROPPED** by `migration_refill_reminder.sql`, entry #60 — the 09:00 cron is now the single low-stock owner) |
| `expire_stale_connection_requests` / `cleanup_resolved_request_notifications` | `migration_5.6c.1_expiration_and_primary.sql` |
| `handle_profile_telegram_chat_id_update` | `migration_optional_telegram.sql` |
| `handle_health_records_storage_path` | `migration_5.6e_vault_permissions.sql` |
| `set_medical_profiles_updated_at` | `migration_medical_profiles.sql` |
| `update_caregiver_connection_updated_at` | `migration_caregiver_decoupling_phase_a.sql` |
| `clean_old_chat_messages` | `migration_caregiver_accept.sql` |
| ~~`get_policies_debug`~~ | **DROPPED** by `migration_rpc_grant_lockdown_2026_08_08.sql` (entry #54) — leaked the RLS model to any authenticated user |
| `guard_caregiver_info_client_writes` | `migration_security_lockdown_2026_07_29.sql` (applied 2026-08-06) |
| `deactivate_legacy_caregiver_link_on_revoke` | `migration_security_lockdown_2026_07_29.sql` (applied 2026-08-06) |
| `rearm_low_stock_notice` | `migration_refill_reminder.sql` (applied 2026-08-08, entry #60) |
| `guard_profile_telegram_chat_id` | `migration_profile_telegram_id_immutable_2026_08_08.sql` (applied 2026-08-08 — **SECURITY INVOKER**; BEFORE UPDATE OF telegram_chat_id on profiles) |
| `get_connection_counterpart_names` | `migration_profiles_select_accepted_2026_08_08.sql` (applied 2026-08-08 — returns id+full_name only for connections the caller is party to) |
