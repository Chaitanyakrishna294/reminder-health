'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Clock,
  Edit2,
  Plus,
  ChevronLeft,
  ChevronRight,
  Sunrise,
  Sun,
  Sunset,
  Moon,
  RotateCcw,
  X,
  Grid3x3,
  Minus,
  GripVertical,
  Info,
} from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';
import LoadingMark from '@/components/ui/loading-mark';
import { createClient } from '@/lib/supabase/client';
import {
  type OverrideEntry,
  parseTimeToMinutes,
  toOverrideDateStr,
} from '@/lib/schedule/dose-engine';
import { PRIORITY, TONE_VAR, priorityMeta } from '@/lib/design/semantics';
import { fetchDoseHistory, dosesForDate, type DayDose, type DoseHistory } from '@/lib/schedule/day-doses';

// One definition of a dose, shared with the Medications page (lib/schedule/day-doses).
type ScheduledMed = DayDose;


const HOUR_HEIGHT = 64; // px per hour on the timeline rail

// Time-of-day shading. Previously each band borrowed a STATUS hue — orange for morning,
// green for afternoon, pink for evening — the same three colors the priority dots use,
// at low alpha. On one screen, orange meant both "before noon" and "important dose".
// Bands are background information, so they get one neutral hue at four depths and stay
// out of the way of anything that encodes state.
//
// `showLabel` suppresses the duplicate on the 9pm-midnight band: it is the same night as
// the midnight-5am one, split only because the rail starts at 00:00.
const DAY_BANDS = [
  { from: 0, to: 5, label: 'Night', icon: Moon, color: 'rgba(15,28,90,0.055)', showLabel: true },
  { from: 5, to: 12, label: 'Morning', icon: Sunrise, color: 'rgba(15,28,90,0.012)', showLabel: true },
  { from: 12, to: 17, label: 'Afternoon', icon: Sun, color: 'rgba(15,28,90,0.025)', showLabel: true },
  { from: 17, to: 21, label: 'Evening', icon: Sunset, color: 'rgba(15,28,90,0.04)', showLabel: true },
  { from: 21, to: 24, label: 'Night', icon: Moon, color: 'rgba(15,28,90,0.055)', showLabel: false },
];

function formatTimeLabel(t: string): string {
  const mins = parseTimeToMinutes(t);
  if (mins === null) return t;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + m.toString().padStart(2, '0') + ' ' + ap;
}

function hourLabel(h: number): string {
  if (h === 0) return '12a';
  if (h < 12) return h + 'a';
  if (h === 12) return '12p';
  return (h - 12) + 'p';
}

// Routine used to be pink here — the same pink as the brand, the primary CTA and the
// Evening chart band, so a dot could mean three different things on one screen.
const priorityColor = (p: string) => TONE_VAR[priorityMeta(p).tone];

// Soft diffuse card shadow shared with the Medications page.
const CARD_SHADOW = '0 1px 3px rgba(16, 28, 90, 0.04), 0 10px 30px rgba(16, 28, 90, 0.06)';

interface DoseCardProps {
  med: ScheduledMed;
  groupMinutes: number;
  canEdit: boolean;
  dragging: { medId: number; originalMinutes: number; currentMinutes: number; startY: number } | null;
  openOverride: (med: ScheduledMed) => void;
  handleRemoveOverride: (id: number) => void;
  startDrag: (e: React.PointerEvent, medId: number, minutes: number) => void;
  onDragMove: (e: React.PointerEvent, medId: number) => void;
  endDrag: (medId: number) => void;
  setDragging: (v: null) => void;
  /** Below sm the card stacks into two rows so the medication name stays legible. */
  narrow: boolean;
  /** Past doses open a read-only detail instead of the adjust controls. */
  openDetail: (med: ScheduledMed) => void;
}

function DoseCard({
  med, groupMinutes, canEdit, dragging,
  openOverride, handleRemoveOverride,
  startDrag, onDragMove, endDrag, setDragging, narrow, openDetail,
}: DoseCardProps) {
  const isDraggingThis = dragging?.medId === med.id;
  const accent = med.isSkipped ? 'var(--muted-foreground)' : priorityColor(med.priority_level);
  // These were hardcoded light hexes (#FFFFFF / #F2F2F7 / #FFF3E0 / #FFEDF2). Because
  // they are inline styles, globals.css's dark-mode compat layer — which only rewrites
  // `.bg-white` and friends — could not reach them, so in dark mode the card stayed
  // white while the name rendered in light `--foreground` ink: unreadable.
  const cardBg = med.isSkipped
    ? 'var(--muted)'
    : med.isOverridden
      ? 'color-mix(in srgb, var(--warning) 12%, var(--card))'
      : isDraggingThis
        ? 'var(--primary-soft)'
        : 'var(--card)';
  const displayTime = isDraggingThis && dragging
    ? formatTimeLabel(
        Math.floor(dragging.currentMinutes / 60).toString().padStart(2, '0') + ':' +
        (dragging.currentMinutes % 60).toString().padStart(2, '0')
      )
    : formatTimeLabel(med.time);

  // Row 1 is the identity (what medication, how much). Row 2 is the state and the
  // controls. On a wide screen both sit on one line; below `sm` they stack, because a
  // 240px column cannot fit 44px of drag handle + 44px of button + a time pill and
  // still leave the NAME legible — and the name is the point of the row.
  const nameBlock = (
    <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
      <p className={'text-[12px] font-bold truncate ' + (med.isSkipped ? 'text-muted-foreground line-through' : 'text-foreground')}>
        {med.drug_name}
      </p>
      {/* `dosage` is the free-text strength and is literally "N/A" when unset — the
          planner was printing that placeholder next to every such dose. */}
      {med.dosage && med.dosage !== 'N/A' && (
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{med.dosage}</span>
      )}
    </div>
  );

  const statusAndTime = (
    <>
      {/* On a past day this is a record, so it states what happened. Never colour
          alone — the word carries the meaning, the tint only reinforces it. */}
      {med.outcome && (
        <span
          className={
            'shrink-0 text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ' +
            (med.outcome === 'TAKEN'
              ? 'bg-success/15 text-success-strong'
              : med.outcome === 'SKIP'
                ? 'bg-warning/15 text-warning-strong'
                : 'bg-danger/15 text-danger-strong')
          }
        >
          {med.outcome === 'TAKEN' ? 'Taken' : med.outcome === 'SKIP' ? 'Skipped' : 'Missed'}
        </span>
      )}
      {/* "skip"/"adj" at 8px were closer to noise than labels. Spelled out, at a size
          that survives a phone at arm's length. */}
      {med.isSkipped && (
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 bg-danger/10 text-danger-strong">Skipped</span>
      )}
      {med.isOverridden && !med.isSkipped && (
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 bg-warning/10 text-warning-strong">Moved</span>
      )}
      <span className={'shrink-0 inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-bold font-mono px-2 py-0.5 rounded-full ' + (isDraggingThis ? 'text-primary bg-primary/15' : 'text-primary bg-primary/10')}>
        <Clock className="w-2.5 h-2.5" strokeWidth={2.5} />{displayTime}
      </span>
    </>
  );

  const dragHandle = canEdit ? (
    <div
      className="shrink-0 cursor-grab active:cursor-grabbing touch-none w-11 h-11 flex items-center justify-center"
      onPointerDown={(e) => startDrag(e, med.id, groupMinutes)}
      onPointerMove={(e) => onDragMove(e, med.id)}
      onPointerUp={() => endDrag(med.id)}
      onPointerCancel={() => setDragging(null)}
      role="button"
      aria-label={`Drag to reschedule ${med.drug_name}`}
    >
      <GripVertical className="w-4 h-4 text-muted-foreground/60 group-hover/card:text-muted-foreground transition-colors" />
    </div>
  ) : null;

  // These were 24px AND `opacity-0 group-hover:opacity-100` — a hover-only control on a
  // screen most people use on a phone, i.e. no way to reach "move this dose" or "skip
  // today" at all by touch. Always visible, 44px.
  // A logged dose is a record. There is nothing to reschedule about yesterday, so the
  // adjust/skip controls give way to a detail view of what was actually taken.
  const editControls = med.outcome ? (
    <div className="shrink-0 flex items-center gap-1">
      <button
        onClick={() => openDetail(med)}
        className="inline-flex items-center justify-center w-11 h-11 rounded-full text-foreground/70 bg-muted hover:bg-accent-surface transition-all cursor-pointer"
        title={`Details for ${med.drug_name}`}
        aria-label={`See details for the ${med.drug_name} dose`}
      >
        <Info className="w-4 h-4" strokeWidth={2.5} />
      </button>
    </div>
  ) : canEdit ? (
    <div className="shrink-0 flex items-center gap-1">
      {med.isOverridden || med.isSkipped ? (
        <button
          onClick={() => handleRemoveOverride(med.id)}
          className="inline-flex items-center justify-center w-11 h-11 rounded-full cursor-pointer transition-all bg-danger/10 text-danger-strong hover:bg-danger/15"
          title="Restore to the usual time"
          aria-label={`Restore ${med.drug_name} to its usual time`}
        >
          <RotateCcw className="w-4 h-4" strokeWidth={2.5} />
        </button>
      ) : (
        <button
          onClick={() => openOverride(med)}
          className="inline-flex items-center justify-center w-11 h-11 rounded-full text-foreground/70 bg-muted hover:bg-accent-surface cursor-pointer transition-all"
          title="Adjust or skip this dose"
          aria-label={`Adjust or skip today's ${med.drug_name} dose`}
        >
          <Edit2 className="w-4 h-4" strokeWidth={2.5} />
        </button>
      )}
    </div>
  ) : null;

  if (narrow) {
    return (
      <div
        className={'group/card flex flex-col gap-1 rounded-2xl px-2.5 py-2 select-none w-full ' + (med.isSkipped ? 'opacity-60' : '')}
        style={{ background: cardBg, boxShadow: CARD_SHADOW }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 w-2 h-2 rounded-full" style={{ background: accent }} />
          {nameBlock}
        </div>
        <div className="flex items-center gap-1.5">
          {statusAndTime}
          <span className="flex-1" />
          {dragHandle}
          {editControls}
        </div>
      </div>
    );
  }

  return (
    <div
      className={'group/card flex items-center gap-2 rounded-2xl px-2.5 py-2 select-none w-full ' + (med.isSkipped ? 'opacity-60' : '')}
      style={{ background: cardBg, boxShadow: CARD_SHADOW }}
    >
      {dragHandle}
      <span className="shrink-0 w-2 h-2 rounded-full" style={{ background: accent }} />
      {nameBlock}
      {statusAndTime}
      {editControls}
    </div>
  );
}

export default function SchedulePlannerPage() {
  const { isElderly, viewMode: activeViewMode } = useUiMode();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showMonth, setShowMonth] = useState(false);
  const [medications, setMedications] = useState<any[]>([]);
  const [overrides, setOverrides] = useState<OverrideEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [selectedMedForOverride, setSelectedMedForOverride] = useState<any | null>(null);
  const [newOverrideTime, setNewOverrideTime] = useState('');
  const [skipForToday, setSkipForToday] = useState(false);
  const [patientName, setPatientName] = useState<string | null>(null);
  // Whose schedule is on screen — the signed-in user, or the patient a caregiver is
  // viewing. Held in state because the history query below needs it outside the
  // effect that resolves it.
  const [scheduleChatId, setScheduleChatId] = useState<string | null>(null);
  // What ACTUALLY happened, keyed by day. The planner only ever projected
  // `reminder_times` forward, so past days showed a hypothetical schedule rather than
  // the doses that were really taken, skipped or missed.
  const [pastDoses, setPastDoses] = useState<DoseHistory>({});
  // Read-only detail for a dose that has already happened.
  const [detailMed, setDetailMed] = useState<ScheduledMed | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  const railRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1.0);
  // Dose cards live in a ~240px column (the rail's hour gutter takes 48px). One row
  // cannot hold a 44px drag handle, the dot, the name, the time pill AND a 44px action
  // button in that space — the medication name was being crushed to 0-22px, i.e. the
  // one thing the row exists to tell you. Below `sm` the card becomes two rows.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const f = () => setNarrow(window.innerWidth < 640);
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const [dragging, setDragging] = useState<{
    medId: number;
    originalMinutes: number;
    currentMinutes: number;
    startY: number;
  } | null>(null);
  // Mirror of the live drag so pointer handlers always read the current position
  // (state closures can be stale, which previously dropped the dragged time).
  const dragRef = useRef<{
    medId: number;
    originalMinutes: number;
    currentMinutes: number;
    startY: number;
  } | null>(null);

  const activeRole = activeViewMode === 'PATIENT_MONITOR' ? 'CAREGIVER' : 'PATIENT';
  const isReadOnly = activeViewMode === 'PATIENT_MONITOR';
  const canEdit = !isReadOnly && activeRole !== 'CAREGIVER';
  const hourHeight = HOUR_HEIGHT * zoom;
  const supabase = createClient();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('role, telegram_chat_id')
          .eq('id', user.id)
          .single();

        if (!profile) return;

        let targetChatId = profile.telegram_chat_id;

        if (activeViewMode === 'PATIENT_MONITOR') {
          // Same patient the rest of the app is monitoring (cookie set by the
          // patient selector), verified against an accepted link. The previous
          // `.single()` lookup broke for caregivers with 2+ patients and could
          // show a different patient than the one selected.
          const cookiePatient = document.cookie
            .split('; ')
            .find((c) => c.startsWith('monitored-patient-id='))
            ?.split('=')[1];
          let linkQuery = supabase
            .from('active_caregiver_links')
            .select('patient_telegram_id, connection_status')
            .eq('caregiver_chat_id', profile.telegram_chat_id)
            .eq('is_active', true)
            .eq('connection_status', 'ACCEPTED');
          if (cookiePatient) linkQuery = linkQuery.eq('patient_telegram_id', cookiePatient);
          const { data: caregiverLinks } = await linkQuery.limit(1);
          const caregiverLink = caregiverLinks?.[0];

          if (caregiverLink && caregiverLink.patient_telegram_id) {
            targetChatId = caregiverLink.patient_telegram_id;

            const [patientProfileResult, medsResult] = await Promise.all([
              supabase
                .from('profiles')
                .select('full_name')
                .eq('telegram_chat_id', targetChatId)
                .single(),
              supabase
                .from('medications')
                .select('id, drug_name, dosage, frequency, reminder_times, priority_level, created_at')
                .eq('telegram_id', targetChatId)
                .eq('active', true),
            ]);

            if (patientProfileResult.data) {
              setPatientName(patientProfileResult.data.full_name);
            }
            setMedications(medsResult.data || []);
          } else {
            setPatientName('Your Patient');
            setMedications([]);
          }
        } else {
          setPatientName(null);
          const { data: meds } = await supabase
            .from('medications')
            .select('id, drug_name, dosage, frequency, reminder_times, priority_level, created_at')
            .eq('telegram_id', targetChatId)
            .eq('active', true);
          setMedications(meds || []);
        }

        setScheduleChatId(targetChatId);

        const storageKey = 'schedule-overrides-' + user.id;
        const savedOverrides = localStorage.getItem(storageKey);
        if (savedOverrides) {
          setOverrides(JSON.parse(savedOverrides));
        }
      } catch (err) {
        console.error('Error loading Schedule Planner:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [supabase, activeViewMode]);

  const saveOverrides = (newOverrides: OverrideEntry[]) => {
    setOverrides(newOverrides);
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        localStorage.setItem('schedule-overrides-' + user.id, JSON.stringify(newOverrides));
      }
    });
  };

  const getMedicationsForDate = (date: Date): ScheduledMed[] =>
    dosesForDate(date, { medications, overrides, history: pastDoses });

  const weekDays = useMemo(() => {
    const start = new Date(selectedDate);
    start.setDate(selectedDate.getDate() - selectedDate.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [selectedDate]);

  // Real dose history for the week on screen, refetched as you page through weeks.
  // drug_name_snapshot is selected alongside the join so a dose logged against a
  // medication you have since deleted still shows WHAT was taken, not a blank.
  useEffect(() => {
    if (!scheduleChatId || weekDays.length === 0) return;
    const from = new Date(weekDays[0]);
    from.setHours(0, 0, 0, 0);
    const to = new Date(weekDays[weekDays.length - 1]);
    to.setHours(23, 59, 59, 999);

    let cancelled = false;
    (async () => {
      const grouped = await fetchDoseHistory(supabase, scheduleChatId, from, to);
      if (!cancelled) setPastDoses(grouped);
    })();
    return () => { cancelled = true; };
  }, [scheduleChatId, weekDays, supabase]);

  const shiftWeek = (dir: number) => {
    const d = new Date(selectedDate);
    d.setDate(selectedDate.getDate() + dir * 7);
    setSelectedDate(d);
    setCurrentDate(d);
  };

  const daysInMonth = useMemo(() => {
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    const days: Date[] = [];
    const startDayOfWeek = startOfMonth.getDay();
    for (let i = startDayOfWeek; i > 0; i--) {
      days.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1 - i));
    }
    for (let i = 1; i <= endOfMonth.getDate(); i++) {
      days.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), i));
    }
    const totalSlots = Math.ceil(days.length / 7) * 7;
    for (let i = 1; i <= totalSlots - days.length; i++) {
      days.push(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, i));
    }
    return days;
  }, [currentDate]);

  const handleApplyOverride = () => {
    if (!selectedMedForOverride) return;
    const dateStr = toOverrideDateStr(selectedDate);
    const filtered = overrides.filter(
      (o) => !(o.medicationId === selectedMedForOverride.id && o.dateStr === dateStr)
    );
    const next = [...filtered];
    if (skipForToday) {
      next.push({ medicationId: selectedMedForOverride.id, dateStr, isSkipped: true });
    } else if (newOverrideTime) {
      next.push({ medicationId: selectedMedForOverride.id, dateStr, overriddenTime: newOverrideTime });
    }
    saveOverrides(next);
    setShowOverrideModal(false);
    setSelectedMedForOverride(null);
    setNewOverrideTime('');
    setSkipForToday(false);
  };

  const handleRemoveOverride = (medId: number) => {
    const dateStr = toOverrideDateStr(selectedDate);
    saveOverrides(overrides.filter((o) => !(o.medicationId === medId && o.dateStr === dateStr)));
  };

  const openOverride = (med: ScheduledMed) => {
    const mins = parseTimeToMinutes(med.time);
    const hhmm =
      mins !== null
        ? Math.floor(mins / 60).toString().padStart(2, '0') + ':' + (mins % 60).toString().padStart(2, '0')
        : '08:00';
    setSelectedMedForOverride(med);
    setNewOverrideTime(hhmm);
    setSkipForToday(false);
    setShowOverrideModal(true);
  };

  const closeModal = () => {
    setShowOverrideModal(false);
    setSelectedMedForOverride(null);
    setNewOverrideTime('');
    setSkipForToday(false);
  };

  const startDrag = (e: React.PointerEvent, medId: number, minutes: number) => {
    if (!canEdit) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const init = { medId, originalMinutes: minutes, currentMinutes: minutes, startY: e.clientY };
    dragRef.current = init;
    setDragging(init);
  };

  const onDragMove = (e: React.PointerEvent, medId: number) => {
    const d = dragRef.current;
    if (!d || d.medId !== medId) return;
    const deltaY = e.clientY - d.startY;
    const raw = Math.round((deltaY / hourHeight) * 60);
    const newMins = Math.max(0, Math.min(23 * 60 + 55, d.originalMinutes + raw));
    dragRef.current = { ...d, currentMinutes: newMins };
    setDragging(prev => prev ? { ...prev, currentMinutes: newMins } : null);
  };

  const endDrag = (medId: number) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(null);
    if (!d || d.medId !== medId) return;
    // No meaningful move → treat as a tap, nothing to confirm.
    if (d.currentMinutes === d.originalMinutes) return;
    const h = Math.floor(d.currentMinutes / 60);
    const m = d.currentMinutes % 60;
    const hhmm = h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0');
    // Open the confirmation popup pre-filled with the dragged time. Saving goes
    // through the same path as the Edit button, so it lands in the timeline.
    const med = getMedicationsForDate(selectedDate).find((x) => x.id === medId);
    if (!med) return;
    setSelectedMedForOverride(med);
    setNewOverrideTime(hhmm);
    setSkipForToday(false);
    setShowOverrideModal(true);
  };

  const selectedMeds = getMedicationsForDate(selectedDate);
  const isToday = selectedDate.toDateString() === new Date().toDateString();

  const groupedByTime = useMemo(() => {
    const map = new Map<string, ScheduledMed[]>();
    for (const m of selectedMeds) {
      if (!map.has(m.time)) map.set(m.time, []);
      map.get(m.time)!.push(m);
    }
    const out: { time: string; minutes: number; meds: ScheduledMed[] }[] = [];
    map.forEach((meds, time) => {
      const minutes = parseTimeToMinutes(time);
      if (minutes !== null) out.push({ time, minutes, meds });
    });
    return out.sort((a, b) => a.minutes - b.minutes);
  }, [selectedMeds]);

  const activeDoses = selectedMeds.filter((m) => !m.isSkipped);
  const skippedCount = selectedMeds.length - activeDoses.length;

  // Compute non-overlapping card tops: each card sits at its natural time position
  // or just below the previous card if they would overlap.
  // Card height follows the card's own layout — narrow screens stack it into two rows
  // (see DoseCard), so reserving the one-row 36px there would overlap every card.
  const cardTops = useMemo(() => {
    const CARD_H = narrow ? 104 : 36;
    const tops: number[] = [];
    let minY = 0;
    for (const med of selectedMeds) {
      const mins = parseTimeToMinutes(med.time) ?? 0;
      const natural = (mins / 60) * hourHeight + 2;
      const top = Math.max(natural, minY);
      tops.push(top);
      minY = top + CARD_H;
    }
    return tops;
  }, [selectedMeds, hourHeight, narrow]);
  const criticalCount = activeDoses.filter((m) => m.priority_level === 'critical').length;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nextDose = isToday
    ? activeDoses.find((m) => (parseTimeToMinutes(m.time) ?? -1) >= nowMinutes) || null
    : activeDoses[0] || null;

  useEffect(() => {
    if (loading || !railRef.current) return;
    const anchorMin = isToday ? nowMinutes : (groupedByTime[0]?.minutes ?? 8 * 60);
    const top = Math.max(0, (anchorMin / 60) * hourHeight - 80);
    railRef.current.scrollTo({ top, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selectedDate, groupedByTime.length, hourHeight]);

  const selectedDateLong = selectedDate.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingMark size={48} className="text-primary-strong" />
      </div>
    );
  }

  return (
    <div className={'max-w-6xl mx-auto space-y-5 ' + (isElderly ? 'text-[1.05rem]' : '')}>
      {/* Header — plain Apple large title.
          `.rise-in` + `--rise-delay` is the app's shared section entrance (globals.css);
          same 60ms cascade the dashboard and medication list use. */}
      <div className="rise-in flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold tracking-tight text-foreground flex items-center gap-2">
            <span className="whitespace-nowrap">Schedule</span>
            {isReadOnly && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-muted text-muted-foreground uppercase tracking-wide shrink-0">
                Read Only
              </span>
            )}
          </h1>
          <p className="text-[13px] text-muted-foreground font-medium mt-0.5 sm:truncate sm:max-w-xs">
            {patientName
              ? `Dose timeline for ${patientName}. Tap a day to plan ahead.`
              : 'Your day, on a timeline. Tap a day to plan ahead.'}
          </p>
        </div>

        <div
          className="shrink-0 w-fit flex items-center gap-2.5 rounded-[22px] bg-card px-3.5 py-2"
          style={{ boxShadow: CARD_SHADOW }}
        >
          <Clock className="w-4 h-4 shrink-0 text-primary" strokeWidth={2.5} />
          <div className="leading-tight">
            <p className="text-[11px] uppercase tracking-widest font-black text-muted-foreground">
              {isToday ? 'Next dose' : 'First dose'}
            </p>
            {nextDose ? (
              <p className="text-xs font-bold text-foreground whitespace-nowrap">
                {nextDose.drug_name} · {formatTimeLabel(nextDose.time)}
              </p>
            ) : (
              /* "None today" alongside "1 dose planned" was a straight contradiction:
                 the dose exists, it is just already behind us. And on a future date the
                 word "today" was simply wrong. Say which of the three it actually is. */
              <p className="text-xs font-semibold text-muted-foreground">
                {activeDoses.length > 0
                  ? isToday ? 'All done for today' : 'None scheduled'
                  : isToday ? 'Nothing due today' : 'Nothing scheduled'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Week navigator */}
      <div className="rise-in bg-card rounded-[22px] p-4" style={{ boxShadow: CARD_SHADOW, ['--rise-delay' as string]: '60ms' }}>
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => shiftWeek(-1)}
            className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-muted hover:bg-input text-foreground transition-all cursor-pointer"
            aria-label="Previous week"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={2.5} />
          </button>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold tracking-tight text-foreground">
              {weekDays[0].toLocaleDateString([], { month: 'short', day: 'numeric' })}
              {' – '}
              {weekDays[6].toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </h2>
            <button
              onClick={() => setShowMonth((s) => !s)}
              className={
                'inline-flex items-center gap-1 h-11 px-3.5 rounded-full text-[11px] font-semibold cursor-pointer transition-all ' +
                (showMonth
                  ? 'bg-primary-strong text-primary-strong-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground')
              }
            >
              <Grid3x3 className="w-3 h-3" strokeWidth={2.5} /> Month
            </button>
          </div>
          <button
            onClick={() => shiftWeek(1)}
            className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-muted hover:bg-input text-foreground transition-all cursor-pointer"
            aria-label="Next week"
          >
            <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex gap-1 sm:gap-1.5 items-stretch px-1">
          {weekDays.map((date, idx) => {
            const meds = getMedicationsForDate(date);
            const load = meds.filter((m) => !m.isSkipped).length;
            const isSel = date.toDateString() === selectedDate.toDateString();
            const isTod = date.toDateString() === new Date().toDateString();

            return (
              <button
                key={idx}
                onClick={() => { setSelectedDate(date); setCurrentDate(date); }}
                className={
                  'group relative cursor-pointer rounded-[7px] ' +
                  (isSel
                    ? 'bg-gradient-to-b from-[#CC3D64] to-[#B52A52] text-white z-10'
                    : isTod
                      ? 'bg-primary-soft text-foreground'
                      : 'bg-muted text-foreground hover:bg-input')
                }
                style={{
                  flexGrow: isSel ? 2.1 : 1,
                  flexBasis: 0,
                  minWidth: 0,
                  transform: `skewX(-9deg)${isSel ? ' translateY(-5px)' : ''}`,
                  boxShadow: isSel ? '0 14px 26px rgba(242, 107, 138, 0.45)' : '0 0 0 rgba(242, 107, 138, 0)',
                  willChange: 'flex-grow, transform',
                  transitionProperty: 'flex-grow, transform, background-color, box-shadow',
                  transitionDuration: '650ms',
                  transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {/* counter-skew so content stays upright */}
                <span
                  className={'flex flex-col items-center justify-center ' + (isSel ? 'gap-1 py-3.5' : 'gap-1.5 py-3')}
                  style={{
                    transform: 'skewX(9deg)',
                    transitionProperty: 'gap, padding',
                    transitionDuration: '650ms',
                    transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <span
                    className={'uppercase font-bold tracking-wide whitespace-nowrap ' + (isSel ? 'text-[11px] text-white/80' : isTod ? 'text-[11px] text-primary' : 'text-[11px] text-muted-foreground')}
                    style={{ transition: 'color 650ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                  >
                    {date.toLocaleDateString([], { weekday: 'short' })}
                  </span>
                  <span className={'font-extrabold leading-none tabular-nums transition-[font-size] duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)] ' + (isSel ? 'text-2xl sm:text-3xl' : 'text-base sm:text-lg')}>
                    {date.getDate()}
                  </span>
                  {/* Dose count along the bottom edge of the expanded tab */}
                  {isSel && (
                    <span className="mt-0.5 text-[11px] font-bold leading-none text-white/85 whitespace-nowrap animate-fade-in">
                      {load > 0 ? `${load} dose${load > 1 ? 's' : ''}` : 'clear'}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {showMonth && (
          <div className="mt-4 pt-4 border-t border-border animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-muted hover:bg-input text-foreground cursor-pointer transition-all"
              >
                <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
              <span className="text-xs font-bold text-foreground">
                {currentDate.toLocaleDateString([], { month: 'long', year: 'numeric' })}
              </span>
              <button
                onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-muted hover:bg-input text-foreground cursor-pointer transition-all"
              >
                <ChevronRight className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground mb-1">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <div key={i}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {daysInMonth.map((date, idx) => {
                const isSel = date.toDateString() === selectedDate.toDateString();
                const isCur = date.getMonth() === currentDate.getMonth();
                const isTod = date.toDateString() === new Date().toDateString();
                const load = getMedicationsForDate(date).filter((m) => !m.isSkipped).length;
                const cellClass = isSel
                  ? 'bg-primary-strong text-primary-strong-foreground'
                  : isTod
                    ? 'bg-primary-soft text-foreground'
                    : 'hover:bg-muted text-foreground';
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setSelectedDate(date);
                      setCurrentDate(date);
                      setShowMonth(false);
                    }}
                    className={'h-9 rounded-xl flex flex-col items-center justify-center text-[11px] font-semibold cursor-pointer transition-all ' + cellClass + (isCur ? '' : ' opacity-35')}
                  >
                    {date.getDate()}
                    {load > 0 && (
                      <span className="w-1 h-1 rounded-full mt-0.5" style={{ background: isSel ? '#fff' : 'var(--primary)' }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Main: timeline + summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="rise-in lg:col-span-8 bg-card rounded-[22px] overflow-hidden" style={{ boxShadow: CARD_SHADOW, ['--rise-delay' as string]: '120ms' }}>
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <h3 className="text-sm font-bold tracking-tight text-foreground">{selectedDateLong}</h3>
              <p className="text-[11px] font-medium text-muted-foreground mt-0.5">
                {activeDoses.length} {activeDoses.length === 1 ? 'dose' : 'doses'} planned
                {skippedCount > 0 ? ' · ' + skippedCount + ' skipped' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 bg-muted rounded-full px-1 py-1">
                <button
                  onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                  className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-card text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                  aria-label="Zoom out"
                >
                  <Minus className="w-3 h-3" strokeWidth={2.5} />
                </button>
                <span className="text-[11px] font-bold text-foreground w-8 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))}
                  className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-card text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                  aria-label="Zoom in"
                >
                  <Plus className="w-3 h-3" strokeWidth={2.5} />
                </button>
              </div>
              {canEdit && overrides.some(o => o.dateStr === toOverrideDateStr(selectedDate)) && (
                <button
                  onClick={() => {
                    const dateStr = toOverrideDateStr(selectedDate);
                    saveOverrides(overrides.filter(o => o.dateStr !== dateStr));
                  }}
                  className="inline-flex items-center gap-1 h-11 px-3.5 rounded-full text-[11px] font-semibold transition-all cursor-pointer bg-danger/10 text-danger-strong hover:bg-danger/15"
                  title="Reset all adjustments for this day"
                >
                  <RotateCcw className="w-3 h-3" strokeWidth={2.5} /> Reset
                </button>
              )}
            </div>
          </div>
          <div className="h-px bg-border mx-6" />

          {groupedByTime.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 px-6">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
                <Sun className="w-8 h-8 text-muted-foreground/50" strokeWidth={2} />
              </div>
              <p className="text-sm font-bold text-foreground">A clear day</p>
              <p className="text-xs font-medium text-muted-foreground mt-1">No medications scheduled for {selectedDateLong}.</p>
            </div>
          ) : (
            <div ref={railRef} className="relative max-h-[560px] overflow-y-auto px-4 py-3">
              <div className="relative" style={{ height: 24 * hourHeight }}>
                {/* Day bands */}
                {DAY_BANDS.map((band, i) => {
                  const BandIcon = band.icon;
                  return (
                    <div
                      key={i}
                      className="absolute left-0 right-0 flex items-start"
                      style={{ top: band.from * hourHeight, height: (band.to - band.from) * hourHeight, background: band.color }}
                    >
                      {band.showLabel && (
                        <span className="ml-14 mt-1 inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                          <BandIcon className="w-3 h-3" /> {band.label}
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* Hour lines */}
                {Array.from({ length: 24 }).map((_, h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-border/50" style={{ top: h * hourHeight }}>
                    <span className="absolute -top-2 left-0 w-12 text-right pr-2 text-[11px] font-bold text-muted-foreground tabular-nums">
                      {hourLabel(h)}
                    </span>
                  </div>
                ))}

                {/* Now line.
                    The NOW pill lives in the hour gutter on the LEFT, centred on the
                    line. It used to sit at `right-0 -top-4` — the same span the dose
                    cards occupy (`left-12 right-2`) — so any dose scheduled near the
                    present time had the badge sitting on its top-right corner. Which is
                    precisely when you are looking at this screen. The gutter is free
                    space, and the red dot plus dashed rule already mark the line, so the
                    pill only has to name it. */}
                {/* z-[5], BELOW the dose cards (z-10). At z-20 the dashed rule drew
                    straight through the medication name of any dose near the present
                    time — and a line through a drug name is this app's own visual for a
                    SKIPPED dose (see `line-through` in DoseCard). A decoration that
                    imitates a status is worse than one you cannot see: the gutter pill
                    and the dot still mark where now is. */}
                {isToday && (
                  <div className="absolute left-12 right-2 z-[5] pointer-events-none" style={{ top: (nowMinutes / 60) * hourHeight }}>
                    <div className="relative flex items-center">
                      <span className="absolute -left-1 w-2.5 h-2.5 rounded-full bg-danger ring-2 ring-white" />
                      <div className="w-full border-t-2 border-danger/70 border-dashed" />
                      <span className="absolute -left-12 top-1/2 -translate-y-1/2 w-11 text-center text-[10px] font-black text-danger-strong bg-card border border-danger py-0.5 rounded-full">NOW</span>
                    </div>
                  </div>
                )}

                {/* Drag ghost line */}
                {dragging && (
                  <div className="absolute left-12 right-2 z-30 pointer-events-none" style={{ top: (dragging.currentMinutes / 60) * hourHeight }}>
                    <div className="relative flex items-center">
                      <span className="absolute -left-1 w-2 h-2 rounded-full bg-primary ring-2 ring-white" />
                      <div className="w-full border-t-2 border-primary border-dashed" />
                      <span className="absolute right-0 -top-4 text-[8px] font-black text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                        {formatTimeLabel(
                          Math.floor(dragging.currentMinutes / 60).toString().padStart(2, '0') + ':' +
                          (dragging.currentMinutes % 60).toString().padStart(2, '0')
                        )}
                      </span>
                    </div>
                  </div>
                )}

                {/* Dose cards — each positioned individually, no overlap */}
                {selectedMeds.map((med, idx) => {
                  const medMins = parseTimeToMinutes(med.time) ?? 0;
                  const isDraggingThis = dragging?.medId === med.id;
                  const topPos = isDraggingThis && dragging
                    ? (dragging.currentMinutes / 60) * hourHeight + 2
                    : cardTops[idx];
                  return (
                    <div key={`${med.id}-${idx}`} className="absolute left-12 right-2 z-10" style={{ top: topPos }}>
                      <DoseCard
                        med={med}
                        groupMinutes={medMins}
                        canEdit={canEdit && !med.outcome}
                        openDetail={setDetailMed}
                        dragging={dragging}
                        openOverride={openOverride}
                        handleRemoveOverride={handleRemoveOverride}
                        startDrag={startDrag}
                        onDragMove={onDragMove}
                        endDrag={endDrag}
                        setDragging={setDragging}
                        narrow={narrow}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Summary rail */}
        <div className="rise-in lg:col-span-4 space-y-5" style={{ ['--rise-delay' as string]: '180ms' }}>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-card rounded-[22px] p-4" style={{ boxShadow: CARD_SHADOW }}>
              <p className="text-2xl font-bold text-foreground leading-none">{activeDoses.length}</p>
              {/* Was a flat "DOSES TODAY" — plural for a count of 1, and still "today"
                  while you were looking at next Thursday. */}
              <p className="text-[11px] font-semibold text-muted-foreground mt-1 uppercase tracking-wide">
                {activeDoses.length === 1 ? 'Dose' : 'Doses'} {isToday ? 'today' : 'that day'}
              </p>
            </div>
            <div className="bg-card rounded-[22px] p-4" style={{ boxShadow: CARD_SHADOW }}>
              <p className="text-2xl font-bold leading-none" style={{ color: criticalCount > 0 ? 'var(--danger-strong)' : 'var(--foreground)' }}>{criticalCount}</p>
              <p className="text-[11px] font-semibold text-muted-foreground mt-1 uppercase tracking-wide">Critical</p>
            </div>
          </div>

          {/* Labels and colors both come from the shared map now. This legend used to
              hardcode its own hexes AND call the lowest level "Routine" while the wizard
              you set it in called it "Normal" — so the key did not explain the app. */}
          <div className="bg-card rounded-[22px] p-5 space-y-3" style={{ boxShadow: CARD_SHADOW }}>
            <h4 className="text-xs font-bold tracking-tight text-foreground">Priority key</h4>
            {(['critical', 'important', 'normal'] as const).map((level) => {
              const meta = PRIORITY[level];
              return (
                <div key={level} className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: TONE_VAR[meta.tone] }} />
                  <span className="text-[11px] font-medium text-muted-foreground">
                    <b className="text-foreground font-bold">{meta.label}</b> — {meta.gloss}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Time-of-day legend. The rail's bands only carried tiny in-chart labels, so
              the shading read as decoration. */}
          <div className="bg-card rounded-[22px] p-5 space-y-3" style={{ boxShadow: CARD_SHADOW }}>
            <h4 className="text-xs font-bold tracking-tight text-foreground">Time of day</h4>
            <div className="grid grid-cols-2 gap-2">
              {DAY_BANDS.filter((b) => b.showLabel).map((band) => {
                const BandIcon = band.icon;
                return (
                  <div key={band.label} className="flex items-center gap-2">
                    <span
                      className="w-5 h-5 rounded-md shrink-0 border border-border"
                      style={{ background: band.color }}
                      aria-hidden="true"
                    />
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                      <BandIcon className="w-3 h-3 shrink-0" /> {band.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {canEdit && (
            <a
              href="/medications"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-full bg-primary-strong text-primary-strong-foreground font-semibold text-sm hover:bg-primary-strong-hover transition-all cursor-pointer"
              style={{ boxShadow: '0 4px 12px rgba(242, 107, 138, 0.35)' }}
            >
              <Plus className="w-4 h-4" strokeWidth={2.5} /> Add medication
            </a>
          )}

          <div className="bg-muted rounded-[22px] p-4">
            <p className="text-[11px] font-medium text-muted-foreground leading-relaxed">
              Adjusting a time or skipping a dose here only affects <b className="text-foreground font-semibold">{selectedDateLong}</b>. Your recurring routine stays exactly as it is.
            </p>
          </div>
        </div>
      </div>

      {/* Override modal */}
      {/* Read-only detail for a dose that already happened. Deliberately separate from
          the Adjust modal: that one changes the future, this one reports the past. */}
      {detailMed && (
        <div
          className="fixed inset-0 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setDetailMed(null)}
          role="presentation"
        >
          <div
            className="bg-card rounded-[22px] max-w-md w-full p-6 space-y-4 border border-border"
            style={{ boxShadow: CARD_SHADOW }}
            role="dialog"
            aria-modal="true"
            aria-label={`Details for ${detailMed.drug_name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">Dose record</p>
                <h3 className="text-base font-bold tracking-tight text-foreground mt-0.5 break-words">{detailMed.drug_name}</h3>
                <p className="text-[11px] font-semibold text-primary-strong mt-0.5">{selectedDateLong}</p>
              </div>
              <button
                onClick={() => setDetailMed(null)}
                aria-label="Close details"
                className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center bg-muted hover:bg-accent-surface text-foreground transition-all cursor-pointer"
              >
                <X className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>

            <dl className="space-y-2.5">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-[11px] font-semibold text-muted-foreground shrink-0">Outcome</dt>
                <dd className="text-[12px] font-bold text-foreground text-right">
                  {detailMed.outcome === 'TAKEN' ? 'Taken' : detailMed.outcome === 'SKIP' ? 'Skipped' : 'Missed'}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-[11px] font-semibold text-muted-foreground shrink-0">Scheduled for</dt>
                <dd className="text-[12px] font-bold text-foreground text-right">{formatTimeLabel(detailMed.time)}</dd>
              </div>
              {detailMed.respondedAt && (
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-[11px] font-semibold text-muted-foreground shrink-0">Answered at</dt>
                  <dd className="text-[12px] font-bold text-foreground text-right">
                    {new Date(detailMed.respondedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </dd>
                </div>
              )}
              {detailMed.dosage && detailMed.dosage !== 'N/A' && (
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-[11px] font-semibold text-muted-foreground shrink-0">Dose</dt>
                  <dd className="text-[12px] font-bold text-foreground text-right break-words">{detailMed.dosage}</dd>
                </div>
              )}
              {detailMed.linkedBrandName && (
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-[11px] font-semibold text-muted-foreground shrink-0">Linked medicine</dt>
                  <dd className="text-[12px] font-bold text-foreground text-right break-words">{detailMed.linkedBrandName}</dd>
                </div>
              )}
              {detailMed.medicationReason && (
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-[11px] font-semibold text-muted-foreground shrink-0">Reason</dt>
                  <dd className="text-[12px] font-bold text-foreground text-right break-words">{detailMed.medicationReason}</dd>
                </div>
              )}
            </dl>

            {detailMed.isDeleted && (
              /* Say plainly what is missing and why, rather than showing a detail panel
                 with blanks where the reason and linked medicine would be. */
              <p className="text-[11px] font-semibold text-muted-foreground leading-relaxed border-t border-border pt-3">
                This medication has been deleted. The dose itself is kept, but its dose
                amount, linked medicine and reason lived on the medication and are gone —
                only the name and the times were preserved.
              </p>
            )}
          </div>
        </div>
      )}

      {showOverrideModal && selectedMedForOverride && (
        <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-card rounded-[22px] max-w-md w-full p-6 space-y-5" style={{ boxShadow: '0 8px 40px rgba(16, 28, 90, 0.18)' }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">Adjust dose</p>
                <h3 className="text-base font-bold tracking-tight text-foreground mt-0.5">{selectedMedForOverride.drug_name}</h3>
                <p className="text-[11px] font-semibold text-primary mt-0.5">{selectedDateLong}</p>
              </div>
              <button onClick={closeModal} className="w-8 h-8 rounded-full flex items-center justify-center bg-muted hover:bg-input text-muted-foreground cursor-pointer transition-all">
                <X className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>

            <button
              onClick={() => setSkipForToday((s) => !s)}
              className={
                'w-full flex items-center justify-between px-4 py-3 rounded-2xl border cursor-pointer transition-all ' +
                (skipForToday ? 'bg-danger/10 border-danger/40' : 'bg-muted border-border hover:bg-muted/70')
              }
            >
              <span className={'text-sm font-bold ' + (skipForToday ? 'text-danger' : 'text-foreground')}>
                Skip this dose for the day
              </span>
              <span className={'relative w-10 h-5 rounded-full transition-all ' + (skipForToday ? 'bg-danger' : 'bg-border')}>
                <span className={'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ' + (skipForToday ? 'left-[22px]' : 'left-0.5')} />
              </span>
            </button>

            {!skipForToday && (
              <label className="block">
                <span className="text-[11px] uppercase font-black text-muted-foreground">New time</span>
                <input
                  type="time"
                  value={newOverrideTime}
                  onChange={(e) => setNewOverrideTime(e.target.value)}
                  className="mt-1.5 w-full px-4 py-3 bg-muted border border-border rounded-2xl text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
            )}

            <div className="flex gap-2">
              <button
                onClick={closeModal}
                className="flex-1 py-3 bg-muted text-muted-foreground hover:bg-input text-sm font-semibold rounded-full cursor-pointer transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyOverride}
                className="flex-1 py-3 bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover text-sm font-semibold rounded-full cursor-pointer transition-all"
                style={{ boxShadow: '0 4px 12px rgba(242, 107, 138, 0.35)' }}
              >
                Save change
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
