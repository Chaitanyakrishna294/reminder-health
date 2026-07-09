'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { calculateNextReminder } from '@/lib/medication-utils';
import moment from 'moment-timezone';
import { useUiMode } from '@/context/ui-mode-context';
import { type UnitType, unitOptions, stepMeta, frequencies, priorities } from '@/components/medications/medication-form-options';
import { validateMedicationStep, buildSharedMedicationFields } from '@/lib/medications/form-logic';
import {
  Pill,
  Clock,
  Layers,
  ShieldAlert,
  Check,
  ArrowLeft,
  ArrowRight,
  FileText,
  Activity,
  Beaker,
  AlertTriangle,
  ChevronDown,
  Minus,
  Plus,
} from 'lucide-react';

// Soft diffuse card shadow shared across the Apple-Health-styled pages.
const CARD_SHADOW = '0 1px 3px rgba(16, 28, 90, 0.04), 0 10px 30px rgba(16, 28, 90, 0.06)';

export default function NewMedicationPage() {
  const [step, setStep] = useState(1);
  const [drugName, setDrugName] = useState('');
  const [unitType, setUnitType] = useState<UnitType>('TABLET');
  const [unitOpen, setUnitOpen] = useState(false);
  const [frequency, setFrequency] = useState<'once_daily' | 'twice_daily' | 'thrice_daily'>('once_daily');
  const [times, setTimes] = useState<string[]>(['08:00']);
  
  // Step 3 states
  const [dosageAmount, setDosageAmount] = useState<number>(1);
  const [strength, setStrength] = useState<string>('');
  
  // Step 4 states
  const [enableInventory, setEnableInventory] = useState<boolean>(true);
  const [currentStock, setCurrentStock] = useState<string>('30');
  const [stockThreshold, setStockThreshold] = useState<string>('4');
  
  // Step 5 states
  const [medicationReason, setMedicationReason] = useState<string>('');
  const [priority, setPriority] = useState<'normal' | 'important' | 'critical'>('normal');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetTelegramChatId, setTargetTelegramChatId] = useState<string | null>(null);

  // Step transition animation state
  const [stepDirection, setStepDirection] = useState<'forward' | 'backward'>('forward');
  const [isTransitioning, setIsTransitioning] = useState(false);

  const router = useRouter();
  const supabase = createClient();
  const { isElderly, viewMode } = useUiMode();
  const activeRole = viewMode === 'PATIENT_MONITOR' ? 'CAREGIVER' : 'PATIENT';

  useEffect(() => {
    if (activeRole === 'CAREGIVER') {
      router.push('/medications');
    }
  }, [activeRole, router]);

  useEffect(() => {
    async function loadSession() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (!profile) {
        router.push('/login');
        return;
      }

      const currentActiveRole = viewMode === 'PATIENT_MONITOR' ? 'CAREGIVER' : 'PATIENT';

      if (currentActiveRole === 'CAREGIVER') {
        router.push('/medications');
        return;
      }

      setTargetTelegramChatId(profile.telegram_chat_id);
    }
    loadSession();
  }, [supabase, router, viewMode]);

  // Adjust timing inputs based on frequency
  useEffect(() => {
    if (frequency === 'once_daily') {
      setTimes(prev => [prev[0] || '08:00']);
    } else if (frequency === 'twice_daily') {
      setTimes(prev => [prev[0] || '08:00', prev[1] || '20:00']);
    } else if (frequency === 'thrice_daily') {
      setTimes(prev => [prev[0] || '08:00', prev[1] || '14:00', prev[2] || '20:00']);
    }
  }, [frequency]);

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

  // Jump directly to any step via the stepper.
  const goToStep = (target: number) => {
    if (target === step) return;
    setError(null);
    animateStep(target, target > step ? 'forward' : 'backward');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetTelegramChatId) {
      setError('Patient Telegram account could not be resolved.');
      return;
    }

    setLoading(true);
    setError(null);

    const sortedTimes = [...times].sort((a, b) => a.localeCompare(b));
    // Reminder times are wall-clock in the creator's timezone: store it so the
    // scheduler fires at the user's local time (DB default is IST otherwise).
    const timezone = moment.tz.guess();
    const nextReminder = calculateNextReminder(sortedTimes, timezone);

    try {
      const { error: insertErr } = await supabase.from('medications').insert([
        {
          telegram_id: targetTelegramChatId,
          timezone,
          ...buildSharedMedicationFields(
            { drugName, frequency, times, dosageAmount, strength, enableInventory, currentStock, stockThreshold, medicationReason, priority, unitType },
            sortedTimes,
          ),
          next_reminder_at: nextReminder.toISOString(),
          active: true,
          refill_confirmed: false,
          retry_count: 0
        }
      ]);

      if (insertErr) throw insertErr;

      router.push('/medications');
      router.refresh();
    } catch (err: any) {
      console.error('[NewMed] Error inserting medication:', err);
      setError(err.message || 'Failed to save medication. Please try again.');
      setLoading(false);
    }
  };

  const labelClass = `block font-semibold text-foreground ${isElderly ? 'text-xl mb-2' : 'text-sm mb-1.5'}`;
  const inputClass = `mt-1 block w-full px-4 py-3 rounded-2xl bg-[#F2F2F7] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 text-sm transition-all duration-200 font-[var(--font-sans)] ${
    isElderly ? 'py-4 text-xl' : ''
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
        <h1 className={`font-bold tracking-tight text-foreground ${isElderly ? 'text-4xl' : 'text-[26px]'}`}>
          Add Medication
        </h1>
        <p className={`text-muted-foreground mt-1 font-medium ${isElderly ? 'text-lg' : 'text-[13px]'}`}>
          Set up a new medication in 6 guided steps.
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-start gap-3 text-[#FF3B30] text-sm p-4 rounded-2xl" style={{ background: '#FFECEA' }}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {targetTelegramChatId ? (
        <div className="bg-white rounded-[22px] overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
          
          {/* ── Premium Stepper ── */}
          <div className="px-6 pt-6 pb-4 md:px-8 md:pt-8">
            <div className="flex items-center justify-between gap-1">
              {stepMeta.map((s, i) => {
                const stepNum = i + 1;
                const isCompleted = step > stepNum;
                const isCurrent = step === stepNum;
                return (
                  <React.Fragment key={stepNum}>
                    <button
                      type="button"
                      onClick={() => goToStep(stepNum)}
                      className="flex flex-col items-center gap-1.5 min-w-0 cursor-pointer group/step"
                      aria-label={`Go to step ${stepNum}: ${s.label}`}
                      aria-current={isCurrent ? 'step' : undefined}
                    >
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 group-hover/step:scale-105 ${
                          isCompleted
                            ? 'bg-primary text-white'
                            : isCurrent
                              ? 'bg-gradient-to-b from-[#F8839E] to-[#F26B8A] text-white'
                              : 'bg-[#F2F2F7] text-muted-foreground group-hover/step:bg-[#E5E5EA]'
                        }`}
                        style={isCurrent ? { boxShadow: '0 6px 16px rgba(242,107,138,0.40)' } : undefined}
                      >
                        {isCompleted ? <Check className="w-4 h-4" strokeWidth={2.5} /> : stepNum}
                      </div>
                      <span className={`text-[10px] font-semibold text-center leading-tight hidden sm:block ${
                        isCurrent || isCompleted ? 'text-primary' : 'text-muted-foreground'
                      }`}>
                        {s.label}
                      </span>
                    </button>
                    {i < stepMeta.length - 1 && (
                      <div className={`flex-1 h-[2px] rounded-full mx-1 mt-[-18px] sm:mt-0 transition-all duration-300 ${
                        step > stepNum ? 'bg-primary' : 'bg-[#EAEAEF]'
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
              <div className="flex items-center gap-2 mb-5 pb-4 border-b border-[#0F1C5A]/[0.06]">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  {stepMeta[step - 1].icon}
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Step {step} of 6</span>
                  <h2 className="text-base font-bold tracking-tight text-foreground leading-tight">{stepMeta[step - 1].label}</h2>
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
                      placeholder="e.g., Paracetamol, Atorvastatin"
                      autoFocus
                    />
                  </div>
                  
                  <div>
                    <label className={labelClass}>Medication Form</label>
                    <p className="text-xs text-muted-foreground mb-3">Select the type of medication unit.</p>
                    <div className="flex flex-col gap-2">
                      {(unitOpen ? unitOptions : unitOptions.filter((o) => o.id === unitType)).map((opt) => {
                        const isSel = unitType === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              if (!unitOpen) { setUnitOpen(true); return; }
                              setUnitType(opt.id);
                              setUnitOpen(false);
                            }}
                            className={`px-3.5 py-3 rounded-2xl text-left transition-all duration-200 flex items-center justify-between gap-3 cursor-pointer ${
                              isSel
                                ? 'bg-primary/8 ring-2 ring-primary/25'
                                : 'bg-[#F6F6F9] hover:bg-[#EFEFF3]'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-200 ${
                                isSel ? 'bg-primary/15 text-primary' : 'bg-white text-muted-foreground'
                              }`}>
                                {opt.icon}
                              </div>
                              <span className={`text-sm font-semibold truncate ${isSel ? 'text-primary' : 'text-foreground'}`}>{opt.label}</span>
                            </div>
                            {/* Right indicator: chevron to open when collapsed, check on the selected row when open */}
                            {!unitOpen ? (
                              <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" strokeWidth={2.5} />
                            ) : isSel ? (
                              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                                <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
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
                          className={`p-4 rounded-2xl text-left transition-all duration-200 flex items-center justify-between cursor-pointer ${
                            frequency === freq.id
                              ? 'bg-primary/8 ring-2 ring-primary/25'
                              : 'bg-[#F6F6F9] hover:bg-[#EFEFF3]'
                          }`}
                        >
                          <div className="flex items-center gap-3.5">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-200 ${
                              frequency === freq.id ? 'bg-primary/15 text-primary' : 'bg-white text-muted-foreground'
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

                  <div className="pt-4 border-t border-[#0F1C5A]/[0.06]">
                    <label className={labelClass}>Reminder Times</label>
                    <p className="text-xs text-muted-foreground mb-3">Set the time for each dose in 24-hour format.</p>
                    <div className="grid grid-cols-1 gap-2.5">
                      {times.map((time, idx) => (
                        <div key={idx} className="bg-[#F6F6F9] p-4 rounded-2xl flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                              <Clock className="w-4 h-4 text-primary" />
                            </div>
                            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Dose {idx + 1}</span>
                          </div>
                          <input
                            type="time"
                            required
                            value={time}
                            onChange={(e) => handleTimeChange(idx, e.target.value)}
                            className={`px-4 py-2.5 rounded-xl bg-white text-foreground font-[var(--font-mono)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all ${
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
                      placeholder="e.g., 500mg, 10ml, 0.5%"
                    />
                    <div className="flex flex-wrap gap-2 mt-3">
                      {['500mg', '650mg', '5mg', '10mg', '20mg', '100mcg'].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setStrength(s)}
                          className={`px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all cursor-pointer ${
                            strength === s
                              ? 'bg-primary/10 text-primary font-bold ring-1 ring-primary/30'
                              : 'bg-[#F2F2F7] hover:bg-[#E9E9EE] text-muted-foreground'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-[#0F1C5A]/[0.06]">
                    <label className={labelClass}>Dosage Amount</label>
                    <p className="text-xs text-muted-foreground mb-3">Units taken per reminder.</p>
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        type="button"
                        onClick={() => setDosageAmount(prev => Math.max(0.5, prev - 0.5))}
                        className="w-11 h-11 rounded-full bg-[#F2F2F7] flex items-center justify-center hover:bg-[#E5E5EA] transition-all cursor-pointer"
                      >
                        <Minus className="w-4 h-4 text-foreground" strokeWidth={2.5} />
                      </button>
                      <div className="flex items-center gap-2 bg-[#F2F2F7] rounded-2xl px-4 py-2.5">
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
                        className="w-11 h-11 rounded-full bg-[#F2F2F7] flex items-center justify-center hover:bg-[#E5E5EA] transition-all cursor-pointer"
                      >
                        <Plus className="w-4 h-4 text-foreground" strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 4: Inventory Tracking */}
              {step === 4 && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between p-4 bg-[#F6F6F9] rounded-2xl">
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
                      placeholder="e.g., For Blood Pressure, Headache"
                    />
                  </div>

                  <div className="pt-4 border-t border-[#0F1C5A]/[0.06]">
                    <label className={labelClass}>Priority Level</label>
                    <p className="text-xs text-muted-foreground mb-3">Determines escalation behavior on missed doses.</p>
                    <div className="grid grid-cols-1 gap-2.5">
                      {priorities.map((p) => {
                        const isSelected = priority === p.id;
                        const colorMap = {
                          success: {
                            bg: isSelected ? 'bg-success/8' : 'bg-[#F6F6F9] hover:bg-[#EFEFF3]',
                            ring: isSelected ? 'ring-2 ring-success/30' : '',
                            iconBg: isSelected ? 'bg-success/15 text-success' : 'bg-white text-muted-foreground',
                            title: isSelected ? 'text-success' : 'text-foreground',
                          },
                          warning: {
                            bg: isSelected ? 'bg-warning/8' : 'bg-[#F6F6F9] hover:bg-[#EFEFF3]',
                            ring: isSelected ? 'ring-2 ring-warning/30' : '',
                            iconBg: isSelected ? 'bg-warning/15 text-warning' : 'bg-white text-muted-foreground',
                            title: isSelected ? 'text-warning' : 'text-foreground',
                          },
                          danger: {
                            bg: isSelected ? 'bg-danger/8' : 'bg-[#F6F6F9] hover:bg-[#EFEFF3]',
                            ring: isSelected ? 'ring-2 ring-danger/30' : '',
                            iconBg: isSelected ? 'bg-danger/15 text-danger' : 'bg-white text-muted-foreground',
                            title: isSelected ? 'text-danger' : 'text-foreground',
                          },
                        };
                        const c = colorMap[p.color];
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setPriority(p.id as any)}
                            className={`p-4 rounded-2xl text-left transition-all duration-200 flex items-center justify-between cursor-pointer ${c.bg} ${c.ring}`}
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
                  <div className="rounded-2xl bg-[#F6F6F9] overflow-hidden">
                    {/* Drug name header */}
                    <div className="bg-primary/8 px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-primary">
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
                    <div className="divide-y divide-[#0F1C5A]/[0.06]">
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

                  {/* Info Note */}
                  <div className="p-4 bg-primary/5 rounded-2xl flex items-start gap-3">
                    <ShieldAlert className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Saving will activate automated reminders. You can pause or edit this medication at any time from the Medications page.
                    </p>
                  </div>
                </div>
              )}

              </div>

              {/* ── Wizard Navigation ── */}
              <div className="flex items-center justify-between pt-5 mt-6 border-t border-[#0F1C5A]/[0.06] gap-3">
                {step > 1 ? (
                  <button
                    type="button"
                    onClick={handlePrevStep}
                    className={`px-5 py-2.5 font-semibold rounded-full text-foreground bg-[#F2F2F7] hover:bg-[#E5E5EA] transition-all duration-200 flex items-center gap-2 cursor-pointer ${
                      isElderly ? 'h-[72px] text-lg' : 'text-sm'
                    }`}
                  >
                    <ArrowLeft className="w-4 h-4" strokeWidth={2.5} />
                    Back
                  </button>
                ) : (
                  <Link
                    href="/medications"
                    className={`px-5 py-2.5 font-semibold rounded-full text-foreground bg-[#F2F2F7] hover:bg-[#E5E5EA] transition-all duration-200 flex items-center justify-center gap-2 ${
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
                    className={`px-6 py-2.5 font-semibold rounded-full bg-primary text-white hover:bg-primary-hover transition-all duration-200 flex items-center gap-2 cursor-pointer ${
                      isElderly ? 'h-[72px] text-lg' : 'text-sm'
                    }`}
                    style={{ boxShadow: '0 4px 12px rgba(242, 107, 138, 0.35)' }}
                  >
                    Continue
                    <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={loading}
                    className={`px-6 py-2.5 font-semibold rounded-full bg-primary text-white hover:bg-primary-hover transition-all duration-200 flex items-center gap-2 cursor-pointer disabled:opacity-50 ${
                      isElderly ? 'h-[72px] text-lg' : 'text-sm'
                    }`}
                    style={{ boxShadow: '0 4px 12px rgba(242, 107, 138, 0.35)' }}
                  >
                    {loading ? 'Saving...' : 'Add Medication'}
                    <Check className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                )}
              </div>

            </form>
          </div>
        </div>
      ) : (
        <div className="bg-white p-12 text-center text-sm text-muted-foreground rounded-[22px]" style={{ boxShadow: CARD_SHADOW }}>
          <div className="w-10 h-10 rounded-full bg-[#F2F2F7] flex items-center justify-center mx-auto mb-3">
            <Activity className="w-5 h-5 text-muted-foreground" />
          </div>
          Loading patient configuration...
        </div>
      )}
    </div>
  );
}
