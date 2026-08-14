# feat(water): native nudges — inexact, low-importance, one action

> Paste this as the PR body. Open it at:
> https://github.com/Chaitanyakrishna294/reminder-health/compare/main...feat/water-native
> (`gh` is not installed on this machine, so the PR could not be opened from the CLI.)

The half deferred from the water commit. The device now nudges.

**Needs a fresh APK** — `server.url` means the two halves ship separately, and the
web half is already on production.

---

## What it does

**Inexact, and that is the hard rule.** WorkManager, not `AlarmManager`. Exact
alarms are medication-only and a glass of water does not earn one. A *chain*
rather than a `PeriodicWorkRequest`: each firing arms the next, so a re-sync moves
the pending nudge instead of stacking a second behind it, and nothing accumulates
across syncs.

**The notification is the dose notification's opposite in every respect.**
`IMPORTANCE_LOW`, silent, swipeable, auto-cancel, no full-screen intent, and ONE
action. "Taken" adds a cup; there is deliberately no Skip, because skipping water
is not an event worth recording. Ignoring it records nothing at all. If the goal
is already met the nudge silently skips — someone who has finished should not be
told about water again, and "you're done!" is a celebration nobody asked for.

**The web computes the times; native picks the next one.** The dose-clash
filtering needs the medication list and the web already has it. Duplicating that
logic is exactly how the settings preview and the phone would start disagreeing
about when reminders arrive. `WaterSchedule` is the Kotlin half of
`lib/water/hydration.ts` and mirrors `hydration.test.ts`'s cases for the same
reason.

## The one rule that looks like a contradiction

Merging counts takes the **larger** of device and server — the opposite of the
web sync's last-write-wins. Approved, and now written into CLAUDE.md next to the
other rule so a future reader does not have to re-derive it:

- **Two EDITS of one value** (this phone's row vs another phone's row) →
  **last write wins**. One is a correction; the later one is it.
- **Two INDEPENDENT TALLIES of the same day** (cups added on the notification vs
  cups added in the app) → **`max()`, on the way in only**. Neither corrects the
  other; taking the lower silently discards cups the user logged.

Undo still wins wherever it matters, because undo writes the row.

## Also in here

A standing rule for production deploys, after I ran one from a tree containing an
unreviewed commit: `--prod` only on an explicit go, or from a tree whose every
commit is approved. Otherwise a preview.

Sign-out clears hydration with everything else — one person's water must not
greet the next.

## Verification

53 native tests (14 new, including the dose-yield boundary and the never-negative
delay that would otherwise loop WorkManager), `tsc` + `next build` clean, APK
builds.

**Device-unverified.** Three things worth checking on the vivo:

1. The nudge is **swipeable and silent**. If it buzzes or cannot be swiped, the
   channel is wrong.
2. **Taken increments the tumbler** after reopening the app.
3. A nudge near a dose **does not arrive** — set a medication within 10 minutes
   of a cup time to test the yield.
