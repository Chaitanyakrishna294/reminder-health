'use client';


import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUiMode } from '@/context/ui-mode-context';
import TodaysSchedule, { ReminderEvent } from '@/components/dashboard/todays-schedule';
import MedicationReviewQueue from '@/components/dashboard/medication-review-queue';
import { addStock } from '@/lib/medications/add-stock';
import { registerPush } from '@/lib/push/register-push';
import { resolveReminderEvent } from '@/lib/reminder-events';
import { PremiumToast } from '@/components/ui/premium-toast';
import MedDueGate from '@/components/dashboard/med-due-gate';
import BrainMascot from '@/components/dashboard/brain-mascot';
import GuideButton from '@/components/guide/guide-button';
import GuideAutoStart from '@/components/guide/guide-auto-start';
import moment from 'moment-timezone';
import { type OverrideEntry, findOverride, toOverrideDateStr } from '@/lib/schedule/dose-engine';
import { isPendingStatus, isAttentionStatus, isEscalatedStatus, partitionDoseAttention, buildGateQueue } from '@/lib/schedule/dose-attention';
import MissedDoseStrip from '@/components/dashboard/missed-dose-strip';
import RefillStrip from '@/components/dashboard/refill-strip';
import RefillGate from '@/components/dashboard/refill-gate';
import type { LowStockMed } from '@/lib/medications/stock';
import MedicationSlider from '@/components/dashboard/medication-slider';
import { getUnitIcon, getCountdownText, PinkBubbles } from '@/components/dashboard/dashboard-helpers';

import { createClient } from '@/lib/supabase/client';
import { getSeverityTheme } from '@/lib/severity-theme';
import { TONE_VAR, doseTone, CARE_LABELS } from '@/lib/design/semantics';
import { unitPhrase } from '@/components/medications/medication-form-options';
import { Eyebrow } from '@/components/ui/eyebrow';
import { EmptyState } from '@/components/ui/empty-state';
import { 
  Activity, 
  Clock, 
  Package, 
  AlertCircle, 
  Phone, 
  Send, 
  Stethoscope, 
  AlertTriangle, 
  Users, 
  RefreshCw, 
  Plus, 
  User, 
  ShieldAlert, 
  CheckCircle,
  HelpCircle,
  TrendingUp,
  XCircle,
  Check,
  Pill,
  X,
  Sparkles,
  Sun,
  CloudSun,
  Moon,
  Circle,
  Lock,
  ChevronDown,
  Utensils,
  SkipForward,
} from 'lucide-react';

const FEATURE_FLAG_ENABLE_PILL_SLIDER = false;

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
  todayEvents: ReminderEvent[];
  medications: any[];
  myTelegramChatId: string;
  targetTelegramChatId?: string;
  chartData: any[];
  lowStockMedicines: LowStockMed[];
  canEditStock: boolean;
  hasPatientLinked: boolean;
  caregiverId?: string;
  lastTaken: { drug_name: string; time: string } | null;
  peopleICareFor?: any[];
  peopleCaringForMe?: any[];
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
  todayEvents,
  medications,
  myTelegramChatId,
  targetTelegramChatId,
  chartData,
  lowStockMedicines,
  canEditStock,
  hasPatientLinked,
  caregiverId,
  lastTaken,
  peopleICareFor = [],
  peopleCaringForMe = [],
  avatarUrl = null,
}: DashboardClientViewProps) {
  const { isElderly, toggleMode, viewMode } = useUiMode();

  const [events, setEvents] = useState<ReminderEvent[]>([]);
  // Per-day schedule overrides saved by the Schedule Planner (localStorage). Applied
  // to today's generated doses so the "Next Dose" card reflects planner changes/skips.
  const [scheduleOverrides, setScheduleOverrides] = useState<OverrideEntry[]>([]);
  // Doses the user chose "remind me later" on → suppressed until this epoch ms.
  // (The 60s `currentTime` clock below re-renders, so the gate re-evaluates live.)
  const [snoozedUntil, setSnoozedUntil] = useState<Record<number, number>>({});
  // Refill gate snooze — one timestamp for ALL low medications, not one per med.
  // Mirrors the medGateSnoozes localStorage pattern; per-device by design, same
  // limitation MedDueGate already has.
  const [refillSnoozedUntil, setRefillSnoozedUntil] = useState(0);
  useEffect(() => {
    try {
      setRefillSnoozedUntil(Number(localStorage.getItem('refillGateSnoozedUntil')) || 0);
    } catch { /* ignore */ }
  }, []);

  const handleRefillSnooze = () => {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0); // next local midnight
    const until = midnight.getTime();
    try { localStorage.setItem('refillGateSnoozedUntil', String(until)); } catch { /* ignore */ }
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

    // Reference timezone for the "today" window: first medication's tz, else browser guess.
    const refTz =
      (medications && medications.length > 0 && medications[0]?.timezone) ||
      moment.tz.guess();

    const refToday = moment().tz(refTz);
    const startOfToday = refToday.clone().startOf('day');
    const endOfToday = refToday.clone().endOf('day');

    // Filter database events to the reference timezone's day boundaries
    const dbEventsToday = todayEvents.filter((e) => {
      const m = moment(e.scheduled_for);
      return m.isSameOrAfter(startOfToday) && m.isSameOrBefore(endOfToday);
    });

    const generatedEvents: ReminderEvent[] = [...dbEventsToday];

    if (medications && medications.length > 0) {
      medications.forEach((med) => {
        const medTz = med.timezone || refTz;
        const localToday = moment().tz(medTz);
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
  }, [todayEvents, medications, targetTelegramChatId, myTelegramChatId, scheduleOverrides]);

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

  const heroMood = activeEscalations > 0 || todayMissed > 0 ? 'concerned' : nextPendingEvent ? 'happy' : 'proud';
  const upcomingCount = events.filter(e => isPendingState(e.reminder_status)).length;
  const activeEvent = hoveredEvent || selectedEvent;

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
  const handleContactRequest = async () => {
    if (contactRequestSending) return;
    setContactRequestSending(true);
    try {
      const res = await fetch('/api/care/contact-request', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast('Contact Request Sent', 'Your caregiver has been notified to assist you.', 'success');
      } else {
        showToast('Could Not Send Request', body?.error || 'Please try again, or call your caregiver directly.', 'error');
      }
    } catch {
      showToast('Could Not Send Request', 'Please check your connection and try again.', 'error');
    } finally {
      setContactRequestSending(false);
    }
  };

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
  const handleElderlyTakeNow = async (event: ReminderEvent, action: 'TAKEN' | 'SKIP') => {
    // 1. Double-click prevention
    if (updatingId !== null) return;
    setUpdatingId(event.id);

    try {
      const resolvedRecord = await resolveReminderEvent({
        supabase,
        eventId: event.id,
        medicationId: event.medication_id,
        scheduledFor: event.scheduled_for,
        action,
        actorRole: userRole,
      });

      if (resolvedRecord.already_resolved) {
        showToast(
          'Medication already resolved',
          'This medication was updated from another device.',
          'error'
        );
      }

      setEvents((prev) =>
        prev.map((e) =>
          e.id === event.id 
            ? { 
                ...e, 
                id: resolvedRecord.event_id ?? e.id,
                reminder_status: resolvedRecord.reminder_status
              } 
            : e
        )
      );

      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Elderly Dashboard Action] Error:', message, err);
      showToast('Error', 'Failed to update event. Please try again.', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  // Doses that are due right now (pending and their scheduled time has arrived). When several
  // land at the same / near time, the patient can confirm them together via "Take all" rather
  // than one-by-one.
  const dueNowEvents = [...events]
    .filter(e => isPendingState(e.reminder_status) && new Date(e.scheduled_for).getTime() <= currentTime.getTime())
    .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());

  const BATCH_SENTINEL = -99999;
  const handleResolveAll = async (action: 'TAKEN' | 'SKIP') => {
    if (updatingId !== null || dueNowEvents.length === 0) return;
    setUpdatingId(BATCH_SENTINEL);
    let ok = 0;
    try {
      for (const ev of dueNowEvents) {
        try {
          const resolved = await resolveReminderEvent({
            supabase,
            eventId: ev.id,
            medicationId: ev.medication_id,
            scheduledFor: ev.scheduled_for,
            action,
            actorRole: userRole,
          });
          setEvents((prev) =>
            prev.map((e) =>
              e.id === ev.id
                ? { ...e, id: resolved.event_id ?? e.id, reminder_status: resolved.reminder_status }
                : e
            )
          );
          ok += 1;
        } catch (err) {
          console.error('[Take All] Failed for event', ev.id, err);
        }
      }
      showToast(
        action === 'TAKEN' ? 'Doses confirmed' : 'Doses skipped',
        `${ok} medication${ok === 1 ? '' : 's'} updated.`,
        ok > 0 ? 'success' : 'error'
      );
      router.refresh();
    } finally {
      setUpdatingId(null);
    }
  };

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

  const getPeriodStatus = (startHour: number, endHour: number) => {
    const periodEvents = events.filter(e => {
      const date = new Date(e.scheduled_for);
      const hour = date.getHours();
      if (startHour < endHour) {
        return hour >= startHour && hour < endHour;
      } else {
        // Over midnight (Night: 9:00 PM to 4:59 AM)
        return hour >= startHour || hour < endHour;
      }
    });

    if (periodEvents.length === 0) return 'empty';

    // Alarm = missed backlog (MISSED / PENDING_REVIEW / UNCONFIRMED) or live
    // caregiver escalation. Checked first: escalated doses are also "pending".
    const hasActiveAlarm = periodEvents.some(e => isAttentionStatus(e.reminder_status) || isEscalatedStatus(e.reminder_status));
    if (hasActiveAlarm) return 'missed';

    // Pending = shared dose-attention set (virtual FUTURE_SCHEDULED plus the
    // real fired-but-unresolved statuses: SENT/DISPLAYED/OPENED/GENTLE_REMINDER/…).
    const hasPending = periodEvents.some(e => isPendingState(e.reminder_status));
    const allTaken = periodEvents.every(e => ['TAKEN', 'RESOLVED_BY_CG'].includes(e.reminder_status));
    
    if (allTaken) return 'taken';
    if (hasPending) return 'pending';
    return 'empty';
  };

  // Was a private palette of pastel hexes — "Critical Coral" #FF9FA5 for a missed dose
  // sat right next to the brand pink, and none of the four values matched the tokens the
  // rest of the app uses for the same states. It also didn't follow dark mode.
  const getStatusColor = (status: string) => TONE_VAR[doseTone(status)];

  // ==========================================
  // ELDERLY MODE VIEW (Strictly Show ONLY: 1. Next Medication, 2. Today's Progress, 3. Low Stock Alerts)
  // ==========================================
  if (isElderly) {
    const progressPercentage = todayTotal > 0 ? Math.round((todayTaken / todayTotal) * 100) : 100;

    return (
      <>
        {dueGate}
        {refillGate}
        {viewMode !== 'PATIENT_MONITOR' && <GuideAutoStart tour="dashboard" />}
        {/* Dock clearance is owned by <main> in dashboard-main-layout; adding it here
            too just stacked two paddings. */}
        <div className="space-y-8 w-full max-w-4xl mx-auto transition-colors duration-500">
          {missedStrip}
          {refillStrip}
          {/* Gravity State Dimmer Backdrop (Disabled) */}

          {/* Push Banner */}
          {showPushBanner && (
            <div className="bg-white/10 dark:bg-slate-900/40 backdrop-blur-xl border-4 border-primary/20 p-5 rounded-2xl flex flex-col sm:flex-row items-center justify-between text-foreground gap-4">
              <span className="text-2xl font-black text-center sm:text-left flex items-center gap-2">
                <Send className="w-8 h-8 text-primary shrink-0 animate-bounce" />
                <span>Enable browser notifications for medication reminders</span>
              </span>
              <div className="flex items-center gap-4 w-full sm:w-auto shrink-0 justify-end">
                <button
                  onClick={handleEnableNotifications}
                  className="bg-primary-strong text-primary-strong-foreground font-black px-8 py-3 rounded-xl text-xl cursor-pointer hover:bg-primary-strong-hover transition-all shadow-md shrink-0"
                >
                  Enable Notifications
                </button>
                <button
                  onClick={handleDismissBanner}
                  aria-label="Dismiss banner"
                  className="p-3 bg-muted text-muted-foreground hover:text-foreground rounded-xl transition-colors cursor-pointer"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
          )}

          {/* iOS PWA Installation Banner */}
          {showIosPwaBanner && (
            <div className="bg-primary/10 border-4 border-primary/30 p-5 rounded-2xl flex flex-col sm:flex-row items-center justify-between text-foreground gap-4">
              <span className="text-xl font-black text-center sm:text-left flex items-start gap-2">
                <Plus className="w-8 h-8 text-primary shrink-0" />
                <span>To receive push reminders on iOS, install Re-MIND-eЯ: tap the Share button and select 'Add to Home Screen'.</span>
              </span>
              <button
                onClick={() => {
                  localStorage.setItem('dismissedIosPwaBanner', 'true');
                  setShowIosPwaBanner(false);
                }}
                className="bg-primary-strong text-primary-strong-foreground font-black px-8 py-3 rounded-xl text-xl cursor-pointer hover:bg-primary-strong-hover transition-all shadow-md shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}
  
          {/* Top Info Banner for accidental toggle */}
          <div className="bg-primary/10 border-4 border-primary/30 p-5 rounded-2xl flex flex-col sm:flex-row items-center justify-between text-foreground gap-4">
            <span className="text-2xl font-black text-center sm:text-left flex items-center gap-2">
              <User className="w-8 h-8 text-primary shrink-0" />
              <span>Currently in Elderly Mode (Accessible Large View)</span>
            </span>
            <button 
              onClick={toggleMode}
              className="bg-primary-strong text-primary-strong-foreground font-black px-8 py-3 rounded-xl text-xl cursor-pointer hover:bg-primary-strong-hover transition-all shadow-md shrink-0"
            >
              Switch to Normal View
            </button>
          </div>
  
          {/* 1. NEXT MEDICATION */}
          <div className={`bg-card rounded-3xl p-8 border border-border shadow-sm space-y-6 ${
            nextPendingEvent?.reminder_status === 'ESCALATED_TO_CG' ||
            nextPendingEvent?.medications.priority_level === 'critical' ||
            (nextPendingEvent && isAttentionStatus(nextPendingEvent.reminder_status))
              ? 'border-danger animate-red-glow bg-danger/5'
              : 'border-primary'
          }`}>
            <h2 className="text-3xl font-black text-muted-foreground tracking-tight uppercase flex items-center gap-2">
              {nextPendingEvent && isAttentionStatus(nextPendingEvent.reminder_status) ? (
                <><AlertTriangle className="w-8 h-8 text-danger" /> Missed Medication</>
              ) : (
                <><Clock className="w-8 h-8 text-primary" /> Next Medication</>
              )}
            </h2>
            {nextPendingEvent ? (
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <Pill className="w-16 h-16 text-primary shrink-0" />
                  <div>
                    <h3 className="text-4xl sm:text-5xl font-black text-foreground leading-tight">
                      {nextPendingEvent.medications.drug_name}
                    </h3>
                    <p className="text-2xl text-muted-foreground font-bold mt-2">
                      Dosage: <b className="text-foreground">{nextPendingEvent.medications.dosage}</b>
                    </p>
                    <p className="text-3xl text-primary font-black mt-2" suppressHydrationWarning>
                      Time: {mounted ? new Date(nextPendingEvent.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                    </p>
                  </div>
                </div>
  
                {/* Giant 88px buttons with large touch target */}
                {viewMode === 'PATIENT_MONITOR' ? (
                  <div className="p-6 bg-muted/60 border border-border rounded-2xl flex items-center justify-center gap-2.5 text-xl font-black text-muted-foreground mt-6">
                    <Lock className="w-5 h-5 text-muted-foreground shrink-0" />
                    <span>Read-Only Monitor Mode</span>
                  </div>
                ) : (
                  /* Missed doses are resolved in the MissedDoseStrip above — no duplicate actions here. */
                  (new Date(nextPendingEvent.scheduled_for).getTime() <= new Date().getTime()) &&
                  !(nextPendingEvent && isAttentionStatus(nextPendingEvent.reminder_status))
                ) ? (
                  <div className="space-y-4 mt-6">
                    {dueNowEvents.length > 1 && (
                      <button
                        onClick={() => handleResolveAll('TAKEN')}
                        disabled={updatingId !== null}
                        className="w-full h-[72px] flex items-center justify-center gap-2 text-2xl font-black rounded-2xl bg-primary-strong text-primary-strong-foreground hover:bg-primary/90 transition-all cursor-pointer shadow-lg disabled:opacity-50"
                      >
                        <Check className="w-6 h-6" />
                        {updatingId === BATCH_SENTINEL ? 'Confirming…' : `I TOOK ALL ${dueNowEvents.length}`}
                      </button>
                    )}
                    <div className="flex flex-col sm:flex-row gap-4">
                      <button
                        onClick={() => handleElderlyTakeNow(nextPendingEvent, 'TAKEN')}
                        disabled={updatingId !== null}
                        className="flex-1 h-[88px] flex items-center justify-center text-3xl font-black rounded-2xl bg-success text-success-foreground hover:bg-success/90 transition-all cursor-pointer shadow-lg disabled:opacity-50"
                      >
                        {updatingId === nextPendingEvent.id ? 'Updating...' : 'I TOOK IT'}
                      </button>
                      <button
                        onClick={() => handleElderlyTakeNow(nextPendingEvent, 'SKIP')}
                        disabled={updatingId !== null}
                        className="h-[88px] px-8 flex items-center justify-center text-2xl font-black rounded-2xl bg-warning text-warning-foreground hover:bg-warning/90 transition-all cursor-pointer shadow-lg disabled:opacity-50"
                      >
                        SKIP
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 p-6 bg-muted/60 border border-border rounded-2xl flex items-center justify-center gap-2.5 text-xl font-black text-muted-foreground">
                    <Clock className="w-5 h-5 text-muted-foreground shrink-0 animate-pulse" />
                    <span>{nextPendingEvent && isAttentionStatus(nextPendingEvent.reminder_status) ? 'Log this dose in the red missed panel above.' : `Options will become available at ${mounted ? new Date(nextPendingEvent.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}`}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 space-y-4">
                <CheckCircle className="w-16 h-16 text-success mx-auto" />
                <p className="text-3xl font-black text-success">All Medications Taken!</p>
                <p className="text-2xl text-muted-foreground font-bold">You have taken all your pills scheduled for today.</p>
              </div>
            )}
          </div>
  
          {/* 1B. SECONDARY HELP ACTION (Elderly Refinement Pass) */}
          {viewMode !== 'PATIENT_MONITOR' && (
            <div className="bg-card border border-warning/40 rounded-3xl p-8 shadow-sm space-y-4">
              <h3 className="text-2xl font-black text-foreground">Need Help?</h3>
              <p className="text-xl text-muted-foreground font-semibold">
                Tap the button below if you want your caregiver to call or assist you.
              </p>
              <button
                onClick={handleContactRequest}
                disabled={contactRequestSending}
                className="w-full h-[88px] flex items-center justify-center text-2xl font-black rounded-2xl bg-warning text-warning-foreground hover:bg-warning/95 active:scale-[0.98] transition-all cursor-pointer shadow-md gap-2 disabled:opacity-60"
              >
                <Phone className="w-8 h-8" /> {contactRequestSending ? 'Sending…' : 'Request Caregiver Contact'}
              </button>
            </div>
          )}
  
          {/* 2. TODAY'S PROGRESS */}
          <div className="bg-card border border-border p-8 rounded-3xl shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <h2 className="text-3xl font-black text-foreground">Today's Progress</h2>
              <span className="text-4xl font-black text-primary bg-primary/10 px-6 py-2 rounded-2xl">
                {todayTaken} of {todayTotal} taken
              </span>
            </div>
  
            <div className="w-full bg-muted rounded-full h-10 overflow-hidden border-2 border-border">
              <div 
                className="bg-success h-full transition-all duration-500 rounded-full" 
                style={{ width: `${todayTotal > 0 ? progressPercentage : 100}%` }}
              />
            </div>
  
            {/* `justify-between` with no gap ran the two labels together at phone width
                in elderly mode — it rendered as "StartedRemaining: 3 doses". */}
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-2xl font-bold text-muted-foreground">
              <span>Started</span>
              {progressPercentage === 100 ? (
                <span className="text-success-strong font-black">Done for the day!</span>
              ) : (
                <span>
                  {todayTotal - todayTaken} {todayTotal - todayTaken === 1 ? 'dose' : 'doses'} left
                </span>
              )}
            </div>
          </div>
  
          {/* 3. LOW STOCK WARNINGS */}
          {lowStockCount > 0 && (
            <div className="bg-danger/10 border border-danger/30 text-foreground p-8 rounded-3xl shadow-sm space-y-4">
              <h2 className="text-3xl font-black text-danger flex items-center gap-2">
                <AlertCircle className="w-8 h-8 text-danger animate-pulse" /> Medicine Alert
              </h2>
              <p className="text-2xl font-bold text-muted-foreground">
                The following medicines are running very low. Please refill soon:
              </p>
              <div className="space-y-2">
                {lowStockMedicines.map((m, idx) => (
                  <div key={idx} className="bg-card p-4 rounded-xl border border-border flex justify-between items-center">
                    <span className="text-2xl font-black">{m.drug_name}</span>
                    <span className="text-2xl font-black text-danger">{m.stock} left</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Toast Notifications */}
        <PremiumToast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      </>
    );
  }

  const isMissed = nextPendingEvent && (new Date(nextPendingEvent.scheduled_for).getTime() <= new Date().getTime());
  const nextSeverity = getSeverityTheme(nextPendingEvent?.medications?.priority_level);
  // Reference design: the upcoming (not-missed) next-dose card is a bold pink gradient with white text.
  const onGradient = !!nextPendingEvent && !isMissed;

  // ==========================================
  // NORMAL MODE VIEW (Premium Apple Health Theme)
  // ==========================================
  return (
    <>
      {dueGate}
      {refillGate}
      {viewMode !== 'PATIENT_MONITOR' && <GuideAutoStart tour="dashboard" />}
      <div className={`space-y-8 w-full transition-all duration-500 relative ${isGravityState ? 'gravity-active' : ''}`}>
      {missedStrip}
      {refillStrip}

      {/* Push Banner */}
      {showPushBanner && (
        <div className="bg-white/10 dark:bg-slate-900/40 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-3xl p-5 shadow-lg relative overflow-hidden flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in z-45">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
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
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
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
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
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

      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-transparent border-none shadow-none p-0">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          {/* Profile photo (falls back to initials) */}
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center font-mono font-black text-lg shadow-inner shrink-0 overflow-hidden">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Profile photo" className="w-full h-full object-cover" />
            ) : (
              userName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'U'
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-black text-foreground tracking-tight flex items-center gap-2">
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

      {/* First Viewport: Top Row split layout (Left: Next Medication card, Right: Compliance Ring) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Next/Missed Medication summary card */}
        <div data-tour="dash-next-med" className={`lg:col-span-7 rounded-3xl p-6 shadow-sm flex flex-col justify-start gap-4 relative overflow-hidden isolate border transition-colors ${
          isMissed
            ? 'border-danger/50 shadow-danger/5 shadow-md bg-danger/[0.02]'
            : nextPendingEvent
              ? 'border-transparent shadow-md shadow-primary/20 bg-gradient-to-br from-[#F8839E] to-[#F26B8A] text-white'
              : 'bg-card border-border'
        }`}>
          {nextPendingEvent && !isMissed && <PinkBubbles />}
          {/* Mascot accent filling the card's empty space. Only floated when there IS a
              dose card to fill space around — in the "All caught up!" state the card is
              short, and the mascot ended up hovering over the checkmark instead of
              beside it. There it moves into the flex row (below). */}
          {nextPendingEvent && (
            <BrainMascot
              size={96}
              mood={heroMood}
              className="absolute right-3 sm:right-6 top-[42%] -translate-y-1/2 opacity-90 pointer-events-none select-none"
            />
          )}
          <div>
            <div className="flex justify-between items-start gap-4">
              <div className="min-w-0 flex-1">
                <Eyebrow className={
                  isMissed ? 'text-danger-strong' : onGradient ? 'text-white/90' : ''
                }>
                  {isMissed ? 'Missed Medication' : 'Next Medication'}
                </Eyebrow>
                {nextPendingEvent ? (
                  <div className="mt-4 flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${
                      isMissed
                        ? 'bg-danger/10 text-danger border border-danger/20'
                        : onGradient
                          ? 'bg-white/20 text-white border border-white/30'
                          : nextSeverity.tile
                    }`}>
                      {getUnitIcon(nextPendingEvent.medications.unit_type, "w-6 h-6")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className={`text-2xl font-black tracking-tight leading-tight truncate ${onGradient ? 'text-white' : 'text-foreground'}`}>
                        {nextPendingEvent.medications.drug_name}
                      </h3>
                      <div className={`text-xs mt-1 space-y-1 font-sans ${onGradient ? 'text-white/85' : 'text-muted-foreground'}`}>
                        {/* Was "1 tablet(s) - N/A" when no strength was recorded — the
                            placeholder leaked straight onto the hero card. */}
                        <p>
                          Dosage: <b className={`font-mono ${onGradient ? 'text-white' : 'text-foreground'}`}>
                            {[
                              nextPendingEvent.medications.dosage_amount
                                ? `${nextPendingEvent.medications.dosage_amount} ${unitPhrase(nextPendingEvent.medications.unit_type, nextPendingEvent.medications.dosage_amount)}`
                                : '',
                              nextPendingEvent.medications.dosage && nextPendingEvent.medications.dosage !== 'N/A'
                                ? nextPendingEvent.medications.dosage
                                : '',
                            ].filter(Boolean).join(' · ')}
                          </b>
                        </p>
                        {nextPendingEvent.medications.medication_reason && (
                          <p className="italic leading-snug">
                            Reason: <span className={`font-semibold ${onGradient ? 'text-white' : 'text-foreground'}`}>{nextPendingEvent.medications.medication_reason}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center gap-3">
                    <BrainMascot
                      size={72}
                      mood={heroMood}
                      className="shrink-0 pointer-events-none select-none"
                    />
                    <CheckCircle className="w-8 h-8 shrink-0 text-success" />
                    <div>
                      <h3 className="text-lg font-black tracking-tight text-success-strong">All caught up!</h3>
                      <p className="text-xs text-muted-foreground font-semibold mt-0.5">You have taken all scheduled medications for today.</p>
                    </div>
                  </div>
                )}
              </div>
              
              {nextPendingEvent && (
                <div className="flex flex-col items-end gap-1 shrink-0 font-mono text-right">
                  {/* 9px was too small to clear 4.5:1 on a tint, and this is the one
                      line that says how late you are. Solid fill when missed, and a
                      readable size. */}
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-black border transition-colors ${
                    isMissed
                      /* Solid #FF3B30 with white text is only 3.55:1 — iOS system red
                         is too light to carry white. An opaque card-coloured pill with
                         the dark red ink clears 7:1 on any background this card takes. */
                      ? 'bg-card text-danger-strong border-danger'
                      : onGradient
                        ? 'bg-white/25 text-white border-white/40'
                        : 'bg-primary/15 text-primary border-primary/25'
                  }`}>
                    {mounted ? getCountdownText(nextPendingEvent.scheduled_for) : 'UPCOMING'}
                  </span>
                  <span className={`text-lg font-black mt-1 transition-colors ${
                    isMissed ? 'text-danger-strong' : onGradient ? 'text-white' : 'text-primary'
                  }`} suppressHydrationWarning>
                    {mounted ? new Date(nextPendingEvent.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                  </span>
                </div>
              )}
            </div>
          </div>
 
          {nextPendingEvent && (
            viewMode === 'PATIENT_MONITOR' ? (
              <div className={`mt-6 p-3 rounded-2xl text-[11px] font-bold w-fit flex items-center gap-1.5 ${onGradient ? 'bg-white/15 border border-white/25 text-white' : 'bg-muted border border-border text-muted-foreground'}`}>
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>Read-Only Monitoring Mode</span>
              </div>
            ) : (
              /* Missed doses are resolved in the MissedDoseStrip above — no duplicate actions here. */
              (new Date(nextPendingEvent.scheduled_for).getTime() <= new Date().getTime()) &&
              !(nextPendingEvent && isAttentionStatus(nextPendingEvent.reminder_status))
            ) ? (
              FEATURE_FLAG_ENABLE_PILL_SLIDER ? (
                <div className="mt-6 w-full max-w-sm">
                  <MedicationSlider 
                    event={nextPendingEvent} 
                    onResolve={(action) => handleElderlyTakeNow(nextPendingEvent, action)} 
                  />
                </div>
              ) : (
                <div className="mt-6 flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={() => handleElderlyTakeNow(nextPendingEvent, 'TAKEN')}
                    disabled={updatingId !== null}
                    className="inline-flex items-center gap-1.5 h-11 px-5 bg-success/20 backdrop-blur-md border border-success/40 text-success-strong text-xs font-black rounded-full hover:bg-success/30 active:scale-[0.98] transition-all cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" /> Take Now
                  </button>
                  <button
                    onClick={() => handleElderlyTakeNow(nextPendingEvent, 'SKIP')}
                    disabled={updatingId !== null}
                    className="inline-flex items-center gap-1.5 h-11 px-4 bg-white/70 backdrop-blur-md border border-white/80 text-foreground text-xs font-bold rounded-full hover:bg-white/80 active:scale-[0.98] transition-all cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    <X className="w-4 h-4" /> Skip
                  </button>
                  {dueNowEvents.length > 1 && (
                    <button
                      onClick={() => handleResolveAll('TAKEN')}
                      disabled={updatingId !== null}
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-primary-strong text-primary-strong-foreground text-xs font-black rounded-full hover:bg-primary/90 active:scale-[0.98] transition-all cursor-pointer shadow-sm disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" />
                      {updatingId === BATCH_SENTINEL ? 'Confirming…' : `Take all ${dueNowEvents.length} due now`}
                    </button>
                  )}
                </div>
              )
            ) : (
              <div className={`mt-6 p-4 rounded-2xl text-xs font-semibold w-fit flex items-center gap-1.5 ${onGradient ? 'bg-white/15 border border-white/25 text-white' : 'bg-muted/50 border border-border/80 text-muted-foreground'}`}>
                <Clock className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                <span>{nextPendingEvent && isAttentionStatus(nextPendingEvent.reminder_status) ? 'Log this dose in the red missed panel above.' : `Options will become available at ${mounted ? new Date(nextPendingEvent.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}`}</span>
              </div>
            )
          )}
        </div>

        {/* Right: Medication Compliance Ring */}
        <div data-tour="dash-compliance" className="lg:col-span-5 bg-card border border-border rounded-3xl p-6 shadow-sm flex flex-col justify-between text-center relative min-h-[300px]">
          <div className="w-full text-left mb-2">
            <h3 className="font-black text-foreground text-sm flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-primary" /> Daily Compliance
            </h3>
            <p className="text-[11px] text-muted-foreground">Daily dose cycle progress</p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-6 w-full">
          {/* Left: orbiting compliance ring */}
          <div className="relative w-full max-w-[200px] aspect-square flex items-center justify-center shrink-0">
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
                        <p className="text-[18px] font-black text-foreground">
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

          {/* Right: compliance stat cards */}
          <div className="w-full flex-1 flex flex-col justify-center gap-2">
            <div className="flex items-center justify-between rounded-2xl bg-success/10 px-4 py-2.5">
              <span className="text-xs font-bold text-success flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-success" /> Taken
              </span>
              <span className="text-sm font-black text-success">{todayTaken}</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-muted px-4 py-2.5">
              <span className="text-xs font-bold text-muted-foreground flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" /> Upcoming
              </span>
              <span className="text-sm font-black text-foreground">{upcomingCount}</span>
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* Daily Compliance Timeline Card */}
      <div className="relative overflow-hidden isolate bg-gradient-to-br from-[#F8839E] to-[#F26B8A] text-white border border-transparent rounded-3xl p-5 shadow-sm shadow-primary/20 space-y-4">
        <h3 className="font-black text-white text-sm flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-white" /> Daily Compliance Timeline
        </h3>

        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Morning', icon: <Sun className="w-3.5 h-3.5 shrink-0" />, period: getPeriodStatus(5, 12) },
            { label: 'Afternoon', icon: <CloudSun className="w-3.5 h-3.5 shrink-0" />, period: getPeriodStatus(12, 17) },
            { label: 'Evening', icon: <Moon className="w-3.5 h-3.5 shrink-0" />, period: getPeriodStatus(17, 21) },
            { label: 'Night', icon: <Moon className="w-3.5 h-3.5 opacity-75 shrink-0" />, period: getPeriodStatus(21, 5) },
          ].map((item, idx) => {
            // These tiles used to be white text on `bg-white/20` over the pink gradient —
            // a white veil over pink lands close enough to white that the label measured
            // 1.77:1, i.e. barely visible. Lightening the tile and putting the navy ink
            // ON it inverts the problem instead of stacking two pale layers.
            let bgClass = 'bg-white/40 backdrop-blur-md text-foreground/75 border-white/40';
            let statusIcon = <Circle className="w-5 h-5 opacity-50 shrink-0" />;
            let statusWord = 'Nothing due';

            if (item.period === 'taken') {
              bgClass = 'bg-white/90 backdrop-blur-md text-foreground border-white';
              statusIcon = <Check className="w-5 h-5 shrink-0 text-success-strong" />;
              statusWord = 'All taken';
            } else if (item.period === 'pending') {
              bgClass = 'bg-white/90 backdrop-blur-md text-foreground border-white';
              statusIcon = <Clock className="w-5 h-5 animate-pulse shrink-0 text-primary" />;
              statusWord = 'Still due';
            } else if (item.period === 'missed') {
              bgClass = 'bg-white/90 backdrop-blur-md text-foreground border-white';
              statusIcon = <X className="w-5 h-5 shrink-0 text-danger-strong" />;
              statusWord = 'Missed';
            }

            return (
              <div
                key={idx}
                className={`p-2 rounded-2xl border flex flex-col items-center justify-center gap-2 min-h-[78px] ${bgClass}`}
                title={`${item.label}: ${statusWord}`}
              >
                {/* `truncate` clipped "Afternoon" to "Afternoo" in a 4-column grid on a
                    375px screen. These are four fixed, known words — let them wrap
                    rather than lose a letter. */}
                <span className="text-[11px] font-black font-mono tracking-tight flex flex-col items-center gap-1 w-full">
                  {item.icon}
                  <span className="text-center leading-tight break-words max-w-full">{item.label}</span>
                </span>
                {/* The icon alone carried the state; screen readers got nothing. */}
                <span aria-hidden="true">{statusIcon}</span>
                <span className="sr-only">{statusWord}</span>
              </div>
            );
          })}
        </div>
        <PinkBubbles />
      </div>

      {/* Main Workspace Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Layer 2: Today's Medication Timeline (Main Content Zone) */}
        <div data-tour="dash-today" className="lg:col-span-8 space-y-6">
          <div className="flex justify-between items-center px-1">
            <div>
              <h2 className="text-xl font-black text-foreground tracking-tight">Today's Schedule</h2>
              <p className="text-xs text-muted-foreground font-semibold">Keep track of your medication requirements</p>
            </div>
            {/* The dashboard's one solid-primary CTA. Refill and Open Hub used to be
                equally loud (one of them in a one-off teal), so nothing read as the main
                action. Both are secondary now. */}
            <Link
              href="/medications"
              className="h-11 px-4 text-xs font-black rounded-full bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover active:scale-[0.98] transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Manage Inventory
            </Link>
          </div>

          <MedicationReviewQueue
            patientTelegramChatId={targetTelegramChatId || myTelegramChatId || ''}
            userRole={userRole}
          />

          <TodaysSchedule 
            events={events}
            userRole={userRole}
            currentUserTelegramChatId={myTelegramChatId || ''}
            patientTelegramChatId={targetTelegramChatId || myTelegramChatId || ''}
            onEventsChange={setEvents}
          />
        </div>

        {/* Side Workspaces (Insights, Inventory) */}
        <div className="lg:col-span-4 space-y-8">
          
          {/* Layer 3: Health Insights */}
          <div className="bg-card border border-border rounded-3xl p-6 shadow-sm space-y-4">
            <div>
              <h3 className="font-black text-foreground text-sm">Health Insights</h3>
              <p className="text-[11px] text-muted-foreground">Your last 7 days at a glance</p>
            </div>

            {/* Weekly rings, laid out like the Olympic rings: 4 on top, 3 below.
                A missed dose and a day with nothing scheduled used to render as the SAME
                grey track, so "you had no medications on Sunday" and "you missed every
                dose on Sunday" looked identical. Missed now draws its own red arc; grey
                is reserved for genuinely empty days. */}
            {(() => {
              const days = chartData.slice(-7);
              const renderRing = (d: { date: string; day?: number; Taken: number; Skipped: number; Missed: number }, idx: number) => {
                const taken = d.Taken || 0;
                const skipped = d.Skipped || 0;
                const missed = d.Missed || 0;
                const total = taken + skipped + missed;
                const C = 2 * Math.PI * 15.5;
                const takenLen = total > 0 ? C * (taken / total) : 0;
                const skippedLen = total > 0 ? C * (skipped / total) : 0;
                const missedLen = total > 0 ? C * (missed / total) : 0;
                const summary = total === 0
                  ? `${d.date}: nothing scheduled`
                  : `${d.date}: ${taken} taken, ${skipped} skipped, ${missed} missed`;
                return (
                  <div key={idx} className="flex flex-col items-center gap-1" title={summary}>
                    <div className="relative w-14 h-14">
                      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90" role="img" aria-label={summary}>
                        {/* Track — nothing scheduled, or the remainder. Neutral, never a warning. */}
                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--muted)" strokeWidth="3" />
                        {takenLen > 0 && (
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--success)" strokeWidth="3"
                            strokeDasharray={`${takenLen} ${C - takenLen}`} strokeDashoffset={0} />
                        )}
                        {skippedLen > 0 && (
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--warning)" strokeWidth="3"
                            strokeDasharray={`${skippedLen} ${C - skippedLen}`} strokeDashoffset={-takenLen} />
                        )}
                        {missedLen > 0 && (
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--danger)" strokeWidth="3"
                            strokeDasharray={`${missedLen} ${C - missedLen}`} strokeDashoffset={-(takenLen + skippedLen)} />
                        )}
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black text-foreground tabular-nums">
                        {total === 0 ? '—' : `${taken}/${total}`}
                      </span>
                    </div>
                    <span className="text-[11px] font-bold text-muted-foreground tabular-nums whitespace-nowrap">{d.date}</span>
                  </div>
                );
              };
              return (
                <div className="flex flex-col items-center gap-2 py-1">
                  <div className="flex justify-center gap-3">
                    {days.slice(0, 4).map((d, i) => renderRing(d, i))}
                  </div>
                  <div className="flex justify-center gap-3">
                    {days.slice(4).map((d, i) => renderRing(d, i + 4))}
                  </div>
                  {/* Color alone can't carry this — the audience includes people with
                      age-related color vision changes. */}
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2">
                    {([
                      ['Taken', 'var(--success)'],
                      ['Skipped', 'var(--warning)'],
                      ['Missed', 'var(--danger)'],
                      ['None due', 'var(--muted)'],
                    ] as const).map(([label, color]) => (
                      <span key={label} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} aria-hidden="true" />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Layer 4: Medication Inventory */}
          <div className="bg-card border border-border rounded-3xl p-6 shadow-sm space-y-4">
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
                <p className="font-black text-success mt-1">Inventory Balanced</p>
                <p className="text-[10px] text-muted-foreground font-semibold">All medication stock levels are sufficient.</p>
              </div>
            )}
          </div>

          {/* Layer 5: Care Circle.
              This was a full-bleed saturated pink gradient sitting directly below plain
              white cards — the loudest surface on the page attached to the least urgent
              information, so the eye jumped past the inventory warnings to get to it.
              Now a tinted surface: still clearly the Care Circle, no longer shouting.
              It also dropped a one-off teal CTA (#5EEAD4) that matched nothing else. */}
          <div className="relative overflow-hidden isolate bg-primary-soft border border-primary/20 rounded-3xl p-6 shadow-sm space-y-5">
            <div className="flex justify-between items-center gap-3">
              <div>
                <h3 className="font-black text-foreground text-sm">Care Circle</h3>
                <p className="text-[11px] text-muted-foreground">Manage sharing &amp; family relationships</p>
              </div>
              <Link
                href="/care-circle"
                className="shrink-0 inline-flex items-center h-11 px-4 rounded-full bg-card border border-border hover:bg-muted text-foreground transition-all text-xs font-bold shadow-sm"
              >
                Open Hub
              </Link>
            </div>

            <div className="space-y-4">
              {/* Patient side first — same order as /care-circle. */}
              <div className="space-y-2">
                <Eyebrow>{CARE_LABELS.asPatient} ({peopleCaringForMe.length})</Eyebrow>
                {peopleCaringForMe.length > 0 ? (
                  <div className="space-y-2">
                    {peopleCaringForMe.slice(0, 3).map((conn) => {
                      const initials = conn.resolved_name?.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'C';
                      return (
                        <div key={conn.connection_id} className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-card border border-border">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-black">
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-black text-foreground truncate">{conn.resolved_name}</p>
                              <p className="text-[11px] font-bold text-muted-foreground uppercase">{conn.relationship_type}</p>
                            </div>
                          </div>
                          <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase">
                            {conn.connection_status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Was 10px white-on-pink at 70% opacity — the least readable text on
                     the dashboard — and it offered no way to fix the emptiness. */
                  <EmptyState
                    bare
                    className="bg-card/60 border border-dashed border-border rounded-2xl"
                    title="No caregivers yet"
                    description="Invite someone who should know if you miss a dose."
                    action={{ label: 'Invite someone', href: '/settings#care-circle' }}
                  />
                )}
              </div>

              <div className="space-y-2">
                <Eyebrow>{CARE_LABELS.asCaregiver} ({peopleICareFor.length})</Eyebrow>
                {peopleICareFor.length > 0 ? (
                  <div className="space-y-2">
                    {peopleICareFor.slice(0, 3).map((conn) => {
                      const initials = conn.resolved_name?.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'P';
                      return (
                        <div key={conn.connection_id} className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-card border border-border">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-black">
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-black text-foreground truncate">{conn.resolved_name}</p>
                              <p className="text-[11px] font-bold text-muted-foreground uppercase">{conn.relationship_type}</p>
                            </div>
                          </div>
                          <Link
                            href={`/care-circle/${conn.patient_telegram_id}`}
                            className="shrink-0 inline-flex items-center h-11 px-3 rounded-full bg-muted hover:bg-accent-surface text-xs font-bold text-foreground transition-all"
                          >
                            Overview
                          </Link>
                        </div>
                      );
                    })}
                    {peopleICareFor.length > 3 && (
                      <p className="text-[11px] text-center text-muted-foreground">
                        + {peopleICareFor.length - 3} more. <Link href="/care-circle" className="text-primary font-bold underline">View all</Link>
                      </p>
                    )}
                  </div>
                ) : (
                  <EmptyState
                    bare
                    className="bg-card/60 border border-dashed border-border rounded-2xl"
                    title="Not caring for anyone yet"
                    description="Requests to become someone's caregiver show up here."
                  />
                )}
              </div>
            </div>
          </div>

        </div>

      </div>

      </div>

      {/* Toast Notifications */}
      <PremiumToast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </>
  );
}
