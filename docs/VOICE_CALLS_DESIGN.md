# Voice-Call Reminder Agent + Monetization — Design

Status: **Design locked, pre-build.** No feature code yet.
Market: **India-first.**
Guiding rule: **the existing medication-reminder pipeline must not change or break.**

---

## 1. Goal

Add an automated **voice-call** reminder channel for patients (especially elderly,
who won't use Telegram/push), and monetize it as a subscription so call costs are
recovered. Notifications (push/Telegram) stay free for everyone.

The agent calls the patient, reads their due medications, and the patient responds via
**keypad (DTMF)** — e.g. "press 1 = took all, 2 = go one-by-one, 3 = skipped". Modes:
- **Grouped** — one call per window: morning / afternoon / night.
- **Per-medication** — a call per medicine (premium, heavier cost).
- **Nightly confirmation** — end-of-day "did you take everything?" call.

---

## 2. Business model (corrected)

**One axis: free = safety + retention; paid = the expensive, high-emotion convenience (voice).**

Safety is NEVER gated. We gate the *channel* (voice), never the *number of medications*.

| Capability | Free | Care+ (paid) |
|---|---|---|
| Medication reminders via push/Telegram | ✅ **unlimited meds** | ✅ |
| Dashboard, schedule, insights | ✅ | ✅ |
| **Voice call reminders + nightly confirmation** | ❌ | ✅ (monthly minute quota) |
| Caregiver escalation **calls** | ❌ | ✅ |
| Health Vault | ✅ generous (cap by **size**, e.g. 250 MB–1 GB — never by file count) | Unlimited |
| Caregivers linked | 1 | Multiple |

- **Payer = the adult-child caregiver**, not the elderly patient. All upgrade copy,
  billing, and prompts target the caregiver ("peace of mind that mum took her pills").
- **Price target: ₹299–₹499/month** (confirm via validation, §8). Annual discount to cut churn.
- **Beyond quota → UPI pay-as-you-go top-ups.** Protects margin from heavy users.

### Why these choices (the brutal math)
- Grouped mode = up to 4 calls/day (morning/afternoon/night + nightly). With no-answer
  **retries** (every ring/attempt is billable), realistic usage ≈ **150–250+ billed
  min/user/month**.
- At ~₹1/min that's **₹150–250/user/month raw telephony COGS**, before Razorpay (~2.4%),
  number rental, DLT, and support.
- Therefore: a ₹99 plan **loses money on every active user**. Price ≥ ₹299 **and** enforce
  a **minute quota + hard retry/daily caps in code** so one user can't run an unbounded bill.

### Explicitly rejected (and why)
- ❌ "Free tier = reminders for only a few meds" — safety/ethics/PR landmine; users miss
  unpaid doses. Never gate med count.
- ❌ Charging micro-amounts for Vault storage with 2 free files — storage is ~free; billing
  friction > revenue; 2 files is insultingly low; the vault is a *retention* asset, keep it generous.
- ❌ À-la-carte per-service voice pricing — decision fatigue, metering/billing complexity,
  support load. Sell **one** clear bundle.

---

## 3. Architecture

Voice is an **additive, parallel channel**. The existing per-minute medication tick in
`src/scheduler.js` is **not edited**.

```
src/voice-scheduler.js   (NEW Node cron — OWN tick, OWN lock "voice_minute_tick",
                           feature-flagged VOICE_CALLS_ENABLED, wrapped so it can
                           never throw into / block the medication tick)
   ├─ reads voice_call_preferences + today's due meds + remaining quota
   ├─ enforces daily-call cap + retry cap
   └─ places outbound call via Exotel API

Exotel ──webhook──▶ web /api/voice/twiml/{callId}   → IVR script: TTS lists meds + <Gather> DTMF
Patient keypad ─webhook─▶ /api/voice/response/{callId} → resolve_reminder_event() (taken/skip)
Exotel status ─webhook─▶ /api/voice/status/{callId}    → retry on NO_ANSWER (capped);
                                                          critical+unanswered → existing escalation
```

### Isolation guarantees (how the present model is protected)
- **Separate module + separate cron + separate lock name** (reuses existing
  `try_acquire_scheduler_lock` RPC; no schema change).
- **Feature flag `VOICE_CALLS_ENABLED` + per-patient opt-in, default OFF** → zero impact
  on current users until deliberately enabled.
- **All voice code wrapped in try/catch**; a telephony outage can never block med reminders.
- **Additive DB only** — no changes to `medications` columns the scheduler reads
  (`next_reminder_at`, `last_sent_at`, `reminder_times`, …).
- **One adherence ledger** — a call TAKEN/SKIP calls the **existing `resolve_reminder_event`
  RPC** (same path Telegram uses), so dashboard/insights/caregiver summaries stay consistent.
  No parallel adherence data.
- **Webhooks are new routes** under `web/src/app/api/voice/*` (Vercel, already public HTTPS).
  No existing route touched.

---

## 4. Dependencies

| Concern | India-first (chosen) | Global (if we expand) |
|---|---|---|
| Telephony | **Exotel** REST via `axios` (Plivo as cheaper alt) | `twilio` |
| Billing | **`razorpay`** (UPI + recurring Subscriptions) | `stripe` |
| Phone OTP verify | Exotel SMS or **MSG91** | Twilio Verify |
| AI voice agent (later premium only) | Vapi / Retell (~$0.13–0.31/min all-in) | same |

> ⚠️ Twilio dropped **outbound calling from Indian (+91) numbers (Aug 2024)** — only callable
> from foreign numbers (bad caller-ID/answer rates). Hence Exotel for India.

MVP uses **DTMF IVR**, not an AI agent — deterministic, cheap, reliable for elderly, clean logs.
AI agent is a later premium upsell.

---

## 5. Data model (additive — proposed SQL, NOT yet applied)

```sql
-- Per-patient voice service config
create table voice_call_preferences (
  id              bigint generated always as identity primary key,
  telegram_id     text not null,            -- matches medications.telegram_id
  phone_e164      text,                     -- +91XXXXXXXXXX
  phone_verified  boolean not null default false,
  enabled         boolean not null default false,   -- master opt-in
  mode            text not null default 'grouped',  -- 'grouped' | 'per_medication'
  morning         jsonb default '{"enabled":true,"time":"08:00"}',
  afternoon       jsonb default '{"enabled":false,"time":"14:00"}',
  night           jsonb default '{"enabled":true,"time":"20:00"}',
  nightly_confirm jsonb default '{"enabled":true,"time":"21:30"}',
  language        text not null default 'en',
  timezone        text not null default 'Asia/Kolkata',
  consent_at      timestamptz,              -- documented consent (compliance)
  dnd_optout      boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (telegram_id)
);

-- One row per placed call (state machine, separate from reminder_events)
create table voice_calls (
  id               bigint generated always as identity primary key,
  telegram_id      text not null,
  call_type        text not null,           -- 'med_reminder' | 'nightly_confirmation'
  window_key       text,                    -- 'morning' | 'afternoon' | 'night' | null
  scheduled_for    timestamptz not null,
  provider         text not null default 'exotel',
  provider_call_sid text,
  status           text not null default 'QUEUED', -- QUEUED/INITIATED/RINGING/IN_PROGRESS/
                                                   -- COMPLETED/NO_ANSWER/BUSY/FAILED
  attempts         int not null default 0,
  responses        jsonb default '[]',      -- [{medication_id, response:'TAKEN'|'SKIP'}]
  billed_seconds   int,
  cost_inr         numeric(10,2),
  created_at       timestamptz not null default now(),
  -- idempotency: never place two calls for the same patient+window+day
  unique (telegram_id, call_type, window_key, scheduled_for)
);

-- Monthly metering for quota + billing
create table voice_call_usage (
  id            bigint generated always as identity primary key,
  telegram_id   text not null,
  period_ym     text not null,             -- 'YYYY-MM'
  calls_made    int not null default 0,
  billed_seconds int not null default 0,
  unique (telegram_id, period_ym)
);

-- Subscription state (Razorpay)
create table subscriptions (
  id                     bigint generated always as identity primary key,
  telegram_id            text not null,
  plan                   text not null,     -- 'free' | 'care_plus'
  status                 text not null,     -- 'active'|'past_due'|'cancelled'|'trialing'
  razorpay_customer_id   text,
  razorpay_subscription_id text,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  unique (telegram_id)
);
```
Locks reuse the existing `scheduler_locks` table with a new lock name `voice_minute_tick`.

---

## 6. Cost & abuse controls (must ship with P1)
- **Daily call cap** per patient (e.g. ≤ 5/day) enforced in `voice-scheduler` before dialing.
- **Retry cap** per call (e.g. ≤ 2 retries, spaced) — every ring is billable.
- **Monthly minute quota** per plan; once exceeded → stop or require UPI top-up.
- Persist `billed_seconds`/`cost_inr` from Exotel status callbacks → reconcile vs revenue.

---

## 7. Compliance checklist (India — Phase 0, blocking)
- [ ] **DLT registration** + approved caller-ID with Exotel (automated outbound).
- [ ] **TRAI/DND** handling — honor DND, register as transactional/service.
- [ ] **OTP-verify** the phone number before any call.
- [ ] **Documented consent** to be called (store `consent_at`) + easy opt-out.
- [ ] Health-data consent for reading medication names aloud + stored vault files.

---

## 8. Validation BEFORE building billing (1–2 weeks, near-zero code)
1. **Willingness to pay** — "Voice reminders for your parents — ₹399/mo" waitlist page +
   WhatsApp survey to existing users' caregivers. No buyers → don't build billing.
2. **Real COGS** — 10-user manual Exotel pilot: measure answer rate, retries, billed minutes.
   *That number sets price + quota.*
3. **Confirm DLT/consent path** with Exotel before writing the scheduler.

Build billing + quota **only after** #1 and #2 are green.

---

## 9. Phased roadmap

- **P0 — Foundation (safe, no calls):**
  Settings → "Call schedule" section: capture phone, OTP-verify, consent, choose mode + times.
  Apply additive migration (tables above). Feature flag off. *Ships with zero behavior change.*
- **P1 — Grouped IVR calls:**
  `voice-scheduler.js` + `/api/voice/*` webhooks; morning/afternoon/night + nightly confirm;
  responses → `resolve_reminder_event`; retry/daily caps; caregiver escalation reuse.
- **P2 — Per-medication mode + AI agent premium tier.**
- **P3 — Razorpay subscription + usage metering + quota enforcement (cost recovery).**

---

## 10. Open decisions / secrets needed
- Exotel account + DLT approval; `EXOTEL_SID`, `EXOTEL_TOKEN`, `EXOTEL_CALLER_ID`.
- Razorpay keys + plan IDs (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`).
- Confirmed price point + quota from validation.
- Public webhook base URL (Vercel prod domain).
