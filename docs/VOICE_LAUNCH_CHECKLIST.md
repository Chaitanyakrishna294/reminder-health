# Voice Calls — Launch Runbook

Everything codeable is built and deployed **dormant** (flag/key-gated). This is the
checklist to actually turn it on. See `VOICE_CALLS_DESIGN.md` for the why.

Current state:
- ✅ P0 Call Schedule UI + tables (live, verified)
- ✅ P1 voice scheduler + `/api/voice/*` webhooks (deployed, `VOICE_CALLS_ENABLED` off → 404)
- ✅ P1b OTP verify (`/api/voice/verify/*`, SMS adapter) — graceful 503 until SMS configured
- ✅ P3 Razorpay subscription (`/api/billing/*`) — 503 until keys configured

---

## Step 1 — Start the long-lead item NOW: Exotel + DLT
1. Create an **Exotel** account (India).
2. Buy/verify an **ExoPhone** (caller ID).
3. Complete **DLT registration** (TRAI) for outbound automated calls + an SMS OTP template.
   *This approval is the bottleneck — days to weeks. Start before anything else.*
4. Note: `EXOTEL_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_CALLER_ID`.

## Step 2 — Validate before spending on billing (parallel, ~1–2 weeks)
1. Waitlist page/message: "Voice reminders for your parents — ₹399/mo." Target **caregivers**.
2. Manual 5–10 call pilot → record **answer rate, retries, billed minutes/call**.
3. Output: a real **COGS/user/month** number → sets the **Care+ price** + **call quota**.
   *No buyers or COGS > price → do not build billing; revisit the model.*

## Step 3 — SMS OTP provider
Pick one and set env (DLT template required in India):
- **MSG91**: `SMS_PROVIDER=msg91`, `MSG91_AUTHKEY`, `MSG91_SENDER`, `MSG91_TEMPLATE_ID`
- **Exotel SMS**: `SMS_PROVIDER=exotel`, `EXOTEL_SMS_SENDER` (+ the Exotel creds above)

## Step 4 — Razorpay (only after Step 2 says go)
1. Razorpay account → create a **Care+ Plan** (monthly, validated price) → note `RAZORPAY_CAREPLUS_PLAN_ID`.
2. Keys: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
3. Add webhook → `https://reminder-health.vercel.app/api/billing/webhook`, events:
   `subscription.activated/charged/cancelled/halted/pending/completed` → `RAZORPAY_WEBHOOK_SECRET`.

---

## Environment variables

**Vercel (web)** — webhooks, OTP, billing:
```
VOICE_CALLS_ENABLED=true
PUBLIC_WEBHOOK_BASE_URL=https://reminder-health.vercel.app
SMS_PROVIDER=msg91
MSG91_AUTHKEY=…  MSG91_SENDER=…  MSG91_TEMPLATE_ID=…
EXOTEL_SID=…  EXOTEL_API_KEY=…  EXOTEL_API_TOKEN=…  EXOTEL_CALLER_ID=…   # if Exotel SMS
RAZORPAY_KEY_ID=…  RAZORPAY_KEY_SECRET=…  RAZORPAY_CAREPLUS_PLAN_ID=…  RAZORPAY_WEBHOOK_SECRET=…
```

**Render (worker)** — scheduler + outbound calls:
```
VOICE_CALLS_ENABLED=true
PUBLIC_WEBHOOK_BASE_URL=https://reminder-health.vercel.app
EXOTEL_SID=…  EXOTEL_API_KEY=…  EXOTEL_API_TOKEN=…  EXOTEL_CALLER_ID=…
VOICE_DAILY_CALL_CAP=6
```

---

## Step 5 — Code work that remains (I do this once creds exist)
- Confirm Exotel's outbound IVR mechanism (applet vs Connect `Url`) → finalize `/api/voice/twiml` format + `src/voice/exotel.js`.
- Window-scope `/api/voice/response` resolution to the exact dose set (currently ±90 min heuristic).
- NO_ANSWER/BUSY capped retries + reuse caregiver escalation for critical meds.
- Per-medication call fan-out (`mode='per_medication'`).
- Plan enforcement: gate the voice scheduler on `isCarePlus()` + monthly minute quota.
- Razorpay Checkout UI ("Upgrade to Care+") in Settings.

## Step 6 — Activation + smoke test
1. Set env on Vercel + Render; redeploy both.
2. In Settings → Call Schedule: enter phone → **Verify** (OTP) → enable a window 2 min out.
3. Confirm: call arrives, keypad press resolves the dose on the dashboard, `voice_calls`
   row reaches `COMPLETED`, `voice_call_usage` increments.
4. Test Care+ checkout → webhook flips `subscriptions.status=active`.

## Rollback
Set `VOICE_CALLS_ENABLED=false` (or remove keys) on both hosts → all voice/billing
endpoints go inert (404/503), scheduler stops. Existing medication reminders are
unaffected at all times (separate tick, separate lock, separate tables).
