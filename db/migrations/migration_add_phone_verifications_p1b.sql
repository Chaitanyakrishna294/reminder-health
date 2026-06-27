-- ============================================================================
-- Phone OTP verification for voice calls — P1b (ADDITIVE ONLY)
-- See docs/VOICE_CALLS_DESIGN.md
--
-- Stores short-lived hashed OTP codes. RLS is enabled with NO policies on purpose:
-- only the service role (server-side API routes) may touch it — codes are never
-- exposed to client/anon/auth roles. Idempotent.
-- ============================================================================

create table if not exists phone_verifications (
  id          bigint generated always as identity primary key,
  telegram_id text not null,
  phone_e164  text not null,
  code_hash   text not null,           -- sha256(code); plaintext code is never stored
  attempts    int  not null default 0,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_phone_verif_telegram on phone_verifications (telegram_id);

alter table phone_verifications enable row level security;
-- Intentionally no policies: service-role only.
