'use client';


import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUiMode } from '@/context/ui-mode-context';
import TodaysSchedule, { ReminderEvent } from '@/components/dashboard/todays-schedule';
import MedicationReviewQueue from '@/components/dashboard/medication-review-queue';
import { registerPush } from '@/lib/push/register-push';
import dynamic from 'next/dynamic';
import { resolveReminderEvent } from '@/lib/reminder-events';
import { PremiumToast } from '@/components/ui/premium-toast';
import MedDueGate from '@/components/dashboard/med-due-gate';
import BrainMascot from '@/components/dashboard/brain-mascot';
import GuideButton from '@/components/guide/guide-button';
import moment from 'moment-timezone';

const CaregiverConsole = dynamic(() => import('@/components/dashboard/caregiver-console'), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-xs text-muted-foreground bg-white border border-border/80 rounded-3xl animate-pulse">Loading Caregiver Command Center...</div>
});

// Subtle translucent bubbles for the pink cards — present but faint, mixed sizes, scattered.
// Deterministic positions (no Math.random) to avoid hydration mismatches.
const PinkBubbles = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden !m-0">
    <span className="absolute rounded-full bg-white/10" style={{ width: 150, height: 150, top: -45, left: -35 }} />
    <span className="absolute rounded-full bg-white/[0.06]" style={{ width: 96, height: 96, bottom: -28, right: 28 }} />
    <span className="absolute rounded-full bg-white/[0.07]" style={{ width: 56, height: 56, top: 28, right: -16 }} />
    <span className="absolute rounded-full bg-white/[0.08]" style={{ width: 38, height: 38, bottom: 26, left: 40 }} />
    <span className="absolute rounded-full bg-white/[0.05]" style={{ width: 22, height: 22, top: 64, left: '44%' }} />
    <span className="absolute rounded-full bg-white/[0.09]" style={{ width: 30, height: 30, top: 14, right: '36%' }} />
  </div>
);

import { createClient } from '@/lib/supabase/client';
import { SpoonIcon, CreamBottleIcon, TabletIcon } from '@/components/ui/custom-icons';
import { getSeverityTheme } from '@/lib/severity-theme';
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
  CircleDot,
  Beaker,
  Droplets,
  Wind,
  Sparkles,
  Sun,
  CloudSun,
  Moon,
  Circle,
  Lock,
  ChevronDown,
  Utensils,
  Bandage
} from 'lucide-react';

const FEATURE_FLAG_ENABLE_PILL_SLIDER = false;

const getUnitIcon = (unitType?: string, className: string = "w-6 h-6") => {
  const type = unitType?.toUpperCase() || 'TABLET';
  switch (type) {
    case 'TABLET':
      return <TabletIcon className={className} />;
    case 'CAPSULE':
      return <Pill className={className} />;
    case 'ML':
    case 'LIQUID':
      return <Beaker className={className} />;
    case 'DROP':
    case 'DROPS':
      return <Droplets className={className} />;
    case 'SPRAY':
      return <Wind className={className} />;
    case 'APPLICATION':
      return <CreamBottleIcon className={className} />;
    case 'TEASPOON':
      return <SpoonIcon className={className} />;
    case 'PATCH':
      return <Bandage className={className} />;
    case 'POWDER':
      return <Sparkles className={className} />;
    case 'INHALER':
    case 'INHALATION':
      return <Wind className={className} />;
    case 'OTHER':
      return <Package className={className} />;
    default:
      return <CircleDot className={className} />;
  }
};

const getCountdownText = (scheduledForStr: string) => {
  const scheduledTime = new Date(scheduledForStr).getTime();
  const now = new Date().getTime();
  const diffMs = scheduledTime - now;
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 0) {
    const overdueMins = Math.abs(diffMins);
    if (overdueMins < 60) {
      return `Missed ${overdueMins} min ago`;
    } else {
      const overdueHours = Math.floor(overdueMins / 60);
      const remainingMins = overdueMins % 60;
      if (remainingMins === 0) {
        return `Missed ${overdueHours} hour${overdueHours > 1 ? 's' : ''} ago`;
      }
      return `Missed ${overdueHours}h ${remainingMins}m ago`;
    }
  } else {
    if (diffMins < 60) {
      return `Due in ${diffMins} min`;
    } else {
      const dueHours = Math.floor(diffMins / 60);
      const remainingMins = diffMins % 60;
      return `Due in ${dueHours}h ${remainingMins}m`;
    }
  }
};

interface MedicationSliderProps {
  event: any;
  onResolve: (action: 'TAKEN' | 'SKIP') => void;
}

const MedicationSlider = ({ event, onResolve }: MedicationSliderProps) => {
  const [position, setPosition] = useState(0); // in pixels
  const [progress, setProgress] = useState(0); // -100 (skip) .. 100 (take)
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = React.useRef<HTMLDivElement>(null);
  // Refs mirror the live drag state so window-listener handlers read current
  // values without the effect re-subscribing on every pixel (the prior cause of jank).
  const positionRef = React.useRef(0);
  const draggingRef = React.useRef(false);

  const handleStart = () => {
    draggingRef.current = true;
    setIsDragging(true);
  };

  const handleMove = (clientX: number) => {
    if (!draggingRef.current || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const width = rect.width;
    const center = rect.left + width / 2;
    const offset = clientX - center;
    const maxOffset = width / 2 - 28; // ~knob radius
    const percentage = Math.max(-100, Math.min(100, (offset / maxOffset) * 100));
    const px = (percentage / 100) * maxOffset;
    positionRef.current = px;
    setPosition(px);
    setProgress(percentage);
  };

  const handleEnd = () => {
    if (!draggingRef.current || !trackRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    const rect = trackRef.current.getBoundingClientRect();
    const maxOffset = rect.width / 2 - 28;
    const threshold = maxOffset * 0.7;
    const pos = positionRef.current;

    if (pos >= threshold) {
      onResolve('TAKEN');
    } else if (pos <= -threshold) {
      onResolve('SKIP');
    }
    positionRef.current = 0;
    setPosition(0);
    setProgress(0);
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onMouseUp = () => handleEnd();
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) handleMove(e.touches[0].clientX);
    };
    const onTouchEnd = () => handleEnd();

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  const takeIntensity = Math.max(0, progress) / 100; // 0..1 dragging right (take)
  const skipIntensity = Math.max(0, -progress) / 100; // 0..1 dragging left (skip)
  const armedTake = progress > 45;
  const armedSkip = progress < -45;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Slide left to skip, right to take this medication"
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      className="relative w-full h-14 rounded-full overflow-hidden border border-border flex items-center justify-between px-5 select-none bg-muted shadow-inner"
    >
      {/* Directional fills that intensify as the knob travels */}
      <div
        className="absolute inset-y-0 left-0 w-1/2 bg-danger/35 pointer-events-none transition-opacity duration-75"
        style={{ opacity: skipIntensity }}
      />
      <div
        className="absolute inset-y-0 right-0 w-1/2 bg-success/35 pointer-events-none transition-opacity duration-75"
        style={{ opacity: takeIntensity }}
      />

      <span className={`relative z-10 flex items-center gap-1 text-[11px] font-black transition-colors ${armedSkip ? 'text-danger' : 'text-danger/70'}`}>
        <X className="w-3.5 h-3.5 shrink-0" /> Skip
      </span>
      <span
        className="relative z-10 text-[10px] font-black uppercase tracking-wider text-muted-foreground transition-opacity"
        style={{ opacity: 1 - Math.min(1, Math.abs(progress) / 60) }}
      >
        Slide to confirm
      </span>
      <span className={`relative z-10 flex items-center gap-1 text-[11px] font-black transition-colors ${armedTake ? 'text-success' : 'text-success/70'}`}>
        Take <Check className="w-3.5 h-3.5 shrink-0" />
      </span>

      <div
        onMouseDown={handleStart}
        onTouchStart={handleStart}
        style={{
          transform: `translateX(calc(-50% + ${position}px))`,
          left: '50%',
          willChange: 'transform',
          transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}
        className={`absolute top-1 z-20 w-12 h-12 rounded-full bg-white shadow-lg border-2 cursor-grab active:cursor-grabbing flex items-center justify-center touch-none transition-colors ${
          armedTake ? 'border-success/60 text-success' : armedSkip ? 'border-danger/60 text-danger' : 'border-border text-primary'
        }`}
      >
        {armedTake ? <Check className="w-5 h-5" /> : armedSkip ? <X className="w-5 h-5" /> : getUnitIcon(event.medications?.unit_type, 'w-5 h-5')}
      </div>
    </div>
  );
};

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
  lowStockMedicines: { drug_name: string; tablet_count: number }[];
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
  const [scheduleOverrides, setScheduleOverrides] = useState<
    { medicationId: number; dateStr: string; overriddenTime?: string; isSkipped?: boolean }[]
  >([]);
  // Doses the user chose "remind me later" on → suppressed until this epoch ms.
  // (The 60s `currentTime` clock below re-renders, so the gate re-evaluates live.)
  const [snoozedUntil, setSnoozedUntil] = useState<Record<number, number>>({});
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
    const todayDateStr = now.toISOString().split('T')[0];

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
          const ov = scheduleOverrides.find(
            (o) => o.medicationId === med.id && o.dateStr === todayDateStr
          );
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
          // comparing hours/minutes in the medication's timezone (not browser local)
          const eventExists = dbEventsToday.some((e) => {
            const em = moment(e.scheduled_for).tz(medTz);
            return (
              e.medication_id === med.id &&
              em.hours() === hours &&
              em.minutes() === minutes
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
  const todayMissed = events.filter(e => e.reminder_status === 'MISSED').length;
  const activeEscalations = events.filter(e => e.reminder_status === 'ESCALATED_TO_CG' || e.reminder_status === 'ESCALATED').length;
  const todayTotal = events.length;

  const isGravityState = activeEscalations > 0 || todayMissed > 0;

  // Find next pending event. This must include the REAL reminder_events statuses the scheduler
  // writes once a dose fires (SENT, GENTLE_REMINDER, ESCALATED, …) — otherwise a dose vanishes
  // from "Next Medication" the moment its time arrives (when the virtual FUTURE_SCHEDULED event
  // is replaced by a real SENT row). It should stay until the patient takes or skips it.
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

  const heroMood = activeEscalations > 0 || todayMissed > 0 ? 'concerned' : nextPendingEvent ? 'happy' : 'proud';
  const upcomingCount = events.filter(e => isPendingState(e.reminder_status)).length;
  const activeEvent = hoveredEvent || selectedEvent;

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
  // "Remind me later" — suppress this dose for 30 min (persisted), then it returns.
  const handleGateSnooze = (eventId: number) => {
    const until = Date.now() + 30 * 60 * 1000;
    setSnoozedUntil(prev => {
      const next = { ...prev, [eventId]: until };
      try { localStorage.setItem('medGateSnoozes', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
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
    
    const hasActiveAlarm = periodEvents.some(e => ['MISSED', 'ESCALATED_TO_CG'].includes(e.reminder_status));
    if (hasActiveAlarm) return 'missed';
    
    const hasPending = periodEvents.some(e => ['PENDING_PATIENT', 'RETRYING_PATIENT', 'SNOOZED', 'FUTURE_SCHEDULED'].includes(e.reminder_status));
    const allTaken = periodEvents.every(e => ['TAKEN', 'RESOLVED_BY_CG'].includes(e.reminder_status));
    
    if (allTaken) return 'taken';
    if (hasPending) return 'pending';
    return 'empty';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'TAKEN':
      case 'RESOLVED_BY_CG':
        return '#7ED9A3'; // Success Green
      case 'MISSED':
      case 'ESCALATED_TO_CG':
        return '#FF9FA5'; // Critical Coral
      case 'SKIPPED':
        return '#FFD48A'; // Warning Orange
      case 'SNOOZED':
        return '#5B8DEF'; // Floating Blue
      default:
        return '#B8C6FF'; // Lavender Accent
    }
  };

  // ==========================================
  // ELDERLY MODE VIEW (Strictly Show ONLY: 1. Next Medication, 2. Today's Progress, 3. Low Stock Alerts)
  // ==========================================
  if (isElderly) {
    const progressPercentage = todayTotal > 0 ? Math.round((todayTaken / todayTotal) * 100) : 100;

    return (
      <>
        {dueGate}
        <div className={`space-y-8 w-full max-w-4xl mx-auto transition-colors duration-500 ${isGravityState ? 'pb-24' : ''}`}>
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
                  className="bg-primary text-primary-foreground font-black px-8 py-3 rounded-xl text-xl cursor-pointer hover:bg-primary-hover transition-all shadow-md shrink-0"
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
            <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 border-4 border-indigo-500/30 p-5 rounded-2xl flex flex-col sm:flex-row items-center justify-between text-foreground gap-4">
              <span className="text-xl font-black text-center sm:text-left flex items-start gap-2">
                <Plus className="w-8 h-8 text-indigo-500 shrink-0" />
                <span>To receive push reminders on iOS, install Re-MIND-eЯ: tap the Share button and select 'Add to Home Screen'.</span>
              </span>
              <button
                onClick={() => {
                  localStorage.setItem('dismissedIosPwaBanner', 'true');
                  setShowIosPwaBanner(false);
                }}
                className="bg-indigo-500 text-white font-black px-8 py-3 rounded-xl text-xl cursor-pointer hover:bg-indigo-600 transition-all shadow-md shrink-0"
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
              className="bg-primary text-primary-foreground font-black px-8 py-3 rounded-xl text-xl cursor-pointer hover:bg-primary-hover transition-all shadow-md shrink-0"
            >
              Switch to Normal View
            </button>
          </div>
  
          {/* 1. NEXT MEDICATION */}
          <div className={`bg-card rounded-3xl p-8 border border-border shadow-sm space-y-6 ${
            nextPendingEvent?.reminder_status === 'ESCALATED_TO_CG' || nextPendingEvent?.medications.priority_level === 'critical'
              ? 'border-danger animate-red-glow bg-danger/5' 
              : 'border-primary'
          }`}>
            <h2 className="text-3xl font-black text-muted-foreground tracking-tight uppercase flex items-center gap-2">
              <Clock className="w-8 h-8 text-primary" /> Next Medication
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
                ) : (new Date(nextPendingEvent.scheduled_for).getTime() <= new Date().getTime()) ? (
                  <div className="space-y-4 mt-6">
                    {dueNowEvents.length > 1 && (
                      <button
                        onClick={() => handleResolveAll('TAKEN')}
                        disabled={updatingId !== null}
                        className="w-full h-[72px] flex items-center justify-center gap-2 text-2xl font-black rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer shadow-lg disabled:opacity-50"
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
                    <span>Options will become available at {mounted ? new Date(nextPendingEvent.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
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
                onClick={() => {
                  alert("Contact Request Sent. Your caregiver has been notified to assist you.");
                }}
                className="w-full h-[88px] flex items-center justify-center text-2xl font-black rounded-2xl bg-warning text-warning-foreground hover:bg-warning/95 active:scale-[0.98] transition-all cursor-pointer shadow-md gap-2"
              >
                <Phone className="w-8 h-8" /> Request Caregiver Contact
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
  
            <div className="flex justify-between text-2xl font-bold text-muted-foreground">
              <span>Started</span>
              {progressPercentage === 100 ? (
                <span className="text-success font-black">Done for the day!</span>
              ) : (
                <span>Remaining: {todayTotal - todayTaken} doses</span>
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
                    <span className="text-2xl font-black text-danger">{m.tablet_count} left</span>
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
      <div className={`space-y-8 w-full transition-all duration-500 relative ${isGravityState ? 'gravity-active' : ''}`}>

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
              className="px-5 py-2.5 bg-primary text-primary-foreground text-xs font-black rounded-full hover:scale-105 active:scale-95 transition-all shadow-md cursor-pointer w-full sm:w-auto text-center"
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
        <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 border border-indigo-500/20 dark:border-indigo-500/30 rounded-3xl p-5 shadow-lg relative overflow-hidden flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in z-45">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-black text-foreground">Add to Home Screen (iOS)</h4>
              <p className="text-xs text-muted-foreground font-semibold mt-0.5">
                To receive push reminders on iOS, install Re-MIND-eЯ: tap the <span className="font-bold text-indigo-600 dark:text-indigo-400">Share</span> button (box with an up arrow) and select <span className="font-bold text-indigo-600 dark:text-indigo-400">"Add to Home Screen"</span>.
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
              <span className="text-2xl mb-2 group-hover:scale-110 transition-transform">💊</span>
              <span className="text-xs font-black text-foreground">Manage my medications</span>
              <span className="text-[10px] text-muted-foreground mt-1 font-semibold leading-relaxed">Add drug inventory, schedule recurring reminder times, and log intake.</span>
            </Link>

            <Link
              href="/settings"
              className="flex flex-col items-center text-center p-5 border border-border hover:border-primary/40 bg-card hover:bg-primary/[0.02] rounded-2xl cursor-pointer transition-all hover:scale-[1.02] group"
            >
              <span className="text-2xl mb-2 group-hover:scale-110 transition-transform">🤝</span>
              <span className="text-xs font-black text-foreground">Invite someone to support me</span>
              <span className="text-[10px] text-muted-foreground mt-1 font-semibold leading-relaxed">Share your profile access code so family members can monitor adherence.</span>
            </Link>

            <Link
              href="/settings"
              className="flex flex-col items-center text-center p-5 border border-border hover:border-primary/40 bg-card hover:bg-primary/[0.02] rounded-2xl cursor-pointer transition-all hover:scale-[1.02] group"
            >
              <span className="text-2xl mb-2 group-hover:scale-110 transition-transform">👨‍⚕️</span>
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
              <span className="text-2xl mb-2 group-hover:scale-110 transition-transform">⏭️</span>
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
            <span className="text-[10px] font-black text-primary uppercase tracking-wider">Patient Name</span>
            <h3 className="text-sm font-black text-foreground mt-0.5">{patientName}</h3>
          </div>
          
          <div className="md:col-span-1 border-b md:border-b-0 md:border-r border-primary/10 pb-3 md:pb-0 md:pr-4 flex flex-col justify-center">
            <span className="text-[10px] font-black text-primary uppercase tracking-wider">Compliance Rate</span>
            <h3 className="text-sm font-black text-foreground mt-0.5">{monthlyAdherence}% Adherence</h3>
          </div>

          <div className="md:col-span-1 border-b md:border-b-0 md:border-r border-primary/10 pb-3 md:pb-0 md:pr-4 flex flex-col justify-center">
            <span className="text-[10px] font-black text-primary uppercase tracking-wider">Last Taken Dose</span>
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
            <span className="text-[10px] font-black text-primary uppercase tracking-wider">Next Dose</span>
            <h3 className="text-xs font-black text-foreground mt-0.5 truncate" title={nextPendingEvent ? `${nextPendingEvent.medications.drug_name} at ${mounted ? new Date(nextPendingEvent.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}` : 'All caught up!'}>
              {nextPendingEvent 
                ? `${nextPendingEvent.medications.drug_name} (${mounted ? new Date(nextPendingEvent.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'})`
                : 'All caught up!'}
            </h3>
          </div>

          <div className="md:col-span-1 flex flex-col justify-center">
            <span className="text-[10px] font-black text-primary uppercase tracking-wider">Alert Status</span>
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
          {/* Mascot accent filling the card's empty space */}
          <BrainMascot
            size={96}
            mood={heroMood}
            className="absolute right-3 sm:right-6 top-[42%] -translate-y-1/2 opacity-90 pointer-events-none select-none"
          />
          <div>
            <div className="flex justify-between items-start gap-4">
              <div className="min-w-0 flex-1">
                <p className={`text-[10px] font-bold uppercase tracking-widest ${
                  isMissed ? 'text-danger' : onGradient ? 'text-white/90' : 'text-muted-foreground'
                }`}>
                  {isMissed ? 'Missed Medication' : 'Next Medication'}
                </p>
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
                        <p>
                          Dosage: <b className={`font-mono ${onGradient ? 'text-white' : 'text-foreground'}`}>
                            {nextPendingEvent.medications.dosage_amount 
                              ? `${nextPendingEvent.medications.dosage_amount} ${nextPendingEvent.medications.unit_type?.toLowerCase() || 'unit'}(s)`
                              : ''}
                            {nextPendingEvent.medications.dosage_amount && nextPendingEvent.medications.dosage ? ' - ' : ''}
                            {nextPendingEvent.medications.dosage || ''}
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
                  <div className="mt-4 flex items-center gap-3 text-success">
                    <CheckCircle className="w-8 h-8 shrink-0" />
                    <div>
                      <h3 className="text-lg font-black tracking-tight">All caught up!</h3>
                      <p className="text-xs text-muted-foreground font-semibold mt-0.5">You have taken all scheduled medications for today.</p>
                    </div>
                  </div>
                )}
              </div>
              
              {nextPendingEvent && (
                <div className="flex flex-col items-end gap-1 shrink-0 font-mono text-right">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black border transition-colors ${
                    isMissed
                      ? 'bg-danger/15 text-danger border-danger/25'
                      : onGradient
                        ? 'bg-white/20 text-white border-white/30'
                        : 'bg-primary/15 text-primary border-primary/25'
                  }`}>
                    {mounted ? getCountdownText(nextPendingEvent.scheduled_for) : 'UPCOMING'}
                  </span>
                  <span className={`text-lg font-black mt-1 transition-colors ${
                    isMissed ? 'text-danger' : onGradient ? 'text-white' : 'text-primary'
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
            ) : (new Date(nextPendingEvent.scheduled_for).getTime() <= new Date().getTime()) ? (
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
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-success/20 backdrop-blur-md border border-success/40 text-success text-xs font-black rounded-full hover:bg-success/30 active:scale-[0.98] transition-all cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" /> Take Now
                  </button>
                  <button
                    onClick={() => handleElderlyTakeNow(nextPendingEvent, 'SKIP')}
                    disabled={updatingId !== null}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white/55 backdrop-blur-md border border-white/70 text-muted-foreground text-xs font-bold rounded-full hover:bg-white/80 active:scale-[0.98] transition-all cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    <X className="w-4 h-4" /> Skip
                  </button>
                  {dueNowEvents.length > 1 && (
                    <button
                      onClick={() => handleResolveAll('TAKEN')}
                      disabled={updatingId !== null}
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-primary text-primary-foreground text-xs font-black rounded-full hover:bg-primary/90 active:scale-[0.98] transition-all cursor-pointer shadow-sm disabled:opacity-50"
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
                <span>Options will become available at {mounted ? new Date(nextPendingEvent.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
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
                        <p className="text-[7px] font-black text-muted-foreground uppercase tracking-widest mt-0.5">
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
            let bgClass = 'bg-white/10 backdrop-blur-md text-white/70 border-white/20';
            let statusIcon = <Circle className="w-5 h-5 opacity-50 shrink-0" />;

            if (item.period === 'taken') {
              bgClass = 'bg-white/20 backdrop-blur-md text-white border-white/35';
              statusIcon = <Check className="w-5 h-5 shrink-0" />;
            } else if (item.period === 'pending') {
              bgClass = 'bg-white/20 backdrop-blur-md text-white border-white/35';
              statusIcon = <Clock className="w-5 h-5 animate-pulse shrink-0" />;
            } else if (item.period === 'missed') {
              bgClass = 'bg-white/20 backdrop-blur-md text-white border-white/35';
              statusIcon = <X className="w-5 h-5 shrink-0" />;
            }

            return (
              <div key={idx} className={`p-2 rounded-2xl border flex flex-col items-center justify-center gap-2 min-h-[78px] ${bgClass}`}>
                <span className="text-[9px] font-black font-mono tracking-tight flex flex-col items-center gap-1 w-full">
                  {item.icon}
                  <span className="truncate max-w-full">{item.label}</span>
                </span>
                <span>{statusIcon}</span>
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
            <Link
              href="/medications"
              className="px-4 py-2 text-xs font-black rounded-full bg-primary text-primary-foreground hover:bg-primary-hover hover:scale-105 active:scale-95 transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
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

            {/* Weekly rings — center number = doses taken; teal = taken, amber = skipped, uncoloured = missed.
                Laid out like the Olympic rings: 4 on top, 3 nestled below. */}
            {(() => {
              const days = chartData.slice(-7);
              const renderRing = (d: { date: string; Taken: number; Skipped: number; Missed: number }, idx: number) => {
                const taken = d.Taken || 0;
                const skipped = d.Skipped || 0;
                const total = taken + skipped + (d.Missed || 0);
                const dayNum = String(d.date).split(' ')[0];
                const C = 2 * Math.PI * 15.5;
                const takenLen = total > 0 ? C * (taken / total) : 0;
                const skippedLen = total > 0 ? C * (skipped / total) : 0;
                return (
                  <div key={idx} className="flex flex-col items-center gap-1" title={`${d.date}: ${taken} taken, ${skipped} skipped, ${d.Missed || 0} missed`}>
                    <div className="relative w-14 h-14">
                      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                        {/* Track = missed / no data (uncoloured) */}
                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--muted)" strokeWidth="3" />
                        {/* Taken (green) */}
                        {takenLen > 0 && (
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--success)" strokeWidth="3"
                            strokeDasharray={`${takenLen} ${C - takenLen}`} strokeDashoffset={0} />
                        )}
                        {/* Skipped (amber), placed right after the taken arc */}
                        {skippedLen > 0 && (
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--warning)" strokeWidth="3"
                            strokeDasharray={`${skippedLen} ${C - skippedLen}`} strokeDashoffset={-takenLen} />
                        )}
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-sm font-black text-foreground tabular-nums">
                        {taken}
                      </span>
                    </div>
                    <span className="text-[10px] font-bold text-muted-foreground tabular-nums">{dayNum}</span>
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
                </div>
              );
            })()}
          </div>

          {/* Layer 4: Medication Inventory */}
          <div className="bg-card border border-border rounded-3xl p-6 shadow-sm space-y-4">
            <div>
              <h3 className="font-black text-foreground text-sm">Medication Inventory</h3>
              <p className="text-[11px] text-muted-foreground">Current tablet counts and alerts</p>
            </div>

            {lowStockCount > 0 ? (
              <div className="space-y-2">
                <div className="bg-warning/10 border border-warning/35 p-3 rounded-xl flex items-center gap-2 text-warning-foreground text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0 text-warning" />
                  <span>Refill recommended for:</span>
                </div>
                {lowStockMedicines.map((m, idx) => (
                  <div key={idx} className="bg-muted px-4 py-3 rounded-2xl border border-border flex justify-between items-center text-xs font-mono">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                      <span className="font-black text-foreground truncate">{m.drug_name}</span>
                    </div>
                    <span className="font-black text-danger shrink-0 bg-danger/10 px-2.5 py-1 rounded-lg border border-danger/20">
                      {m.tablet_count} left
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-success/5 border border-success/20 p-4 rounded-2xl text-center text-xs space-y-1">
                <Package className="w-8 h-8 text-success mx-auto mb-2" />
                <p className="font-black text-success mt-1">Inventory Balanced</p>
                <p className="text-[10px] text-muted-foreground font-semibold">All medication stock levels are sufficient.</p>
              </div>
            )}
          </div>

          {/* Layer 5: Care Circle */}
          <div className="relative overflow-hidden isolate bg-gradient-to-br from-[#F8839E] to-[#F26B8A] text-white border border-transparent rounded-3xl p-6 shadow-sm shadow-primary/20 space-y-5">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-black text-white text-sm">Care Circle</h3>
                <p className="text-[11px] text-white/80">Manage sharing & family relationships</p>
              </div>
              <Link
                href="/care-circle"
                className="px-3 py-1.5 rounded-full bg-[#5EEAD4] border border-transparent hover:bg-[#2DD4BF] text-[#0F766E] transition-all text-[10px] font-bold shadow-sm"
              >
                Open Hub
              </Link>
            </div>
            
            <div className="space-y-4">
              {/* Sub-List 1: People I Care For */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase font-bold text-white/80">People I Care For ({peopleICareFor.length})</p>
                {peopleICareFor.length > 0 ? (
                  <div className="space-y-2">
                    {peopleICareFor.slice(0, 3).map((conn) => {
                      const initials = conn.resolved_name?.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'P';
                      return (
                        <div key={conn.connection_id} className="flex items-center justify-between p-3 rounded-2xl bg-white/15 backdrop-blur-md border border-white/25">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#CCFBF1] text-[#0D9488] flex items-center justify-center text-xs font-black">
                              {initials}
                            </div>
                            <div>
                              <p className="text-xs font-black text-white">{conn.resolved_name}</p>
                              <p className="text-[9px] font-bold text-white/70 uppercase">{conn.relationship_type}</p>
                            </div>
                          </div>
                          <Link
                            href={`/care-circle/${conn.patient_telegram_id}`}
                            className="px-2.5 py-1 rounded-full bg-white/20 hover:bg-white/30 text-[10px] font-bold text-white border border-white/30 transition-all"
                          >
                            Overview
                          </Link>
                        </div>
                      );
                    })}
                    {peopleICareFor.length > 3 && (
                      <p className="text-[10px] text-center text-white/70">
                        + {peopleICareFor.length - 3} more. <Link href="/care-circle" className="text-white font-bold underline">View all</Link>
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-white/70 border border-dashed border-white/40 rounded-xl p-3 text-center">
                    No active patients linked yet.
                  </p>
                )}
              </div>

              {/* Sub-List 2: People Caring For Me */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase font-bold text-white/80">People Caring For Me ({peopleCaringForMe.length})</p>
                {peopleCaringForMe.length > 0 ? (
                  <div className="space-y-2">
                    {peopleCaringForMe.slice(0, 3).map((conn) => {
                      const initials = conn.resolved_name?.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'C';
                      return (
                        <div key={conn.connection_id} className="flex items-center justify-between p-3 rounded-2xl bg-white/15 backdrop-blur-md border border-white/25">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#CCFBF1] text-[#0D9488] flex items-center justify-center text-xs font-black">
                              {initials}
                            </div>
                            <div>
                              <p className="text-xs font-black text-white">{conn.resolved_name}</p>
                              <p className="text-[9px] font-bold text-white/70 uppercase">{conn.relationship_type}</p>
                            </div>
                          </div>
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white border border-white/30 uppercase">
                            {conn.connection_status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10px] text-white/70 border border-dashed border-white/40 rounded-xl p-3 text-center">
                    No active caregivers linked yet.
                  </p>
                )}
              </div>
            </div>
            <PinkBubbles />
          </div>

        </div>

      </div>

      </div>

      {/* Toast Notifications */}
      <PremiumToast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </>
  );
}
