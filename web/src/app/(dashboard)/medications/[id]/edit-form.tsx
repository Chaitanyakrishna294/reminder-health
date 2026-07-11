'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { calculateNextReminder } from '@/lib/medication-utils';
import { useUiMode } from '@/context/ui-mode-context';
import { type UnitType, unitOptions, stepMeta, frequencies, priorities } from '@/components/medications/medication-form-options';
import { validateMedicationStep, buildSharedMedicationFields } from '@/lib/medications/form-logic';
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
    active: boolean;
    low_stock_alert_enabled: boolean;
    unit_type?: string;
    dosage_amount?: number;
    current_stock?: number | null;
    stock_threshold?: number | null;
    medication_reason?: string | null;
    timezone?: string | null;
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
      // Recompute in the medication's OWN timezone: reminder_times are wall-clock
      // in that zone, and the scheduler fires on next_reminder_at. Recalculating
      // without it would silently shift non-IST medications to IST on every edit.
      nextReminder = calculateNextReminder(sortedTimes, medication.timezone ?? undefined);
    }

    try {
      const { error: updateErr } = await supabase
        .from('medications')
        .update({
          ...buildSharedMedicationFields(
            { drugName, frequency, times, dosageAmount, strength, enableInventory, currentStock, stockThreshold, medicationReason, priority, unitType, catalogLink },
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
  const inputClass = `mt-1 block w-full px-4 py-3 border border-input rounded-2xl bg-background text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 text-sm transition-all duration-200 font-[var(--font-sans)] ${
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
                            ? 'bg-primary text-white shadow-[0_0_0_4px_rgba(242,107,138,0.15)]'
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
                            <h3 className={`font-bold text-sm ${frequency === freq.id ? 'text-primary' : 'text-foreground'}`}>{freq.title}</h3>
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
                      const colorMap = {
                        success: {
                          border: isSelected ? 'border-success' : 'border-border',
                          bg: isSelected ? 'bg-success/6' : '',
                          ring: isSelected ? 'ring-2 ring-success/15' : '',
                          iconBg: isSelected ? 'bg-success/12 text-success' : 'bg-muted text-muted-foreground',
                          title: isSelected ? 'text-success' : 'text-foreground',
                        },
                        warning: {
                          border: isSelected ? 'border-warning' : 'border-border',
                          bg: isSelected ? 'bg-warning/6' : '',
                          ring: isSelected ? 'ring-2 ring-warning/15' : '',
                          iconBg: isSelected ? 'bg-warning/12 text-warning' : 'bg-muted text-muted-foreground',
                          title: isSelected ? 'text-warning' : 'text-foreground',
                        },
                        danger: {
                          border: isSelected ? 'border-danger' : 'border-border',
                          bg: isSelected ? 'bg-danger/6' : '',
                          ring: isSelected ? 'ring-2 ring-danger/15' : '',
                          iconBg: isSelected ? 'bg-danger/12 text-danger' : 'bg-muted text-muted-foreground',
                          title: isSelected ? 'text-danger' : 'text-foreground',
                        },
                      };
                      const c = colorMap[p.color];
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPriority(p.id as any)}
                          className={`p-4 rounded-2xl border text-left transition-all duration-200 flex items-center justify-between cursor-pointer hover:bg-muted/40 ${c.border} ${c.bg} ${c.ring}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-200 ${c.iconBg}`}>
                              {p.icon}
                            </div>
                            <div>
                              <h3 className={`font-bold text-sm transition-colors duration-200 ${c.title}`}>{p.title}</h3>
                              <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
                            </div>
                          </div>
                          {isSelected && (
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                              p.color === 'success' ? 'bg-success' : p.color === 'warning' ? 'bg-warning' : 'bg-danger'
                            }`}>
                              <Check className="w-3.5 h-3.5 text-white" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
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
                      <span className="text-sm font-bold text-foreground font-[var(--font-mono)]">{dosageAmount} {unitType.toLowerCase()}(s)</span>
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
                    isElderly ? 'h-[72px] text-lg' : 'text-sm'
                  }`}
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
              ) : (
                <Link
                  href="/medications"
                  className={`px-5 py-2.5 font-semibold rounded-2xl border border-border text-foreground bg-muted hover:bg-muted/70 transition-all duration-200 flex items-center justify-center gap-2 ${
                    isElderly ? 'h-[72px] text-lg' : 'text-sm'
                  }`}
                >
                  Cancel
                </Link>
              )}

              {step < 6 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  className={`px-6 py-2.5 font-semibold rounded-2xl bg-primary text-primary-foreground hover:bg-primary-hover transition-all duration-200 flex items-center gap-2 cursor-pointer shadow-sm ${
                    isElderly ? 'h-[72px] text-lg' : 'text-sm'
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
                    isElderly ? 'h-[72px] text-lg' : 'text-sm'
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
