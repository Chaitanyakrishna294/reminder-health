# Verification close — August 2026

**STATUS: CLOSED 2026-08-18 BY OWNER DECISION, WITH DEFERRED DEVICE
VERIFICATIONS.** The phase is closed to proceed to the next one — it is **not**
closed because the checks passed. Most did not run.

**NOTHING IN THIS TABLE READS PASS.** No row ever received a device verdict, so
no row claims one. Rows that needed hardware read **DEFERRED-BY-OWNER**.

### The deferral, in one place

Every row marked **DEFERRED-BY-OWNER** carries this attribution:

| | |
|---|---|
| **Dated** | 2026-08-20 (the decision is recorded as closing the phase of 2026-08-18) |
| **Owner** | the maintainer |
| **Reason** | "proceeding to next phase; to be verified during real-user validation or a future evening." |

Stated once rather than repeated into twenty-three cells, so the table stays
readable. It applies to each of them individually.

**These deferred items are the first checklist when real-user validation
begins.**

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
| 4 | Reboot mid-ladder (the crown) | **DEFERRED-BY-OWNER** | `rescheduleAll` then `retry ladder rebuilt after boot … next rung +Nmin` |
| 4b | Powered off past the whole ladder | **DEFERRED-BY-OWNER** | **no ring**; sticky posted instead |
| — | A snooze does not survive a reboot | **DOCUMENTED-STATE** | pre-listed by the maintainer; the server keeps the dose SNOOZED with `retry_reminder_at`, so only the device goes quiet. CLAUDE.md, M2 known gap |
| 3 | Airplane-mode rungs | **DEFERRED-BY-OWNER** | 3 rungs, then `synced 1 queued dose action(s)` |
| 6 | Snooze suspends, does not race | **FINDING 2 — OPEN, triage blocked** | failure mode not yet named |
| 2a | Cancel from the notification | **DEFERRED-BY-OWNER** | `retry ladder cancelled … the dose was answered` |
| 2b | Cancel from the app (the 08-14 regression) | **DEFERRED-BY-OWNER** | `doseResolved: mirrored 1 of 1 …` **then** `retry ladder cancelled` |
| 2c | Caregiver answers remotely | **DEFERRED-BY-OWNER** — *the ≤30 min delay within it is* **DOCUMENTED-STATE** | the cancel itself still needs a verdict; the delay is pre-listed and is not a finding |
| 1 | Critical rings at +5; zero-blame copy | **DEFERRED-BY-OWNER** | rungs 2–4 read "Still time to take" |
| 5 | Escalation only after the window | **DEFERRED-BY-OWNER** | escalation after +15, not during |
| 7a–7e | Focused list, four doses at one instant | **FINDING 4 — re-run pending** | ONE notification, ONE screen, same notification id |
| 7f | Elderly is one question at a time | **DEFERRED-BY-OWNER** | elderly otherwise untouched this phase |
| 7g | Single-dose alarm has not regressed | **DEFERRED-BY-OWNER** | the rewrite's main regression risk |
| 8a–8e | Alarm media, including `8a-preview` | **DEFERRED-BY-OWNER** | the preview must **match** the real alarm |
| — | Full-screen intent presentation | **FINDING 3 — OPEN, needs lock state** | unlocked + in use → heads-up only is documented |
| 9a–9c | Expired-token recovery (new section) | **FINDING 1 — FIXED, re-verify **DEFERRED-BY-OWNER**** | `0acf4a2`, `54b9f12`; 9c guards that the ceiling still strands real rejections |
| 10 | Water count agrees phone ↔ web (new section) | see Water below | web half — merge deploys it, no APK needed |

### Water

| Test | Verdict | Evidence |
|---|---|---|
| Nudges arrive: silent, swipeable | **DEFERRED-BY-OWNER** | |
| Taken on the nudge increments the tumbler | **FINDING 5 — FIXED, re-verify **DEFERRED-BY-OWNER**** | `0acf4a2`, `54b9f12`; procedure now in checklist §10 |
| Dose-clash drop (within 10 min of a dose) | **DEFERRED-BY-OWNER** | |
| Goal-met skip | **DEFERRED-BY-OWNER** | `water: goal already met (n/m) — skipping this nudge` |

### Language

| Test | Verdict | Evidence |
|---|---|---|
| Telugu walk + **alarm** | **DEFERRED-BY-OWNER** | expects **translated** buttons — see pre-flight |
| Hindi switch re-test | **DEFERRED-BY-OWNER** | a language change re-syncs without needing a navigation |

### Behaviour walk (everything that writes)

| Test | Verdict |
|---|---|
| Dose resolve from every surface | **DEFERRED-BY-OWNER** |
| Vault upload | **DEFERRED-BY-OWNER** |
| Care-circle invite / consent flow | **DEFERRED-BY-OWNER** |
| Wizard save | **DEFERRED-BY-OWNER** |
| Deep links | **DEFERRED-BY-OWNER** |
| Bug-1 race | **DEFERRED-BY-OWNER** |

### Deferred — named reason and owner

These carry a verdict now. They are **not** awaiting a device; they are decisions
that this evening deliberately does not attempt.

| Item | Verdict | Reason | Owner |
|---|---|---|---|
| Escalation end to end with a real caregiver acting on it | **DEFERRED** | A two-person test. Sections 2c and 5 prove the device and server halves; a second human receiving and acting on the escalation is out of scope for a solo evening. | maintainer — schedule with a care-circle member before the Play closed test |
| OEM battery managers beyond vivo (Xiaomi / Oppo / Realme) | **DEFERRED** | No such hardware available. vivo needed no autostart exemption and that does not generalise — it is a standing M3 risk, not something tonight can retire. | maintainer — M3 hardening, needs borrowed or bought devices |
| Telegram-only and web-only delivery | **DEFERRED** | The server pipeline is unchanged by every commit tonight, so exercising it would test nothing this evening altered. | maintainer — covered by the existing bot tick; revisit if the pipeline changes |
| Long-horizon reliability: multi-day drift, DST, month boundaries | **DEFERRED** | Not reachable in hours on hardware. Covered instead by `test/schedule-test-vectors.json`, which the bot, the web and the Kotlin port all run. | already covered by fixture — no owner needed unless the fixture is changed |
| Rate-limiting `lookup_profile_by_connect_code` / `lookup_caregiver_by_code` | **DEFERRED** | A launch gate, not a verification item: it is unbuilt server work (`check_rate_limit` inside the two SECURITY DEFINER bodies), so there is nothing on the device to verify. | maintainer — before the Play closed test; tracked in CLAUDE.md M3 and PLAY_LISTING.md |
| A human review pass on the six machine-produced translations | **DEFERRED** | Tonight can prove the alarm speaks Telugu; it cannot prove the Telugu is good. Different kind of check, different reviewer. | maintainer — needs a native speaker per language; tracked in `docs/I18N.md` |

---

## Findings

### 1 · Stranded dose action on an expired JWT — NEW BUG, fixed, re-verify deferred by owner

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

### 5 · Water count differs between phone and web — NEW BUG, fixed, re-verify deferred by owner

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
| 1 | Every section carries a verdict | **MET, but read how.** Every row carries one: 23 **DEFERRED-BY-OWNER**, 6 **DEFERRED** (reason + owner), 2 **DOCUMENTED-STATE**, 2 **FIXED** with re-verify deferred. **Zero PASS** — no device verdict was ever given, so none is claimed. |
| 2 | Water PR merged, the last open feature branch | **ALREADY SATISFIED** — water merged before the evening. `WaterNudge.kt` and 11 web files are on main and `git branch -a --no-merged main` was empty, so no PR existed to merge. |
| 3 | This document | **MET** — table, evidence links, deferred list and boundary complete. The Logcat quotes the condition anticipated do not exist, because the runs they would have come from did not happen. |
| 4 | CLAUDE.md testing phase CLOSED | **MET** — closed by owner decision with the deferral named, not by verification. |

## The honest boundary

**What was proven on hardware tonight: nothing.** The device runs did not happen.
Two bugs were found from a Sentry report and a user observation, root-caused,
fixed and unit-tested — but neither fix has run on a phone.

**Unproven on hardware, in full:**

- **§4 reboot mid-ladder** — the crown, and the one that was a known gap. Never run.
- **§7 the coalesced ring** — the focused list, yield-on-timeout, tap-to-jump, the
  elderly one-at-a-time branch, and §7g's single-dose regression check. Never run.
- **§8 alarm media** — backdrops, the airplane-mode proof that nothing is fetched
  at fire time, and the §8a preview-vs-real comparison. Never run.
- **§5 escalation only after the window.** Never run.
- **§9 the expired-token recovery** and **§10 the water write-back** — tonight's two
  fixes. Compiled, unit-tested, packaged into an APK; never executed on a device.
- **Both language walks** — Telugu and the Hindi switch. The translations are
  confirmed present in the APK's resource table; that they *render on the alarm
  screen* is unverified.
- **The whole behaviour walk** — dose resolve from every surface, vault upload,
  care-circle invite/consent, wizard save, deep links, the Bug-1 race.
- **§1, §2a/2b/2c, §3, §6** — defaults, the three cancel paths, airplane rungs,
  snooze-suspends.

**What IS verified, and by what means:**

- The **layout half**, on the vivo I2202 on 2026-08-18 — see
  [device-width-sweep-2026-08-18.md](design/device-width-sweep-2026-08-18.md).
- The **schedule maths**, by the shared fixture the bot, the web and the Kotlin
  port all run.
- **60 native unit tests**, 0 failures, including the new auth-failure rules.
- The **six locales are packaged** in the APK's compiled resource table (checked
  with `aapt2`, not merely present in source).

**Also still deferred, from before the owner decision:** the two-person escalation
test, OEM battery managers beyond vivo, Telegram/web-only delivery, long-horizon
drift, the unbuilt directory-lookup rate limit, and a native-speaker review of the
six translations. See the deferred table above for reasons and owners.

**The honest summary:** this is a phase closed to move forward, with a named debt.
The debt is this list.
