# Retry ladder — one-evening device checklist

Everything here runs on a **vivo I2202** with the debug APK from
`android-app/android/app/build/outputs/apk/debug/app-debug.apk`.

**Before you start**, both halves must be current — `server.url` mode means the
APK and the deployed web ship separately:

- `migration_retry_ladder_2026_08_14.sql` applied ✅ (you did this)
- web deployed ✅ (`d0zwujw95`)
- fresh APK installed ← the only outstanding one

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
rail or the gate.

**Pass, both times:**
- No further rungs. Nothing at +2 or +3.
- logcat: `retry ladder cancelled for med N -- the dose was answered`, followed by
  an `EXACT alarm registered` for the **next dose**. That second line matters:
  a live rung occupies the medication's only alarm slot, so cancelling without
  rescheduling would leave it silent until the next sync.
- No sticky appears.

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

## 7 · The coalesced multi-dose ring — ⚠ NOT IN THIS BUILD

**Skip this one.** Meds A and D at the same time will currently ring as **two
separate notifications**, each with its own ladder, which is correct underneath
but is not the single grouped ring specified. See the note below.

---

## What is NOT in this APK

**The coalesced multi-dose ring.** Ladders are already independent in the
scheduler — the part your spec says must stay that way — but the *presentation*
still shows one notification per medication rather than one ring listing every
unanswered dose from that scheduled time, with per-dose answers and elderly
one-at-a-time.

I stopped short of it deliberately. It is a substantial rewrite of
`AlarmActivity` (472 lines) plus the notification builder, on the most
safety-critical screen in the product, and doing it at the tail of a long
session is how the alarm screen gets broken. Everything above is complete and
provable tonight; the ring is its own pass with its own verification.

## If something fails

Grab the window around it — `AlarmScheduler` logs every decision with the
medication id and the dose instant:

```
adb logcat -s AlarmScheduler:* -v time > ladder.txt
```

The three lines worth reading first: `retry ladder started`, `advanced`, and
`for the dose due <T>` — if that last timestamp ever changes within one ladder,
that is the bug to report before anything else.
