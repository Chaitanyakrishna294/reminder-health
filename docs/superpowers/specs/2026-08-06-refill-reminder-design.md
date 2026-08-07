# Refill reminder — design

**Date:** 2026-08-06
**Status:** approved, ready for implementation planning

---

## 1. Problem

`medications.stock_threshold` does not do what the app promises. The Add Medication
wizard collects it under the helper text *"You will receive an alert when stock reaches
this amount"*, but no alert reads it:

| Site | Rule today |
|---|---|
| `src/scheduler.js:709` — bot's 09:00 low-stock cron | `daysOfStockLeft(med) <= 3` |
| `web/src/app/(dashboard)/dashboard/page.tsx:98-108` | the same 3-day math, re-typed inline; does not even `select` `stock_threshold` |
| `web/src/components/medications/medication-list.tsx:283` — card badge | `current_stock <= stock_threshold` |

So there are three definitions of "low" and they disagree. The threshold the user sets
drives one badge and nothing else.

Two things are missing on top of that:

1. No refill notification reaches the web at all. The 09:00 cron sends Telegram only —
   which means **web-only users (synthetic `WEB-*` telegram ids) get no refill warning
   whatsoever**, since `bot.sendMessage` no-ops for them.
2. Doses have a full-screen "Did you take it?" gate on app open (`MedDueGate`). Refills
   have no equivalent, so a low medication is easy to scroll past.

## 2. Goals

- Alert when `current_stock <= stock_threshold`, with `daysOfStockLeft <= 3` as a backup.
- Deliver via web push, the in-app bell, and a warning strip pinned to the dashboard —
  alongside the existing Telegram message.
- A refill gate on app open, offering "add stock now" and "remind me tomorrow".
- Collapse the three definitions of "low" onto one.

**Non-goals:** immediate (sub-daily) alerting; caregiver fan-out notifications (the 21:30
caregiver summary already mentions low stock); cross-device snooze state.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Trigger | `stock <= threshold` OR `daysLeft <= 3` | The threshold is what the UI promises; the days backup catches a threshold too small to give real warning (e.g. threshold 2 on a 4-doses-a-day medication is half a day) |
| Detection | Daily 09:00 cron for push/Telegram; **UI reads live** | No new state, no migration for detection, and the app shows the truth the moment it opens even before the cron has run |
| Repeat | Once per crossing | Threshold alerts fire far earlier than the old 3-day rule; a threshold of 10 on a once-daily med would otherwise be 10 consecutive identical pushes, and people who are nagged stop reading |
| Re-arm | Clear the flag on **any stock increase** | See §5 — re-arming on "crossed back above threshold" is unexpressible in SQL for the days-left backup without duplicating burn math |
| Gate snooze | Until tomorrow (next local midnight) | A refill is a pharmacy trip; the dose gate's 30 min would re-ask before anyone could act, which trains people to dismiss it |
| Strip after snooze | Stays | Snoozing defers the interruption, not the fact. Matches `MissedDoseStrip` |
| Caregiver in monitor mode | Sees the gate | The caregiver is often the person who actually goes to the pharmacy |
| Architecture | Shared predicate module, mirrored bot↔web | Keeps burn math in JS where `test/reminders.test.js` already tests it; a SQL view would move it somewhere untestable |

## 4. The predicate

One function, mirrored: `src/reminders.js` (bot) and `web/src/lib/medications/stock.ts` (web).

```
isLowStock(med) -> { low, reason, stock, daysLeft, threshold }

stock = med.current_stock ?? med.tablet_count
if (!med.active)                                    -> { low: false }
if (!med.low_stock_alert_enabled || stock == null)  -> { low: false }   // tracking off
if (threshold != null && stock <= threshold)        -> { low: true, reason: 'threshold' }
if (daysOfStockLeft(med) <= 3)                      -> { low: true, reason: 'days' }
                                                    -> { low: false }
```

`daysOfStockLeft` is unchanged. `reason` exists so copy can be honest — *"4 tablets left,
you asked to be warned at 4"* and *"about 2 days left"* are different sentences, and one
generic string would be wrong half the time.

All three sites in §1 collapse onto this. Note `dashboard/page.tsx` must start selecting
`stock_threshold` and `active`.

### Edge cases

| Case | Behaviour |
|---|---|
| Tracking off / stock null | Never low, never gated |
| `stock_threshold` null, tracking on | Days-left backup only (bot-created meds can have null) |
| Stock is 0 | Low, distinct copy: "Out of {name}", not "running low" |
| Paused medication (`active = false`) | Excluded. The cron already filters this; **the web currently does not** — without it a paused med would gate forever |
| `stock_threshold` = 0 | Legal — warn only at empty |

## 5. Alert pipeline

The existing 09:00 cron (`scheduler.js:688`) keeps its shape and gains:

1. Condition → `isLowStock(med).low`.
2. Guard → skip if `low_stock_notified_at IS NOT NULL` (one alert per crossing).
3. On send → existing Telegram message **plus** `sendBrowserPush(...)` **plus** a
   `notifications` row (`type: 'LOW_STOCK'`) for the bell. All three go to the **patient
   who owns the medication** — `notifications.user_id` is the patient's profile id,
   resolved from `medications.telegram_id` the same way `sendBrowserPush` already does.
   No caregiver fan-out (§2 non-goals).
4. Stamp `low_stock_notified_at = now()`.

### Re-arming

The flag must clear when the user restocks. Doing it in application code means every
current and future write path has to remember; doing it where stock actually changes —
the existing `handle_reminder_event_taken_stock_reduction` trigger and its siblings —
covers web refill, bot "Bought", and caregiver edits with no JS site to forget.

**Condition: `NEW.current_stock > OLD.current_stock`** — i.e. any increase, not "crossed
back above the threshold". Threshold-crossing is unexpressible in SQL for an alert raised
by the days-left backup (there is no threshold to cross), and expressing it would require
`dosesPerDay` in SQL — the untestable duplication this design exists to avoid. "You bought
more, so you are eligible to be warned again next time you get low" is also simply
correct: someone who adds one tablet and is still low *should* hear again tomorrow.

## 6. UI

### `<RefillGate>` — full screen, modelled on `MedDueGate`

- **The dose gate always wins.** Renders only when `dueQueue.length === 0`. A dose due now
  is time-critical; a refill is not, and stacking two full-screen gates teaches people to
  tap past both.
- **List, not one-by-one.** `MedDueGate` asks individually because each answer is a
  separate medical fact. A refill is one pharmacy trip, so all low meds show together,
  each with an inline amount input.
- Footer **"Remind me tomorrow"** → next local midnight into
  `localStorage.refillGateSnoozedUntil`, mirroring the existing `medGateSnoozes` pattern.
  **One snooze covers every low medication**, not one per med — the whole point is a
  single pharmacy trip, and per-med snoozes would re-gate the user the moment a second med
  went low. Auto-closes once every med is topped up.
- In `PATIENT_MONITOR` the gate keys off the **monitored patient's** medications, not the
  caregiver's own.

### `<RefillStrip>` — pinned top, modelled on `MissedDoseStrip`

- Not dismissible. `warning` tone per `docs/DESIGN_SYSTEM.md` (orange = actionable
  warning; `danger` red is reserved for a missed dose).
- One row per med: name, `4 tablets left`, and the reason.
- Renders in **every layout including caregiver monitor mode**, like `MissedDoseStrip`.
  It sits below `MissedDoseStrip` when both are present: a missed dose outranks a refill.

### One stock-write path

Two already exist: `submitRefill` (dashboard inventory card) and `openStockModal`
(medication list). A third for the gate would repeat exactly the mistake that produced
three definitions of "low". Extract into `web/src/lib/medications/add-stock.ts`; point all
call sites at it.

### Caregiver honesty

The gate now shows in monitor mode, so it must handle a caregiver who cannot act. Adding
stock is a medication write gated by `can_edit_medications`. Without that permission the
caregiver sees the medication and the count but gets *"Ask {patient} to refill"* rather
than an input that would silently fail on RLS.

Both components branch on `isElderly` and use the `-strong` text tokens
(`docs/DESIGN_SYSTEM.md`).

## 7. Migration

Hand-applied by the maintainer in the Supabase SQL editor (repo hard rule — never applied
by an agent). `db/migrations/migration_refill_reminder.sql` + rollback + validation:

1. `ALTER TABLE medications ADD COLUMN IF NOT EXISTS low_stock_notified_at timestamptz`
2. Extend `notifications_type_check` to include `'LOW_STOCK'` (current list in
   `migration_5.7b_escalation_outcomes_ddl.sql:90`)
3. Extend the stock trigger function to clear `low_stock_notified_at` on any increase

## 8. Failure modes

- No VAPID / no push subscription → `sendBrowserPush` already no-ops; bell row and
  Telegram still send.
- Web-only users (`WEB-*`) get no Telegram — push and the bell are their only channels.
  This is the main argument for adding them.
- Render free tier pauses at month-end → the 09:00 cron does not fire, but the gate and
  strip read live data, so the in-app experience degrades to "you find out when you open
  the app" rather than failing.
- Snooze is `localStorage`, so "remind me tomorrow" on the phone does not silence the
  tablet. Same limitation `MedDueGate` already has; accepted, not fixed.

## 9. Testing

- `isLowStock` unit tests in the existing `test/reminders.test.js` (node:test) covering
  every row of the edge-case table.
- **A shared JSON fixture read by both the bot test and the web mirror's test**, so the
  two implementations are proven to agree. `docs/WORK_LEDGER.md` flags mirror drift as a
  live landmine (moment-timezone); this makes drift fail the test run instead of
  misfiring a patient's reminder.
- Web mirror test run via `node --experimental-strip-types`, matching
  `web/src/lib/schedule/*.test.ts`.
- Browser verification: force a med below threshold → open app → gate appears → add stock
  → gate closes, strip clears, `low_stock_notified_at` re-arms.

## 10. Files

**New**
- `web/src/lib/medications/stock.ts` — web mirror of `isLowStock`
- `web/src/lib/medications/add-stock.ts` — single stock-write path
- `web/src/components/dashboard/refill-gate.tsx`
- `web/src/components/dashboard/refill-strip.tsx`
- `db/migrations/migration_refill_reminder.sql` (+ rollback, validation)
- `test/fixtures/low-stock-cases.json` — shared drift fixture

**Modified**
- `src/reminders.js` — add `isLowStock`
- `src/scheduler.js` — cron condition, push, bell row, `low_stock_notified_at`
- `web/src/app/(dashboard)/dashboard/page.tsx` — select `stock_threshold`/`active`, use `isLowStock`
- `web/src/components/dashboard/dashboard-client-view.tsx` — mount gate + strip
- `web/src/components/medications/medication-list.tsx` — use `isLowStock`, use `add-stock`
- `web/src/hooks/use-realtime-notifications.ts` — `'LOW_STOCK'` in the type union
- `docs/WORK_LEDGER.md` — new files, new column, new notification type
