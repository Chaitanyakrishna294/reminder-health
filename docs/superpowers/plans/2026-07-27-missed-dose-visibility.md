# Missed-Dose Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make missed doses impossible to overlook: the "Did you take it?" gate also asks about missed/unreviewed doses (present doses first, missed backlog after, with a one-by-one / all-at-once view toggle), a red strip pins missed doses to the very top of the dashboard, and the hero card always shows the missed state when one exists.

**Architecture:** One pure helper (`dose-attention.ts`) becomes the single source of truth for "pending" vs "attention" (missed) statuses and for gate-queue ordering; the gate, the new strip component, and the hero selection all consume it. All resolution flows through the existing `resolve_reminder_event` RPC via `resolveReminderEvent()` — no DB changes.

**Tech Stack:** Next.js 16 App Router (web/), React 19, TS strict, Tailwind v4 semantic tokens, node:assert bare test scripts.

**Spec:** `docs/superpowers/specs/2026-07-27-missed-dose-visibility-design.md` (approved 2026-07-27).

## Global Constraints

- Web app only (`web/src`). **No DB migration. No worker (`src/`) changes. No service-worker changes.**
- Attention statuses (exact): `MISSED`, `PENDING_REVIEW`, `UNCONFIRMED`.
- Gate queue order: due-now pending doses first (ascending `scheduled_for`), then attention doses (ascending). Snooze filter applies to the **gate queue only** — never the strip or hero.
- Gate view toggle: `One by one` (default every time the gate appears; session-local state) / `All at once`; toggle visible only when queue length > 1. **No bulk "mark all" button** — one tap per dose.
- Missed-mode gate copy (exact): headline "You missed your <drug>", question "Did you take it?", buttons "Yes, I took it late" / "No, I missed it" / "Ask me later".
- Strip: `role="alert"`, danger tokens, no dismiss affordance, renders in elderly AND normal AND caregiver-monitor views, first element inside the page container.
- Elderly mode: larger type/touch targets via `useUiMode().isElderly` (existing pattern).
- Dashboard nav untouched (5-icon hard rule). moment-timezone untouched.
- Next 16 caution (web/AGENTS.md): these changes are all client components + a pure lib module — no new framework APIs. If a framework question comes up, check `web/node_modules/next/dist/docs/` first.
- Commits: small, one per task, message style `feat(web): …` / `test(web): …`. Do NOT push or deploy; the maintainer deploys from repo root.

**Existing interfaces you will consume (already in the codebase):**

- `resolveReminderEvent({ supabase, eventId, medicationId, scheduledFor, action: 'TAKEN'|'SKIP', actorRole: 'PATIENT'|'CAREGIVER' })` from `web/src/lib/reminder-events.ts` — handles virtual events (`eventId <= 0` → passes null; RPC creates the row) and returns `{ reminder_status, already_resolved, … }`.
- `ReminderEvent` interface from `web/src/components/dashboard/todays-schedule.tsx:14-29` — `{ id, medication_id, telegram_id, scheduled_for, reminder_status, snooze_count, medications: { drug_name, dosage, priority_level, unit_type?, dosage_amount?, medication_reason? } }`.
- `useUiMode()` from `@/context/ui-mode-context` — `{ isElderly, viewMode }`.
- `getUnitIcon(unitType, className)` from `@/components/ui/custom-icons`.
- Tailwind semantic tokens: `danger`, `success`, `success-foreground`, `card`, `border`, `muted`, `muted-foreground`, `foreground`, `primary`, `primary-foreground`.

---

### Task 1: `dose-attention` pure helper + node test

**Files:**
- Create: `web/src/lib/schedule/dose-attention.ts`
- Test: `web/src/lib/schedule/dose-attention.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (later tasks rely on these exact names):
  - `interface DoseLike { id: number; scheduled_for: string; reminder_status: string }`
  - `ATTENTION_STATUSES: readonly string[]`, `PENDING_STATUSES: readonly string[]`
  - `isAttentionStatus(status: string): boolean`, `isPendingStatus(status: string): boolean`
  - `partitionDoseAttention<T extends DoseLike>(events: T[]): { attention: T[]; pending: T[] }` — both sorted ascending by `scheduled_for`
  - `buildGateQueue<T extends DoseLike>(events: T[], nowMs: number, snoozedUntil: Record<number, number>): T[]` — due-now pending first, then attention, snoozed ids filtered out

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/schedule/dose-attention.test.ts`:

```ts
// Self-contained check for the missed-dose attention partition. No framework:
//   node --experimental-strip-types src/lib/schedule/dose-attention.test.ts
// Fails loudly (non-zero exit) if any invariant breaks.
import assert from 'node:assert';
import {
  isAttentionStatus,
  isPendingStatus,
  partitionDoseAttention,
  buildGateQueue,
} from './dose-attention.ts';

const ev = (id: number, iso: string, status: string) => ({
  id,
  scheduled_for: iso,
  reminder_status: status,
});
const NOW = new Date('2026-07-27T12:00:00.000Z').getTime();

// ── Status classification ──
// Attention = the missed backlog the user must be confronted with.
for (const s of ['MISSED', 'PENDING_REVIEW', 'UNCONFIRMED']) {
  assert.equal(isAttentionStatus(s), true, `${s} should be attention`);
  assert.equal(isPendingStatus(s), false, `${s} must NOT be pending`);
}
// Pending = still on its normal path (virtual + real fired-but-unresolved).
for (const s of ['FUTURE_SCHEDULED', 'SENT', 'GENTLE_REMINDER', 'ESCALATED', 'SNOOZED']) {
  assert.equal(isPendingStatus(s), true, `${s} should be pending`);
  assert.equal(isAttentionStatus(s), false, `${s} must NOT be attention`);
}
// Resolved doses belong to neither bucket.
for (const s of ['TAKEN', 'SKIPPED', 'RESOLVED_BY_CG']) {
  assert.equal(isAttentionStatus(s), false);
  assert.equal(isPendingStatus(s), false);
}

// ── partitionDoseAttention: buckets + ascending sort, resolved dropped ──
const mixed = [
  ev(1, '2026-07-27T11:00:00.000Z', 'SENT'),            // due (pending, past)
  ev(2, '2026-07-27T08:00:00.000Z', 'MISSED'),          // attention, older
  ev(3, '2026-07-27T15:00:00.000Z', 'FUTURE_SCHEDULED'), // pending, future
  ev(4, '2026-07-27T06:00:00.000Z', 'PENDING_REVIEW'),  // attention, oldest
  ev(5, '2026-07-27T07:00:00.000Z', 'TAKEN'),           // resolved → neither
];
const { attention, pending } = partitionDoseAttention(mixed);
assert.deepEqual(attention.map(e => e.id), [4, 2]); // oldest first
assert.deepEqual(pending.map(e => e.id), [1, 3]);   // ascending
assert.equal([...attention, ...pending].some(e => e.id === 5), false);

// ── buildGateQueue: present doses first, missed backlog after ──
// Even though the MISSED doses are OLDER, the due-now pending dose leads —
// it is the dose the user opened the app for.
assert.deepEqual(buildGateQueue(mixed, NOW, {}).map(e => e.id), [1, 4, 2]);

// Future pending doses never enter the queue.
assert.equal(buildGateQueue(mixed, NOW, {}).some(e => e.id === 3), false);

// ── Snooze filter: suppressed while active, back after expiry ──
assert.deepEqual(
  buildGateQueue(mixed, NOW, { 1: NOW + 60_000 }).map(e => e.id),
  [4, 2],
  'actively snoozed dose is suppressed'
);
assert.deepEqual(
  buildGateQueue(mixed, NOW, { 1: NOW - 1 }).map(e => e.id),
  [1, 4, 2],
  'expired snooze no longer suppresses'
);

// ── Empty input ──
assert.deepEqual(partitionDoseAttention([]), { attention: [], pending: [] });
assert.deepEqual(buildGateQueue([], NOW, {}), []);

console.log('dose-attention: all assertions passed');
```

- [ ] **Step 2: Run test to verify it fails**

From `web/`:
```bash
node --experimental-strip-types src/lib/schedule/dose-attention.test.ts
```
Expected: FAIL — `Cannot find module ... dose-attention.ts` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/schedule/dose-attention.ts`:

```ts
// Single source of truth for which dose statuses are "pending" (normal path)
// vs "attention" (missed backlog that must be surfaced), and for the med-due
// gate's question order. Consumed by the gate queue, the top-of-dashboard
// missed strip, and the hero-card selection so all three surfaces agree.
// Structural typing on purpose: works for any event shape with these keys.

export interface DoseLike {
  id: number;
  scheduled_for: string;
  reminder_status: string;
}

/** A dose that slipped past the user and needs an explicit answer. */
export const ATTENTION_STATUSES: readonly string[] = ['MISSED', 'PENDING_REVIEW', 'UNCONFIRMED'];

/** A dose still on its normal path: scheduled, or fired but not yet resolved. */
export const PENDING_STATUSES: readonly string[] = [
  // Client-side virtual / legacy states
  'PENDING_PATIENT', 'RETRYING_PATIENT', 'SNOOZED', 'ESCALATED_TO_CG', 'FUTURE_SCHEDULED',
  // Real reminder_events statuses for a fired-but-unresolved dose
  'SENT', 'DISPLAYED', 'OPENED', 'GENTLE_REMINDER', 'REMINDED', 'RETRYING',
  'ESCALATED', 'CAREGIVER_ACKNOWLEDGED',
];

export const isAttentionStatus = (status: string): boolean => ATTENTION_STATUSES.includes(status);
export const isPendingStatus = (status: string): boolean => PENDING_STATUSES.includes(status);

/**
 * Split events into the missed backlog and the normal pending set, each
 * ascending by scheduled time. Resolved doses (TAKEN/SKIPPED/…) land in neither.
 */
export function partitionDoseAttention<T extends DoseLike>(
  events: T[],
): { attention: T[]; pending: T[] } {
  const byTimeAsc = (a: T, b: T) =>
    new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime();
  return {
    attention: events.filter(e => isAttentionStatus(e.reminder_status)).sort(byTimeAsc),
    pending: events.filter(e => isPendingStatus(e.reminder_status)).sort(byTimeAsc),
  };
}

/**
 * The gate's question queue: due-now pending doses first (the dose the user
 * most likely opened the app for), THEN the missed backlog, oldest first.
 * Snoozing ("ask me later") suppresses a dose here only — never in the strip.
 */
export function buildGateQueue<T extends DoseLike>(
  events: T[],
  nowMs: number,
  snoozedUntil: Record<number, number>,
): T[] {
  const { attention, pending } = partitionDoseAttention(events);
  const dueNow = pending.filter(e => new Date(e.scheduled_for).getTime() <= nowMs);
  return [...dueNow, ...attention].filter(
    e => !(snoozedUntil[e.id] && nowMs < snoozedUntil[e.id]),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

From `web/`:
```bash
node --experimental-strip-types src/lib/schedule/dose-attention.test.ts
```
Expected: `dose-attention: all assertions passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/schedule/dose-attention.ts web/src/lib/schedule/dose-attention.test.ts
git commit -m "feat(web): dose-attention partition helper for missed-dose surfaces"
```

---

### Task 2: `MissedDoseStrip` component

**Files:**
- Create: `web/src/components/dashboard/missed-dose-strip.tsx`

**Interfaces:**
- Consumes: `resolveReminderEvent` (lib/reminder-events), `ReminderEvent` type, `useUiMode`.
- Produces: default export `MissedDoseStrip({ events, userRole, onResolved })` —
  `events: ReminderEvent[]` (attention-status only, oldest first, non-empty handling internal),
  `userRole: 'PATIENT' | 'CAREGIVER'`,
  `onResolved: (eventId: number, newStatus: string) => void`.
  Task 4 renders it in both dashboard layouts.

- [ ] **Step 1: Write the component**

Create `web/src/components/dashboard/missed-dose-strip.tsx`:

```tsx
'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { resolveReminderEvent } from '@/lib/reminder-events';
import { useUiMode } from '@/context/ui-mode-context';
import { AlertTriangle, Check, X } from 'lucide-react';
import type { ReminderEvent } from '@/components/dashboard/todays-schedule';

interface MissedDoseStripProps {
  /** Attention-status events (MISSED / PENDING_REVIEW / UNCONFIRMED), oldest first. */
  events: ReminderEvent[];
  userRole: 'PATIENT' | 'CAREGIVER';
  onResolved: (eventId: number, newStatus: string) => void;
}

/**
 * Pinned to the very top of the dashboard in every layout. No dismiss —
 * resolving each dose is the only way to clear it (snoozing the gate merely
 * defers the question, never this strip).
 */
export default function MissedDoseStrip({ events, userRole, onResolved }: MissedDoseStripProps) {
  const supabase = createClient();
  const { isElderly } = useUiMode();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [failedId, setFailedId] = useState<number | null>(null);

  if (events.length === 0) return null;

  const resolve = async (event: ReminderEvent, action: 'TAKEN' | 'SKIP') => {
    if (busyId !== null) return;
    setBusyId(event.id);
    setFailedId(null);
    try {
      const res = await resolveReminderEvent({
        supabase,
        eventId: event.id,
        medicationId: event.medication_id,
        scheduledFor: event.scheduled_for,
        action,
        actorRole: userRole,
      });
      onResolved(event.id, res.reminder_status);
    } catch (err: unknown) {
      console.error('[MissedDoseStrip] resolve failed:', err instanceof Error ? err.message : String(err));
      setFailedId(event.id);
    } finally {
      setBusyId(null);
    }
  };

  const timeStr = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      role="alert"
      className="bg-danger/5 border-2 border-danger/30 rounded-3xl p-5 space-y-3 animate-fade-in"
    >
      <h2
        className={`flex items-center gap-2 font-black text-danger tracking-tight ${
          isElderly ? 'text-2xl' : 'text-base'
        }`}
      >
        <AlertTriangle className={isElderly ? 'w-7 h-7 shrink-0' : 'w-5 h-5 shrink-0'} />
        {events.length === 1 ? '1 missed dose' : `${events.length} missed doses`}
      </h2>

      <ul className="space-y-2">
        {events.map(e => (
          <li
            key={e.id}
            className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border rounded-2xl px-4 py-3"
          >
            <div className="min-w-0">
              <p className={`font-black text-foreground truncate ${isElderly ? 'text-xl' : 'text-sm'}`}>
                {e.medications.drug_name}
              </p>
              <p className={`font-semibold text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
                {timeStr(e.scheduled_for)}
                {failedId === e.id && (
                  <span className="text-danger"> · Could not save, try again</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => resolve(e, 'TAKEN')}
                disabled={busyId !== null}
                className={`flex items-center gap-1.5 rounded-xl bg-success text-success-foreground font-black px-3 shadow-sm hover:bg-success/90 active:scale-[0.97] transition-all disabled:opacity-50 cursor-pointer ${
                  isElderly ? 'py-3 text-lg' : 'py-2 text-xs'
                }`}
              >
                <Check className="w-4 h-4" /> Took it
              </button>
              <button
                onClick={() => resolve(e, 'SKIP')}
                disabled={busyId !== null}
                className={`flex items-center gap-1.5 rounded-xl bg-card border border-border text-foreground font-black px-3 hover:bg-muted active:scale-[0.97] transition-all disabled:opacity-50 cursor-pointer ${
                  isElderly ? 'py-3 text-lg' : 'py-2 text-xs'
                }`}
              >
                <X className="w-4 h-4" /> Missed it
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

From `web/`:
```bash
npx tsc --noEmit
```
Expected: exit 0, no errors (the component compiles even though nothing imports it yet).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/dashboard/missed-dose-strip.tsx
git commit -m "feat(web): MissedDoseStrip pinned missed-dose alert component"
```

---

### Task 3: Gate v2 — missed mode, due-first queue, view toggle

**Files:**
- Modify: `web/src/components/dashboard/med-due-gate.tsx` (full rewrite below)
- Modify: `web/src/components/dashboard/dashboard-client-view.tsx:433-465` (queue construction + gate render — the call site must change in the same commit or the build breaks)

**Interfaces:**
- Consumes: `isAttentionStatus`, `buildGateQueue` from Task 1; `resolveReminderEvent`; existing `GateEvent`.
- Produces: `MedDueGate` new props — `{ queue: GateEvent[]; userRole; onResolved(eventId, newStatus); onSnooze(eventId); onSnoozeAll() }`. The old `event`/`remaining` props are GONE. Task 4 does not touch these props again.

- [ ] **Step 1: Rewrite `med-due-gate.tsx`**

Replace the entire contents of `web/src/components/dashboard/med-due-gate.tsx` with:

```tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { resolveReminderEvent } from '@/lib/reminder-events';
import { isAttentionStatus } from '@/lib/schedule/dose-attention';
import { useUiMode } from '@/context/ui-mode-context';
import { getUnitIcon } from '@/components/ui/custom-icons';
import { Check, X, Clock, Siren, AlertTriangle } from 'lucide-react';
import BrainMascot from './brain-mascot';

export interface GateEvent {
  id: number;
  medication_id: number;
  scheduled_for: string;
  reminder_status: string;
  medications: {
    drug_name: string;
    dosage?: string | null;
    dosage_amount?: number | null;
    unit_type?: string | null;
  };
}

interface MedDueGateProps {
  /** Full question queue, current dose first: due doses, then missed backlog. */
  queue: GateEvent[];
  userRole: 'PATIENT' | 'CAREGIVER';
  onResolved: (eventId: number, newStatus: string) => void;
  /** One-by-one "remind/ask me later": snooze just this dose for 30 min. */
  onSnooze: (eventId: number) => void;
  /** List view "Ask me later": snooze every queued dose for 30 min. */
  onSnoozeAll: () => void;
}

function overdueLabel(scheduledFor: string): string {
  const mins = Math.floor((Date.now() - new Date(scheduledFor).getTime()) / 60000);
  if (mins < 1) return 'due now';
  if (mins < 60) return `${mins} min overdue`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m overdue` : `${h}h overdue`;
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function MedDueGate({ queue, userRole, onResolved, onSnooze, onSnoozeAll }: MedDueGateProps) {
  const supabase = createClient();
  const router = useRouter();
  const { isElderly } = useUiMode();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [small, setSmall] = useState(false);
  // Session-local: every gate appearance starts back at one-by-one (safety default).
  const [view, setView] = useState<'one' | 'list'>('one');
  // List rows already saved, kept on screen briefly as confirmation before removal.
  const [flashIds, setFlashIds] = useState<number[]>([]);

  useEffect(() => {
    const f = () => setSmall(window.innerWidth < 420);
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);

  const event = queue[0];
  const remaining = queue.length;
  if (!event) return null;

  const missedMode = isAttentionStatus(event.reminder_status);
  const med = event.medications;
  // Keep showing the list while a saved-row confirmation is still flashing.
  const effectiveView = remaining > 1 || flashIds.length > 0 ? view : 'one';

  const answer = async (target: GateEvent, action: 'TAKEN' | 'SKIP', flash: boolean) => {
    if (busyId !== null) return;
    setBusyId(target.id);
    setError(null);
    try {
      const res = await resolveReminderEvent({
        supabase,
        eventId: target.id,
        medicationId: target.medication_id,
        scheduledFor: target.scheduled_for,
        action,
        actorRole: userRole,
      });
      if (flash) {
        setFlashIds(prev => [...prev, target.id]);
        setTimeout(() => {
          setFlashIds(prev => prev.filter(id => id !== target.id));
          onResolved(target.id, res.reminder_status);
        }, 700);
      } else {
        onResolved(target.id, res.reminder_status);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[MedDueGate] resolve failed:', message);
      setError('Could not save that. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Medication check"
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center px-6 py-10 text-center overflow-y-auto"
      style={{
        background: missedMode
          ? 'radial-gradient(120% 90% at 50% 0%, #FDE8EA 0%, #F8F9FB 55%, #FFF0EE 100%)'
          : 'radial-gradient(120% 90% at 50% 0%, #FDEEF2 0%, #F8F9FB 55%, #EAF3FF 100%)',
      }}
    >
      {remaining > 1 && (
        <span className="absolute top-6 text-xs font-mono font-bold text-muted-foreground tracking-widest">
          {remaining} doses to confirm
        </span>
      )}

      <BrainMascot
        size={
          effectiveView === 'list'
            ? (small ? 88 : 112)
            : isElderly ? (small ? 156 : 200) : (small ? 116 : 168)
        }
        mood={
          missedMode ||
          Math.floor((Date.now() - new Date(event.scheduled_for).getTime()) / 60000) >= 30
            ? 'concerned'
            : 'reminder'
        }
      />

      {/* View toggle — only when there is a queue worth batching. */}
      {remaining > 1 && (
        <div
          role="tablist"
          aria-label="Question view"
          className="mt-5 inline-flex rounded-full border border-border bg-card p-1 shadow-sm"
        >
          <button
            role="tab"
            aria-selected={effectiveView === 'one'}
            onClick={() => setView('one')}
            className={`px-4 rounded-full font-bold cursor-pointer transition-colors ${
              isElderly ? 'py-2.5 text-base' : 'py-1.5 text-xs'
            } ${
              effectiveView === 'one'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            One by one
          </button>
          <button
            role="tab"
            aria-selected={effectiveView === 'list'}
            onClick={() => setView('list')}
            className={`px-4 rounded-full font-bold cursor-pointer transition-colors ${
              isElderly ? 'py-2.5 text-base' : 'py-1.5 text-xs'
            } ${
              effectiveView === 'list'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All at once
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-center gap-2 text-danger text-sm font-semibold">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {effectiveView === 'one' ? (
        <>
          <p className={`mt-5 font-semibold text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
            {overdueLabel(event.scheduled_for)} · scheduled {fmtTime(event.scheduled_for)}
          </p>

          <h1 className={`mt-2 font-black text-foreground tracking-tight ${isElderly ? 'text-3xl' : 'text-2xl'}`}>
            {missedMode ? 'You missed your' : 'Did you take your'}
          </h1>
          <div className="mt-2 flex items-center justify-center gap-2 max-w-[90vw]">
            <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              {getUnitIcon(med.unit_type ?? undefined, 'w-5 h-5')}
            </span>
            <span className={`font-black text-primary tracking-tight truncate ${isElderly ? 'text-3xl' : 'text-2xl'}`}>
              {missedMode ? med.drug_name : `${med.drug_name}?`}
            </span>
          </div>
          {(med.dosage_amount || med.dosage) && (
            <p className={`mt-2 text-muted-foreground font-sans ${isElderly ? 'text-base' : 'text-sm'}`}>
              {med.dosage_amount ? `${med.dosage_amount} ${med.unit_type?.toLowerCase() || 'unit'}(s)` : ''}
              {med.dosage_amount && med.dosage ? ' · ' : ''}
              {med.dosage || ''}
            </p>
          )}
          {missedMode && (
            <h2 className={`mt-4 font-black text-foreground tracking-tight ${isElderly ? 'text-2xl' : 'text-xl'}`}>
              Did you take it?
            </h2>
          )}

          <div className="mt-8 w-full max-w-sm space-y-3">
            <button
              onClick={() => answer(event, 'TAKEN', false)}
              disabled={busyId !== null}
              className={`w-full flex items-center justify-center gap-2 rounded-2xl bg-success text-success-foreground font-black shadow-md hover:bg-success/90 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer ${
                isElderly ? 'py-5 text-2xl' : 'py-4 text-lg'
              }`}
            >
              <Check className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
              {missedMode ? 'Yes, I took it late' : 'Yes, I took it'}
            </button>
            <button
              onClick={() => answer(event, 'SKIP', false)}
              disabled={busyId !== null}
              className={`w-full flex items-center justify-center gap-2 rounded-2xl bg-card text-foreground border border-border font-black hover:bg-muted active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer ${
                isElderly ? 'py-5 text-2xl' : 'py-4 text-lg'
              }`}
            >
              <X className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
              {missedMode ? 'No, I missed it' : 'No, skip this dose'}
            </button>
            <button
              onClick={() => busyId === null && onSnooze(event.id)}
              disabled={busyId !== null}
              className={`w-full flex items-center justify-center gap-2 rounded-2xl text-muted-foreground hover:text-foreground font-semibold transition-all disabled:opacity-50 cursor-pointer ${
                isElderly ? 'py-3 text-lg' : 'py-2.5 text-sm'
              }`}
            >
              <Clock className="w-4 h-4" />
              {missedMode ? 'Ask me later' : 'Not yet, remind me later'}
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className={`mt-5 font-black text-foreground tracking-tight ${isElderly ? 'text-3xl' : 'text-2xl'}`}>
            Confirm your doses
          </h1>
          <p className={`mt-1 font-semibold text-muted-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
            Tap Taken or Skipped for each one.
          </p>

          <div className="mt-6 w-full max-w-md space-y-2 text-left">
            {queue.map(q => {
              const qMissed = isAttentionStatus(q.reminder_status);
              const saved = flashIds.includes(q.id);
              return (
                <div
                  key={q.id}
                  className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border rounded-2xl px-4 py-3 shadow-sm"
                >
                  <div className="min-w-0">
                    <p className={`font-black text-foreground truncate ${isElderly ? 'text-xl' : 'text-sm'}`}>
                      {q.medications.drug_name}
                    </p>
                    <p
                      className={`font-semibold ${qMissed ? 'text-danger' : 'text-muted-foreground'} ${
                        isElderly ? 'text-base' : 'text-xs'
                      }`}
                    >
                      {fmtTime(q.scheduled_for)}
                      {qMissed ? ' · missed' : ''}
                    </p>
                  </div>
                  {saved ? (
                    <span className={`flex items-center gap-1 text-success font-black ${isElderly ? 'text-lg' : 'text-sm'}`}>
                      <Check className="w-4 h-4" /> Saved
                    </span>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => answer(q, 'TAKEN', true)}
                        disabled={busyId !== null}
                        className={`flex items-center gap-1 rounded-xl bg-success text-success-foreground font-black px-3 shadow-sm hover:bg-success/90 active:scale-[0.97] transition-all disabled:opacity-50 cursor-pointer ${
                          isElderly ? 'py-3 text-lg' : 'py-2 text-xs'
                        }`}
                      >
                        <Check className="w-4 h-4" /> Taken
                      </button>
                      <button
                        onClick={() => answer(q, 'SKIP', true)}
                        disabled={busyId !== null}
                        className={`flex items-center gap-1 rounded-xl bg-card border border-border text-foreground font-black px-3 hover:bg-muted active:scale-[0.97] transition-all disabled:opacity-50 cursor-pointer ${
                          isElderly ? 'py-3 text-lg' : 'py-2 text-xs'
                        }`}
                      >
                        <X className="w-4 h-4" /> Skipped
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={() => busyId === null && onSnoozeAll()}
            disabled={busyId !== null}
            className={`mt-4 flex items-center justify-center gap-2 rounded-2xl text-muted-foreground hover:text-foreground font-semibold transition-all disabled:opacity-50 cursor-pointer ${
              isElderly ? 'py-3 text-lg' : 'py-2.5 text-sm'
            }`}
          >
            <Clock className="w-4 h-4" /> Ask me later
          </button>
        </>
      )}

      {/* Safety carve-out: the emergency card is always reachable, even mid-gate. */}
      <button
        onClick={() => router.push('/emergency')}
        className="mt-6 inline-flex items-center gap-1.5 text-xs font-bold text-danger/80 hover:text-danger transition-colors cursor-pointer"
      >
        <Siren className="w-3.5 h-3.5" /> Emergency card
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Update the call site in `dashboard-client-view.tsx`**

2a. Add to the imports block (after line 18, `import { type OverrideEntry, ... } from '@/lib/schedule/dose-engine';`):

```ts
import { isPendingStatus, isAttentionStatus, partitionDoseAttention, buildGateQueue } from '@/lib/schedule/dose-attention';
```

2b. Replace the `dueQueue` construction (currently lines 433-443):

```ts
  // "Did you take it?" gate: due/overdue, unresolved doses, shown before the dashboard.
  // Only for the patient on their own dashboard (never when a caregiver is monitoring).
  const dueQueue = (userRole === 'PATIENT' && viewMode !== 'PATIENT_MONITOR')
    ? [...events]
        .filter(e =>
          isPendingState(e.reminder_status) &&
          new Date(e.scheduled_for).getTime() <= nowMs &&
          !(snoozedUntil[e.id] && nowMs < snoozedUntil[e.id])
        )
        .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime())
    : [];
```

with:

```ts
  // "Did you take it?" gate, shown before the dashboard. Present doses first,
  // then the missed backlog (MISSED / PENDING_REVIEW / UNCONFIRMED), oldest first.
  // Only for the patient on their own dashboard (never when a caregiver is monitoring).
  const dueQueue = (userRole === 'PATIENT' && viewMode !== 'PATIENT_MONITOR')
    ? buildGateQueue(events, nowMs, snoozedUntil)
    : [];
```

2c. After the existing `handleGateSnooze` function (lines 445-452), add:

```ts
  // List view "Ask me later" — suppress every queued dose for 30 min at once.
  const handleGateSnoozeAll = () => {
    const until = Date.now() + 30 * 60 * 1000;
    setSnoozedUntil(prev => {
      const next = { ...prev };
      dueQueue.forEach(e => { next[e.id] = until; });
      try { localStorage.setItem('medGateSnoozes', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
```

2d. Replace the `dueGate` element (currently lines 453-465):

```ts
  // Reactive gate: always asks about the earliest unhandled due dose. As doses are
  // answered/snoozed (or new ones come due via the 60s clock), the queue updates live.
  const dueGate = (mounted && dueQueue.length > 0) ? (
    <MedDueGate
      event={dueQueue[0] as any}
      remaining={dueQueue.length}
      userRole={userRole}
      onResolved={(eventId, newStatus) =>
        setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, reminder_status: newStatus } : e)))
      }
      onSnooze={handleGateSnooze}
    />
  ) : null;
```

with:

```ts
  // Reactive gate: always asks about the head of the queue. As doses are
  // answered/snoozed (or new ones come due via the 60s clock), the queue updates live.
  const dueGate = (mounted && dueQueue.length > 0) ? (
    <MedDueGate
      queue={dueQueue as any}
      userRole={userRole}
      onResolved={(eventId, newStatus) =>
        setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, reminder_status: newStatus } : e)))
      }
      onSnooze={handleGateSnooze}
      onSnoozeAll={handleGateSnoozeAll}
    />
  ) : null;
```

(Note: the exact comment text above `dueQueue`/`dueGate` may differ slightly from what is in the file — match on the code, keep the replacement comments as written here. `partitionDoseAttention` and `isAttentionStatus` are imported now but first used in Task 4; if the linter flags unused imports at this commit, import only `isPendingStatus` and `buildGateQueue` here and add the other two in Task 4.)

- [ ] **Step 3: Typecheck**

From `web/`:
```bash
npx tsc --noEmit
```
Expected: exit 0. If it reports `isPendingState` unused or similar, that's Task 4's cleanup target — only fix errors, not warnings, here.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/dashboard/med-due-gate.tsx web/src/components/dashboard/dashboard-client-view.tsx
git commit -m "feat(web): med-due gate v2 - missed backlog, due-first queue, list toggle"
```

---

### Task 4: Dashboard truth — strip in both layouts, hero + counts

**Files:**
- Modify: `web/src/components/dashboard/dashboard-client-view.tsx` (five small edits; line numbers are pre-Task-3 references, match on code)

**Interfaces:**
- Consumes: `MissedDoseStrip` (Task 2), `partitionDoseAttention` / `isAttentionStatus` / `isPendingStatus` (Task 1).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Import the strip**

Add to the imports block:

```ts
import MissedDoseStrip from '@/components/dashboard/missed-dose-strip';
```

(If Task 3 deferred the `isAttentionStatus`/`partitionDoseAttention` imports, add them now.)

- [ ] **Step 2: Widen the missed count (was `MISSED` only)**

Replace (around line 398):

```ts
  const todayMissed = events.filter(e => e.reminder_status === 'MISSED').length;
```

with:

```ts
  // "Missed" for banners/mood spans the whole attention backlog, so the page
  // can't show a calm face while PENDING_REVIEW/UNCONFIRMED doses exist.
  const todayMissed = events.filter(e => isAttentionStatus(e.reminder_status)).length;
```

(`isGravityState`, `heroMood`, and the "Attention: You have missed doses" banners all derive from `todayMissed` — they pick this up automatically.)

- [ ] **Step 3: Delegate `isPendingState` and make the hero attention-first**

Replace the block from the `isPendingState` definition through the `nextPendingEvent` selection (pre-Task-3 lines 404-427):

```ts
  const isPendingState = (status: string) => {
    return [
      // Client-side virtual / legacy states
      'PENDING_PATIENT', 'RETRYING_PATIENT', 'SNOOZED', 'ESCALATED_TO_CG', 'FUTURE_SCHEDULED',
      // Real reminder_events statuses for a fired-but-unresolved dose
      'SENT', 'DISPLAYED', 'OPENED', 'GENTLE_REMINDER', 'REMINDED', 'RETRYING',
      'ESCALATED', 'CAREGIVER_ACKNOWLEDGED',
    ].includes(status);
  };
  // Surface missed/overdue doses first (a dose past its time that isn't resolved),
  // then the soonest upcoming. Falls back to nothing when all are resolved → card hides.
  const nowMs = Date.now();
  const nextPendingEvent = [...events]
    .filter(e => isPendingState(e.reminder_status))
    .sort((a, b) => {
      const aOverdue = new Date(a.scheduled_for).getTime() <= nowMs;
      const bOverdue = new Date(b.scheduled_for).getTime() <= nowMs;
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1; // overdue/missed to the top
      return new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime();
    })[0];
```

with:

```ts
  // Pending vs attention (missed backlog) is defined once in
  // lib/schedule/dose-attention.ts — shared with the gate queue and the strip.
  const isPendingState = (status: string) => isPendingStatus(status);
  const nowMs = Date.now();
  const { attention: attentionEvents } = partitionDoseAttention(events);
  // Hero: a missed dose always outranks the calm "next up" pick, so the top of
  // the page never shows a serene card while something needs attention.
  const nextPendingEvent = attentionEvents[0] ?? [...events]
    .filter(e => isPendingState(e.reminder_status))
    .sort((a, b) => {
      const aOverdue = new Date(a.scheduled_for).getTime() <= nowMs;
      const bOverdue = new Date(b.scheduled_for).getTime() <= nowMs;
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1; // overdue to the top
      return new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime();
    })[0];
```

(The normal-mode hero's red state needs no further change: `isMissed` at line 882 is `scheduled_for <= now`, which is always true for attention events.)

- [ ] **Step 4: Build the strip element and render it first in BOTH layouts**

4a. Directly after the `dueGate` element definition (end of Task 3's step 2d), add:

```ts
  // Top-of-page missed strip: renders in every layout, including caregiver
  // monitor. Resolving is the only way to clear it — snoozing the gate does
  // not hide it. (While the gate overlay is up, the strip sits behind it.)
  const missedStrip = (mounted && attentionEvents.length > 0) ? (
    <MissedDoseStrip
      events={attentionEvents}
      userRole={userRole}
      onResolved={(eventId, newStatus) =>
        setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, reminder_status: newStatus } : e)))
      }
    />
  ) : null;
```

4b. **Elderly layout** — insert `{missedStrip}` as the first child of the container (pre-Task-3 line 674):

```tsx
        <div className={`space-y-8 w-full max-w-4xl mx-auto transition-colors duration-500 ${isGravityState ? 'pb-24' : ''}`}>
          {missedStrip}
          {/* Gravity State Dimmer Backdrop (Disabled) */}
```

4c. **Normal layout** — insert `{missedStrip}` as the first child of the container (pre-Task-3 line 894):

```tsx
      <div className={`space-y-8 w-full transition-all duration-500 relative ${isGravityState ? 'gravity-active' : ''}`}>
      {missedStrip}

      {/* Push Banner */}
```

- [ ] **Step 5: Elderly "Next Medication" card shows danger for missed**

In the elderly layout's card (pre-Task-3 lines 736-740), replace the border condition:

```tsx
          <div className={`bg-card rounded-3xl p-8 border border-border shadow-sm space-y-6 ${
            nextPendingEvent?.reminder_status === 'ESCALATED_TO_CG' || nextPendingEvent?.medications.priority_level === 'critical'
              ? 'border-danger animate-red-glow bg-danger/5' 
              : 'border-primary'
          }`}>
```

with:

```tsx
          <div className={`bg-card rounded-3xl p-8 border border-border shadow-sm space-y-6 ${
            nextPendingEvent?.reminder_status === 'ESCALATED_TO_CG' ||
            nextPendingEvent?.medications.priority_level === 'critical' ||
            (nextPendingEvent && isAttentionStatus(nextPendingEvent.reminder_status))
              ? 'border-danger animate-red-glow bg-danger/5'
              : 'border-primary'
          }`}>
```

- [ ] **Step 6: Typecheck + helper test still green**

From `web/`:
```bash
npx tsc --noEmit
```
```bash
node --experimental-strip-types src/lib/schedule/dose-attention.test.ts
```
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/dashboard/dashboard-client-view.tsx
git commit -m "feat(web): missed strip pinned to dashboard top; hero and counts tell the truth"
```

---

### Task 5: Full verification + docs sync

**Files:**
- Modify: `docs/WORK_LEDGER.md` (§4: new lib module + component, one line each)

**Interfaces:** none — verification and bookkeeping.

- [ ] **Step 1: Full builds and test suites**

From `web/`:
```bash
npm run lint
```
```bash
npm run build
```
From repo root:
```bash
npm test
```
Expected: lint clean (pre-existing warnings acceptable, no NEW errors), build succeeds, all worker tests pass (no worker files were touched).

- [ ] **Step 2: Manual dev-server verification**

Start the `web` launch config (port 3001) and log in with a test account. Then:

1. Add a temporary medication with a reminder time 30+ minutes in the past (the client generates a virtual `MISSED` event after the 10-minute grace).
2. Reload `/dashboard` → the full-screen gate appears in missed mode: "You missed your <drug>" / "Did you take it?" with "Yes, I took it late" / "No, I missed it" / "Ask me later".
3. Add a second past-time reminder → gate shows "2 doses to confirm" and the One by one / All at once toggle; switch to All at once → rows with Taken/Skipped buttons; resolve one → row flashes "Saved" then disappears.
4. Tap "Ask me later" → gate closes, red missed strip is the FIRST element on the dashboard with no scrolling; hero card shows the red "Missed Medication" state.
5. Resolve from the strip → strip row disappears; when empty the strip unmounts.
6. Toggle Elderly Mode → strip appears at top with large type; Next Medication card has the red danger border for the missed dose.
7. Clean up: delete the temporary medication(s) and resolve any leftover test events.

- [ ] **Step 3: Update the work ledger**

In `docs/WORK_LEDGER.md` §4 "Key lib modules" table add:

```
| `lib/schedule/dose-attention.ts` | Pending-vs-attention (missed) status partition + gate-queue order; shared by gate, missed strip, hero; has test |
```

In the components paragraph (below the lib table), note `missed-dose-strip.tsx` alongside the other dashboard components, e.g. extend the "Big ones" sentence's surrounding text with: `missed-dose-strip.tsx` (top-pinned missed-dose alert, spec 2026-07-27).

- [ ] **Step 4: Final commit**

```bash
git add docs/WORK_LEDGER.md
git commit -m "docs: ledger entries for dose-attention helper and missed strip"
```

---

## Self-Review Notes

- **Spec coverage:** gate extension incl. due-first order and toggle → Tasks 1+3; strip in all layouts → Tasks 2+4; hero truth + widened counts → Task 4; shared helper + node test → Task 1; edge cases (idempotent resolve, virtual events, many doses, elderly) are carried by existing RPC behavior and are exercised in Task 5 step 2.
- **Deliberate deviations:** none from the spec. The spec's "resolved rows show a brief confirmation state" is the 700 ms "Saved" flash in list view.
- **Known non-goals honored:** no worker, SW, DB, nav, or moment-timezone changes anywhere in the plan.
