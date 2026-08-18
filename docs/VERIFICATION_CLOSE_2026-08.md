# Verification close — August 2026

**STATUS: OPEN / IN PROGRESS.** The live verdict table for the verification
evening, written up front so results drop into cells rather than being
reconstructed afterwards.

**No row may read PASS without the maintainer's explicit device verdict.** Rows
read `AWAITING DEVICE VERDICT` until those words exist. That is the point of the
table, not a gap in it.

- **Layout half: CLOSED** — see
  [device-width-sweep-2026-08-18.md](design/device-width-sweep-2026-08-18.md),
  verified on the vivo I2202 on 2026-08-18.
- **Behaviour half: in progress** — this document.

---

## Pre-flight facts (settled 2026-08-18)

| question | answer | evidence |
|---|---|---|
| Is the native alarm translated? | **YES — state (a), all on main** | `2f51851`; six `values-*/strings.xml` at 32 user-facing keys each; `AlarmPrefs.setLanguage`/`localized()`; `ScheduleBridgePlugin` reads `language`; the web sends `locale` with it in the effect deps |
| Did the docs agree? | **No — they were stale, now corrected** | CLAUDE.md and `docs/I18N.md` both claimed "still English"; fixed in `bb4241f` |
| Does the Telugu test expect translated buttons? | **Yes** | as above |
| Is the on-disk APK usable for tonight? | **NO — dated 2026-08-12 00:06** | the retry ladder's foundation is `733618a`, 08-14 14:24 |
| What needs the fresh APK? | Sections 1–8, water nudges, both language tests | all native, all committed after that APK |
| What runs on any build? | the pure-web behaviour walk — vault upload, care-circle invite/consent, wizard save, deep links, web-UI dose resolve | web deployed at `bb4241f` |

**Medication names are never translated** — they arrive as `%1$s` from the Room
store exactly as typed. Stated in every locale file's header comment.

---

## Verdict table

### Retry ladder — `RETRY_LADDER_DEVICE_CHECKLIST.md`

| § | Test | Verdict | Evidence expected |
|---|---|---|---|
| 4 | Reboot mid-ladder (the crown) | AWAITING DEVICE VERDICT | `rescheduleAll` then `retry ladder rebuilt after boot … next rung +Nmin` |
| 4b | Powered off past the whole ladder | AWAITING DEVICE VERDICT | **no ring**; sticky posted instead |
| 3 | Airplane-mode rungs | AWAITING DEVICE VERDICT | 3 rungs, then `synced 1 queued dose action(s)` |
| 6 | Snooze suspends, does not race | **FINDING 2 — OPEN, triage blocked** | failure mode not yet named |
| 2a | Cancel from the notification | AWAITING DEVICE VERDICT | `retry ladder cancelled … the dose was answered` |
| 2b | Cancel from the app (the 08-14 regression) | AWAITING DEVICE VERDICT | `doseResolved: mirrored 1 of 1 …` **then** `retry ladder cancelled` |
| 2c | Caregiver answers remotely | AWAITING DEVICE VERDICT | bounded ≤30 min — documented state, not a finding |
| 1 | Critical rings at +5; zero-blame copy | AWAITING DEVICE VERDICT | rungs 2–4 read "Still time to take" |
| 5 | Escalation only after the window | AWAITING DEVICE VERDICT | escalation after +15, not during |
| 7a–7e | Focused list, four doses at one instant | **FINDING 4 — re-run pending** | ONE notification, ONE screen, same notification id |
| 7f | Elderly is one question at a time | AWAITING DEVICE VERDICT | elderly otherwise untouched this phase |
| 7g | Single-dose alarm has not regressed | AWAITING DEVICE VERDICT | the rewrite's main regression risk |
| 8a–8e | Alarm media, including `8a-preview` | AWAITING DEVICE VERDICT | the preview must **match** the real alarm |
| — | Full-screen intent presentation | **FINDING 3 — OPEN, needs lock state** | unlocked + in use → heads-up only is documented |
| 9a–9c | Expired-token recovery (new section) | **FINDING 1 — FIXED, awaiting re-verify** | `0acf4a2`, `54b9f12`; 9c guards that the ceiling still strands real rejections |
| 10 | Water count agrees phone ↔ web (new section) | see Water below | web half — merge deploys it, no APK needed |

### Water

| Test | Verdict | Evidence |
|---|---|---|
| Nudges arrive: silent, swipeable | AWAITING DEVICE VERDICT | |
| Taken on the nudge increments the tumbler | **FINDING 5 — FIXED, awaiting re-verify** | `0acf4a2`, `54b9f12`; procedure now in checklist §10 |
| Dose-clash drop (within 10 min of a dose) | AWAITING DEVICE VERDICT | |
| Goal-met skip | AWAITING DEVICE VERDICT | `water: goal already met (n/m) — skipping this nudge` |

### Language

| Test | Verdict | Evidence |
|---|---|---|
| Telugu walk + **alarm** | AWAITING DEVICE VERDICT | expects **translated** buttons — see pre-flight |
| Hindi switch re-test | AWAITING DEVICE VERDICT | a language change re-syncs without needing a navigation |

### Behaviour walk (everything that writes)

| Test | Verdict |
|---|---|
| Dose resolve from every surface | AWAITING DEVICE VERDICT |
| Vault upload | AWAITING DEVICE VERDICT |
| Care-circle invite / consent flow | AWAITING DEVICE VERDICT |
| Wizard save | AWAITING DEVICE VERDICT |
| Deep links | AWAITING DEVICE VERDICT |
| Bug-1 race | AWAITING DEVICE VERDICT |

---

## Findings

### 1 · Stranded dose action on an expired JWT — NEW BUG, fixed, awaiting re-verify

Sentry, med 159, 2026-08-18 ~16:45 UTC: `dose actions stranded after 5 exhausted
retries: resolve_reminder_event HTTP 401 PGRST303 JWT expired`.

Two defects compounding:

1. `DoseActionDao.pending()` filters `attempts < 5` and `markFailed` increments
   `attempts`, so an **auth** failure spent a retry exactly like a genuine
   rejection. Nothing anywhere reset `attempts`.
2. `ActionSyncWorker` returns `Result.retry()` while anything is pending, so
   WorkManager's backoff chain burned all five against a token that could never
   work — before the app was next opened.

`ActionSync`'s own comment promised that a 401 "is retried after the next
setSession". True only if fewer than five attempts were spent first; the ceiling
had already foreclosed the recovery the comment described.

**No data was lost.** `pruneSynced` deletes only `synced = 1`, so the row stayed
in `dose_actions` and the re-queue below reaches it.

**Fix** (`0acf4a2`): `isAuthFailure()` — HTTP 401/403, PGRST303 — routes to
`markAuthFailed`, which records the error without spending a retry; and
`setSession` re-queues every unsynced action before flushing. The ceiling still
does its real job, which is doses the server permanently rejects.

**Native token refresh was deliberately NOT added**, though `refreshToken` is
stored. Supabase refresh tokens are single-use and rotate, so a native refresh
would invalidate the webview's copy — two refreshers racing one token, with
surprise logouts as the failure mode on a medication app. `setSession` on app
open already is "fresh tokens over the bridge". A reversible decision, flagged to
the maintainer rather than taken silently.

### 2 · Snooze misbehaving — OPEN, triage blocked

Reported without the mode named: no re-fire / wrong time / no full screen on
re-fire. Cannot be triaged against the design until one is chosen. The decisive
check is that `med N (name) had a SNOOZE due <fireAt>` carries the **original**
dose instant, not the re-fire time — if those two are equal it is the
snooze-identity bug and outranks everything else.

### 3 · Full screen only flashes — OPEN, needs the lock state

**Unlocked and in active use → heads-up notification instead of the full screen
is documented, correct, and must not be overridden** — the ways to force it are
the ones CLAUDE.md forbids. The deciding fact is whether the screen was locked.
Also confounded by the ring-window setting, which section 7 setup lowers to one
minute.

### 4 · Same-time meds presentation unclear — re-run pending

Not yet a finding. The intended presentation — one notification, one screen, one
active dose, answer or timeout advances, tap to jump the queue — was described to
the maintainer for a four-dose re-run.

### 5 · Water count differs between phone and web — NEW BUG, fixed, awaiting re-verify

**Not** the same root as finding 1: `WaterActionReceiver` calls
`WaterPrefs.addCup()`, purely local SharedPreferences with no network call.

`schedule-sync.tsx` computed `Math.max(deviceCups, rowCups)` correctly and then
pushed the result to **native only**, never writing back to `water_logs`. The
merge could raise the device but never the server, so cups added on the
notification stayed on the phone while the web tumbler read the lower row.

**Fix** (`0acf4a2`): upsert the merged value when the device is ahead, guarded on
`deviceCups > rowCups` so an undo — which writes the row — still wins.

---

## Documented states (pre-listed, not findings)

| state | record |
|---|---|
| Snooze does not survive a reboot; the server covers it | CLAUDE.md, M2 known gap |
| Caregiver-remote ladder cancel bounded ≤30 min | CLAUDE.md, retry-ladder rule |
| `/register` scrolls 19px at 320px | device-width sweep, accepted |
| `/settings/help` keeps its bordered card | conformance audit §D6 |
| Gate scrolls internally at 320 with four doses; primary stays visible | device-width sweep |
| Cookie notice adds scroll before dismissal | device-width sweep |

---

## Exit conditions

| # | Condition | State |
|---|---|---|
| 1 | Every section carries a verdict | **OPEN** — awaiting device verdicts |
| 2 | Water PR merged, the last open feature branch | **ALREADY SATISFIED** — water merged before tonight. `WaterNudge.kt` and 11 water web files are tracked on main, and `git branch -a --no-merged main` is empty, so no PR exists to merge. Recorded rather than manufactured. |
| 3 | This document | **OPEN** — scaffold written, verdicts pending |
| 4 | CLAUDE.md testing phase CLOSED | **NOT DONE, deliberately** — writing it now would record a close that has not happened |

## The honest boundary

What this evening does **not** cover, and will not by the time it closes:

- **The escalation ladder end to end with a real second person.** Sections 2c and
  5 exercise the device and server halves; a caregiver actually receiving and
  acting on an escalation is a two-person test.
- **OEM battery managers other than vivo.** Xiaomi/Oppo/Realme autostart
  behaviour is a documented M3 risk and untested. vivo needed no exemption, and
  that does not generalise.
- **Telegram-only and web-only users.** The server pipeline is unchanged and
  untouched tonight.
- **Long-horizon reliability.** Everything here is minutes to hours. Multi-day
  drift, DST transitions and month boundaries are covered by the shared schedule
  fixture, not by hardware.
- **The two fixes from tonight on hardware.** `0acf4a2` compiles and the web half
  builds, but neither has run on the device yet.
