'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { calculateNextReminder } from '@/lib/medication-utils';
import {
  DEFAULT_LADDERS,
  RETRY_CAP_MINUTES,
  isConfigurable,
  ladderError,
  retryOffsets,
} from '@/lib/schedule/retry-ladder';
import { useUiMode } from '@/context/ui-mode-context';
import { type UnitType, unitOptions, stepMeta, frequencies, priorities, weekdays, describeDoseDays, unitPhrase } from '@/components/medications/medication-form-options';
import { validateMedicationStep, buildSharedMedicationFields, normalizeDoseDays } from '@/lib/medications/form-logic';
import { getToneTheme } from '@/lib/severity-theme';
import MedicationCatalogLink from '@/components/medications/medication-catalog-link';
import type { CatalogLinkValue } from '@/lib/medications/catalog';
import {
  Pill,
  Clock,
  Layers,
  ShieldAlert,
  Check,
  ArrowLeft,
  ArrowRight,
  FileText,
  Beaker,
  AlertTriangle,
  Minus,
  Plus,
} from 'lucide-react';

interface EditMedicationFormProps {
  medication: {
    id: number;
    telegram_id: string;
    drug_name: string;
    dosage: string;
    frequency: string;
    reminder_times: string[];
    tablet_count: number;
    priority_level: string;
    retry_interval_minutes?: number | null;
    retry_count?: number | null;
    active: boolean;
    low_stock_alert_enabled: boolean;
    unit_type?: string;
    dosage_amount?: number;
    current_stock?: number | null;
    stock_threshold?: number | null;
    medication_reason?: string | null;
    timezone?: string | null;
    /** Weekdays the med is due, 0=Sun..6=Sat. Null = every day. */
    dose_days?: number[] | null;
    catalog_id?: number | null;
    linked_brand_name?: string | null;
    linked_composition?: string | null;
    linked_manufacturer?: string | null;
    linked_snapshot_date?: string | null;
    linked_is_discontinued?: boolean | null;
  };
}

export default function EditMedicationForm({ medication }: EditMedicationFormProps) {
  const [step, setStep] = useState(1);
  const [drugName, setDrugName] = useState(medication.drug_name);
  const [catalogLink, setCatalogLink] = useState<CatalogLinkValue | null>(
    medication.catalog_id
      ? {
          catalogId: medication.catalog_id,
          brandName: medication.linked_brand_name || '',
          composition: medication.linked_composition ?? null,
          manufacturer: medication.linked_manufacturer ?? null,
          isDiscontinued: medication.linked_is_discontinued ?? false,
          snapshotDate: medication.linked_snapshot_date || '',
        }
      : null
  );
  const [unitType, setUnitType] = useState<UnitType>((medication.unit_type as UnitType) || 'TABLET');
  const [frequency, setFrequency] = useState<'once_daily' | 'twice_daily' | 'thrice_daily'>(
    medication.frequency as any
  );
  const [times, setTimes] = useState<string[]>(medication.reminder_times);
  // NULL in the column means every day; the picker represents that as no days
  // selected, so both round-trip back to NULL through normalizeDoseDays.
  const [doseDays, setDoseDays] = useState<number[]>(medication.dose_days ?? []);
  
  // Step 3 states
  const [dosageAmount, setDosageAmount] = useState<number>(medication.dosage_amount || 1);
  const [strength, setStrength] = useState<string>(medication.dosage || '');
  
  // Step 4 states
  const [enableInventory, setEnableInventory] = useState<boolean>(medication.low_stock_alert_enabled);
  const [currentStock, setCurrentStock] = useState<string>(
    medication.current_stock !== null && medication.current_stock !== undefined 
      ? String(medication.current_stock) 
      : '30'
  );
  const [stockThreshold, setStockThreshold] = useState<string>(
    medication.stock_threshold !== null && medication.stock_threshold !== undefined 
      ? String(medication.stock_threshold) 
      : '4'
  );
  
  // Step 5 states
  const [medicationReason, setMedicationReason] = useState<string>(medication.medication_reason || '');
  // Retry ladder override. NULL/NULL is the normal state and means "use the
  // priority default", so the inputs start EMPTY rather than pre-filled with the
  // default — a filled box reads as a choice somebody made.
  const [retryInterval, setRetryInterval] = useState<string>(
    medication.retry_interval_minutes != null ? String(medication.retry_interval_minutes) : '',
  );
  const [retryCount, setRetryCount] = useState<string>(
    medication.retry_count != null ? String(medication.retry_count) : '',
  );

  const [priority, setPriority] = useState<'normal' | 'important' | 'critical'>(
    medication.priority_level as any
  );
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step transition animation state
  const [stepDirection, setStepDirection] = useState<'forward' | 'backward'>('forward');
  const [isTransitioning, setIsTransitioning] = useState(false);

  const router = useRouter();
  const supabase = createClient();
  const { isElderly } = useUiMode();

  // Adjust timing inputs on frequency change, resetting to default presets only if changed
  useEffect(() => {
    if (frequency === medication.frequency) {
      setTimes(medication.reminder_times);
    } else {
      if (frequency === 'once_daily') {
        setTimes(prev => [prev[0] || '08:00']);
      } else if (frequency === 'twice_daily') {
        setTimes(prev => [prev[0] || '08:00', prev[1] || '20:00']);
      } else if (frequency === 'thrice_daily') {
        setTimes(prev => [prev[0] || '08:00', prev[1] || '14:00', prev[2] || '20:00']);
      }
    }
  }, [frequency, medication]);

  const handleTimeChange = (index: number, val: string) => {
    setTimes(prev => prev.map((t, idx) => idx === index ? val : t));
  };

  // Deselecting the last day returns to "every day" rather than leaving a
  // medication that is never due — the same rule the DB CHECK enforces.
  const toggleDoseDay = (day: number) => {
    setDoseDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b));
  };

  const animateStep = (newStep: number, direction: 'forward' | 'backward') => {
    setStepDirection(direction);
    setIsTransitioning(true);
    setTimeout(() => {
      setStep(newStep);
      setIsTransitioning(false);
    }, 150);
  };

  const handleNextStep = (e: React.MouseEvent) => {
    e.preventDefault();
    setError(null);
    if (step >= 6) return;

    const validationError = validateMedicationStep(step, {
      drugName, times, dosageAmount, enableInventory, currentStock, stockThreshold,
    });
    if (validationError) {
      setError(validationError);
      return;
    }
    animateStep(step + 1, 'forward');
  };

  const handlePrevStep = (e: React.MouseEvent) => {
    e.preventDefault();
    setError(null);
    if (step > 1) {
      animateStep(step - 1, 'backward');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const sortedTimes = [...times].sort((a, b) => a.localeCompare(b));
    
    let nextReminder: Date | null = null;
    if (medication.active) {
      // calculateNextReminder throws on an empty array (matches src/utils.js).
      // The wizard's step-2 validation should already block this, but a legacy
      // row edited without ever revisiting that step could still reach here —
      // guard rather than let a throw crash the page.
      if (sortedTimes.length === 0) {
        setError('Please add at least one reminder time.');
        setLoading(false);
        return;
      }
      // Recompute in the medication's OWN timezone: reminder_times are wall-clock
      // in that zone, and the scheduler fires on next_reminder_at. Recalculating
      // without it would silently shift non-IST medications to IST on every edit.
      // dose_days likewise: without it an edit re-arms the next reminder onto
      // whatever day the edit happened, not the next day the med is actually due.
      nextReminder = calculateNextReminder(sortedTimes, medication.timezone ?? undefined, normalizeDoseDays(doseDays));
    }

    // Both or neither, and under the cap. The DB CHECK enforces this too — the
    // form check is so nobody discovers it as a save failure.
    const ladderTouched = retryInterval.trim() !== '' || retryCount.trim() !== '';
    let retryFields: { retry_interval_minutes: number | null; retry_count: number | null } = {
      retry_interval_minutes: null,
      retry_count: null,
    };
    if (ladderTouched) {
      const iv = Number(retryInterval);
      const ct = Number(retryCount);
      const problem = ladderError(iv, ct);
      if (problem) {
        setError(problem);
        setLoading(false);
        return;
      }
      retryFields = { retry_interval_minutes: iv, retry_count: ct };
    }

    try {
      const { error: updateErr } = await supabase
        .from('medications')
        .update({
          ...retryFields,
          ...buildSharedMedicationFields(
            { drugName, frequency, times, doseDays, dosageAmount, strength, enableInventory, currentStock, stockThreshold, medicationReason, priority, unitType, catalogLink },
            sortedTimes,
          ),
          ...(nextReminder ? { next_reminder_at: nextReminder.toISOString() } : {}),
        })
        .eq('id', medication.id);

      if (updateErr) throw updateErr;

      router.push('/medications');
      router.refresh();
    } catch (err: any) {
      console.error('[EditMed] Error updating medication:', err);
      setError(err.message || 'Failed to update medication. Please try again.');
      setLoading(false);
    }
  };

  const labelClass = `block font-semibold text-foreground ${isElderly ? 'text-xl mb-2' : 'text-sm mb-1.5'}`;
  const inputClass = `mt-1 block w-full px-4 py-3 min-h-11 border border-input rounded-2xl bg-background text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 text-sm transition-all duration-200 font-[var(--font-sans)] ${
    isElderly ? 'py-4 text-xl rounded-2xl border-2' : ''
  }`;

  const stepContentClass = `transition-all duration-300 ease-out ${
    isTransitioning 
      ? `opacity-0 ${stepDirection === 'forward' ? 'translate-x-4' : '-translate-x-4'}` 
      : 'opacity-100 translate-x-0'
  }`;

  return (
    <div className={`mx-auto transition-all duration-300 ${isElderly ? 'max-w-2xl space-y-6' : 'max-w-xl space-y-5'}`}>
      
      {/* Page Header */}
      <div>
        <h1 className={`font-black tracking-tight text-foreground ${isElderly ? 'text-4xl' : 'text-2xl'}`}>
          Edit Medication
        </h1>
        <p className={`text-muted-foreground mt-1 ${isElderly ? 'text-lg' : 'text-sm'}`}>
          Modify your medication parameters through guided steps.
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-start gap-3 bg-danger/8 text-danger text-sm p-4 rounded-2xl border border-danger/15">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className={`bg-card rounded-3xl border border-border shadow-md overflow-hidden ${isElderly ? 'border-2' : ''}`}>
        
        {/* ── Premium Stepper ── */}
        <div className="px-6 pt-6 pb-4 md:px-8 md:pt-8">
          <div className="flex items-center justify-between gap-1">
            {stepMeta.map((s, i) => {
              const stepNum = i + 1;
              const isCompleted = step > stepNum;
              const isCurrent = step === stepNum;
              return (
                <React.Fragment key={stepNum}>
                  <div className="flex flex-col items-center gap-1.5 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                        isCompleted
                          ? 'bg-success text-white'
                          : isCurrent
                            ? 'bg-primary-strong text-primary-strong-foreground shadow-[0_0_0_4px_rgba(242,107,138,0.15)]'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {isCompleted ? <Check className="w-4 h-4" /> : stepNum}
                    </div>
                    <span className={`text-[10px] font-semibold text-center leading-tight hidden sm:block ${
                      isCurrent ? 'text-primary' : isCompleted ? 'text-success' : 'text-muted-foreground'
                    }`}>
                      {s.label}
                    </span>
                  </div>
                  {i < stepMeta.length - 1 && (
                    <div className={`flex-1 h-[2px] rounded-full mx-1 mt-[-18px] sm:mt-0 transition-all duration-300 ${
                      step > stepNum ? 'bg-success' : 'bg-muted'
                    }`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* ── Step Content ── */}
        <div className="px-6 pb-6 md:px-8 md:pb-8">
          <form onSubmit={handleSubmit}>

            {/* Current step label */}
            <div className="flex items-center gap-2 mb-5 pb-4 border-b border-border/60">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                {stepMeta[step - 1].icon}
              </div>
              <div>
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step {step} of 6</span>
                <h2 className="text-base font-bold text-foreground leading-tight">{stepMeta[step - 1].label}</h2>
              </div>
            </div>
            
            <div className={stepContentClass}>

            {/* STEP 1: Details (Name & Unit Type) */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <label className={labelClass}>Medication Name</label>
                  <input
                    type="text"
                    required
                    value={drugName}
                    onChange={(e) => setDrugName(e.target.value)}
                    className={inputClass}
                    placeholder="e.g., Paracetamol"
                    autoFocus
                  />
                  <MedicationCatalogLink value={catalogLink} onChange={setCatalogLink} />
                </div>

                <div>
                  <label className={labelClass}>Medication Form</label>
                  <p className="text-xs text-muted-foreground mb-3">Select the type of medication unit.</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {unitOptions.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setUnitType(opt.id)}
                        className={`p-3.5 rounded-2xl border text-center transition-all duration-200 flex flex-col items-center justify-center cursor-pointer gap-2 ${
                          unitType === opt.id 
                            ? 'border-primary bg-primary/6 ring-2 ring-primary/15 text-primary' 
                            : 'border-border hover:border-primary/30 hover:bg-muted/40 text-muted-foreground'
                        }`}
                      >
                        <div className={`transition-colors duration-200 ${unitType === opt.id ? 'text-primary' : 'text-muted-foreground'}`}>
                          {opt.icon}
                        </div>
                        <span className={`text-xs font-semibold ${unitType === opt.id ? 'text-primary font-bold' : ''}`}>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: Schedule & Times */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <label className={labelClass}>Select Frequency</label>
                  <div className="grid grid-cols-1 gap-3 mt-1">
                    {frequencies.map((freq) => (
                      <button
                        key={freq.id}
                        type="button"
                        onClick={() => setFrequency(freq.id as any)}
                        className={`p-4 rounded-2xl border text-left transition-all duration-200 flex items-center justify-between cursor-pointer ${
                          frequency === freq.id 
                            ? 'border-primary bg-primary/6 ring-2 ring-primary/15' 
                            : 'border-border hover:border-primary/30 hover:bg-muted/40'
                        }`}
                      >
                        <div className="flex items-center gap-3.5">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-200 ${
                            frequency === freq.id ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground'
                          }`}>
                            {freq.icon}
                          </div>
                          <div>
                            <h3 className={`font-bold text-sm ${frequency === freq.id ? 'text-primary-strong' : 'text-foreground'}`}>{freq.title}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">{freq.desc}</p>
                          </div>
                        </div>
                        {frequency === freq.id && (
                          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                            <Check className="w-3.5 h-3.5 text-white" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-border/40">
                  <label className={labelClass} id="dose-days-label">Which Days?</label>
                  <p className="text-xs text-muted-foreground mb-3">
                    For medicines taken only on some days. Leave all off for every day.
                  </p>
                  <div className="flex gap-2" role="group" aria-labelledby="dose-days-label">
                    {weekdays.map((d) => {
                      const on = doseDays.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => toggleDoseDay(d.id)}
                          aria-pressed={on}
                          aria-label={d.full}
                          className={`flex-1 rounded-xl font-bold transition-all duration-200 cursor-pointer ${
                            isElderly ? 'py-4 text-lg' : 'py-3 text-sm'
                          } ${
                            on
                              ? 'bg-primary text-white ring-2 ring-primary/25'
                              : 'bg-muted text-muted-foreground hover:bg-muted/70'
                          }`}
                        >
                          {d.short}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs font-semibold text-primary mt-3">{describeDoseDays(doseDays)}</p>
                </div>

                <div className="pt-4 border-t border-border/40">
                  <label className={labelClass}>Reminder Times</label>
                  <p className="text-xs text-muted-foreground mb-3">Set the time for each dose in 24-hour format.</p>
                  <div className="grid grid-cols-1 gap-2.5">
                    {times.map((time, idx) => (
                      <div key={idx} className="bg-muted/30 p-4 rounded-2xl border border-border flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Clock className="w-4 h-4 text-primary" />
                          </div>
                          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Dose {idx + 1}</span>
                        </div>
                        <input
                          type="time"
                          required
                          value={time}
                          onChange={(e) => handleTimeChange(idx, e.target.value)}
                          className={`px-4 py-2.5 border border-input rounded-xl bg-background text-foreground font-[var(--font-mono)] text-sm font-bold focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all ${
                            isElderly ? 'py-3 text-lg' : ''
                          }`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Dosage & Strength */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <label className={labelClass}>Strength</label>
                  <input
                    type="text"
                    value={strength}
                    onChange={(e) => setStrength(e.target.value)}
                    className={inputClass}
                    placeholder="e.g., 500mg, 10ml"
                  />
                  <div className="flex flex-wrap gap-2 mt-3">
                    {['500mg', '650mg', '5mg', '10mg', '20mg', '100mcg'].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStrength(s)}
                        className={`px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-all cursor-pointer ${
                          strength === s
                            ? 'border-primary bg-primary/8 text-primary font-bold'
                            : 'border-border hover:bg-muted bg-background text-muted-foreground'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-border/40">
                  <label className={labelClass}>Dosage Amount</label>
                  <p className="text-xs text-muted-foreground mb-3">Units taken per reminder.</p>
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      type="button"
                      onClick={() => setDosageAmount(prev => Math.max(0.5, prev - 0.5))}
                      className="w-11 h-11 border border-border rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80 transition-all cursor-pointer"
                    >
                      <Minus className="w-4 h-4 text-foreground" />
                    </button>
                    <div className="flex items-center gap-2 bg-muted/30 border border-border rounded-xl px-4 py-2.5">
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        required
                        value={dosageAmount}
                        onChange={(e) => setDosageAmount(parseFloat(e.target.value) || 1)}
                        className="text-center w-16 bg-transparent text-foreground font-[var(--font-mono)] text-lg font-bold focus:outline-none"
                      />
                      <span className="text-xs font-semibold text-muted-foreground lowercase whitespace-nowrap">
                        {unitOptions.find(o => o.id === unitType)?.label}(s)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDosageAmount(prev => prev + 0.5)}
                      className="w-11 h-11 border border-border rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80 transition-all cursor-pointer"
                    >
                      <Plus className="w-4 h-4 text-foreground" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: Inventory Tracking */}
            {step === 4 && (
              <div className="space-y-5">
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-2xl border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Layers className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-foreground">Track Stock Inventory</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Auto-deduct stock on each dose</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={enableInventory} 
                      onChange={(e) => setEnableInventory(e.target.checked)} 
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>

                {enableInventory && (
                  <div className="space-y-4 pt-2" style={{ animation: 'fadeIn 0.2s ease-out' }}>
                    <div>
                      <label className={labelClass}>Current Stock</label>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          required={enableInventory}
                          value={currentStock}
                          onChange={(e) => setCurrentStock(e.target.value)}
                          className={inputClass}
                          placeholder="e.g., 30"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">units</span>
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>Low Stock Threshold</label>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          required={enableInventory}
                          value={stockThreshold}
                          onChange={(e) => setStockThreshold(e.target.value)}
                          className={inputClass}
                          placeholder="e.g., 4"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">units</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2">
                        You will receive an alert when stock reaches this amount.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 5: Reason & Priority */}
            {step === 5 && (
              <div className="space-y-6">
                <div>
                  <label className={labelClass}>Medication Reason</label>
                  <p className="text-xs text-muted-foreground mb-2">Optional. Helps identify the purpose.</p>
                  <input
                    type="text"
                    value={medicationReason}
                    onChange={(e) => setMedicationReason(e.target.value)}
                    className={inputClass}
                    placeholder="e.g., For Blood Pressure"
                  />
                </div>

                <div className="pt-4 border-t border-border/40">
                  <label className={labelClass}>Priority Level</label>
                  <p className="text-xs text-muted-foreground mb-3">Determines escalation behavior on missed doses.</p>
                  <div className="grid grid-cols-1 gap-2.5">
                    {priorities.map((p) => {
                      const isSelected = priority === p.id;
                      const t = getToneTheme(p.color);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPriority(p.id as any)}
                          aria-pressed={isSelected}
                          className={`p-4 rounded-2xl border text-left transition-all duration-200 flex items-center justify-between cursor-pointer hover:bg-muted/40 ${
                            isSelected ? `${t.borderStrong} ${t.bg} ring-2 ${t.border}` : 'border-border'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-200 ${
                              isSelected ? t.tile : 'bg-muted text-muted-foreground'
                            }`}>
                              {p.icon}
                            </div>
                            <div>
                              <h3 className={`font-bold text-sm transition-colors duration-200 ${isSelected ? t.text : 'text-foreground'}`}>{p.title}</h3>
                              <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
                            </div>
                          </div>
                          {isSelected && (
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${t.solid}`}>
                              <Check className="w-3.5 h-3.5" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* REMINDING AGAIN, BEFORE ANYONE ELSE IS TOLD.
                    Routine is deliberately excluded: a supplement does not need
                    its own retry schedule, and it would be one more decision on
                    a form that already asks plenty. */}
                {isConfigurable(priority) && (
                  <div className="pt-4 border-t border-border">
                    <label className={labelClass}>If you do not answer</label>
                    <p className="text-xs text-muted-foreground mb-3">
                      Your phone asks again before anyone in your care circle is told.
                      Leave these empty to use the usual pattern for this priority.
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="retry-interval" className="block text-xs font-semibold text-muted-foreground mb-1.5">
                          Every (minutes)
                        </label>
                        <input
                          id="retry-interval"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={RETRY_CAP_MINUTES}
                          value={retryInterval}
                          onChange={(e) => setRetryInterval(e.target.value)}
                          placeholder={String(DEFAULT_LADDERS[priority].interval)}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label htmlFor="retry-count" className="block text-xs font-semibold text-muted-foreground mb-1.5">
                          How many times
                        </label>
                        <input
                          id="retry-count"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={RETRY_CAP_MINUTES}
                          value={retryCount}
                          onChange={(e) => setRetryCount(e.target.value)}
                          placeholder={String(DEFAULT_LADDERS[priority].count)}
                          className={inputClass}
                        />
                      </div>
                    </div>

                    {/* Shows the actual rings rather than the rule. "+5, +10,
                        +15" is checkable against what the phone will do; "5 x 5,
                        max 30" is arithmetic homework. */}
                    {(() => {
                      const touched = retryInterval.trim() !== '' || retryCount.trim() !== '';
                      const problem = touched
                        ? ladderError(Number(retryInterval), Number(retryCount))
                        : null;
                      if (problem) {
                        return (
                          <p className="mt-2.5 text-xs font-semibold text-danger-strong" role="alert">
                            {problem}
                          </p>
                        );
                      }
                      const offsets = retryOffsets(
                        priority,
                        touched
                          ? { interval: Number(retryInterval), count: Number(retryCount) }
                          : null,
                      );
                      return (
                        <p className="mt-2.5 text-xs text-muted-foreground font-semibold tabular-nums">
                          {touched ? 'Reminds you' : 'Usual pattern'} at{' '}
                          {offsets.map((o) => `+${o}`).join(', ')} minutes after the dose is due
                          {touched ? '.' : ' — leave empty to keep this.'}
                        </p>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* STEP 6: Review & Save */}
            {step === 6 && (
              <div className="space-y-5">
                {/* Summary Card */}
                <div className="rounded-2xl border border-border overflow-hidden">
                  {/* Drug name header */}
                  <div className="bg-primary/6 px-5 py-4 border-b border-border/40">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/12 flex items-center justify-center text-primary">
                        <Pill className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-foreground text-base font-[var(--font-mono)]">{drugName}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {unitOptions.find(u => u.id === unitType)?.label} · {strength || 'No strength specified'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Detail rows */}
                  <div className="divide-y divide-border/40">
                    <div className="flex items-center justify-between px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground">Schedule</span>
                      </div>
                      <span className="text-sm font-bold text-foreground font-[var(--font-mono)] capitalize">{frequency.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground">Times</span>
                      </div>
                      <span className="text-sm font-bold text-foreground font-[var(--font-mono)]">{times.join(', ')}</span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Beaker className="w-4 h-4 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground">Dosage</span>
                      </div>
                      <span className="text-sm font-bold text-foreground font-[var(--font-mono)]">{dosageAmount} {unitPhrase(unitType, dosageAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Layers className="w-4 h-4 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground">Inventory</span>
                      </div>
                      <span className="text-sm font-bold text-foreground font-[var(--font-mono)]">
                        {enableInventory ? `${currentStock} units (alert at ${stockThreshold})` : 'Disabled'}
                      </span>
                    </div>
                    {medicationReason && (
                      <div className="flex items-center justify-between px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <span className="text-xs font-semibold text-muted-foreground">Reason</span>
                        </div>
                        <span className="text-sm font-bold text-foreground">{medicationReason}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <ShieldAlert className="w-4 h-4 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground">Priority</span>
                      </div>
                      <span className={`text-sm font-bold font-[var(--font-mono)] capitalize flex items-center gap-1.5 ${
                        priority === 'normal' ? 'text-success' : priority === 'important' ? 'text-warning' : 'text-danger'
                      }`}>
                        <span className={`w-2 h-2 rounded-full ${
                          priority === 'normal' ? 'bg-success' : priority === 'important' ? 'bg-warning' : 'bg-danger'
                        }`} />
                        {priority}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            </div>

            {/* ── Wizard Navigation ── */}
            <div className="flex items-center justify-between pt-5 mt-6 border-t border-border/40 gap-3">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={handlePrevStep}
                  className={`px-5 py-2.5 font-semibold rounded-2xl border border-border text-foreground bg-muted hover:bg-muted/70 transition-all duration-200 flex items-center gap-2 cursor-pointer ${
                    isElderly ? 'h-[72px] text-lg' : 'h-11 text-sm'
                  }`}
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
              ) : (
                <Link
                  href="/medications"
                  className={`px-5 py-2.5 font-semibold rounded-2xl border border-border text-foreground bg-muted hover:bg-muted/70 transition-all duration-200 flex items-center justify-center gap-2 ${
                    isElderly ? 'h-[72px] text-lg' : 'h-11 text-sm'
                  }`}
                >
                  Cancel
                </Link>
              )}

              {step < 6 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  className={`px-6 py-2.5 font-semibold rounded-2xl bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all duration-200 flex items-center gap-2 cursor-pointer shadow-sm ${
                    isElderly ? 'h-[72px] text-lg' : 'h-11 text-sm'
                  }`}
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={loading}
                  className={`px-6 py-2.5 font-semibold rounded-2xl bg-success text-success-foreground hover:bg-success/90 transition-all duration-200 flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-sm ${
                    isElderly ? 'h-[72px] text-lg' : 'h-11 text-sm'
                  }`}
                >
                  {loading ? 'Saving...' : 'Save Changes'}
                  <Check className="w-4 h-4" />
                </button>
              )}
            </div>

          </form>
        </div>
      </div>
    </div>
  );
}
