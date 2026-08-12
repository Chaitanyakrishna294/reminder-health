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

## Release build

`./gradlew assembleRelease` from `android-app/android/`. Signing is wired from a
**gitignored** `keystore.properties`, and the keystore itself lives **outside the
repo** (`C:/Users/chait/android-keystores/reminder-health-upload.jks`) so no
`git add -A` can reach it. Without that file the debug build still works and
`assembleRelease` fails loudly — it will never silently emit an unsigned or
debug-signed artifact.

**Minification is on** (`minifyEnabled` + `shrinkResources`), which CLAUDE.md
requires. The rules in `app/proguard-rules.pro` are written per-target with a
note on what breaks without each, because R8's failure mode is not a build error:
it strips reflection-only code and produces an APK that installs fine and then
silently loses a feature in the only build real users get. Reflection surfaces
here are Capacitor plugin methods (resolved by name from JS), Room entities,
SQLCipher's JNI, and manifest-named receivers/activities.

Known R8 complaint, already handled: Tink (behind `EncryptedSharedPreferences`)
references build-time-only annotations that are absent at runtime, so
`assembleRelease` failed on `Missing class com.google.errorprone.*` /
`javax.annotation.*` until `-dontwarn` rules were added. If a future dependency
does the same, R8 writes the exact rules needed to
`app/build/outputs/mapping/release/missing_rules.txt`.

> **Not yet done: run the release build on a device.** `assembleRelease`
> succeeding proves the R8 *configuration* is valid, not that the minified app
> behaves. Installing it replaces the debug build and its signed-in session, so it
> is a deliberate act — do it before the first upload, not after. Smoke test:
> app launches, medications list, an alarm fires, Taken syncs.

## Still open before submitting

- [ ] Closed test track: ~12 testers, 14 days (Play's requirement for new
      personal developer accounts).
- [ ] Keystore generated and backed up in ≥2 places outside the repo, **before**
      the first upload — a lost upload key cannot be recovered without a Play
      support reset.
- [ ] Store graphics: icon, feature graphic, phone screenshots.
- [ ] **Rate-limit the two directory lookups before strangers can get accounts.**
      `lookup_profile_by_connect_code` and `lookup_caregiver_by_code` turn a short
      code into a real person's name + profile UUID. Both are locked to
      `authenticated` at the grant AND guarded with `auth.uid()` in the body
      (2026-08-13), but **"authenticated" is a weak gate here**: guest sign-in is one
      tap, so anyone can hold a session and walk the code space. That is tolerable
      while the only testers are people you know; it stops being tolerable the day
      the closed test opens.
      Shape it as: call `check_rate_limit` **inside** the two SECURITY DEFINER
      bodies, keyed on `auth.uid()`. Not from the client — `check_rate_limit(text,
      int, int)` is **service_role only** (`authenticated` was revoked by
      `migration_rpc_grant_lockdown_2026_08_08.sql`), so a browser call cannot work;
      a definer body runs as the owner and can. Own migration, own validation.
- [x] ~~Confirm the Supabase region stated in `/privacy` §4~~ — **confirmed
      2026-08-11: `ap-southeast-1` (Singapore).** Privacy §4 is accurate as
      written. Re-check if the project is ever migrated, since it is a
      data-residency claim in a published policy.
- [x] ~~Support email~~ — `hello.remindre@gmail.com` confirmed live 2026-08-11.

> **Play Console fee ($25) deferred**, so the closed test is on hold. Everything
> above that does not need the Console is done; the keystore below is the piece
> worth having ready *before* the fee is paid, not after.
