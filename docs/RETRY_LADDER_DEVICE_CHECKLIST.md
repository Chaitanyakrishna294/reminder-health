# Retry ladder — one-evening device checklist

Everything here runs on a **vivo I2202** with the debug APK from
`android-app/android/app/build/outputs/apk/debug/app-debug.apk`.

**Before you start**, both halves must be current — `server.url` mode means the
APK and the deployed web ship separately:

- `migration_retry_ladder_2026_08_14.sql` applied ✅ (you did this)
- web deployed ✅ (`d0zwujw95`)
- fresh APK installed ← rebuild for the coalesced ring + the 2b fix
- **web re-deployed** ← required for 2b/2c, and for elderly + ring duration to
  reach the alarm screen at all; `server.url` means the two halves ship separately
- `migration_alarm_ring_seconds_2026_08_14.sql` applied ← needed before the
  ring-duration control can save. Everything else works without it (the device
  keeps its 60s default), so this one is not a hard ordering constraint

Then open the app once so `syncSchedule` pushes `priorityLevel` and the ladder
columns into the native store. **Nothing below works until that sync has run** —
check logcat for `synced N medication(s)`.

```
adb logcat -s AlarmScheduler:* -v time
```

Keep that running all evening. Every line below is grep-able from it.

---

## Test medications to create first

Deliberately short ladders. They shorten the WAIT without weakening the proof —
what is being tested is that a chain advances, cancels and rebuilds, and three
rungs demonstrate that exactly as well as five.

| # | Name | Priority | Ladder | Why |
|---|---|---|---|---|
| **A** | `LadderCritical` | Critical | **5 × 3** (custom) | The main proof: rungs at +5, +10, +15. Whole ladder over in 15 min instead of 25. |
| **B** | `LadderShort` | Critical | **1 × 3** (custom) | Rungs at +1, +2, +3 — for the fast loops (cancel, reboot, airplane). Do most of your iterating here. |
| **C** | `LadderRoutine` | Routine | default (15 × 1) | Proves routine gets ONE nudge and no controls appear on its edit form. |
| **D** | `LadderPair` | Important | default (10 × 2) | Give it the **same reminder time as A** for the multi-dose ring. |

Set each one's time a few minutes ahead, then re-open the app so it syncs.

> A 1-minute interval is legal (`1 × 3 = 3 ≤ 30`) and is the single biggest
> time-saver here. Use B for anything you expect to repeat.

---

## 1 · A critical med rings at +5 intervals — **med A**

1. Let A's dose time pass. **Do not answer anything.**
2. Expect the first ring at T+0, then rungs at **+5, +10, +15**.
3. After +15, expect the sticky **"Missed: take LadderCritical"** and no more rings.

**Pass:**
- Rungs 2–4 read **"Still time to take LadderCritical"**, not "Time to take".
  Zero-blame — no "again", no count.
- logcat shows `retry ladder started`, then `advanced` twice, then
  `is exhausted -- leaving the sticky missed notice`.
- Each `next rung +Nmin ... for the dose due <T>` shows **the same dose instant**
  every time. If a rung's dose time drifts to its own fire time, stop — that is
  the snooze identity bug and the answer would be unsaveable.

## 2 · Answering mid-ladder stops it — **both surfaces, med B**

Run twice. **The two surfaces take different code paths and both must work.**

**2a — from the notification:** let B ring, wait for the +1 rung, tap **Taken**
on the notification itself (do not open the app).

**2b — from the app:** repeat, but at the +1 rung open the app and answer on the
rail or the gate. **This FAILED on 2026-08-14 and is fixed in this build — re-run
it first.** Two critical medications marked SKIP from the rail showed as skipped
in the UI while their rungs kept firing every five minutes: a web resolve goes
straight to Supabase, so the device never heard and `pending_retries` was never
cancelled. `resolveReminderEvent` now reports every web answer over the bridge
(`doseResolved`), through the same choke point a notification tap uses.

**2c — a caregiver answers remotely.** Let B ring, then resolve that dose from a
DIFFERENT device or browser. Nothing on the phone was involved, so nothing told
it. Then bring the app to the foreground.

**Pass, all three:**
- No further rungs. Nothing at +2 or +3.
- logcat: `retry ladder cancelled for med N -- the dose was answered`, followed by
  an `EXACT alarm registered` for the **next dose**. That second line matters:
  a live rung occupies the medication's only alarm slot, so cancelling without
  rescheduling would leave it silent until the next sync.
- No sticky appears.

**2b also expects** `doseResolved: mirrored 1 of 1 server-side answer(s)` in
logcat. If `retry ladder cancelled` appears without it, the ladder died for some
other reason and the fix is not proven.

**2c also expects** `[ScheduleSync] cancelled 1 retry ladder(s) for dose(s)
already answered elsewhere` in the **webview console** (`chrome://inspect`),
followed by the same `retry ladder cancelled` line in logcat. Honest bound: this
only runs when the app is opened — until then the phone keeps re-asking, for at
most the ladder's ≤30 minutes. That is the accepted cost of never polling.

## 3 · Airplane-mode rungs — **med B**

1. Airplane mode **on**. Force-stop the app.
2. Let B's dose time pass.

**Pass:** all three rungs still ring. The ladder is `AlarmManager`, not network.
Answer one; it queues. Turn airplane mode off and expect
`synced 1 queued dose action(s)`.

## 4 · Reboot mid-ladder — **the one that was a known gap**

1. Let B ring. Wait for the **+1 rung**.
2. **Reboot the phone.** Do not open the app afterwards.

**Pass:** the remaining rung still fires. logcat after boot shows
`rescheduleAll` and `retry ladder rebuilt after boot ... next rung +Nmin`.

**Then the harder half:** repeat, but stay powered off past the whole ladder
(easy with B — 3 minutes). On boot expect **no ring**, and the sticky posted
instead. Rungs whose moment passed are discarded, never fired late — an alarm
for a dose from an hour ago is startling and ambiguous.

## 5 · Escalation only after the window

With A (window = **+15**), let the whole ladder run out and leave the dose
unanswered.

**Pass:** the care-circle escalation arrives **after** +15, not during the
ladder. The patient must never be politely re-asked at +10 while their caregiver
has already been told they missed it.

> The 30-minute cap exists exactly for this: the server clamps its escalation
> anchor at `created_at + 30`, so any ladder that fits under the cap finishes
> before escalation can pre-empt it.

## 6 · Snooze suspends, it does not race — **med B**

Let B ring, tap **Snooze 10 min** on the first ring.

**Pass:**
- **No rungs at +1, +2, +3.** The ladder is suspended, not running alongside.
- The snooze re-prompt arrives ~10 min later.
- logcat shows the snooze re-fire carrying **the original dose instant**.
- After the re-prompt, if still unanswered, a **fresh** ladder starts.

## 7 · The focused list — **the acceptance test**

Meds **A** and **D** already share a reminder time. Add two more at that same
time so **four doses land on one instant** — the scenario the rewrite exists for,
and the one that failed on 2026-08-14 with two doses fighting for the full screen
while the other two sat as notifications nobody opened.

**Set the ring window to 1 minute first** (Settings → Notifications → "How long
each alarm rings"), or 7c takes four minutes per run.

**7a — the ring itself.** Let the shared time pass with the phone **locked**.

**Pass:**
- **ONE** notification, not four. Title reads **"Time for 4 medicines"**;
  expanding it lists all four by name.
- **ONE** full-screen alarm screen. All four doses are listed; the FIRST one is
  focused — bigger, accent-bordered, with Taken / Skip. The other three show
  **Waiting**.
- logcat: one `notification <id> posted for 4 dose(s) due <T>` and one
  `coalesced 4 doses due <T> into one notification`. **The same notification id
  for all four** — a second id means the grouping did not take.

**7b — focus advances on an ANSWER.** Tap **Taken** on the focused dose.

**Pass:**
- Its row turns to `✓ Taken` and **stays on screen**; the next dose becomes
  focused and starts its own ring window.
- The notification narrows to the three still outstanding.
- Answer the rest: the last one shows **All done** and the screen closes itself.

**7c — focus advances on a TIMEOUT.** Repeat 7a and answer nothing.

**Pass:**
- After the ring window, the focused dose becomes **Not answered** and the NEXT
  dose takes focus and rings. logcat:
  `med N rang 60s with no answer — yielding to med M`.
- This repeats through all four, then the screen closes.
- A missed notice for **4 medicines**, and every ladder still running — yielding
  is not an answer, and nothing was recorded for any of them.
- Now repeat answering only the first two: the missed notice must name **2**, not
  four.

**7d — tap to jump the queue.** During 7a, tap the LAST dose in the list.

**Pass:** it becomes focused immediately with a fresh ring window; the one that
was focused goes back to **Waiting**. Answer it, and focus returns to the first
unanswered dose. Also tap a dose that already shows **Not answered** — it must
take focus again rather than being a dead row.

**7e — a rung arrives mid-presentation.** Use med **B** (1 × 3) as one of the
four, and let its rung fire while the screen is still working through the list.

**Pass:** no second notification and no second screen. The rung gives med B the
focus, and the list still shows exactly the still-unanswered doses — anything
already answered stays `✓`, and is not asked again. logcat:
`a rung for med N arrived mid-screen; giving it the focus`.

**7f — elderly is one question at a time.** Turn on elderly mode, **re-open the
app once** so `syncSchedule` carries the flag (look for `elderly=true` on the
`AlarmActivity shown` line), then repeat 7a.

**Pass:**
- **ONE** dose on screen at the original large size, with `1 of 4` under the time.
  No list.
- Answering shows the confirmation, then the next dose appears. Timing out
  advances the same way.
- Settings → Notifications shows the ring-duration control but **not** the
  "Notification style" pickers — elderly sees the result, not the file browser.

**7g — the single-dose alarm has NOT regressed.** Let med **C** ring on its own.

**Pass:** identical to what you signed off on 2026-08-11 — big centred name,
full-width `Taken`, `Skip` beneath it, `Snooze` smallest, and the buttons **low on
the screen**. This is the regression risk of the whole rewrite: the single dose
now renders through the same list the group does. If the buttons have drifted
upward or the name has shrunk, report it before anything else.

---

## 8 · Alarm media — picture and sound

Settings → Notifications → **Notification style**. All of this is device-local;
none of it touches Supabase.

**8a — the three bundled images.** Choose each of Sunrise / Daylight / Night and
let an alarm ring on each.

**Pass:** the image fills the screen behind the dose, and **Taken / Skip / Snooze
stay clearly readable on all three**. The buttons keep their own solid fills, so
if any of them is hard to read against a backdrop, that is a real bug — report
it.

**8b — a photo from the gallery.** Choose photo, pick one, let an alarm ring.
**Then delete that photo from the gallery** and let another alarm ring.

**Pass:** the alarm still shows it. The file was copied into app storage at pick
time, which is the whole point — if it vanishes, the copy did not happen.

**8c — airplane mode.** Turn airplane mode on, force-stop the app, let an alarm
ring.

**Pass:** picture shows, custom sound plays. This is the proof that nothing is
fetched at fire time.

**8d — a custom sound.** Choose a sound file, let an alarm ring, then switch back
to **Default tone**.

**Pass:** the chosen sound replaces the alarm tone and loops; Default tone
restores the system alarm sound. In a four-dose handful it is **one sound for the
whole screen** — it must not restart as the focus moves down the list.

**8e — a very large photo.** Pick the biggest image on the phone.

**Pass:** the alarm shows it without crashing. Images are decoded downsampled
precisely because a full-size modern phone photo is an OutOfMemoryError on this
screen.

---

## If something fails

Grab the window around it — `AlarmScheduler` logs every decision with the
medication id and the dose instant:

```
adb logcat -s AlarmScheduler:* -v time > ladder.txt
```

The three lines worth reading first: `retry ladder started`, `advanced`, and
`for the dose due <T>` — if that last timestamp ever changes within one ladder,
that is the bug to report before anything else.
