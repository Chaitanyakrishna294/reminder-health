# Exotel Setup — What to Ask Support For

Account: `reminderhealth1` · ExoPhone (caller id): `09513886363`

You chose to have Exotel onboarding/support do the setup. Paste the brief below to them,
then bring the 3 answers (bottom) back to finish the code.

---

## Paste this to Exotel support

> Hi — I'm building **automated outbound medication-reminder voice calls** for patients
> (a healthcare reminder app; these are **transactional/service** calls, not promotional).
> India, account `reminderhealth1`, ExoPhone `09513886363`.
>
> Please help me set up:
> 1. **DLT / regulatory approval** for outbound automated (transactional) voice on this account.
> 2. A **Call Flow (App)** that, when the patient answers:
>    - plays a short greeting (e.g. "This is your medication reminder. Press 1 if you have
>      taken your medicines, press 2 to skip."), and
>    - **gathers one keypress**, and
>    - uses a **Passthru / Connect dynamic-URL applet** that calls my server so I can
>      (a) supply the prompt and (b) receive the keypress and call result.
> 3. My webhook endpoints to wire into the flow:
>    - Prompt / dynamic URL: `https://reminder-health.vercel.app/api/voice/twiml`
>    - Keypress result:       `https://reminder-health.vercel.app/api/voice/response`
>    - Call status callback:  `https://reminder-health.vercel.app/api/voice/status`
> 4. I'll trigger calls via the **Connect API** (`/v1/Accounts/reminderhealth1/Calls/connect.json`),
>    passing `Url` = this flow's App URL and `CustomField` = my internal call id.
>
> Questions:
> - What is the **App URL** for the flow once built?
> - For the dynamic-URL applet, what **HTTP method + exact parameter names** will you send me
>   (e.g. CallSid, From, digits, CustomField), and what **response format** must I return?
> - Can the greeting read **dynamic text per call** via the URL response, or should v1 use a
>   **fixed greeting** + keypress?

---

## Bring these 3 answers back to me (they unblock the final code)
1. **App URL** → becomes `EXOTEL_FLOW_URL` (looks like
   `http://my.exotel.com/reminderhealth1/exoml/start_voice/<APP_ID>`).
2. **Dynamic-URL request + response format** (method, param names, expected response body).
   *This is the one thing I must match — I'll convert `/api/voice/twiml` from its current
   placeholder to Exotel's exact format using this.*
3. **Dynamic TTS supported?** (yes → we read the med list aloud; no → fixed greeting for v1).

If you also want OTP **SMS** verification via Exotel, ask them for an **SMS sender id +
DLT template** for a code message, and bring back the sender id (`EXOTEL_SMS_SENDER`).

---

## Render env vars YOU set (worker dials from Render — I have no access)
In the Render dashboard for the worker service → Environment:
```
VOICE_CALLS_ENABLED=true
PUBLIC_WEBHOOK_BASE_URL=https://reminder-health.vercel.app
EXOTEL_ACCOUNT_SID=reminderhealth1
EXOTEL_API_KEY=<your key>
EXOTEL_API_TOKEN=<your token>
EXOTEL_PHONE_NUMBER=09513886363
EXOTEL_SUBDOMAIN=api.exotel.com
EXOTEL_FLOW_URL=<App URL from answer #1>
VOICE_DAILY_CALL_CAP=6
```
(I already set `PUBLIC_WEBHOOK_BASE_URL` on Vercel. When the flow format is confirmed,
I'll coordinate flipping `VOICE_CALLS_ENABLED=true` on Vercel so the webhooks go live.)

## Then I finish (one focused pass)
Convert the webhook to Exotel's format, window-scope dose resolution, add retries +
caregiver escalation, and run a live test call to a number you approve.

⚠️ Rotate the Exotel API key/token after testing — they were shared over chat.
