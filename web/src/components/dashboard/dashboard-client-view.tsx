'use client';


import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUiMode } from '@/context/ui-mode-context';
import { useDensity } from '@/context/density-context';
import TodaysSchedule, { ReminderEvent } from '@/components/dashboard/todays-schedule';
import WaterCard, { type WaterCardProps } from '@/components/water/water-card';
import MedicationReviewQueue from '@/components/dashboard/medication-review-queue';
import { addStock } from '@/lib/medications/add-stock';
import { registerPush } from '@/lib/push/register-push';

import { PremiumToast } from '@/components/ui/premium-toast';
import MedDueGate from '@/components/dashboard/med-due-gate';
import GuideButton from '@/components/guide/guide-button';
import GuideAutoStart from '@/components/guide/guide-auto-start';
import moment from 'moment-timezone';
import { type OverrideEntry, findOverride, occursOnWeekday, toOverrideDateStr } from '@/lib/schedule/dose-engine';
import { isPendingStatus, isAttentionStatus, partitionDoseAttention, buildGateQueue } from '@/lib/schedule/dose-attention';
import MissedDoseStrip from '@/components/dashboard/missed-dose-strip';
import RefillStrip from '@/components/dashboard/refill-strip';
import RefillGate from '@/components/dashboard/refill-gate';
import type { LowStockMed } from '@/lib/medications/stock';
import DoseStrip from '@/components/dashboard/dose-strip';
import WeekStrip, { type WeekStripDay } from '@/components/dashboard/week-strip';
import ElderlyToday from '@/components/dashboard/elderly-today';
import { dayKeyForDose, weekKeysOf, dayKeysEndingAt } from '@/lib/design/slots';
import { getUnitIcon } from '@/components/dashboard/dashboard-helpers';

import { createClient } from '@/lib/supabase/client';
import { TONE_VAR, doseTone } from '@/lib/design/semantics';
import { caregiverRoleLabel, patientRoleLabel, firstName } from '@/lib/care-circle/relationship';
import { Eyebrow } from '@/components/ui/eyebrow';
import {
  Activity,
  Package,
  AlertCircle,
  Send,
  Stethoscope,
  AlertTriangle,
  Users,
  Plus,
  CheckCircle,
  Check,
  Pill,
  X,
  Sparkles,
  Sun,
  CloudSun,
  Moon,
  SkipForward,
} from 'lucide-react';

interface DashboardClientViewProps {
  userRole: 'PATIENT' | 'CAREGIVER';
  userName: string;
  patientName: string;
  monthlyAdherence: number;
  todayTaken: number;
  todayTotal: number;
  todaySkipped: number;
  todayMissed: number;
  activeEscalations: number;
  lowStockCount: number;
  /** The last 8 days plus 24h forward. Split into today vs past days in the effect below. */
  recentEvents: ReminderEvent[];
  medications: any[];
  myTelegramChatId: string;
  targetTelegramChatId?: string;
  lowStockMedicines: LowStockMed[];
  canEditStock: boolean;
  hasPatientLinked: boolean;
  caregiverId?: string;
  lastTaken: { drug_name: string; time: string } | null;
  peopleICareFor?: any[];
  /**
   * Opt-in hydration. Threaded from the server rather than fetched in the
   * card, so a feature that is OFF for almost everyone costs nobody an extra
   * round trip on the one screen that has to paint fast.
   */
  water?: WaterCardProps;
  peopleCaringForMe?: any[];
  /** Signed avatar URLs keyed by telegram id, for members who consented to sharing. */
  careCircleAvatars?: Record<string, string>;
  avatarUrl?: string | null;
}

export default function DashboardClientView({
  userRole,
  userName,
  patientName,
  monthlyAdherence,
  todayTaken: initialTodayTaken,
  todayTotal: initialTodayTotal,
  todaySkipped: initialTodaySkipped,
  todayMissed: initialTodayMissed,
  activeEscalations: initialActiveEscalations,
  lowStockCount,
  recentEvents,
  medications,
  myTelegramChatId,
  targetTelegramChatId,
  lowStockMedicines,
  canEditStock,
  hasPatientLinked,
  caregiverId,
  lastTaken,
  peopleICareFor = [],
  water,
  peopleCaringForMe = [],
  careCircleAvatars = {},
  avatarUrl = null,
}: DashboardClientViewProps) {
  const { isElderly, toggleMode, viewMode } = useUiMode();
  /**
   * THE DENSITY SPLIT. `layout` is the table in lib/design/density.ts — read it
   * rather than comparing densities by hand here, so the whole difference
   * between browser and app stays in one readable place instead of spreading
   * into conditions scattered down a 1500-line file.
   *
   * The elderly branch below returns before any of this matters; it is its own
   * presentation, not a variant of this one.
   */
  const { layout } = useDensity();

  const [events, setEvents] = useState<ReminderEvent[]>([]);
  // Per-day schedule overrides saved by the Schedule Planner (localStorage). Applied
  // to today's generated doses so the "Next Dose" card reflects planner changes/skips.
  const [scheduleOverrides, setScheduleOverrides] = useState<OverrideEntry[]>([]);
  // Doses the user chose "remind me later" on → suppressed until this epoch ms.
  // (The 60s `currentTime` clock below re-renders, so the gate re-evaluates live.)
  const [snoozedUntil, setSnoozedUntil] = useState<Record<number, number>>({});
  // Refill gate snooze — one timestamp for ALL of the viewed patient's low
  // medications, not one per med. Mirrors the medGateSnoozes localStorage pattern;
  // per-device by design, same limitation MedDueGate already has.
  //
  // Keyed per patient (targetTelegramChatId): a caregiver monitoring two patients
  // must be able to snooze one patient's gate without silencing the other's, and a
  // caregiver's own medications (myTelegramChatId) must not be silenced by
  // snoozing a monitored patient's gate. An unqualified key would leak across both.
  const refillSnoozeKey = `refillGateSnoozedUntil:${targetTelegramChatId ?? myTelegramChatId}`;
  const [refillSnoozedUntil, setRefillSnoozedUntil] = useState(0);
  useEffect(() => {
    try {
      setRefillSnoozedUntil(Number(localStorage.getItem(refillSnoozeKey)) || 0);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refillSnoozeKey]);

  const handleRefillSnooze = () => {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0); // next local midnight
    const until = midnight.getTime();
    try { localStorage.setItem(refillSnoozeKey, String(until)); } catch { /* ignore */ }
    setRefillSnoozedUntil(until);
  };
  // Doses the resolve RPC can NEVER save (planner-shifted virtual dose, deactivated
  // med, no permission). Session-local: the gate stops re-asking them and the missed
  // strip renders them info-only, instead of an all-day "try again" loop.
  const [unresolvableIds, setUnresolvableIds] = useState<Set<number>>(new Set());
  const markUnresolvable = (eventId: number) =>
    setUnresolvableIds(prev => {
      if (prev.has(eventId)) return prev;
      const next = new Set(prev);
      next.add(eventId);
      return next;
    });
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [hoveredEvent, setHoveredEvent] = useState<ReminderEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ReminderEvent | null>(null);
  const [mounted, setMounted] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; title: string; message: string; type: 'success' | 'error' }[]>([]);
  const [showPushBanner, setShowPushBanner] = useState(false);
  const [showIosPwaBanner, setShowIosPwaBanner] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);

  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  /**
   * Which day the RAIL is showing, as a YYYY-MM-DD key. null = today, and null
   * rather than today's key on purpose: the key changes at midnight, and a user who
   * left the tab open overnight should roll onto the new day rather than stay pinned
   * to a date that has quietly become yesterday.
   */
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  /** 0 = the week containing today, -1 = last week. Never positive: the strip stops
   *  at the current week, so there is no next week to step into. */
  const [weekOffset, setWeekOffset] = useState(0);
  const searchParams = useSearchParams();

  /**
   * Deep link from a dose notification: /dashboard?day=YYYY-MM-DD.
   *
   * The URL is the source of truth, re-read whenever it changes rather than once on
   * mount. That is what makes Android back work from a deep link: back clears the
   * `day` param and the rail returns to today by itself, with no second channel
   * telling it to. A mount-only read would leave the rail stranded on the linked day
   * after the URL had already moved on.
   *
   * Validated against the key shape before use — a query string is user-editable,
   * and an unvalidated value would select a "day" matching nothing and render an
   * empty rail with no explanation.
   */
  const dayParam = searchParams.get('day');
  useEffect(() => {
    const valid = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : null;
    const t = setTimeout(() => {
      setSelectedDayKey(valid);
      setWeekOffset(0);
    }, 0);
    return () => clearTimeout(t);
  }, [dayParam]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Restore active "remind me later" snoozes so a reload doesn't bypass them.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('medGateSnoozes');
      if (raw) {
        const parsed = JSON.parse(raw) as Record<number, number>;
        const now = Date.now();
        const live = Object.fromEntries(Object.entries(parsed).filter(([, until]) => Number(until) > now));
        if (Object.keys(live).length) setSnoozedUntil(live as Record<number, number>);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setMounted(true);

    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
        (navigator as any).standalone === true;
      const dismissed = localStorage.getItem('dismissedIosPwaBanner') === 'true';

      if (isIos && !isStandalone && !dismissed) {
        setShowIosPwaBanner(true);
      }

      const dismissedWizard = localStorage.getItem('dismissedSetupWizard') === 'true';
      const isBrandNew = medications.length === 0 && peopleICareFor.length === 0 && peopleCaringForMe.length === 0;
      if (isBrandNew && !dismissedWizard) {
        setShowSetupWizard(true);
      }
    }

    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window
    ) {
      if (Notification.permission === 'granted') {
        const checkAndRefreshSubscription = async () => {
          try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            
            if (!subscription) {
              console.log('[PUSH_DIAGNOSTIC] Subscription missing on device. Re-registering...');
              await registerPush(myTelegramChatId);
            } else {
              const lastRefresh = localStorage.getItem('lastPushRefreshTimestamp');
              const lastEndpoint = localStorage.getItem('lastPushEndpoint');
              const lastPushUser = localStorage.getItem('lastPushUserChatId');
              const now = Date.now();
              const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
              
              if (
                subscription.endpoint !== lastEndpoint ||
                lastPushUser !== myTelegramChatId ||
                !lastRefresh ||
                now - parseInt(lastRefresh) > sevenDaysMs
              ) {
                console.log('[PUSH_DIAGNOSTIC] Refresh conditions met. Updating push subscription...');
                await registerPush(myTelegramChatId);
              }
            }
          } catch (err) {
            console.error('[PUSH_DIAGNOSTIC] Auto-registration check failed:', err);
          }
        };
        checkAndRefreshSubscription();
      } else {
        const dismissed = sessionStorage.getItem('dismissedPushBanner') === 'true';
        if (Notification.permission === 'default' && !dismissed) {
          setShowPushBanner(true);
        }
      }
    }
  }, []);

  const handleEnableNotifications = async () => {
    const success = await registerPush(myTelegramChatId);
    if (success) {
      showToast('Notifications Enabled', 'You will now receive medication reminders in this browser.', 'success');
      setShowPushBanner(false);
    } else {
      showToast('Error', 'Failed to register push notifications. Please check browser permissions.', 'error');
    }
  };

  const handleDismissBanner = () => {
    sessionStorage.setItem('dismissedPushBanner', 'true');
    setShowPushBanner(false);
  };

  const supabase = createClient();
  const router = useRouter();

  // Load the Schedule Planner's per-day overrides (same localStorage key the planner
  // writes: `schedule-overrides-<authUserId>`). Re-read on mount so returning from the
  // planner picks up the latest time changes / skips for the "Next Dose" card.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const raw = localStorage.getItem('schedule-overrides-' + user.id);
        if (raw) setScheduleOverrides(JSON.parse(raw));
      } catch { /* ignore malformed/absent overrides */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Generate virtual events and filter database events to the day client-side.
  // Timezone-aware: virtual events are built in each medication's own timezone (e.g.
  // Asia/Kolkata) rather than the browser's local timezone. This keeps the generated
  // scheduled_for aligned with the medication's registered reminder_times, so the
  // resolve_reminder_event RPC (which formats AT TIME ZONE med.timezone) no longer
  // throws INVALID_SCHEDULED_TIME when the browser is in a different zone (e.g. UTC).
  useEffect(() => {
    const now = new Date();
    // Planner stores overrides keyed by the date's UTC string (toISOString), so match
    // today the same way to line up with what the Schedule Planner saved.
    const todayDateStr = toOverrideDateStr(now);

    // Reference timezone, used ONLY for things that need one calendar to hang on:
    // the date row's labels and the virtual-dose generator's notion of "today".
    const refTz =
      (medications && medications.length > 0 && medications[0]?.timezone) ||
      moment.tz.guess();

    // "Is this dose today?" is asked PER MEDICATION, against that medication's own
    // clock. It used to be asked against one reference zone for the whole list, which
    // is wrong twice over: it moves every dose of a second-zone medication by hours,
    // and — the bug that actually bit — a start/end-of-day window built from moment
    // put a 01:40 Asia/Kolkata dose outside it whenever the viewer's clock disagreed.
    // dayKeyForDose compares calendar dates in the medication's zone, which is the
    // same comparison correct_reminder_event makes server-side.
    const nowIso = now.toISOString();
    const tzForMedication = (medicationId: number) =>
      medications?.find((m) => m.id === medicationId)?.timezone || refTz;
    const isToday = (e: ReminderEvent) => {
      const tz = tzForMedication(e.medication_id);
      return dayKeyForDose(e.scheduled_for, tz) === dayKeyForDose(nowIso, tz);
    };

    const dbEventsToday = recentEvents.filter(isToday);

    const generatedEvents: ReminderEvent[] = [...dbEventsToday];

    if (medications && medications.length > 0) {
      medications.forEach((med) => {
        const medTz = med.timezone || refTz;
        const localToday = moment().tz(medTz);

        // Not due today at all (dose_days null/empty = every day). Checked with
        // the weekday in the MEDICATION's timezone, which is the same boundary
        // the doses below are built on and the same one the schedulers advance
        // next_reminder_at against.
        if (!occursOnWeekday(localToday.day(), med.dose_days)) return;

        const times = (med.reminder_times || []) as string[];
        times.forEach((timeStr) => {
          const [baseH, baseM] = timeStr.split(':').map(Number);

          // Apply the Schedule Planner's override for this med today, if any:
          // skip the dose entirely, or shift it to the new wall-clock time.
          const ov = findOverride(scheduleOverrides, med.id, todayDateStr);
          if (ov?.isSkipped) return;
          let hours = baseH;
          let minutes = baseM;
          if (ov?.overriddenTime) {
            const [oh, om] = ov.overriddenTime.split(':').map(Number);
            if (!Number.isNaN(oh) && !Number.isNaN(om)) {
              hours = oh;
              minutes = om;
            }
          }

          // Build the dose moment at this wall-clock time in the medication's timezone
          const reminderMoment = moment.tz(
            {
              year: localToday.year(),
              month: localToday.month(),
              day: localToday.date(),
              hour: hours,
              minute: minutes,
              second: 0,
              millisecond: 0,
            },
            medTz
          );

          // Check if a database event already covers this med at this time today,
          // comparing hours/minutes in the medication's timezone (not browser local).
          // Planner overrides are localStorage-only — the bot still fires the real
          // event at the ORIGINAL slot time — so when an override shifted this slot,
          // a DB event at the base hh:mm covers the same physical dose too. Match
          // either time, or one dose becomes two (double-counted totals + a false
          // unresolvable "missed" twin after the real event is answered).
          const overrideShifted = hours !== baseH || minutes !== baseM;
          const eventExists = dbEventsToday.some((e) => {
            if (e.medication_id !== med.id) return false;
            const em = moment(e.scheduled_for).tz(medTz);
            const eh = em.hours();
            const emin = em.minutes();
            return (
              (eh === hours && emin === minutes) ||
              (overrideShifted && eh === baseH && emin === baseM)
            );
          });

          if (!eventExists) {
            // Keyed by the original slot (baseH/baseM) so each reminder time keeps a
            // stable, collision-free id even when shifted by an override.
            const virtualId = -(med.id * 10000 + baseH * 60 + baseM);
            // 10-minute grace period for virtual events to become MISSED
            const isPast = reminderMoment.valueOf() < now.getTime() - 10 * 60 * 1000;

            generatedEvents.push({
              id: virtualId,
              medication_id: med.id,
              telegram_id: targetTelegramChatId || myTelegramChatId || '',
              scheduled_for: reminderMoment.toISOString(),
              reminder_status: isPast ? 'MISSED' : 'FUTURE_SCHEDULED',
              snooze_count: 0,
              medications: {
                drug_name: med.drug_name,
                dosage: med.dosage || 'N/A',
                priority_level: med.priority_level || 'normal',
                unit_type: med.unit_type,
                dosage_amount: med.dosage_amount,
                medication_reason: med.medication_reason,
              },
            });
          }
        });
      });

      // Sort chronologically
      generatedEvents.sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
    }

    setEvents(generatedEvents);
  }, [recentEvents, medications, targetTelegramChatId, myTelegramChatId, scheduleOverrides]);

  // Toast Helper
  const showToast = (title: string, message: string, type: 'success' | 'error' = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  // Realtime subscription for the active patient
  useEffect(() => {
    const patientId = targetTelegramChatId || myTelegramChatId;
    if (!patientId) return;

    const channel = supabase
      .channel(`dashboard-client-realtime-${patientId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE to keep everything synchronized
          schema: 'public',
          table: 'reminder_events',
          filter: `telegram_id=eq.${patientId}`,
        },
        () => {
          // Trigger a Server Component re-fetch to pull the latest database state
          router.refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [targetTelegramChatId, myTelegramChatId, supabase, router]);

  // Dynamic calculations based on current state (timezone-safe, calculated on client)
  const todayTaken = events.filter(e => e.reminder_status === 'TAKEN' || e.reminder_status === 'RESOLVED_BY_CG').length;
  const todaySkipped = events.filter(e => e.reminder_status === 'SKIPPED').length;
  // "Missed" for banners/mood spans the whole attention backlog, so the page
  // can't show a calm face while PENDING_REVIEW/UNCONFIRMED doses exist.
  const todayMissed = events.filter(e => isAttentionStatus(e.reminder_status)).length;
  const activeEscalations = events.filter(e => e.reminder_status === 'ESCALATED_TO_CG' || e.reminder_status === 'ESCALATED').length;
  const todayTotal = events.length;

  const isGravityState = activeEscalations > 0 || todayMissed > 0;

  // Find next pending event. This must include the REAL reminder_events statuses the scheduler
  // writes once a dose fires (SENT, GENTLE_REMINDER, ESCALATED, …) — otherwise a dose vanishes
  // from "Next Medication" the moment its time arrives (when the virtual FUTURE_SCHEDULED event
  // is replaced by a real SENT row). It should stay until the patient takes or skips it.
  // Pending vs attention (missed backlog) is defined once in
  // lib/schedule/dose-attention.ts — shared with the gate queue and the strip.
  const isPendingState = (status: string) => isPendingStatus(status);
  const nowMs = Date.now();
  const { attention: attentionEvents } = partitionDoseAttention(events);
  // Hero priority: a dose due RIGHT NOW wins (it keeps its action buttons —
  // vital for caregiver-role self-users who never see the gate), then the
  // missed backlog (resolved via the strip pinned above), then the calm
  // "next up" pick. The page still can't look serene while something is
  // missed: the strip, banners, and mood all key off the attention set.
  const sortedPending = [...events]
    .filter(e => isPendingState(e.reminder_status))
    .sort((a, b) => {
      const aOverdue = new Date(a.scheduled_for).getTime() <= nowMs;
      const bOverdue = new Date(b.scheduled_for).getTime() <= nowMs;
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1; // overdue to the top
      return new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime();
    });
  const dueNowPending = sortedPending.find(e => new Date(e.scheduled_for).getTime() <= nowMs);
  const nextPendingEvent = dueNowPending ?? attentionEvents[0] ?? sortedPending[0];

  const upcomingCount = events.filter(e => isPendingState(e.reminder_status)).length;
  const activeEvent = hoveredEvent || selectedEvent;

  // ── THE DATE ROW ──────────────────────────────────────────────────────────
  //
  // Only the RAIL follows the selected day. The dose gate, the blister strip, the
  // missed-dose strip, the compliance ring and every count above stay pinned to
  // `events`, which is today. That split is the whole safety story here: CLAUDE.md's
  // never-disagree invariant is about the gate and the rail asking about the SAME
  // dose, and it holds because the gate is only ever fed today. Browsing to Tuesday
  // is archive-editing; it must not be able to make the app interrupt someone about
  // a dose from Tuesday.
  const rowRefTz =
    (medications && medications.length > 0 && medications[0]?.timezone) || moment.tz.guess();
  // `currentTime` rather than a fresh Date(): reading the clock during render is
  // impure, and this one already ticks every 60s.
  const todayKey = dayKeyForDose(currentTime.toISOString(), rowRefTz) ?? '';
  // The strip anchors on the SELECTED day, not on today plus an offset. That is what
  // lets a deep link (/dashboard?day=…) or any out-of-week selection land with its
  // own week already on screen — selecting always resets the offset to 0, so the
  // anchor and the offset can never double-apply.
  const weekAnchorKey = selectedDayKey ?? todayKey;
  const weekKeys = weekAnchorKey ? weekKeysOf(weekAnchorKey, weekOffset) : [];
  // Matches the server query's 8-day reach (app/(dashboard)/dashboard/page.tsx).
  // If that window changes, change this with it or the strip starts showing days it
  // has no data for.
  const oldestLoadedKey = todayKey ? dayKeysEndingAt(todayKey, 8)[0] : '';
  // The week you would step INTO, so the arrow disables before it lands somewhere
  // empty rather than after.
  const prevWeekEnd = weekKeys.length > 0 ? dayKeysEndingAt(weekKeys[0], 2)[0] : '';
  const currentWeekEnd = todayKey ? weekKeysOf(todayKey, 0)[6] : '';

  // Past days come straight from `recentEvents` — real reminder_events rows with the
  // status they finished in. Deliberately NOT re-projected from reminder_times: a
  // past day is a record of what happened, and projecting one would draw doses that
  // were never actually scheduled and let someone "correct" a dose that never existed.
  const pastEventsByDay: Record<string, ReminderEvent[]> = {};
  for (const e of recentEvents) {
    const tz = medications?.find((m) => m.id === e.medication_id)?.timezone || rowRefTz;
    const key = dayKeyForDose(e.scheduled_for, tz);
    if (key === null || key === todayKey) continue;
    (pastEventsByDay[key] ||= []).push(e);
  }

  /**
   * A FUTURE day is the opposite case: nothing has happened, so there is no record —
   * only the schedule's intention. Projected from `reminder_times` + `dose_days` in
   * each medication's own zone, exactly the way the Schedule Planner projects, and
   * marked FUTURE_SCHEDULED so nothing downstream mistakes it for an answerable dose.
   *
   * The ids are negative and derived from (medication, hh:mm) — the same virtual-id
   * scheme today's generator uses — so a preview row can never collide with a real
   * event id, and the RPC's no-existing-row path refuses it on the future bound.
   */
  const projectDay = (key: string): ReminderEvent[] => {
    if (!medications || !key) return [];
    const out: ReminderEvent[] = [];
    for (const med of medications) {
      const tz = med.timezone || rowRefTz;
      const at = moment.tz(`${key} 00:00`, 'YYYY-MM-DD HH:mm', tz);
      if (!occursOnWeekday(at.day(), med.dose_days)) continue;
      // A medication cannot be due before it existed — and equally, a paused one is
      // not going to fire. `medications` is already filtered to active rows.
      for (const timeStr of ((med.reminder_times || []) as string[])) {
        const [h, m] = timeStr.split(':').map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) continue;
        const when = at.clone().hour(h).minute(m).second(0).millisecond(0);
        out.push({
          id: -(med.id * 10000 + h * 60 + m),
          medication_id: med.id,
          telegram_id: targetTelegramChatId || myTelegramChatId || '',
          scheduled_for: when.toISOString(),
          reminder_status: 'FUTURE_SCHEDULED',
          snooze_count: 0,
          medications: {
            drug_name: med.drug_name,
            dosage: med.dosage || 'N/A',
            priority_level: med.priority_level || 'normal',
            unit_type: med.unit_type,
            dosage_amount: med.dosage_amount,
            medication_reason: med.medication_reason,
          },
        });
      }
    }
    return out.sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
  };

  const isViewingToday = selectedDayKey === null || selectedDayKey === todayKey;
  const isViewingFuture = !!selectedDayKey && selectedDayKey > todayKey;
  const railEvents = isViewingToday
    ? events
    : isViewingFuture
      ? projectDay(selectedDayKey!)
      : (pastEventsByDay[selectedDayKey!] ?? []);

  /**
   * DEEP LINK FROM A NOTIFICATION — `?day=…&med=…&at=…`.
   *
   * `day` alone opens the right day; these two name the DOSE, so the rail can
   * scroll that card into view and ring it. Same selection state a dose-strip
   * pocket sets, so there is one highlight mechanism rather than a second one
   * built for notifications.
   *
   * Matched on (medication_id, scheduled_for) rather than an event id because
   * that pair is what `reminder_events` is unique on, and it is the only
   * identity a notification can carry for a dose whose row may not have existed
   * when the notification was written.
   *
   * Runs when the DAY'S EVENTS ARRIVE, not just on mount: a past day is fetched
   * asynchronously, so on a cold open the target does not exist yet and a
   * mount-only effect would silently select nothing.
   */
  const medParam = searchParams.get('med');
  const atParam = searchParams.get('at');
  useEffect(() => {
    if (!medParam || !atParam) return;
    const medId = Number(medParam);
    if (!Number.isFinite(medId)) return;
    const atMs = new Date(atParam).getTime();
    if (Number.isNaN(atMs)) return;

    // Compared as instants, not strings: the URL carries whatever ISO form the
    // database emitted, and "+00:00" vs "Z" is the same moment written twice.
    const match = railEvents.find(
      (e) => e.medication_id === medId && new Date(e.scheduled_for).getTime() === atMs,
    );
    if (!match) return;

    // Guarded: without it this re-selects on every render while the params sit in
    // the URL, which would fight the user the moment they tapped a different dose.
    setSelectedEvent((prev) => (prev?.id === match.id ? prev : match));
  }, [medParam, atParam, railEvents]);

  const stripDays: WeekStripDay[] = weekKeys.map((key) => {
    const isFuture = key > todayKey;
    const dayEvents = key === todayKey ? events : isFuture ? projectDay(key) : (pastEventsByDay[key] ?? []);
    return {
      key,
      total: dayEvents.length,
      // "Open" means nobody ever answered it — the gap the strip exists to point at.
      // Meaningless for a future day, which is why the dot is suppressed there.
      open: isFuture
        ? 0
        : dayEvents.filter((e) => !['TAKEN', 'RESOLVED_BY_CG', 'SKIPPED'].includes(e.reminder_status)).length,
      isFuture,
    };
  });

  /** "Aug 15", or "Today" when the rail is on today. Mono, per the date rules. */
  const selectedLabel = isViewingToday
    ? 'Today'
    : new Date(Date.UTC(
        Number(selectedDayKey!.slice(0, 4)),
        Number(selectedDayKey!.slice(5, 7)) - 1,
        Number(selectedDayKey!.slice(8, 10)), 12,
      )).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  // "Did you take it?" gate, shown before the dashboard. Present doses first,
  // then the missed backlog (MISSED / PENDING_REVIEW / UNCONFIRMED), oldest first.
  // Only for the patient on their own dashboard (never when a caregiver is monitoring).
  const dueQueue = (userRole === 'PATIENT' && viewMode !== 'PATIENT_MONITOR')
    ? buildGateQueue(events, nowMs, snoozedUntil).filter(e => !unresolvableIds.has(e.id))
    : [];
  // "Remind me later" — suppress this dose for 30 min (persisted), then it returns.
  const handleGateSnooze = (eventId: number) => {
    const until = Date.now() + 30 * 60 * 1000;
    setSnoozedUntil(prev => {
      const next = { ...prev, [eventId]: until };
      try { localStorage.setItem('medGateSnoozes', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
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
      onUnresolvable={markUnresolvable}
    />
  ) : null;

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
      onUnresolvable={markUnresolvable}
      unresolvableIds={unresolvableIds}
    />
  ) : null;

  // Below the missed strip: a missed dose outranks a refill.
  const refillStrip = (mounted && lowStockMedicines.length > 0) ? (
    <RefillStrip meds={lowStockMedicines} canEdit={canEditStock} />
  ) : null;

  // Refill gate — only once the dose queue is empty. A dose due now is time-critical
  // and outranks a refill; two stacked full-screen gates teach people to tap past both.
  const refillGate = (
    mounted &&
    dueQueue.length === 0 &&
    lowStockMedicines.length > 0 &&
    refillSnoozedUntil <= Date.now()
  ) ? (
    <RefillGate meds={lowStockMedicines} canEdit={canEditStock} onSnooze={handleRefillSnooze} />
  ) : null;

  // "Request Caregiver Contact" (elderly mode): notifies every linked caregiver
  // via the in-app notification bell. Honest feedback either way.
  const [contactRequestSending, setContactRequestSending] = useState(false);

  // Inline stock refill from the dashboard inventory card. Same write as the
  // Medications page (current_stock += amount; a DB trigger syncs tablet_count).
  const [refillOpenId, setRefillOpenId] = useState<number | null>(null);
  const [refillAmount, setRefillAmount] = useState('');
  const [refillBusyId, setRefillBusyId] = useState<number | null>(null);
  const submitRefill = async (medId: number, currentStock: number | null | undefined) => {
    const amount = Number(refillAmount);
    setRefillBusyId(medId);
    try {
      const { newStock } = await addStock({ supabase, medicationId: medId, currentStock, amount });
      showToast('Stock updated', `Added ${amount}. Now ${newStock}.`, 'success');
      setRefillOpenId(null);
      setRefillAmount('');
      router.refresh();
    } catch (err) {
      showToast('Could not update stock', err instanceof Error ? err.message : 'Please try again.', 'error');
    } finally {
      setRefillBusyId(null);
    }
  };

  // Resolve medication for Elderly Mode giant button

  // Doses that are due right now (pending and their scheduled time has arrived). When several
  // land at the same / near time, the patient can confirm them together via "Take all" rather
  // than one-by-one.
  const dueNowEvents = [...events]
    .filter(e => isPendingState(e.reminder_status) && new Date(e.scheduled_for).getTime() <= currentTime.getTime())
    .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());

  const BATCH_SENTINEL = -99999;

  const getGreeting = () => {
    const hours = new Date().getHours();
    if (hours < 12) return 'Good Morning';
    if (hours < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const getGreetingIcon = () => {
    const hours = new Date().getHours();
    if (hours < 12) return <Sun className="w-5 h-5 text-warning animate-pulse shrink-0" />;
    if (hours < 17) return <CloudSun className="w-5 h-5 text-warning/80 shrink-0" />;
    return <Moon className="w-5 h-5 text-primary shrink-0" />;
  };

  // Was a private palette of pastel hexes — "Critical Coral" #FF9FA5 for a missed dose
  // sat right next to the brand pink, and none of the four values matched the tokens the
  // rest of the app uses for the same states. It also didn't follow dark mode.
  const getStatusColor = (status: string) => TONE_VAR[doseTone(status)];

  // ==========================================
  // ELDERLY MODE VIEW (Strictly Show ONLY: 1. Next Medication, 2. Today's Progress, 3. Low Stock Alerts)
  // ==========================================
  // ELDERLY = THE THIRD DENSITY. A presentation branch, and the distinction from the
  // parallel dashboard that used to live here matters:
  //
  //   * that one re-derived everything — its own next-dose pick, its own resolve
  //     handler, its own totals — so the week strip, the day rail, past-day
  //     correction and the deep link all landed in normal mode and reached none of
  //     it. Nobody remembers to build a thing twice.
  //   * this one computes NOTHING. Every value below was derived above, by the same
  //     code the standard view uses, and ElderlyToday resolves through the same
  //     `resolveReminderEvent` wrapper. A change to the dose rules reaches both
  //     because there is only one of them.
  //
  // Scaling the standard UI up was the wrong experience: elderly needs FEWER
  // elements, not bigger ones. Everything below this line — the strip, the rail, the
  // week nav, inventory, insights — is a thing to read before the answer appears,
  // and the screen has two seconds to make the answer obvious.
  if (isElderly) {
    return (
      <>
        {/* The gate stays: it is the same "did you take it?" question, and it is
            the one interruption that earns its place. */}
        {dueGate}
        {refillGate}
        <ElderlyToday
          events={events}
          nextPendingEvent={nextPendingEvent}
          attentionEvents={attentionEvents}
          userRole={userRole}
          readOnly={viewMode === 'PATIENT_MONITOR'}
          onEventsChange={setEvents}
          todayTaken={todayTaken}
          todayTotal={todayTotal}
        />
      </>
    );
  }

  // ==========================================
  // NORMAL MODE VIEW (Premium Apple Health Theme)
  // ==========================================
  return (
    <>
      {dueGate}
      {refillGate}
      {viewMode !== 'PATIENT_MONITOR' && (
        <GuideAutoStart tour="dashboard" accountHasData={medications.length > 0} />
      )}
      <div className={`space-y-8 w-full transition-all duration-500 relative ${isGravityState ? 'gravity-active' : ''}`}>
      {missedStrip}
      {refillStrip}

      {/* Push Banner. Browser density only — inside the app a dose alarm is a
          native AlarmManager registration, so "Enable Browser Notifications"
          would be offering a channel the app does not use, and ReliabilityCheck
          already owns the permission that DOES matter there. */}
      {layout.webPushBanner && showPushBanner && (
        <div className="bg-white/10 dark:bg-slate-900/40 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-3xl p-5 shadow-lg relative overflow-hidden flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in z-45">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-foreground flex items-center justify-center shrink-0">
              <Send className="w-5 h-5 animate-bounce" />
            </div>
            <div>
              <h4 className="text-sm font-black text-foreground">Enable Browser Notifications</h4>
              <p className="text-xs text-muted-foreground font-semibold mt-0.5">
                Get real-time alerts for your scheduled medications directly on your device.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 w-full sm:w-auto shrink-0 justify-end">
            <button
              onClick={handleEnableNotifications}
              className="px-5 py-2.5 bg-primary-strong text-primary-strong-foreground text-xs font-black rounded-full hover:scale-105 active:scale-95 transition-all shadow-md cursor-pointer w-full sm:w-auto text-center"
            >
              Enable Notifications
            </button>
            <button
              onClick={handleDismissBanner}
              aria-label="Dismiss banner"
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-full transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* iOS PWA Installation Banner */}
      {showIosPwaBanner && (
        <div className="bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-3xl p-5 shadow-lg relative overflow-hidden flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in z-45">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-foreground flex items-center justify-center shrink-0">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-black text-foreground">Add to Home Screen (iOS)</h4>
              <p className="text-xs text-muted-foreground font-semibold mt-0.5">
                To receive push reminders on iOS, install Re-MIND-eЯ: tap the <span className="font-bold text-primary">Share</span> button (box with an up arrow) and select <span className="font-bold text-primary">"Add to Home Screen"</span>.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 w-full sm:w-auto shrink-0 justify-end">
            <button
              onClick={() => {
                localStorage.setItem('dismissedIosPwaBanner', 'true');
                setShowIosPwaBanner(false);
              }}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-full transition-colors cursor-pointer"
              aria-label="Dismiss banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}



      {/* Patient Active Missed Alarm Alert (Disabled) */}

      {/* Onboarding Setup Wizard Banner */}
      {showSetupWizard && (
        <div className="bg-white border border-border rounded-[28px] p-6 shadow-md relative overflow-hidden animate-fade-in space-y-6">
          <div className="flex justify-between items-start gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-foreground flex items-center justify-center shrink-0">
                <Sparkles className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h2 className="text-base font-black text-foreground">Welcome to Re-MIND-eЯ</h2>
                <p className="text-xs text-muted-foreground font-semibold mt-1">
                  What would you like to do?
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                localStorage.setItem('dismissedSetupWizard', 'true');
                setShowSetupWizard(false);
              }}
              aria-label="Dismiss setup guide"
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/45 rounded-full transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <Link
              href="/medications"
              className="flex flex-col items-center text-center p-5 border border-border hover:border-primary/40 bg-card hover:bg-primary/[0.02] rounded-2xl cursor-pointer transition-all hover:scale-[1.02] group"
            >
              <Pill className="w-7 h-7 mb-2 text-primary group-hover:scale-110 transition-transform" />
              <span className="text-xs font-black text-foreground">Manage my medications</span>
              <span className="text-[10px] text-muted-foreground mt-1 font-semibold leading-relaxed">Add drug inventory, schedule recurring reminder times, and log intake.</span>
            </Link>

            <Link
              href="/settings"
              className="flex flex-col items-center text-center p-5 border border-border hover:border-primary/40 bg-card hover:bg-primary/[0.02] rounded-2xl cursor-pointer transition-all hover:scale-[1.02] group"
            >
              <Users className="w-7 h-7 mb-2 text-primary group-hover:scale-110 transition-transform" />
              <span className="text-xs font-black text-foreground">Invite someone to support me</span>
              <span className="text-[10px] text-muted-foreground mt-1 font-semibold leading-relaxed">Share your profile access code so family members can monitor adherence.</span>
            </Link>

            <Link
              href="/settings"
              className="flex flex-col items-center text-center p-5 border border-border hover:border-primary/40 bg-card hover:bg-primary/[0.02] rounded-2xl cursor-pointer transition-all hover:scale-[1.02] group"
            >
              <Stethoscope className="w-7 h-7 mb-2 text-primary group-hover:scale-110 transition-transform" />
              <span className="text-xs font-black text-foreground">Help care for someone else</span>
              <span className="text-[10px] text-muted-foreground mt-1 font-semibold leading-relaxed">Register your caregiver ID and link connected patient profiles.</span>
            </Link>

            <button
              onClick={() => {
                localStorage.setItem('dismissedSetupWizard', 'true');
                setShowSetupWizard(false);
              }}
              className="flex flex-col items-center text-center p-5 border border-border hover:border-primary/40 bg-card hover:bg-primary/[0.02] rounded-2xl cursor-pointer transition-all hover:scale-[1.02] group"
            >
              <SkipForward className="w-7 h-7 mb-2 text-muted-foreground group-hover:scale-110 transition-transform" />
              <span className="text-xs font-black text-foreground">Skip for now</span>
              <span className="text-[10px] text-muted-foreground mt-1 font-semibold leading-relaxed">Close this guide and explore the workspace dashboard at your own pace.</span>
            </button>
          </div>
        </div>
      )}

      {/* Welcome Header.
          Deliberately quieter than the hero card below it: a greeting is context, not
          content. It used to run a 48px avatar beside a 20px black title, which made
          "Good Morning, Priya" compete with the dose you came here to take. */}
      <div className="rise-in flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-transparent border-none shadow-none p-0">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Profile photo (falls back to initials) */}
          <div className="w-10 h-10 rounded-full bg-primary/10 text-foreground border border-primary/20 flex items-center justify-center font-mono font-black text-sm shadow-inner shrink-0 overflow-hidden">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Profile photo" className="w-full h-full object-cover" />
            ) : (
              userName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'U'
            )}
          </div>
          <div className="min-w-0">
            {/* ROUND TWO: the greeting becomes a STATEMENT. It was 18px sitting
                beside a 40px avatar, which made the first thing on the app's
                main screen its least confident element. It is still not the
                hero — the due-now dose is — but it should read as the app
                addressing you rather than as a caption. */}
            <h1 className="title-page text-foreground flex items-center gap-2">
              {getGreetingIcon()}
              <span>{getGreeting()}, {userName}</span>
              <GuideButton tour="dashboard" />
            </h1>
            <p className="text-xs text-muted-foreground font-semibold mt-1 flex items-center gap-1.5">
              {activeEscalations > 0 ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0 animate-bounce" />
                  <span>Caregiver intervention is required.</span>
                </>
              ) : todayMissed > 0 ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-warning shrink-0" />
                  <span>Attention: You have missed doses.</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-3.5 h-3.5 text-success shrink-0" />
                  <span>Your health schedule is on track today.</span>
                </>
              )}
            </p>
          </div>
        </div>
        
      </div>

      {/* Patient Monitor Summary Card */}
      {viewMode === 'PATIENT_MONITOR' && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 bg-primary/5 border border-primary/20 rounded-3xl p-6 shadow-sm animate-fade-in">
          <div className="md:col-span-1 border-b md:border-b-0 md:border-r border-primary/10 pb-3 md:pb-0 md:pr-4 flex flex-col justify-center">
            <Eyebrow as="span" className="text-primary">Patient Name</Eyebrow>
            <h3 className="text-sm font-black text-foreground mt-0.5">{patientName}</h3>
          </div>
          
          <div className="md:col-span-1 border-b md:border-b-0 md:border-r border-primary/10 pb-3 md:pb-0 md:pr-4 flex flex-col justify-center">
            <Eyebrow as="span" className="text-primary">Compliance Rate</Eyebrow>
            <h3 className="text-sm font-black text-foreground mt-0.5">{monthlyAdherence}% Adherence</h3>
          </div>

          <div className="md:col-span-1 border-b md:border-b-0 md:border-r border-primary/10 pb-3 md:pb-0 md:pr-4 flex flex-col justify-center">
            <Eyebrow as="span" className="text-primary">Last Taken Dose</Eyebrow>
            {(() => {
              const formattedLastTakenTime = mounted && lastTaken
                ? new Date(lastTaken.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';
              return (
                <h3 className="text-xs font-black text-foreground mt-0.5 truncate" title={lastTaken ? `${lastTaken.drug_name} at ${formattedLastTakenTime}` : 'None taken today'}>
                  {lastTaken ? `${lastTaken.drug_name} (${formattedLastTakenTime})` : 'None taken today'}
                </h3>
              );
            })()}
          </div>

          <div className="md:col-span-1 border-b md:border-b-0 md:border-r border-primary/10 pb-3 md:pb-0 md:pr-4 flex flex-col justify-center">
            <Eyebrow as="span" className="text-primary">Next Dose</Eyebrow>
            <h3 className="text-xs font-black text-foreground mt-0.5 truncate" title={nextPendingEvent ? `${nextPendingEvent.medications.drug_name} at ${mounted ? new Date(nextPendingEvent.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}` : 'All caught up!'}>
              {nextPendingEvent 
                ? `${nextPendingEvent.medications.drug_name} (${mounted ? new Date(nextPendingEvent.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'})`
                : 'All caught up!'}
            </h3>
          </div>

          <div className="md:col-span-1 flex flex-col justify-center">
            <Eyebrow as="span" className="text-primary">Alert Status</Eyebrow>
            <div className="mt-0.5">
              {activeEscalations > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-black text-danger bg-danger/10 border border-danger/25 px-2.5 py-0.5 rounded-full animate-pulse uppercase tracking-wider">
                  <AlertTriangle className="w-3 h-3 text-danger shrink-0" /> Escalation Active
                </span>
              ) : todayMissed > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-black text-warning bg-warning/10 border border-warning/25 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                  <AlertCircle className="w-3 h-3 text-warning shrink-0" /> Dose Missed
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-black text-success bg-success/10 border border-success/25 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                  <Check className="w-3 h-3 text-success shrink-0" /> Routine On Track
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The hero "Next Medication" card stood here until the day rail replaced it
          (redesign §03). It and the rail's due-now card asked the same question
          about the same dose, stacked one above the other; the rail keeps it, and
          the `dash-next-med` tour anchor moved onto the rail's due-now card.

          Compliance + Care circle shared that row and have moved down into the
          workspace column. They could not simply stay: with the hero gone they
          would have become the FIRST thing on a phone, which is the exact fault
          the old `order-first` had — an abstract donut above the dose you opened
          the app to take. Today leads now, and Care circle still sits right under
          it rather than ~1500px down. */}

      {/* Replaced the four Morning/Afternoon/Evening/Night tiles. Those spent ~78px of
          the phone's first screen on one word per quarter-day, and they AGGREGATED —
          three morning doses collapsed into a single "Still due", so the tile could not
          tell you which one you had missed. The strip shows every dose individually, in
          time order, and each pocket is a real touch target. */}
      <div className="rise-in" style={{ ['--rise-delay' as string]: '120ms' }}>
        <DoseStrip
          events={events}
          mounted={mounted}
          now={currentTime.getTime()}
          selectedId={selectedEvent?.id ?? null}
          onSelect={(event) =>
            setSelectedEvent((prev) => (prev?.id === event.id ? null : event))
          }
        />
      </div>

      {/* Main Workspace Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Layer 2: Today's Medication Timeline (Main Content Zone).
            Takes the full twelve columns once the side column is gone, rather
            than leaving four columns of whitespace beside it on a tablet. */}
        <div
          data-tour="dash-today"
          className={`rise-in space-y-6 ${layout.sideColumn ? 'lg:col-span-8' : 'lg:col-span-12'}`}
          style={{ ['--rise-delay' as string]: '180ms' }}
        >
          {/* "Manage Inventory" used to sit here as a solid-pink button, the loudest
              control on the screen. It was answering a question nobody asks while
              looking at today's doses — restocking is a weekly errand, not a today
              action — and it took the accent that belongs to the one thing that IS:
              answering a dose. It now lives with the Medication Inventory card, and
              low stock reaches Today contextually, as a quiet chip on the dose card
              of the medication actually running out. */}
          <div className="px-1">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-black text-foreground tracking-tight font-mono tabular-nums" suppressHydrationWarning>
                  {selectedLabel}
                </h2>
                {/* Only when you are away from today, and it says where it goes.
                    A permanent "Today" button next to a heading reading "Today" is
                    a control with nothing to do. */}
                {!isViewingToday && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDayKey(null);
                      setWeekOffset(0);
                      // Clear the deep-link param too, or the URL keeps saying
                      // ?day=… while the rail shows today — and a reload, or
                      // Android back, would drag it back to the linked day.
                      if (dayParam) router.replace('/dashboard');
                    }}
                    className="min-h-11 px-3 -my-2 rounded-full bg-primary-soft text-primary-strong font-mono font-bold text-xs inline-flex items-center gap-1 hover:bg-primary/15 active:scale-[0.98] transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <span aria-hidden>«</span> Today
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-semibold" suppressHydrationWarning>
                {isViewingToday
                  ? 'Keep track of your medication requirements'
                  : isViewingFuture
                    /* Says plainly that this is a plan, not a record — the cards below
                       carry no actions and the reason should not be a mystery. */
                    ? 'Scheduled for this day. Nothing to record yet.'
                    : 'You can still correct what was recorded.'}
              </p>
            </div>
          </div>

          {/* Mounted-gated: the row's days are derived from the device clock, and
              rendering them on the server would hydrate a different week for anyone
              whose date has already turned. */}
          {mounted && weekKeys.length > 0 && (
            <WeekStrip
              days={stripDays}
              selectedKey={selectedDayKey ?? todayKey}
              todayKey={todayKey}
              /* Selecting re-anchors the strip on that day, so the offset resets or
                 the two would compound on the next step. */
              onSelect={(key) => { setSelectedDayKey(key === todayKey ? null : key); setWeekOffset(0); }}
              onStepWeek={(delta) => setWeekOffset((w) => w + delta)}
              /* Stops at the week containing today. Future is a preview of what is
                 scheduled, and a strip you can page into next month is an invitation
                 to try to record an outcome for a dose that has not happened. */
              canStepForward={weekKeys.length > 0 && weekKeys[6] < currentWeekEnd}
              /* Only as far back as the 8-day query actually loaded — measured on the
                 week you would land in, not the one you are on. Beyond it every day
                 renders empty, and an empty day in an adherence record reads as
                 "nothing was taken", the one lie this app must not tell. Deeper
                 history needs a per-week fetch, the way the Medications page does it. */
              canStepBack={!!prevWeekEnd && !!oldestLoadedKey && prevWeekEnd >= oldestLoadedKey}
              isElderly={isElderly}
            />
          )}

          <MedicationReviewQueue
            patientTelegramChatId={targetTelegramChatId || myTelegramChatId || ''}
            userRole={userRole}
          />

          <TodaysSchedule
            events={railEvents}
            /* A past day is an archive: no live actions, only correction. Passing the
               day through lets TodaysSchedule drop Taken/Skip and widen Change to
               cover a dose nobody ever answered. */
            isPastDay={!isViewingToday && !isViewingFuture}
            /* A future day is a preview: no actions of any kind. The server refuses
               a future resolve on its own (resolve_reminder_event's forward bound)
               and a future correction explicitly, so this only spares the user a
               button that was always going to fail. */
            isFutureDay={isViewingFuture}
            userRole={userRole}
            currentUserTelegramChatId={myTelegramChatId || ''}
            patientTelegramChatId={targetTelegramChatId || myTelegramChatId || ''}
            /* Only today's array is this component's to update. A correction on a
               past day must not write into `events` — that is today, and the gate
               reads it. The router refresh TodaysSchedule already fires brings the
               corrected past day back from the server. */
            onEventsChange={isViewingToday ? setEvents : undefined}
            /* The day rail slots doses by time of day, and that must use the
               MEDICATION's timezone, not the device's — a dose set for 08:00 IST
               is a morning dose even when the phone is in London. ReminderEvent
               carries no timezone, so the lookup is threaded from here, where the
               medication list actually lives. */
            medicationTimezone={(medicationId) =>
              medications?.find((m) => m.id === medicationId)?.timezone ?? null
            }
            /* Tapping a pocket in the strip above selects a dose; the rail scrolls
               that dose's card into view and rings it. Same state the compliance
               ring reads, so all three surfaces agree on which dose is in hand. */
            selectedEventId={selectedEvent?.id ?? null}
            /* Only medications the shared low-stock rule flags — lowStockMedicines is
               already that set, computed server-side with the same predicate the bot
               uses (lib/medications/stock.ts). No chip on a medicine with plenty
               left: a count on every card is wallpaper, and wallpaper is not a
               warning. Suppressed on past and future days, where a supply notice is
               either historically wrong or premature. */
            lowStockLeft={
              isViewingToday
                ? (medicationId) => lowStockMedicines.find((m) => m.id === medicationId)?.stock ?? null
                : undefined
            }
          />

          {/* WATER, in the gap under Today's Doses — including the "nothing
              scheduled" empty state, which is the case it earns most: a day with
              no doses is an empty screen, and one quiet useful thing beats
              nothing. Renders null unless the feature is switched on.

              Every density: the app and the browser get the same widget, and
              elderly gets it larger with the same one tap. It is NOT in the
              analytics column — this is a thing you do, not a thing you read. */}
          {water && <WaterCard {...water} />}
        </div>

        {/* Side Workspaces (Insights, Inventory) — the spec's ANALYTICS COLUMN,
            and the whole of what the app density drops.

            Nothing here is lost on the app, only un-duplicated: the compliance
            ring is the one genuinely analytical card and the app is a
            today-view, while Care circle and Medication inventory are both
            already tabs in the five-icon nav, one tap away. Low stock still
            reaches the app through the refill gate, the refill strip and the
            per-dose "N left" chip, none of which live in this column.

            `browser-only` is the pre-paint half of the same decision — see the
            note in globals.css. The condition is the real one. */}
        {/* Tail of the cascade. 240ms is the last delay — anything later and the card
            arrives after the user has already started reading the page. */}
        {layout.sideColumn && (
        <div className="browser-only rise-in lg:col-span-4 space-y-8" style={{ ['--rise-delay' as string]: '240ms' }}>

          <div className="grid grid-cols-[1.1fr_1fr] lg:grid-cols-1 gap-3 sm:gap-6 items-stretch">
          <div data-tour="dash-compliance" className="card-lift p-4 sm:p-6 flex flex-col justify-between text-center relative min-h-0 sm:min-h-[300px]">
            {/* Half-width now, so the title has to fit one line: "Daily Compliance" wrapped
                to two and the "Daily dose cycle progress" subtitle took two more, spending
                four lines of a small card restating its own heading. */}
            <div className="w-full text-left mb-2">
              <h3 className="font-black text-foreground text-xs sm:text-sm flex items-center gap-1.5 min-w-0">
                <Activity className="w-4 h-4 text-primary shrink-0" />
                <span className="truncate">Compliance</span>
              </h3>
              <p className="hidden sm:block text-[11px] text-muted-foreground">Daily dose cycle progress</p>
            </div>

            {/* The ring is the whole card. It gets every pixel the half-width card can spare
                rather than sharing them with a key — a legend of colour names read as small
                text below a graphic too small to read. */}
            <div className="flex flex-col items-center w-full">
            {/* Orbiting compliance ring */}
            <div className="relative w-full max-w-[150px] sm:max-w-[200px] aspect-square flex items-center justify-center shrink-0">
              {events.length === 0 ? (
                <div className="text-center space-y-2">
                  <CheckCircle className="w-8 h-8 text-success mx-auto" />
                  <p className="text-xs text-muted-foreground font-bold">No active schedule today</p>
                </div>
              ) : (
                <svg viewBox="0 0 300 300" className="w-full h-full overflow-visible">
                  {/* Background Track Circle */}
                  <circle 
                    cx="150" 
                    cy="150" 
                    r="85" 
                    fill="none" 
                    stroke="var(--muted)" 
                    strokeWidth="8" 
                  />
                  
                  {/* Colored Progress Ring */}
                  <circle 
                    cx="150" 
                    cy="150" 
                    r="85" 
                    fill="none" 
                    stroke="var(--primary)" 
                    strokeWidth="8" 
                    strokeDasharray="534"
                    strokeDashoffset={534 * (1 - (todayTotal > 0 ? todayTaken / todayTotal : 0))}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out origin-center -rotate-90"
                  />
   
                  {/* Centered Cycle Card */}
                  <circle 
                    cx="150" 
                    cy="150" 
                    r="45" 
                    fill="var(--card)" 
                    stroke={activeEvent ? getStatusColor(activeEvent.reminder_status) : "var(--primary)"}
                    strokeWidth="2.5"
                    style={{ transition: 'all 0.3s ease' }}
                  />
   
                  {/* Compliance Text inside foreignObject */}
                  <foreignObject 
                    x="102" 
                    y="102" 
                    width="96" 
                    height="96" 
                    className="pointer-events-none select-none"
                  >
                    <div className="w-full h-full flex flex-col justify-center items-center text-center p-1">
                      {activeEvent ? (
                        <div className="space-y-0.5 leading-tight flex flex-col items-center">
                          <span className="text-foreground" style={{ color: getStatusColor(activeEvent.reminder_status) }}>
                            {getUnitIcon(activeEvent.medications.unit_type, 'w-5 h-5')}
                          </span>
                          <p className="text-[9px] font-black text-foreground truncate max-w-[70px]">
                            {activeEvent.medications.drug_name}
                          </p>
                          <p className="text-[8px] font-black text-primary" suppressHydrationWarning>
                            {mounted ? new Date(activeEvent.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                          </p>
                          <p className="text-[7px] font-black text-muted-foreground uppercase tracking-wider">
                            {activeEvent.reminder_status.replace('_', ' ')}
                          </p>
                        </div>
                      ) : (
                        <div className="leading-tight">
                          {/* The one real hero numeral on Today: the figure the
                              ring exists to state. It was 18px inside a 300px
                              ring, which made the ring the subject and the
                              number a caption — the wrong way round.

                              `numeral-tick` runs on mount, so it rises into
                              place on load and again whenever the count changes
                              and this re-renders. */}
                          <p className="numeral-lg numeral-tick text-foreground">
                            {todayTotal > 0 ? Math.round((todayTaken / todayTotal) * 100) : 100}%
                          </p>
                          <p className="text-[11px] font-black text-muted-foreground uppercase tracking-wider mt-0.5">
                            {todayTaken}/{todayTotal} TAKEN
                          </p>
                        </div>
                      )}
                    </div>
                  </foreignObject>
   
                  {/* Compliance Ring Markers — orbit the center, pause while inspecting one */}
                  <g
                    className="origin-center"
                    style={{
                      transformOrigin: '150px 150px',
                      animation: 'dose-orbit 40s linear infinite',
                      animationPlayState: activeEvent ? 'paused' : 'running',
                    }}
                  >
                    {events.map((event, idx) => {
                      const angle = (idx * 2 * Math.PI) / events.length - Math.PI / 2;
                      const cx = 150 + 85 * Math.cos(angle);
                      const cy = 150 + 85 * Math.sin(angle);
                      const statusColor = getStatusColor(event.reminder_status);
                      const isEscalated = event.reminder_status === 'ESCALATED_TO_CG';
                      const isActive = activeEvent?.id === event.id;

                      return (
                        <g
                          key={event.id}
                          className="cursor-pointer group/node"
                          onMouseEnter={() => setHoveredEvent(event)}
                          onMouseLeave={() => setHoveredEvent(null)}
                          onClick={() => setSelectedEvent(prev => prev?.id === event.id ? null : event)}
                        >
                          {/* Ping ring for alarms */}
                          {isEscalated && (
                            <circle 
                              cx={cx} 
                              cy={cy} 
                              r="16" 
                              fill="none" 
                              stroke="#FF9FA5" 
                              strokeWidth="2" 
                              className="animate-ping"
                            />
                          )}
   
                          {/* Node Circle - White ringed solid status badge */}
                          <circle
                            cx={cx}
                            cy={cy}
                            r={isActive ? 12 : 9}
                            fill={statusColor}
                            stroke="#ffffff"
                            strokeWidth={isActive ? 3 : 2.5}
                            className="transition-all duration-300 group-hover/node:r-[11px]"
                          />
                        </g>
                      );
                    })}
                  </g>
                </svg>
              )}
            </div>

            </div>
          </div>

          {/* Care Circle at a glance, shown from whichever side you are actually on.
              Role is derived from the connections themselves rather than a stored flag,
              because a single account can genuinely be both: someone can be cared for by
              a daughter while caring for a parent. Patient-only sees caregivers,
              caregiver-only sees patients, and a dual account sees one of each so neither
              relationship is hidden by the other. */}
          {(() => {
            const byPriority = (a: any, b: any) =>
              Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary));
            const caregivers = [...peopleCaringForMe].sort(byPriority);
            const patients = [...peopleICareFor].sort(byPriority);
            const isDual = caregivers.length > 0 && patients.length > 0;

            type Member = { key: string; name: string; role: string; photo?: string };
            const toMember = (conn: any, isPatient: boolean): Member => ({
              key: conn.connection_id,
              name: firstName(conn.resolved_name),
              // The same stored value means opposite things depending on which side of
              // the link the person on screen is standing.
              role: isPatient
                ? patientRoleLabel(conn.relationship_type)
                : caregiverRoleLabel(conn.relationship_type),
              // Both directions now: the Medical Profile toggle reads "show my photo to
              // my care circle" and covers caregiver photos shown to patients too.
              photo: isPatient
                ? careCircleAvatars[conn.patient_telegram_id]
                : careCircleAvatars[conn.caregiver_chat_id],
            });

            const members: Member[] = isDual
              ? [toMember(caregivers[0], false), toMember(patients[0], true)]
              : caregivers.length > 0
                ? caregivers.slice(0, 3).map(c => toMember(c, false))
                : patients.slice(0, 3).map(p => toMember(p, true));

            return (
              <div className="card-lift p-4 sm:p-6 flex flex-col min-h-0">
                {/* "See all" sat beside the title and squeezed it to "Care …". It moves to
                    the foot of the card, where it also fills the space a short list leaves. */}
                <h3 className="font-black text-foreground text-xs sm:text-sm flex items-center gap-1.5 min-w-0">
                  <Users className="w-4 h-4 text-primary shrink-0" />
                  <span className="truncate">Care circle</span>
                </h3>

                {members.length > 0 ? (
                  <ul className="mt-3 space-y-3">
                    {members.map((m) => (
                      <li key={m.key} className="flex items-center gap-2.5 min-w-0">
                        <span className="shrink-0 w-8 h-8 rounded-full bg-primary/10 text-foreground flex items-center justify-center text-[11px] font-black overflow-hidden">
                          {m.photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.photo} alt="" className="w-full h-full object-cover" />
                          ) : (
                            /* text-primary on a primary/10 tint measures 2.9:1. Initials are text. */
                            m.name.slice(0, 2).toUpperCase()
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-black text-foreground truncate">{m.name}</span>
                          <span className="block text-[11px] font-bold text-muted-foreground truncate">{m.role}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-3 flex-1 flex flex-col justify-center">
                    <p className="text-[11px] font-semibold text-muted-foreground leading-relaxed">
                      Nobody is notified if you miss a dose yet.
                    </p>
                    <Link
                      href="/settings#care-circle"
                      className="mt-2 inline-flex items-center text-[11px] font-black text-primary-strong hover:underline"
                    >
                      Invite someone
                    </Link>
                  </div>
                )}

                {members.length > 0 && (
                  <Link
                    href="/care-circle"
                    className="mt-auto inline-flex items-center min-h-11 text-[11px] font-black text-primary-strong hover:underline"
                  >
                    See all
                  </Link>
                )}
              </div>
            );
          })()}
          </div>

          {/* Health Insights lived here — seven day-rings built from a `chartData`
              prop. Removed 2026-08-12: the compliance ring above is the dashboard's
              adherence surface, and this card restated the idea in a form you could
              not actually read (a 3px stroke split three ways, so what you read was
              the "13/15", not the ring).

              The server-side 7-day aggregation went with it rather than being left
              computed-and-unused on every dashboard load. If the dataviz pass wants
              a history surface, the loop is in git history — `chartDataMap` in
              app/(dashboard)/dashboard/page.tsx. */}

          {/* Layer 4: Medication Inventory */}
          <div className="card-lift p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-black text-foreground text-sm">Medication Inventory</h3>
                <p className="text-[11px] text-muted-foreground">Current tablet counts and alerts</p>
              </div>
              {lowStockCount > 0 && (
                <span className="shrink-0 inline-flex items-center gap-1 bg-warning/10 border border-warning/30 text-warning-strong text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full">
                  <AlertTriangle className="w-3 h-3 shrink-0" /> {lowStockCount} low
                </span>
              )}
            </div>

            {lowStockCount > 0 ? (
              <div className="space-y-2">
                {/* `text-warning-foreground` is white — invisible on this 10% tint.
                    `-strong` is the readable-on-tint variant. */}
                <div className="bg-warning/10 border border-warning/35 p-3 rounded-xl flex items-center gap-2 text-warning-strong text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0 text-warning-strong" />
                  <span>Refill recommended for:</span>
                </div>
                {lowStockMedicines.map((m, idx) => {
                  const canRefill = viewMode !== 'PATIENT_MONITOR';
                  const isOpen = refillOpenId === m.id;
                  return (
                    <div key={idx} className="bg-muted px-4 py-3 rounded-2xl border border-border text-xs font-mono space-y-2">
                      <div className="flex justify-between items-center gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                          <span className="font-black text-foreground truncate">{m.drug_name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-black text-danger-strong bg-danger/10 px-2.5 py-1 rounded-lg border border-danger/20">
                            {m.stock} left
                          </span>
                          {canRefill && (
                            <button
                              onClick={() => { setRefillOpenId(isOpen ? null : m.id); setRefillAmount(''); }}
                              className="inline-flex items-center gap-1 font-black text-foreground bg-card hover:bg-muted border border-border h-11 px-3 rounded-xl transition-colors cursor-pointer"
                              aria-label={`Add stock for ${m.drug_name}`}
                            >
                              <Plus className="w-3 h-3" /> Refill
                            </button>
                          )}
                        </div>
                      </div>
                      {canRefill && isOpen && (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            inputMode="numeric"
                            autoFocus
                            value={refillAmount}
                            onChange={(e) => setRefillAmount(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') submitRefill(m.id, m.stock); }}
                            placeholder="Units to add"
                            className="flex-1 min-w-0 bg-card border border-input rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                          <button
                            onClick={() => submitRefill(m.id, m.stock)}
                            disabled={refillBusyId === m.id}
                            className="shrink-0 font-black text-primary-strong-foreground bg-primary-strong hover:bg-primary-strong-hover px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {refillBusyId === m.id ? 'Adding…' : 'Add'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-success/5 border border-success/20 p-4 rounded-2xl text-center text-xs space-y-1">
                <Package className="w-8 h-8 text-success mx-auto mb-2" />
                <p className="font-black text-success-strong mt-1">Inventory Balanced</p>
                <p className="text-[11px] text-muted-foreground font-semibold">All medication stock levels are sufficient.</p>
              </div>
            )}

            {/* Manage inventory's natural home: the card that already lists what is
                running low and lets you top it up. Secondary styling on purpose — it
                was a solid-pink button on Today's header, which made restocking look
                like the most urgent thing on a screen about taking a dose. */}
            <Link
              href="/medications"
              className="inline-flex items-center gap-1.5 min-h-11 text-xs font-black text-primary-strong hover:underline cursor-pointer"
            >
              <Package className="w-3.5 h-3.5 shrink-0" aria-hidden /> Manage inventory
            </Link>
          </div>

        </div>
        )}

      </div>

      </div>

      {/* Toast Notifications */}
      <PremiumToast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </>
  );
}
