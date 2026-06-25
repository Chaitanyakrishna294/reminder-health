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
} from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';
import { createClient } from '@/lib/supabase/client';

interface ScheduledMed {
  id: number;
  drug_name: string;
  dosage: string;
  frequency: string;
  time: string;
  priority_level: string;
  isOverridden?: boolean;
  overriddenTime?: string;
  isSkipped?: boolean;
}

interface OverrideEntry {
  medicationId: number;
  dateStr: string; // YYYY-MM-DD
  overriddenTime?: string;
  isSkipped?: boolean;
}

const HOUR_HEIGHT = 64; // px per hour on the timeline rail

const DAY_BANDS = [
  { from: 0, to: 5, label: 'Night', icon: Moon, color: 'rgba(15,28,90,0.05)', text: '#5b6aa8' },
  { from: 5, to: 12, label: 'Morning', icon: Sunrise, color: 'rgba(255,149,0,0.07)', text: '#c47600' },
  { from: 12, to: 17, label: 'Afternoon', icon: Sun, color: 'rgba(52,199,89,0.07)', text: '#1f9d4d' },
  { from: 17, to: 21, label: 'Evening', icon: Sunset, color: 'rgba(242,107,138,0.08)', text: '#d23e64' },
  { from: 21, to: 24, label: 'Night', icon: Moon, color: 'rgba(15,28,90,0.05)', text: '#5b6aa8' },
];

function parseTimeToMinutes(t: string): number | null {
  if (!t) return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

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

const priorityColor = (p: string) =>
  p === 'critical' ? 'var(--danger)' : p === 'important' ? 'var(--warning)' : 'var(--primary)';

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
}

function DoseCard({
  med, groupMinutes, canEdit, dragging,
  openOverride, handleRemoveOverride,
  startDrag, onDragMove, endDrag, setDragging,
}: DoseCardProps) {
  const isDraggingThis = dragging?.medId === med.id;
  const accent = med.isSkipped ? '#C7C7CC' : priorityColor(med.priority_level);
  const cardBg = med.isSkipped
    ? '#F2F2F7'
    : med.isOverridden
      ? '#FFF3E0'
      : isDraggingThis
        ? '#FFEDF2'
        : '#FFFFFF';
  const displayTime = isDraggingThis && dragging
    ? formatTimeLabel(
        Math.floor(dragging.currentMinutes / 60).toString().padStart(2, '0') + ':' +
        (dragging.currentMinutes % 60).toString().padStart(2, '0')
      )
    : formatTimeLabel(med.time);

  return (
    <div
      className={'group/card flex items-center gap-2 rounded-2xl px-2.5 py-2 select-none w-full ' + (med.isSkipped ? 'opacity-60' : '')}
      style={{ background: cardBg, boxShadow: CARD_SHADOW }}
    >
      {canEdit && (
        <div
          className="shrink-0 cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={(e) => startDrag(e, med.id, groupMinutes)}
          onPointerMove={(e) => onDragMove(e, med.id)}
          onPointerUp={() => endDrag(med.id)}
          onPointerCancel={() => setDragging(null)}
        >
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 group-hover/card:text-muted-foreground/70 transition-colors" />
        </div>
      )}
      <span className="shrink-0 w-2 h-2 rounded-full" style={{ background: accent }} />
      <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
        <p className={'text-[12px] font-bold truncate ' + (med.isSkipped ? 'text-muted-foreground line-through' : 'text-foreground')}>
          {med.drug_name}
        </p>
        <span className="shrink-0 text-[9px] font-medium text-muted-foreground">{med.dosage}</span>
      </div>
      {med.isSkipped && (
        <span className="shrink-0 text-[8px] font-bold uppercase tracking-wide rounded-full px-1.5 py-0.5" style={{ color: '#FF3B30', background: '#FFECEA' }}>skip</span>
      )}
      {med.isOverridden && !med.isSkipped && (
        <span className="shrink-0 text-[8px] font-bold uppercase tracking-wide rounded-full px-1.5 py-0.5" style={{ color: '#FF9500', background: '#FFF3E0' }}>adj</span>
      )}
      <span className={'shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold font-mono px-2 py-0.5 rounded-full ' + (isDraggingThis ? 'text-primary bg-primary/15' : 'text-primary bg-primary/10')}>
        <Clock className="w-2.5 h-2.5" strokeWidth={2.5} />{displayTime}
      </span>
      {canEdit && (
        <div className="shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity">
          {med.isOverridden || med.isSkipped ? (
            <button
              onClick={() => handleRemoveOverride(med.id)}
              className="inline-flex items-center justify-center w-6 h-6 rounded-full cursor-pointer transition-all"
              style={{ color: '#FF3B30', background: '#FFECEA' }}
              title="Restore"
            >
              <RotateCcw className="w-3 h-3" strokeWidth={2.5} />
            </button>
          ) : (
            <button
              onClick={() => openOverride(med)}
              className="inline-flex items-center justify-center w-6 h-6 rounded-full text-foreground/60 bg-[#F2F2F7] hover:bg-[#E5E5EA] cursor-pointer transition-all"
              title="Adjust"
            >
              <Edit2 className="w-3 h-3" strokeWidth={2.5} />
            </button>
          )}
        </div>
      )}
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
  const [now, setNow] = useState<Date>(new Date());
  const railRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1.0);
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
          const { data: caregiverLink } = await supabase
            .from('caregiver_info')
            .select('patient_telegram_id, connection_status')
            .eq('caregiver_chat_id', profile.telegram_chat_id)
            .eq('is_active', true)
            .single();

          if (caregiverLink && caregiverLink.patient_telegram_id && caregiverLink.connection_status === 'ACCEPTED') {
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

  const getMedicationsForDate = (date: Date): ScheduledMed[] => {
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = date.getDay();

    return medications
      .flatMap((med) => {
        let scheduled = false;
        if (med.frequency === 'once_daily' || med.frequency === 'twice_daily' || med.frequency === 'thrice_daily') {
          scheduled = true;
        } else if (med.frequency === 'every_other_day') {
          const createdTime = new Date(med.created_at || Date.now()).getTime();
          const diffDays = Math.floor((date.getTime() - createdTime) / (1000 * 60 * 60 * 24));
          scheduled = diffDays % 2 === 0;
        } else if (med.frequency === 'weekly') {
          const createdDay = new Date(med.created_at || Date.now()).getDay();
          scheduled = dayOfWeek === createdDay;
        }

        if (!scheduled) return [];

        return (med.reminder_times || []).map((timeStr: string) => {
          const medOverride = overrides.find(
            (o) => o.medicationId === med.id && o.dateStr === dateStr
          );
          const result: ScheduledMed = {
            id: med.id,
            drug_name: med.drug_name,
            dosage: med.dosage,
            frequency: med.frequency,
            time: medOverride?.overriddenTime || timeStr,
            priority_level: med.priority_level,
            isOverridden: !!medOverride?.overriddenTime,
            overriddenTime: medOverride?.overriddenTime,
            isSkipped: medOverride?.isSkipped || false,
          };
          return result;
        });
      })
      .sort((a, b) => (parseTimeToMinutes(a.time) ?? 0) - (parseTimeToMinutes(b.time) ?? 0))
      .filter((med, idx, arr) => arr.findIndex(m => m.id === med.id && m.time === med.time) === idx);
  };

  const weekDays = useMemo(() => {
    const start = new Date(selectedDate);
    start.setDate(selectedDate.getDate() - selectedDate.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [selectedDate]);

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
    const dateStr = selectedDate.toISOString().split('T')[0];
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
    const dateStr = selectedDate.toISOString().split('T')[0];
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
  // or just below the previous card if they would overlap (36px per card).
  const cardTops = useMemo(() => {
    const CARD_H = 36;
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
  }, [selectedMeds, hourHeight]);
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className={'max-w-6xl mx-auto space-y-5 ' + (isElderly ? 'text-[1.05rem]' : '')}>
      {/* Header — plain Apple large title */}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold tracking-tight text-foreground flex items-center gap-2">
            <span className="whitespace-nowrap">Schedule</span>
            {isReadOnly && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#F2F2F7] text-muted-foreground uppercase tracking-wide shrink-0">
                Read Only
              </span>
            )}
          </h1>
          <p className="text-[13px] text-muted-foreground font-medium mt-0.5 sm:truncate sm:max-w-xs">
            {patientName
              ? `Dose timeline for ${patientName} — tap a day to plan ahead.`
              : 'Your day, on a timeline — tap a day to plan ahead.'}
          </p>
        </div>

        <div
          className="shrink-0 w-fit flex items-center gap-2.5 rounded-[22px] bg-white px-3.5 py-2"
          style={{ boxShadow: CARD_SHADOW }}
        >
          <Clock className="w-4 h-4 shrink-0 text-primary" strokeWidth={2.5} />
          <div className="leading-tight">
            <p className="text-[8px] uppercase tracking-widest font-semibold text-muted-foreground">
              {isToday ? 'Next dose' : 'First dose'}
            </p>
            {nextDose ? (
              <p className="text-xs font-bold text-foreground whitespace-nowrap">
                {nextDose.drug_name} · {formatTimeLabel(nextDose.time)}
              </p>
            ) : (
              <p className="text-xs font-semibold text-muted-foreground">None today</p>
            )}
          </div>
        </div>
      </div>

      {/* Week navigator */}
      <div className="bg-white rounded-[22px] p-4" style={{ boxShadow: CARD_SHADOW }}>
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => shiftWeek(-1)}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-[#F2F2F7] hover:bg-[#E5E5EA] text-foreground transition-all cursor-pointer"
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
                'inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-all ' +
                (showMonth
                  ? 'bg-primary text-white'
                  : 'bg-[#F2F2F7] text-muted-foreground hover:text-foreground')
              }
            >
              <Grid3x3 className="w-3 h-3" strokeWidth={2.5} /> Month
            </button>
          </div>
          <button
            onClick={() => shiftWeek(1)}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-[#F2F2F7] hover:bg-[#E5E5EA] text-foreground transition-all cursor-pointer"
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
                    ? 'bg-gradient-to-b from-[#F8839E] to-[#F26B8A] text-white z-10'
                    : isTod
                      ? 'bg-primary-soft text-foreground'
                      : 'bg-[#F2F2F5] text-foreground hover:bg-[#EAEAEF]')
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
                    className={'uppercase font-bold tracking-wide whitespace-nowrap ' + (isSel ? 'text-[11px] text-white/80' : isTod ? 'text-[9px] sm:text-[10px] text-primary' : 'text-[9px] sm:text-[10px] text-muted-foreground')}
                    style={{ transition: 'color 650ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                  >
                    {date.toLocaleDateString([], { weekday: 'short' })}
                  </span>
                  <span className={'font-extrabold leading-none tabular-nums transition-[font-size] duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)] ' + (isSel ? 'text-2xl sm:text-3xl' : 'text-base sm:text-lg')}>
                    {date.getDate()}
                  </span>
                  {/* Dose count along the bottom edge of the expanded tab */}
                  {isSel && (
                    <span className="mt-0.5 text-[9px] font-bold leading-none text-white/85 whitespace-nowrap animate-fade-in">
                      {load > 0 ? `${load} dose${load > 1 ? 's' : ''}` : 'clear'}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {showMonth && (
          <div className="mt-4 pt-4 border-t border-[#0F1C5A]/[0.06] animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-[#F2F2F7] hover:bg-[#E5E5EA] text-foreground cursor-pointer transition-all"
              >
                <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
              <span className="text-xs font-bold text-foreground">
                {currentDate.toLocaleDateString([], { month: 'long', year: 'numeric' })}
              </span>
              <button
                onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-[#F2F2F7] hover:bg-[#E5E5EA] text-foreground cursor-pointer transition-all"
              >
                <ChevronRight className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-semibold text-muted-foreground mb-1">
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
                  ? 'bg-primary text-white'
                  : isTod
                    ? 'bg-primary-soft text-foreground'
                    : 'hover:bg-[#F2F2F7] text-foreground';
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
        <div className="lg:col-span-8 bg-white rounded-[22px] overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <h3 className="text-sm font-bold tracking-tight text-foreground">{selectedDateLong}</h3>
              <p className="text-[11px] font-medium text-muted-foreground mt-0.5">
                {activeDoses.length} {activeDoses.length === 1 ? 'dose' : 'doses'} planned
                {skippedCount > 0 ? ' · ' + skippedCount + ' skipped' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 bg-[#F2F2F7] rounded-full px-1 py-1">
                <button
                  onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                  className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                  aria-label="Zoom out"
                >
                  <Minus className="w-3 h-3" strokeWidth={2.5} />
                </button>
                <span className="text-[10px] font-bold text-foreground w-8 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))}
                  className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                  aria-label="Zoom in"
                >
                  <Plus className="w-3 h-3" strokeWidth={2.5} />
                </button>
              </div>
              {canEdit && overrides.some(o => o.dateStr === selectedDate.toISOString().split('T')[0]) && (
                <button
                  onClick={() => {
                    const dateStr = selectedDate.toISOString().split('T')[0];
                    saveOverrides(overrides.filter(o => o.dateStr !== dateStr));
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[10px] font-semibold transition-all cursor-pointer"
                  style={{ color: '#FF3B30', background: '#FFECEA' }}
                  title="Reset all adjustments for this day"
                >
                  <RotateCcw className="w-3 h-3" strokeWidth={2.5} /> Reset
                </button>
              )}
            </div>
          </div>
          <div className="h-px bg-[#0F1C5A]/[0.06] mx-6" />

          {groupedByTime.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 px-6">
              <div className="w-16 h-16 rounded-full bg-[#F2F2F7] flex items-center justify-center mb-3">
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
                      <span className="ml-14 mt-1 inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider" style={{ color: band.text }}>
                        <BandIcon className="w-3 h-3" /> {band.label}
                      </span>
                    </div>
                  );
                })}

                {/* Hour lines */}
                {Array.from({ length: 24 }).map((_, h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-border/50" style={{ top: h * hourHeight }}>
                    <span className="absolute -top-2 left-0 w-12 text-right pr-2 text-[9px] font-bold text-muted-foreground tabular-nums">
                      {hourLabel(h)}
                    </span>
                  </div>
                ))}

                {/* Now line */}
                {isToday && (
                  <div className="absolute left-12 right-2 z-20 pointer-events-none" style={{ top: (nowMinutes / 60) * hourHeight }}>
                    <div className="relative flex items-center">
                      <span className="absolute -left-1 w-2.5 h-2.5 rounded-full bg-danger ring-2 ring-white" />
                      <div className="w-full border-t-2 border-danger/70 border-dashed" />
                      <span className="absolute right-0 -top-4 text-[8px] font-black text-danger bg-danger/10 px-1.5 py-0.5 rounded-full">NOW</span>
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
                        canEdit={canEdit}
                        dragging={dragging}
                        openOverride={openOverride}
                        handleRemoveOverride={handleRemoveOverride}
                        startDrag={startDrag}
                        onDragMove={onDragMove}
                        endDrag={endDrag}
                        setDragging={setDragging}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Summary rail */}
        <div className="lg:col-span-4 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-[22px] p-4" style={{ boxShadow: CARD_SHADOW }}>
              <p className="text-2xl font-bold text-foreground leading-none">{activeDoses.length}</p>
              <p className="text-[10px] font-semibold text-muted-foreground mt-1 uppercase tracking-wide">Doses today</p>
            </div>
            <div className="bg-white rounded-[22px] p-4" style={{ boxShadow: CARD_SHADOW }}>
              <p className="text-2xl font-bold leading-none" style={{ color: criticalCount > 0 ? '#FF3B30' : 'var(--foreground)' }}>{criticalCount}</p>
              <p className="text-[10px] font-semibold text-muted-foreground mt-1 uppercase tracking-wide">Critical</p>
            </div>
          </div>

          <div className="bg-white rounded-[22px] p-5 space-y-3" style={{ boxShadow: CARD_SHADOW }}>
            <h4 className="text-xs font-bold tracking-tight text-foreground">Priority key</h4>
            {[
              { c: '#FF3B30', l: 'Critical — never miss' },
              { c: '#FF9500', l: 'Important' },
              { c: '#F26B8A', l: 'Routine' },
            ].map((row, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-full" style={{ background: row.c }} />
                <span className="text-[11px] font-medium text-muted-foreground">{row.l}</span>
              </div>
            ))}
          </div>

          {canEdit && (
            <a
              href="/medications"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-full bg-primary text-white font-semibold text-sm hover:bg-primary-hover transition-all cursor-pointer"
              style={{ boxShadow: '0 4px 12px rgba(242, 107, 138, 0.35)' }}
            >
              <Plus className="w-4 h-4" strokeWidth={2.5} /> Add medication
            </a>
          )}

          <div className="bg-[#F2F2F7] rounded-[22px] p-4">
            <p className="text-[10px] font-medium text-muted-foreground leading-relaxed">
              Adjusting a time or skipping a dose here only affects <b className="text-foreground font-semibold">{selectedDateLong}</b>. Your recurring routine stays exactly as it is.
            </p>
          </div>
        </div>
      </div>

      {/* Override modal */}
      {showOverrideModal && selectedMedForOverride && (
        <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-[22px] max-w-md w-full p-6 space-y-5" style={{ boxShadow: '0 8px 40px rgba(16, 28, 90, 0.18)' }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Adjust dose</p>
                <h3 className="text-base font-bold tracking-tight text-foreground mt-0.5">{selectedMedForOverride.drug_name}</h3>
                <p className="text-[11px] font-semibold text-primary mt-0.5">{selectedDateLong}</p>
              </div>
              <button onClick={closeModal} className="w-8 h-8 rounded-full flex items-center justify-center bg-[#F2F2F7] hover:bg-[#E5E5EA] text-muted-foreground cursor-pointer transition-all">
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
                <span className="text-[10px] uppercase font-black text-muted-foreground">New time</span>
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
                className="flex-1 py-3 bg-[#F2F2F7] text-muted-foreground hover:bg-[#E5E5EA] text-sm font-semibold rounded-full cursor-pointer transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyOverride}
                className="flex-1 py-3 bg-primary text-white hover:bg-primary-hover text-sm font-semibold rounded-full cursor-pointer transition-all"
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
