'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { calculateNextReminder } from '@/lib/medication-utils';
import { useUiMode } from '@/context/ui-mode-context';
import { Plus, Package, Clock, Pause, Play, SquarePen, Trash2 } from 'lucide-react';
import { getUnitIcon } from '@/components/ui/custom-icons';
import { getSeverityTheme } from '@/lib/severity-theme';

export interface Medication {
  id: number;
  telegram_id: string;
  drug_name: string;
  dosage: string;
  frequency: string;
  reminder_times: string[];
  tablet_count: number;
  priority_level: string;
  next_reminder_at: string | null;
  active: boolean;
  unit_type?: string;
  dosage_amount?: number;
  current_stock?: number | null;
  stock_threshold?: number | null;
  medication_reason?: string | null;
}

interface MedicationListProps {
  initialMeds: Medication[];
  targetTelegramChatId: string;
  myTelegramChatId: string;
  userRole: 'PATIENT' | 'CAREGIVER';
}

export default function MedicationList({
  initialMeds,
  targetTelegramChatId,
  myTelegramChatId,
  userRole,
}: MedicationListProps) {
  const [meds, setMeds] = useState<Medication[]>(initialMeds);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  
  const supabase = createClient();
  const router = useRouter();
  const { isElderly, viewMode } = useUiMode();
  const activeRole = viewMode === 'PATIENT_MONITOR' ? 'CAREGIVER' : 'PATIENT';

  useEffect(() => {
    setMounted(true);
  }, []);

  // Dynamic loader that refreshes medications when changing active role views
  useEffect(() => {
    async function fetchMeds() {
      if (userRole === 'CAREGIVER') {
        const queryId = activeRole === 'PATIENT' ? myTelegramChatId : targetTelegramChatId;
        if (!queryId) {
          setMeds([]);
          return;
        }

        const { data, error } = await supabase
          .from('medications')
          .select('id, telegram_id, drug_name, dosage, frequency, reminder_times, tablet_count, priority_level, next_reminder_at, active, unit_type, dosage_amount, current_stock, stock_threshold, medication_reason')
          .eq('telegram_id', queryId);

        if (!error && data) {
          setMeds(data as Medication[]);
        }
      } else {
        setMeds(initialMeds);
      }
    }
    if (mounted) {
      fetchMeds();
    }
  }, [activeRole, userRole, myTelegramChatId, targetTelegramChatId, supabase, mounted, initialMeds]);

  const handleToggleActive = async (med: Medication) => {
    setLoadingId(med.id);
    try {
      const newActive = !med.active;
      let nextReminder: string | null = null;

      if (newActive && med.reminder_times.length > 0) {
        // Recalculate next reminder when resuming
        const nextDate = calculateNextReminder(med.reminder_times);
        nextReminder = nextDate.toISOString();
      }

      const { error } = await supabase
        .from('medications')
        .update({
          active: newActive,
          next_reminder_at: nextReminder,
        })
        .eq('id', med.id);

      if (error) throw error;

      setMeds((prev) =>
        prev.map((m) =>
          m.id === med.id
            ? { ...m, active: newActive, next_reminder_at: nextReminder }
            : m
        )
      );
      router.refresh();
    } catch (err) {
      console.error('[MedList] Error toggling active status:', err);
      alert('Failed to update medication status.');
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (medId: number) => {
    if (!confirm('Are you sure you want to delete this medication?')) return;
    setLoadingId(medId);
    try {
      // Hard delete from database so it completely disappears from the web manager
      const { error } = await supabase
        .from('medications')
        .delete()
        .eq('id', medId);

      if (error) throw error;

      // Remove from local listing
      setMeds((prev) => prev.filter((m) => m.id !== medId));
      router.refresh();
    } catch (err) {
      console.error('[MedList] Error deleting medication:', err);
      alert('Failed to delete medication.');
    } finally {
      setLoadingId(null);
    }
  };

  const format12Hour = (timeStr: string) => {
    const [hourStr, minStr] = timeStr.split(':');
    const hour = parseInt(hourStr);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${displayHour}:${minStr} ${ampm}`;
  };

  return (
    <div className="space-y-6">
      {/* Header Panel */}
      <div className={`flex justify-between items-center bg-card rounded-3xl border border-border shadow-sm transition-all duration-300 ${
        isElderly ? 'p-6 border-2' : 'p-4'
      }`}>
        <div>
          <h2 className={`font-black text-foreground ${isElderly ? 'text-2xl' : 'text-sm'}`}>Medication Inventory</h2>
          <p className={`text-muted-foreground ${isElderly ? 'text-base mt-1' : 'text-xs'}`}>
            Active medications currently loaded into the scheduler.
          </p>
        </div>
        {activeRole !== 'CAREGIVER' && (
          <Link
            href="/medications/new"
            className={`font-black rounded-full bg-primary text-primary-foreground hover:bg-primary-hover transition-all cursor-pointer shadow-sm flex items-center justify-center ${
              isElderly ? 'px-6 py-3.5 text-lg' : 'px-4 py-2 text-xs'
            }`}
          >
            <Plus className={`${isElderly ? 'w-5 h-5 mr-2' : 'w-4 h-4 mr-1'} shrink-0`} />
            <span>Add Medication</span>
          </Link>
        )}
      </div>

      {/* Grid List */}
      {meds.length === 0 ? (
        <div className={`bg-card border border-border rounded-3xl text-center text-muted-foreground shadow-sm ${
          isElderly ? 'p-16 text-lg' : 'p-12 text-sm'
        }`}>
          No active medications found. Click "Add Medication" to register your first one.
        </div>
      ) : (
        <div className={`grid grid-cols-1 gap-6 ${isElderly ? 'md:grid-cols-1 max-w-4xl mx-auto' : 'md:grid-cols-2'}`}>
          {meds.map((med) => {
            const isLoading = loadingId === med.id;
            const theme = getSeverityTheme(med.priority_level);
            return (
              <div
                key={med.id}
                className={`rounded-3xl border flex flex-col justify-between transition-all duration-300 ${
                  isElderly
                    ? 'p-8 border-4 space-y-6'
                    : 'p-5 space-y-4 hover:scale-[1.01] hover:shadow-md shadow-sm'
                } ${
                  !med.active
                    ? 'opacity-60 bg-muted/30 border-border'
                    : `${theme.bg} ${isElderly ? theme.borderStrong : theme.border}`
                }`}
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`shrink-0 flex items-center justify-center rounded-2xl ${theme.tile} ${isElderly ? 'w-16 h-16' : 'w-10 h-10'}`}>
                        {getUnitIcon(med.unit_type, isElderly ? 'w-8 h-8' : 'w-5 h-5')}
                      </span>
                      <div>
                        <h3 className={`font-black text-foreground tracking-tight ${isElderly ? 'text-3xl' : 'text-sm'}`}>
                          {med.drug_name}
                        </h3>
                        <p className={`text-muted-foreground mt-1 ${isElderly ? 'text-lg font-bold' : 'text-xs'}`}>
                          Dosage: <b className="text-foreground">{med.dosage_amount || 1} {med.unit_type?.toLowerCase() || 'tablet'}(s)</b>
                          {med.dosage && med.dosage !== 'N/A' && (
                            <> ({med.dosage})</>
                          )}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`uppercase font-extrabold border transition-all ${
                        isElderly ? 'px-4 py-1.5 text-xs rounded-full border-2' : 'px-2 py-0.5 rounded-full text-[10px]'
                      } ${theme.badge}`}
                    >
                      {med.priority_level}
                    </span>
                  </div>

                  <div className={`mt-4 space-y-3 ${isElderly ? 'border-t border-b border-border/50 py-4 my-4' : ''}`}>
                    {/* Frequency info */}
                    <div className={`flex items-center justify-between ${isElderly ? 'text-lg' : 'text-xs text-muted-foreground'}`}>
                      <span className="text-muted-foreground font-bold">Frequency:</span>
                      <span className="font-extrabold text-foreground capitalize">
                        {med.frequency.replace('_', ' ')}
                      </span>
                    </div>

                    {/* Timings info */}
                    <div className={`flex items-start justify-between ${isElderly ? 'text-lg' : 'text-xs text-muted-foreground'}`}>
                      <span className="text-muted-foreground font-bold">Reminder Timings:</span>
                      <div className="flex flex-wrap gap-1.5 justify-end max-w-[60%]">
                        {med.reminder_times.map((time, idx) => (
                          <span
                            key={idx}
                            className={`bg-muted rounded-md font-mono font-extrabold text-foreground border border-border ${
                              isElderly ? 'px-2.5 py-1 text-sm' : 'px-1.5 py-0.5 text-[10px]'
                            }`}
                          >
                            {format12Hour(time)}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Stock level info */}
                    <div className={`flex items-center justify-between ${isElderly ? 'text-lg' : 'text-xs text-muted-foreground'}`}>
                      <span className="text-muted-foreground font-bold">Stock:</span>
                      <span className="font-extrabold text-foreground flex items-center gap-1">
                        <Package className="w-4 h-4 text-muted-foreground shrink-0" />
                        {med.current_stock !== null && med.current_stock !== undefined ? (
                          <span className={
                            med.stock_threshold !== null && med.stock_threshold !== undefined && Number(med.current_stock) <= Number(med.stock_threshold)
                              ? 'text-danger font-black animate-pulse'
                              : ''
                          }>
                            {med.current_stock} {med.unit_type?.toLowerCase() || 'unit'}(s) 
                            {med.stock_threshold !== null && med.stock_threshold !== undefined && Number(med.current_stock) <= Number(med.stock_threshold) && (
                              <span className="text-[10px] ml-1 bg-danger/10 text-danger border border-danger/20 px-1.5 py-0.5 rounded-full font-black">
                                LOW
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground font-medium">Not tracked</span>
                        )}
                      </span>
                    </div>

                    {/* Medication Reason */}
                    {med.medication_reason && (
                      <div className={`flex items-start justify-between ${isElderly ? 'text-lg' : 'text-xs text-muted-foreground'}`}>
                        <span className="text-muted-foreground font-bold">Reason:</span>
                        <span className="font-extrabold text-foreground text-right">{med.medication_reason}</span>
                      </div>
                    )}

                    {/* Next scheduled run */}
                    {med.active && med.next_reminder_at && (
                      <div className={`flex items-center justify-between pt-1 border-t border-border/50 ${
                        isElderly ? 'text-lg pt-3 mt-3' : 'text-xs text-muted-foreground'
                      }`}>
                        <span className="text-muted-foreground font-bold">Next reminder:</span>
                        <span className="font-extrabold text-primary flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {mounted && med.next_reminder_at ? new Date(med.next_reminder_at).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            }) : 'Loading...'}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Operations buttons */}
                {activeRole !== 'CAREGIVER' && (
                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/50">
                    <button
                      onClick={() => handleToggleActive(med)}
                      disabled={isLoading}
                      aria-label={med.active ? 'Pause medication' : 'Resume medication'}
                      title={med.active ? 'Pause' : 'Resume'}
                      className={`rounded-full cursor-pointer transition-all backdrop-blur-md border shadow-sm flex items-center justify-center disabled:opacity-50 ${isLoading ? 'animate-pulse' : ''} ${
                        isElderly ? 'w-14 h-14' : 'w-9 h-9'
                      } ${
                        med.active
                          ? 'bg-white/55 border-white/70 text-foreground hover:bg-white/80'
                          : 'bg-primary/15 border-primary/30 text-primary hover:bg-primary/25'
                      }`}
                    >
                      {med.active
                        ? <Pause className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} />
                        : <Play className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} />}
                    </button>
                    <Link
                      href={`/medications/${med.id}`}
                      aria-label="Edit medication"
                      title="Edit"
                      className={`rounded-full bg-white/55 backdrop-blur-md border border-white/70 text-foreground hover:bg-white/80 transition-all shadow-sm flex items-center justify-center ${
                        isElderly ? 'w-14 h-14' : 'w-9 h-9'
                      }`}
                    >
                      <SquarePen className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} />
                    </Link>
                    <button
                      onClick={() => handleDelete(med.id)}
                      disabled={isLoading}
                      aria-label="Delete medication"
                      title="Delete"
                      className={`rounded-full bg-danger/15 backdrop-blur-md border border-danger/30 text-danger hover:bg-danger/25 transition-all cursor-pointer shadow-sm flex items-center justify-center disabled:opacity-50 ${
                        isElderly ? 'w-14 h-14' : 'w-9 h-9'
                      }`}
                    >
                      <Trash2 className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
