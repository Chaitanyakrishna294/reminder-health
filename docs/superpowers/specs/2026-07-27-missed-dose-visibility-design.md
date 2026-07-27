# Missed-Dose Visibility — Design

**Date:** 2026-07-27
**Status:** Approved by maintainer (chat, 2026-07-27)
**Scope decision:** In-app visibility fix only. Re-engagement work (push action
buttons, repeated pushes, app badge) is explicitly deferred to a future project.

## Problem

Users rarely open the app or Telegram. When they do open the web dashboard, they
see only the first viewport (the "Next Medication" hero card + compliance ring)
and do not scroll. Missed doses are rendered further down the page in the
medication timeline, so they go unnoticed and unresolved.

Root cause in code (`web/src/components/dashboard/dashboard-client-view.tsx`):

- `isPendingState()` excludes `MISSED` (client-virtual), `PENDING_REVIEW`, and
  `UNCONFIRMED`. Those statuses therefore drop out of BOTH the "Did you take
  it?" gate (`dueQueue`) and the hero card (`nextPendingEvent`).
- Result: the doses most in need of attention are exactly the ones excluded
  from the only two above-the-fold surfaces.

## Goals

1. A patient with an unresolved missed dose cannot open the dashboard without
   being asked about it.
2. If they defer, the missed dose stays visible at the very top of the page —
   zero scrolling required — until resolved.
3. The top hero card never shows a calm "Next Medication" state while a missed
   dose exists.
4. Caregivers monitoring a patient see missed doses without scrolling too.

## Non-goals

- No push/notification changes (service worker untouched).
- No Telegram/bot/scheduler changes.
- No database migration — `resolve_reminder_event` already accepts any event
  not yet TAKEN/SKIPPED (it special-cases `UNCONFIRMED` via the review-queue
  path) and creates rows for virtual events.
- No handling of doses from previous days (dashboard loads today only).
- Voice stack stays dormant.

## Design

Attention statuses (one definition, used by all three parts):
`MISSED` (client-virtual), `PENDING_REVIEW`, `UNCONFIRMED`.

### Part 1 — Gate extension (`med-due-gate.tsx` + `dashboard-client-view.tsx`)

- `dueQueue` additionally includes today's events in attention statuses,
  subject to the same 30-minute `medGateSnoozes` suppression.
- **Queue order: present doses first, missed backlog after.** Doses due now
  (pending states, `scheduled_for <= now`) come first, soonest first — the
  dose the user most likely opened the app for. Only once every present dose
  is answered does the gate move on to previously missed doses
  (attention statuses), oldest first. The "N doses to confirm" counter spans
  the whole queue.
- `MedDueGate` gets a `mode: 'due' | 'missed'` prop (derived from the event's
  status being an attention status). `missed` mode changes copy only:
  - Header: "You missed <drug> at <time>." then "Did you take it?"
  - Buttons: "Yes, I took it late" / "No, I missed it" / "Ask me later"
  - Mascot mood `concerned`, red accent instead of pink.
- **View toggle: "One by one" / "All at once"** (shown only when the queue has
  more than one dose; default is one-by-one). Covers the catch-up scenario —
  e.g. returning from a trip with 10 unlogged doses:
  - *One by one* (default): the existing detailed card — one dose, full drug
    info, big buttons. Safest for elderly users; nothing changes for them.
  - *All at once*: a compact list of every queued dose — drug name +
    scheduled time per row, with small "✓ Taken" / "✗ Skipped" buttons on
    each row. Each tap resolves that dose individually through the same RPC
    (no bulk "mark all" button — each dose gets its own deliberate tap, which
    also keeps stock math and the dose ledger honest). Resolved rows show a
    brief confirmation state, and the gate closes when the list empties.
  - Toggle choice is session-local UI state, not persisted — every gate
    appearance starts back at one-by-one.
  - In list view, "Ask me later" snoozes ALL remaining queued doses for 30
    minutes (they fall through to the missed strip, Part 2).
- Resolution path unchanged: `resolveReminderEvent` with TAKEN/SKIP,
  `actorRole: 'PATIENT'`. Patient-self view only (never PATIENT_MONITOR),
  exactly as today. Emergency-card escape hatch stays.

### Part 2 — Missed strip (new `components/dashboard/missed-dose-strip.tsx`)

- Rendered as the FIRST element of the dashboard in BOTH render paths
  (elderly layout and normal layout), and also in PATIENT_MONITOR view.
- Content: one row per attention-status event — drug name, scheduled time,
  inline "✓ Took it" / "✗ Missed it" buttons calling `resolveReminderEvent`
  (`actorRole` = 'CAREGIVER' when monitoring, else 'PATIENT').
- Danger styling (semantic `--danger` tokens), `role="alert"` so screen
  readers announce it, larger touch targets under `useUiMode().isElderly`.
- No dismiss affordance — resolving is the only way to clear it.
- Renders nothing when no attention-status events exist.
- Shows for the patient only when the gate was deferred (the gate otherwise
  resolves the queue before the dashboard is visible).

### Part 3 — Hero truth (`dashboard-client-view.tsx`)

- `nextPendingEvent` selection becomes: first attention-status event (oldest
  first) if any exist, else current pending-state logic. The hero's existing
  `isMissed` red state then renders for it (it already triggers on
  `scheduled_for <= now`).
- `heroMood`/`isGravityState` already account for `todayMissed`; extend the
  count to include `PENDING_REVIEW`/`UNCONFIRMED` so mood and the "Attention:
  You have missed doses" banner agree with the new definition.

### Shared helper

Extract the attention/pending partition into a pure function in
`web/src/lib/schedule/dose-attention.ts`:

```
partitionDoseAttention(events, nowMs) -> { attention: Event[], pending: Event[] }
```

Both the gate queue, the strip, and the hero selection consume it. The
30-minute snooze filter is applied AFTER the partition, in the gate-queue
construction only — snoozing silences the gate, never the strip or hero.
Tested with a bare node:assert script `dose-attention.test.ts` run via
`node --experimental-strip-types` (same convention as `dose-engine.ts`).

## Edge cases

- **Dose resolved elsewhere mid-session** (Telegram button, caregiver): the
  existing `onResolved` state update and 60-second re-render clock already
  reconcile; `resolve_reminder_event` returns `already_resolved: true` and the
  UI treats it as success.
- **Many missed doses:** gate shows "N doses to confirm" counter (existing)
  and offers the "All at once" list view for fast catch-up; strip lists all
  rows.
- **Virtual events** (no DB row yet): `resolveReminderEvent` passes
  `eventId: null` and the RPC creates the row — already the existing behavior
  for virtual due doses.
- **Elderly mode:** both gate (already elderly-aware) and strip scale up
  typography/touch targets.

## Testing & verification

1. `dose-attention.test.ts` — unit coverage for the partition (statuses,
   due-before-missed gate ordering, empty cases).
2. Manual dev-server verification (launch config `web`, port 3001): seed a
   missed dose, confirm gate → snooze → strip at top with no scroll →
   resolve → strip disappears; caregiver monitor view shows strip;
   hero shows red missed state.
3. `npm test` (worker) must stay green — no worker files touched.

## Risks

- `dashboard-client-view.tsx` is 86 KB; changes are additive and confined to
  the queue/hero selection expressions plus one new component import.
- Gate firing more often is intentional; "Ask me later" (30-min snooze) is the
  pressure valve.
- `PENDING_REVIEW` doses resolved via the gate write `resolution_channel`
  as today's default; no analytics depend on it currently.
