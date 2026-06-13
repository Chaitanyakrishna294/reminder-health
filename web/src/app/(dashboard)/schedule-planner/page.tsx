'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar as CalendarIcon, Clock, Edit2, AlertCircle, Plus, ChevronLeft, ChevronRight, CheckCircle, HelpCircle } from 'lucide-react';
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

export default function SchedulePlannerPage() {
  const router = useRouter();
  const { isElderly, viewMode: activeViewMode } = useUiMode();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('month');
  const [medications, setMedications] = useState<any[]>([]);
  const [overrides, setOverrides] = useState<OverrideEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [selectedMedForOverride, setSelectedMedForOverride] = useState<any | null>(null);
  const [newOverrideTime, setNewOverrideTime] = useState('');
  const [skipForToday, setSkipForToday] = useState(false);
  const [patientName, setPatientName] = useState<string | null>(null);
  const activeRole = activeViewMode === 'PATIENT_MONITOR' ? 'CAREGIVER' : 'PATIENT';
  
  const supabase = createClient();

  useEffect(() => {
    // Detect mobile viewport and default to 'day' view
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setViewMode('day');
    }
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
            
            // Fetch patient name and medications concurrently
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
                .eq('active', true)
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
          // Patient: fetch medications directly (hide patient name header as they view their own)
          setPatientName(null);
          const { data: meds } = await supabase
            .from('medications')
            .select('id, drug_name, dosage, frequency, reminder_times, priority_level, created_at')
            .eq('telegram_id', targetChatId)
            .eq('active', true);
          setMedications(meds || []);
        }

        // Load overrides from localStorage
        const storageKey = `schedule-overrides-${user.id}`;
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

  // Save overrides to localStorage
  const saveOverrides = (newOverrides: OverrideEntry[]) => {
    setOverrides(newOverrides);
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        localStorage.setItem(`schedule-overrides-${user.id}`, JSON.stringify(newOverrides));
      }
    });
  };

  // Helper: Get list of meds scheduled for selected date
  const getMedicationsForDate = (date: Date): ScheduledMed[] => {
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday...
    
    return medications.flatMap(med => {
      // Determine if med runs on this day based on frequency
      let scheduled = false;
      if (med.frequency === 'once_daily' || med.frequency === 'twice_daily' || med.frequency === 'thrice_daily') {
        scheduled = true;
      } else if (med.frequency === 'every_other_day') {
        // Simple modulo logic based on timestamp
        const createdTime = new Date(med.created_at || Date.now()).getTime();
        const diffDays = Math.floor((date.getTime() - createdTime) / (1000 * 60 * 60 * 24));
        scheduled = diffDays % 2 === 0;
      } else if (med.frequency === 'weekly') {
        // Runs on same day of week as creation day
        const createdDay = new Date(med.created_at || Date.now()).getDay();
        scheduled = dayOfWeek === createdDay;
      }

      if (!scheduled) return [];

      // Generate items for each reminder time
      return (med.reminder_times || []).map((timeStr: string) => {
        // Check for overrides
        const medOverride = overrides.find(
          o => o.medicationId === med.id && o.dateStr === dateStr
        );

        return {
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
      });
    }).sort((a, b) => a.time.localeCompare(b.time));
  };

  // Calendar logic
  const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  
  const daysInMonth: Date[] = [];
  // Pad beginning of month
  const startDayOfWeek = startOfMonth.getDay();
  for (let i = startDayOfWeek; i > 0; i--) {
    daysInMonth.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1 - i));
  }
  // Month days
  for (let i = 1; i <= endOfMonth.getDate(); i++) {
    daysInMonth.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), i));
  }
  // Pad end of month to full weeks
  const totalSlots = Math.ceil(daysInMonth.length / 7) * 7;
  const remainingSlots = totalSlots - daysInMonth.length;
  for (let i = 1; i <= remainingSlots; i++) {
    daysInMonth.push(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, i));
  }

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleApplyOverride = () => {
    if (!selectedMedForOverride) return;

    const dateStr = selectedDate.toISOString().split('T')[0];
    const filteredOverrides = overrides.filter(
      o => !(o.medicationId === selectedMedForOverride.id && o.dateStr === dateStr)
    );

    const newOverrides = [...filteredOverrides];
    if (skipForToday) {
      newOverrides.push({
        medicationId: selectedMedForOverride.id,
        dateStr,
        isSkipped: true,
      });
    } else if (newOverrideTime) {
      newOverrides.push({
        medicationId: selectedMedForOverride.id,
        dateStr,
        overriddenTime: newOverrideTime,
      });
    }

    saveOverrides(newOverrides);
    setShowOverrideModal(false);
    setSelectedMedForOverride(null);
    setNewOverrideTime('');
    setSkipForToday(false);
  };

  const handleRemoveOverride = (medId: number) => {
    const dateStr = selectedDate.toISOString().split('T')[0];
    const filtered = overrides.filter(
      o => !(o.medicationId === medId && o.dateStr === dateStr)
    );
    saveOverrides(filtered);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const selectedMeds = getMedicationsForDate(selectedDate);
  const selectedDateStr = selectedDate.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-card p-6 rounded-[24px] border border-border shadow-sm gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-foreground flex items-center gap-2">
            <CalendarIcon className="w-6 h-6 text-primary" />
            Schedule Planner
            {activeViewMode === 'PATIENT_MONITOR' && (
              <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black bg-danger/10 text-danger border border-danger/25 uppercase tracking-wider shrink-0 animate-pulse">
                Read Only
              </span>
            )}
          </h1>
          <p className="text-xs text-muted-foreground font-semibold mt-1">
            {patientName 
              ? `Plan medications, view calendar schedules, and set overrides for: ${patientName}.`
              : 'Plan your medications, view calendar schedules, and set custom overrides.'}
          </p>
        </div>
        <div className="flex bg-[#EEF4FB] rounded-full p-1 border border-border/60">
          {(['month', 'week', 'day'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer capitalize ${
                viewMode === mode
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Grid: Calendar Left, Day Schedule Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Calendar (8 cols) */}
        <div className="lg:col-span-8 bg-card border border-border rounded-[24px] p-6 shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-black text-foreground">
              {currentDate.toLocaleDateString([], { month: 'long', year: 'numeric' })}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={prevMonth}
                className="p-2 border border-border rounded-xl hover:bg-muted text-foreground cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={nextMonth}
                className="p-2 border border-border rounded-xl hover:bg-muted text-foreground cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Month Calendar Grid */}
          {viewMode === 'month' && (
            <div className="space-y-2">
              <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-muted-foreground pb-2 border-b border-border/60">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} className="py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {daysInMonth.map((date, idx) => {
                  const isSelected = date.toDateString() === selectedDate.toDateString();
                  const isCurrentMonth = date.getMonth() === currentDate.getMonth();
                  const dateMeds = getMedicationsForDate(date);
                  const hasMeds = dateMeds.length > 0;
                  const isToday = date.toDateString() === new Date().toDateString();

                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        setSelectedDate(date);
                        setCurrentDate(date);
                      }}
                      className={`h-12 w-full rounded-2xl flex flex-col items-center justify-center relative cursor-pointer border transition-all text-xs font-bold ${
                        isSelected
                          ? 'bg-primary text-white border-primary shadow-sm shadow-primary/20 hover:bg-primary-hover'
                          : isToday
                            ? 'bg-primary/10 border-primary text-primary hover:bg-primary/15'
                            : 'bg-white border-border hover:bg-muted text-foreground'
                      } ${!isCurrentMonth ? 'opacity-40' : ''}`}
                    >
                      <span>{date.getDate()}</span>
                      {hasMeds && (
                        <div className="flex gap-0.5 mt-1 justify-center">
                          {dateMeds.slice(0, 3).map((m, mIdx) => (
                            <span 
                              key={mIdx} 
                              className={`w-1.5 h-1.5 rounded-full ${
                                m.isSkipped 
                                  ? 'bg-muted-foreground' 
                                  : m.priority_level === 'critical' 
                                    ? 'bg-danger' 
                                    : m.priority_level === 'important' 
                                      ? 'bg-warning' 
                                      : 'bg-primary'
                              }`} 
                            />
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Week Calendar View */}
          {viewMode === 'week' && (
            <div className="grid grid-cols-7 gap-3">
              {Array.from({ length: 7 }).map((_, idx) => {
                const date = new Date(selectedDate);
                date.setDate(selectedDate.getDate() - selectedDate.getDay() + idx);
                const isSelected = date.toDateString() === selectedDate.toDateString();
                const isToday = date.toDateString() === new Date().toDateString();
                const dateMeds = getMedicationsForDate(date);

                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDate(date)}
                    className={`p-4 rounded-3xl flex flex-col items-center justify-between min-h-[100px] border cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20'
                        : isToday
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'bg-white border-border text-foreground hover:bg-muted'
                    }`}
                  >
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">
                      {date.toLocaleDateString([], { weekday: 'short' })}
                    </span>
                    <span className="text-lg font-black">{date.getDate()}</span>
                    <span className="text-[9px] font-bold mt-1">
                      {dateMeds.length} Doses
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Day Calendar View */}
          {viewMode === 'day' && (
            <div className="bg-muted/10 p-4 rounded-3xl border border-border/80">
              <p className="text-xs text-center font-bold text-muted-foreground">Hourly Day View for {selectedDateStr}</p>
              <div className="mt-4 space-y-4 max-h-[300px] overflow-y-auto pr-1">
                {selectedMeds.length === 0 ? (
                  <p className="text-xs text-center text-muted-foreground py-6">No doses scheduled for today</p>
                ) : (
                  selectedMeds.map((med, idx) => (
                    <div key={idx} className="flex gap-4 items-center p-3 bg-white border border-border rounded-2xl shadow-sm">
                      <Clock className="w-4 h-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-foreground truncate">{med.drug_name}</p>
                        <p className="text-[10px] text-muted-foreground font-semibold">Dosage: {med.dosage}</p>
                      </div>
                      <span className="text-xs font-mono font-black text-primary bg-primary/10 px-2 py-0.5 rounded-lg border border-primary/20">
                        {med.time}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Medications for Date (4 cols) */}
        <div className="lg:col-span-4 bg-white border border-border rounded-[24px] p-6 shadow-sm flex flex-col justify-between min-h-[450px]">
          <div>
            <h3 className="font-black text-foreground text-sm flex items-center gap-1.5 border-b border-border/60 pb-3">
              <Clock className="w-4 h-4 text-primary" /> Daily Schedule
            </h3>
            <p className="text-xs font-bold text-primary mt-2">{selectedDateStr}</p>

            <div className="mt-4 space-y-3 overflow-y-auto max-h-[300px] pr-1">
              {selectedMeds.length === 0 ? (
                <div className="text-center py-10 space-y-2">
                  <CheckCircle className="w-8 h-8 text-success mx-auto" />
                  <p className="text-xs font-bold text-success">All clear!</p>
                  <p className="text-[10px] text-muted-foreground font-semibold">No medications scheduled for this day.</p>
                </div>
              ) : (
                selectedMeds.map((med, idx) => (
                  <div 
                    key={idx} 
                    className={`p-3 rounded-2xl border flex flex-col justify-between gap-3 shadow-sm ${
                      med.isSkipped
                        ? 'bg-muted/40 border-border/60 opacity-60'
                        : med.isOverridden
                          ? 'border-warning/40 bg-warning/5'
                          : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-foreground truncate">{med.drug_name}</p>
                        <p className="text-[10px] text-muted-foreground font-semibold mt-0.5">Dose: {med.dosage}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-[9px] font-black font-mono px-2 py-0.5 rounded-lg border ${
                          med.isSkipped 
                            ? 'bg-muted text-muted-foreground border-border'
                            : 'bg-primary/10 text-primary border-primary/20'
                        }`}>
                          {med.time}
                        </span>
                        {med.isSkipped && (
                          <span className="text-[8px] font-black text-danger uppercase tracking-wider">
                            SKIPPED FOR TODAY
                          </span>
                        )}
                        {med.isOverridden && !med.isSkipped && (
                          <span className="text-[8px] font-black text-warning uppercase tracking-wider">
                            OVERRIDDEN
                          </span>
                        )}
                      </div>
                    </div>

                    {activeRole !== 'CAREGIVER' && (
                      <div className="flex gap-2 justify-end border-t border-border/40 pt-2">
                        {med.isOverridden || med.isSkipped ? (
                          <button
                            onClick={() => handleRemoveOverride(med.id)}
                            className="px-2.5 py-1 text-[9px] font-bold bg-danger/10 text-danger hover:bg-danger/20 rounded-lg cursor-pointer transition-all"
                          >
                            Restore Default
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setSelectedMedForOverride(med);
                              setNewOverrideTime(med.time);
                              setShowOverrideModal(true);
                            }}
                            className="px-2.5 py-1 text-[9px] font-bold bg-muted hover:bg-muted/80 text-foreground border border-border/80 rounded-lg flex items-center gap-1 cursor-pointer transition-all"
                          >
                            <Edit2 className="w-2.5 h-2.5" /> Adjust
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-primary/5 p-3 rounded-2xl border border-primary/10 text-[10px] text-muted-foreground font-semibold mt-4">
            * Adjusting times here overrides the schedule only for the selected date. The base recurring medication routine will remain unchanged.
          </div>
        </div>
      </div>

      {/* Override Modification Modal */}
      {showOverrideModal && selectedMedForOverride && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl border border-border max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-black text-foreground flex items-center gap-1.5">
              Adjust timing for: <span className="text-primary">{selectedMedForOverride.drug_name}</span>
            </h3>
            
            <p className="text-xs text-muted-foreground font-semibold">
              Select a customized time or choose to skip this dose for the date: <b className="text-foreground">{selectedDateStr}</b>
            </p>

            <div className="space-y-3">
              <label className="block">
                <span className="text-[10px] uppercase font-black text-muted-foreground">Skip this dosage</span>
                <div className="flex items-center gap-2 mt-1.5">
                  <input
                    type="checkbox"
                    checked={skipForToday}
                    onChange={(e) => setSkipForToday(e.target.checked)}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/60 cursor-pointer"
                  />
                  <span className="text-xs font-semibold text-foreground">Skip for today</span>
                </div>
              </label>

              {!skipForToday && (
                <label className="block">
                  <span className="text-[10px] uppercase font-black text-muted-foreground">Adjust Timing</span>
                  <input
                    type="time"
                    value={newOverrideTime}
                    onChange={(e) => setNewOverrideTime(e.target.value)}
                    className="mt-1.5 w-full px-3 py-2 bg-muted border border-border/80 rounded-xl text-xs font-semibold focus:outline-none"
                  />
                </label>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-3">
              <button
                onClick={() => {
                  setShowOverrideModal(false);
                  setSelectedMedForOverride(null);
                  setNewOverrideTime('');
                  setSkipForToday(false);
                }}
                className="px-4 py-2 bg-muted text-muted-foreground hover:bg-muted/80 text-xs font-bold rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyOverride}
                className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary-hover text-xs font-black rounded-xl cursor-pointer shadow-sm"
              >
                Apply Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
