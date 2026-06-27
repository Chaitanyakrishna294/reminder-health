-- ============================================================================
-- Voice-Call Reminder Agent — P0 foundation (ADDITIVE ONLY)
-- See docs/VOICE_CALLS_DESIGN.md
--
-- SAFETY: This migration only CREATEs new tables/indexes/policies. It does NOT
-- alter or drop anything the existing medication-reminder pipeline depends on
-- (medications, reminder_events, reminder_logs, profiles, scheduler_locks...).
-- Idempotent: safe to re-run.
-- NOT YET APPLIED — review before running against the live project.
-- ============================================================================

-- Per-patient voice service configuration -----------------------------------
create table if not exists voice_call_preferences (
  id              bigint generated always as identity primary key,
  telegram_id     text not null unique,            -- matches medications.telegram_id
  phone_e164      text,                            -- +91XXXXXXXXXX
  phone_verified  boolean not null default false,
  enabled         boolean not null default false,  -- master opt-in (default OFF)
  mode            text   not null default 'grouped'
                  check (mode in ('grouped','per_medication')),
  morning         jsonb  not null default '{"enabled":true,"time":"08:00"}'::jsonb,
  afternoon       jsonb  not null default '{"enabled":false,"time":"14:00"}'::jsonb,
  night           jsonb  not null default '{"enabled":true,"time":"20:00"}'::jsonb,
  nightly_confirm jsonb  not null default '{"enabled":true,"time":"21:30"}'::jsonb,
  language        text   not null default 'en',
  timezone        text   not null default 'Asia/Kolkata',
  consent_at      timestamptz,                     -- documented call consent (compliance)
  dnd_optout      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One row per placed call (state machine; separate from reminder_events) ------
create table if not exists voice_calls (
  id                bigint generated always as identity primary key,
  telegram_id       text not null,
  call_type         text not null
                    check (call_type in ('med_reminder','nightly_confirmation')),
  window_key        text check (window_key in ('morning','afternoon','night') or window_key is null),
  scheduled_for     timestamptz not null,
  provider          text not null default 'exotel',
  provider_call_sid text,
  status            text not null default 'QUEUED',
  attempts          int  not null default 0,
  responses         jsonb not null default '[]'::jsonb, -- [{medication_id,response}]
  billed_seconds    int,
  cost_inr          numeric(10,2),
  created_at        timestamptz not null default now(),
  -- idempotency: never place two calls for the same patient+window+day
  unique (telegram_id, call_type, window_key, scheduled_for)
);
create index if not exists idx_voice_calls_telegram   on voice_calls (telegram_id);
create index if not exists idx_voice_calls_status     on voice_calls (status);
create index if not exists idx_voice_calls_sched      on voice_calls (scheduled_for);

-- Monthly metering for quota + billing --------------------------------------
create table if not exists voice_call_usage (
  id             bigint generated always as identity primary key,
  telegram_id    text not null,
  period_ym      text not null,                    -- 'YYYY-MM'
  calls_made     int  not null default 0,
  billed_seconds int  not null default 0,
  unique (telegram_id, period_ym)
);

-- Subscription state (Razorpay) ---------------------------------------------
create table if not exists subscriptions (
  id                       bigint generated always as identity primary key,
  telegram_id              text not null unique,
  plan                     text not null default 'free'
                           check (plan in ('free','care_plus')),
  status                   text not null default 'active',
  razorpay_customer_id     text,
  razorpay_subscription_id text,
  current_period_end       timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Row Level Security ---------------------------------------------------------
-- A user owns rows whose telegram_id == their profile's telegram_chat_id.
-- The Node worker uses the service role, which bypasses RLS.
alter table voice_call_preferences enable row level security;
alter table voice_calls            enable row level security;
alter table voice_call_usage       enable row level security;
alter table subscriptions          enable row level security;

-- Helper predicate inlined per policy (kept simple/portable).
do $$
begin
  if not exists (select 1 from pg_policies where tablename='voice_call_preferences' and policyname='own_voice_prefs') then
    create policy own_voice_prefs on voice_call_preferences
      using (telegram_id in (select telegram_chat_id from profiles where id = auth.uid()))
      with check (telegram_id in (select telegram_chat_id from profiles where id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where tablename='voice_calls' and policyname='own_voice_calls') then
    create policy own_voice_calls on voice_calls
      for select
      using (telegram_id in (select telegram_chat_id from profiles where id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where tablename='voice_call_usage' and policyname='own_voice_usage') then
    create policy own_voice_usage on voice_call_usage
      for select
      using (telegram_id in (select telegram_chat_id from profiles where id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where tablename='subscriptions' and policyname='own_subscription') then
    create policy own_subscription on subscriptions
      for select
      using (telegram_id in (select telegram_chat_id from profiles where id = auth.uid()));
  end if;
end $$;
