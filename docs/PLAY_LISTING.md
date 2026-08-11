# Play Store listing — required text and answers

Everything Play asks for that is a *writing* task rather than a build task. Kept
here so the listing copy and the in-app pages can be diffed against each other
rather than drifting apart.

**Nothing here is submitted yet.** The closed test track is the remaining M3 item.

---

## URLs

| Field | Value |
| --- | --- |
| Privacy policy | `https://reminder-health.vercel.app/privacy` |
| Terms of service | `https://reminder-health.vercel.app/terms` |
| Medical disclaimer | `https://reminder-health.vercel.app/disclaimer` |
| Support email | `hello.remindre@gmail.com` |

All three pages are public and require no sign-in — Play's reviewers cannot log
in, and a policy URL behind auth is a standard rejection reason.

## Medical disclaimer — short form for the listing

Paste into the app description, near the top. This is the condensed version of
`/disclaimer`; **if you change one, change both.**

> **Re-MIND-eЯ is a reminder tool, not a medical device.** It does not give
> medical advice, does not suggest or change doses, and does not check whether
> what you entered is correct — the medications, doses and times are the ones you
> enter yourself. Always follow your doctor or pharmacist. Reminders are
> best-effort and can be delayed or missed if your phone is off, offline, or
> restricting background apps, so please do not rely on this app alone for
> medication critical to your health. In an emergency, contact your local
> emergency services.

## Data safety form — what to declare

Play's Data Safety section is answered from what the app *actually* does. Cross-check
against `/privacy` before submitting; these are the answers the current build supports.

**Collected and linked to the user:**

| Data type | Why | Notes |
| --- | --- | --- |
| Personal info — name, email address | Account management | |
| Personal info — phone number | Optional; only if provided | |
| Health and fitness — health info | App functionality | Medication names, schedules, adherence history, Health Vault documents |
| Photos/documents (Health Vault) | App functionality | User-uploaded, private bucket |
| App activity | App functionality | Dose responses |

**Collected, NOT linked to the user:**

| Data type | Why | Notes |
| --- | --- | --- |
| Crash logs | Diagnostics | Sentry. No medication names, no email/phone/Telegram ID, no IP, no session replay — see `/privacy` §5a |

**Declare as:**
- Data is encrypted in transit: **yes** (HTTPS everywhere).
- Users can request data deletion: **yes** — in-app at Settings → Delete Account.
- Data is NOT sold, and is NOT used for advertising or third-party marketing.

**On-device storage note (not a Data Safety "collection", but say it in the
description if asked):** the app keeps an encrypted copy of the medication
schedule on the device so alarms work offline. It is erased on sign-out and on
uninstall. See `/privacy` §4a.

## Permissions — justification for review

Play asks about the sensitive ones. Answers, with the reason each is genuinely
needed:

| Permission | Justification |
| --- | --- |
| `USE_EXACT_ALARM` / `SCHEDULE_EXACT_ALARM` | The app's core function is delivering a medication reminder at a specific time. An inexact alarm may fire an hour late, which for a dose is a failure. This is the alarm-clock-class use Google documents as acceptable. |
| `USE_FULL_SCREEN_INTENT` | The dose alarm must be answerable from the lock screen, like an alarm clock. Used **only** for the dose alarm. |
| `POST_NOTIFICATIONS` | Reminders are notifications. |
| `RECEIVE_BOOT_COMPLETED` | Android drops all scheduled alarms on shutdown; without this a phone that rebooted overnight wakes with no reminders and no sign anything is wrong. |
| `VIBRATE` | The alarm vibrates alongside sound, which is what wakes a sleeping user with the ringer down. |

**Not requested, deliberately:** `SYSTEM_ALERT_WINDOW` (the full-screen intent is
the sanctioned route), `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (the app opens the
settings screen instead of demanding the grant), and no foreground service.

`WAKE_LOCK`, `ACCESS_NETWORK_STATE` and `FOREGROUND_SERVICE` appear in the merged
manifest from `androidx.work`; the app declares none of them and holds no wake
lock. See CLAUDE.md for the audit.

## Still open before submitting

- [ ] Closed test track: ~12 testers, 14 days (Play's requirement for new
      personal developer accounts).
- [ ] Keystore generated and backed up in ≥2 places outside the repo, **before**
      the first upload — a lost upload key cannot be recovered without a Play
      support reset.
- [ ] Store graphics: icon, feature graphic, phone screenshots.
- [ ] Confirm the Supabase region stated in `/privacy` §4 (currently "Singapore")
      still matches the live project.
