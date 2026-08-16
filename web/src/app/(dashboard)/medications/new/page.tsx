'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { calculateNextReminder } from '@/lib/medication-utils';
import moment from 'moment-timezone';
import { useUiMode } from '@/context/ui-mode-context';
import {
  type UnitType,
  unitOptions,
  stepMeta,
  frequencies,
  priorities,
  weekdays,
  describeDoseDays,
  STRENGTH_SUGGESTIONS,
  unitLabel,
  unitPhrase,
} from '@/components/medications/medication-form-options';
import { priorityMeta, TONE_VAR } from '@/lib/design/semantics';
import RetryLadderFields, { isCustomLadder } from '@/components/medications/retry-ladder-fields';
import { ladderError } from '@/lib/schedule/retry-ladder';
import { getToneTheme } from '@/lib/severity-theme';
import MedicationCatalogLink from '@/components/medications/medication-catalog-link';
import GuideButton from '@/components/guide/guide-button';
import GuideAutoStart from '@/components/guide/guide-auto-start';
import { useGuide } from '@/components/guide/guide-context';
import { TOURS } from '@/components/guide/guide-content';
import { searchMedicationCatalog, type CatalogLinkValue } from '@/lib/medications/catalog';
import { validateMedicationStep, buildSharedMedicationFields, normalizeDoseDays } from '@/lib/medications/form-logic';
import { useLanguage } from '@/context/language-context';
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
  Pencil,
} from 'lucide-react';

// Soft diffuse card shadow shared across the Apple-Health-styled pages.
const CARD_SHADOW = '0 1px 3px rgba(16, 28, 90, 0.04), 0 10px 30px rgba(16, 28, 90, 0.06)';

export default function NewMedicationPage() {
  const { t } = useLanguage();
  const [step, setStep] = useState(1);
  // Seeded from ?name= when arriving via "Add <query>" from the medications search, so
  // the term already typed there is not typed again. Only the free-text name field is
  // prefilled — no catalog row is selected, because linking a nickname to a real drug
  // stays a human decision (see docs/WORK_LEDGER.md).
  const searchParams = useSearchParams();
  const [drugName, setDrugName] = useState(searchParams.get('name') ?? '');
  const [catalogLink, setCatalogLink] = useState<CatalogLinkValue | null>(null);

  // Arriving from a directory result on /medications: ?catalogId= names the row the user
  // tapped. The row is re-read from the database rather than reconstructed from the URL,
  // so a hand-edited link cannot fabricate a catalog association on a medical record —
  // an id that does not resolve simply leaves the name prefilled and no link set.
  const prefillCatalogId = searchParams.get('catalogId');
  useEffect(() => {
    if (!prefillCatalogId) return;
    const wanted = Number(prefillCatalogId);
    if (!Number.isFinite(wanted)) return;
    let cancelled = false;
    (async () => {
      const rows = await searchMedicationCatalog(supabase, searchParams.get('name') ?? '');
      if (cancelled) return;
      const row = rows.find(r => r.id === wanted);
      if (!row) return;
      setCatalogLink({
        catalogId: row.id,
        brandName: row.brand_name,
        composition: row.composition_text,
        manufacturer: row.manufacturer_name,
        isDiscontinued: row.is_discontinued,
        snapshotDate: row.snapshot_date,
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillCatalogId]);
  const [unitType, setUnitType] = useState<UnitType>('TABLET');
  const [unitOpen, setUnitOpen] = useState(false);
  const [frequency, setFrequency] = useState<'once_daily' | 'twice_daily' | 'thrice_daily'>('once_daily');
  const [times, setTimes] = useState<string[]>(['08:00']);
  // Weekdays this med is due, 0=Sun..6=Sat. Empty = every day (the default, and
  // what normalizeDoseDays stores as NULL). `frequency` above is doses per DUE
  // day; this is which days are due at all — the two are independent.
  const [doseDays, setDoseDays] = useState<number[]>([]);
  
  // Step 3 states
  const [dosageAmount, setDosageAmount] = useState<number>(1);
  const [strength, setStrength] = useState<string>('');
  
  // Step 4 states
  const [enableInventory, setEnableInventory] = useState<boolean>(true);
  const [currentStock, setCurrentStock] = useState<string>('30');
  const [stockThreshold, setStockThreshold] = useState<string>('4');
  
  // Step 5 states
  const [medicationReason, setMedicationReason] = useState<string>('');
  /**
   * Retry ladder, configured at the moment the priority is chosen rather than
   * on a later visit to the edit form. Empty strings mean "use the usual
   * pattern for this priority", which is what the database stores as NULL.
   */
  const [retryInterval, setRetryInterval] = useState<string>('');
  const [retryCount, setRetryCount] = useState<string>('');
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

  // Guided tour: as it advances field-by-field, jump the wizard to the step each field
  // lives on so the real input is on screen to be spotlighted. When the tour ends, put
  // the user back on the step they were on before it started.
  const { activeTour, stepIndex } = useGuide();
  const prevTourRef = useRef<string | null>(null);
  const stepBeforeTourRef = useRef(1);
  useEffect(() => {
    if (activeTour === 'newMedication') {
      if (prevTourRef.current !== 'newMedication') stepBeforeTourRef.current = step;
      const ws = TOURS.newMedication[stepIndex]?.wizardStep;
      if (ws) setStep(ws);
    } else if (prevTourRef.current === 'newMedication') {
      setStep(stepBeforeTourRef.current);
    }
    prevTourRef.current = activeTour;
    // `step` is intentionally excluded — this effect reacts to tour movement, not step edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTour, stepIndex]);

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

  // Jump directly to any step via the stepper.
  const goToStep = (target: number) => {
    if (target === step) return;
    setError(null);
    animateStep(target, target > step ? 'forward' : 'backward');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetTelegramChatId) {
      setError(t.medForm.errNoTelegram);
      return;
    }

    setLoading(true);
    setError(null);

    const sortedTimes = [...times].sort((a, b) => a.localeCompare(b));
    // calculateNextReminder throws on an empty array (matches src/utils.js — see
    // the schedule-test-vectors fixture); the wizard's step-2 validation should
    // already block this, but guard here too rather than let a throw crash the
    // page for any path that reaches submit without it (e.g. direct step jump).
    if (sortedTimes.length === 0) {
      setError(t.medForm.errNoTimes);
      setLoading(false);
      return;
    }
    // Reminder times are wall-clock in the creator's timezone: store it so the
    // scheduler fires at the user's local time (DB default is IST otherwise).
    const timezone = moment.tz.guess();
    // normalizeDoseDays here too (not just in the row fields): the first reminder
    // must land on a day the medication is actually due, or a Mon/Wed/Fri med
    // added on a Tuesday fires once on the Tuesday before settling in.
    const nextReminder = calculateNextReminder(sortedTimes, timezone, normalizeDoseDays(doseDays));

    /*
     * The ladder is validated HERE as well as in the fields, for the same reason
     * the database has a CHECK: a form check is advice. The cap is a safety
     * property — a ladder longer than 30 minutes would have the phone re-asking
     * the patient while their caregiver was already being told the dose was
     * missed — so it is enforced at every layer that can enforce it.
     */
    const customLadder = isCustomLadder(retryInterval, retryCount);
    const ladderProblem = customLadder
      ? ladderError(Number(retryInterval), Number(retryCount))
      : null;
    if (ladderProblem) {
      setError(ladderProblem);
      setLoading(false);
      return;
    }

    try {
      const { error: insertErr } = await supabase.from('medications').insert([
        {
          telegram_id: targetTelegramChatId,
          timezone,
          ...buildSharedMedicationFields(
            { drugName, frequency, times, doseDays, dosageAmount, strength, enableInventory, currentStock, stockThreshold, medicationReason, priority, unitType, catalogLink },
            sortedTimes,
          ),
          next_reminder_at: nextReminder.toISOString(),
          active: true,
          refill_confirmed: false,
          // The BOT's send-retry counter, not the ladder. Different column,
          // different feature — the name collision cost a failed migration.
          retry_count: 0,
          // NULL means "use the priority default", which is the normal state and
          // what the database CHECK expects when the pair is unset.
          retry_ladder_interval_minutes: customLadder ? Number(retryInterval) : null,
          retry_ladder_count: customLadder ? Number(retryCount) : null,
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
  const inputClass = `mt-1 block w-full px-4 py-3 min-h-11 rounded-2xl bg-muted text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 text-sm transition-all duration-200 font-[var(--font-sans)] ${
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className={`font-bold tracking-tight text-foreground ${isElderly ? 'text-4xl' : 'text-[26px]'}`}>
            Add Medication
          </h1>
          <p className={`text-muted-foreground mt-1 font-medium ${isElderly ? 'text-lg' : 'text-[13px]'}`}>
            Set up a new medication in 6 guided steps.
          </p>
        </div>
        <GuideButton tour="newMedication" className="shrink-0 mt-1" label="How adding a medication works" />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-start gap-3 bg-danger/10 text-danger-strong text-sm p-4 rounded-2xl">
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
                      className="flex flex-col items-center justify-center gap-1.5 min-w-11 min-h-11 cursor-pointer group/step"
                      aria-label={`Go to step ${stepNum}: ${s.label}`}
                      aria-current={isCurrent ? 'step' : undefined}
                    >
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 group-hover/step:scale-105 ${
                          isCompleted
                            ? 'bg-primary-strong text-primary-strong-foreground'
                            : isCurrent
                              ? 'bg-primary-strong text-primary-strong-foreground'
                              : 'bg-muted text-muted-foreground group-hover/step:bg-accent-surface'
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
                        step > stepNum ? 'bg-primary' : 'bg-muted'
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
              <div className="flex items-center gap-2 mb-5 pb-4 border-b border-border">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  {stepMeta[step - 1].icon}
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Step {step} of 6</span>
                  <h2 className="text-base font-bold tracking-tight text-foreground leading-tight">{stepMeta[step - 1].label}</h2>
                </div>
              </div>
              
              <div className={stepContentClass}>

              {/* STEP 1: Details (Name & Unit Type) */}
              {step === 1 && (
                <div className="space-y-6">
                  <div>
                    <label className={labelClass}>{t.medForm.name}</label>
                    <input
                      type="text"
                      required
                      data-tour="mednew-name"
                      value={drugName}
                      onChange={(e) => setDrugName(e.target.value)}
                      className={inputClass}
                      placeholder={t.medForm.namePlaceholder}
                      autoFocus
                    />
                    <div data-tour="mednew-catalog">
                      <MedicationCatalogLink value={catalogLink} onChange={setCatalogLink} />
                    </div>
                  </div>

                  <div data-tour="mednew-form">
                    <label className={labelClass}>{t.medForm.form}</label>
                    <p className="text-xs text-muted-foreground mb-3">{t.medForm.formHint}</p>
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
                                : 'bg-muted hover:bg-accent-surface'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-200 ${
                                isSel ? 'bg-primary/15 text-primary' : 'bg-white text-muted-foreground'
                              }`}>
                                {opt.icon}
                              </div>
                              <span className={`text-sm font-semibold truncate ${isSel ? 'text-primary-strong' : 'text-foreground'}`}>{opt.label}</span>
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
                  <div data-tour="mednew-frequency">
                    <label className={labelClass}>{t.medForm.selectFrequency}</label>
                    <div className="grid grid-cols-1 gap-3 mt-1">
                      {frequencies.map((freq) => (
                        <button
                          key={freq.id}
                          type="button"
                          onClick={() => setFrequency(freq.id as any)}
                          className={`p-4 rounded-2xl text-left transition-all duration-200 flex items-center justify-between cursor-pointer ${
                            frequency === freq.id
                              ? 'bg-primary/8 ring-2 ring-primary/25'
                              : 'bg-muted hover:bg-accent-surface'
                          }`}
                        >
                          <div className="flex items-center gap-3.5">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-200 ${
                              frequency === freq.id ? 'bg-primary/15 text-primary' : 'bg-white text-muted-foreground'
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

                  <div className="pt-4 border-t border-border">
                    <label className={labelClass} id="dose-days-label">{t.medForm.whichDays}</label>
                    <p className="text-xs text-muted-foreground mb-3">
                      For medicines taken only on some days — twice a week, alternate days, Sundays only.
                      Leave all off for every day.
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
                                : 'bg-muted text-muted-foreground hover:bg-accent-surface'
                            }`}
                          >
                            {d.short}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs font-semibold text-primary-strong mt-3">
                      {describeDoseDays(doseDays)}
                    </p>
                  </div>

                  <div data-tour="mednew-times" className="pt-4 border-t border-border">
                    <label className={labelClass}>{t.medForm.reminderTimes}</label>
                    <p className="text-xs text-muted-foreground mb-3">{t.medForm.reminderTimesHint}</p>
                    <div className="grid grid-cols-1 gap-2.5">
                      {times.map((time, idx) => (
                        <div key={idx} className="bg-muted p-4 rounded-2xl flex items-center justify-between gap-4">
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
                  <div data-tour="mednew-strength">
                    {/* Step 1 marks its optional field as such; this one didn't, so
                        skipping it felt like an error until "No strength specified"
                        turned up on the review screen. */}
                    <label className={labelClass}>{t.medForm.strength} <span className="font-normal text-muted-foreground">{t.medForm.optional}</span></label>
                    <input
                      type="text"
                      value={strength}
                      onChange={(e) => setStrength(e.target.value)}
                      className={inputClass}
                      placeholder={t.medForm.strengthPlaceholder}
                    />
                    {/* Suggestions follow the form picked in step 1 — a syrup no longer
                        gets offered six tablet strengths. */}
                    {STRENGTH_SUGGESTIONS[unitType].length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {STRENGTH_SUGGESTIONS[unitType].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setStrength(s)}
                            className={`min-h-11 px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all cursor-pointer ${
                              strength === s
                                ? 'bg-primary/10 text-primary-strong font-bold ring-1 ring-primary/30'
                                : 'bg-muted hover:bg-accent-surface text-muted-foreground'
                            }`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div data-tour="mednew-amount" className="pt-4 border-t border-border">
                    <label className={labelClass}>{t.medForm.dosageAmount}</label>
                    <p className="text-xs text-muted-foreground mb-3">{t.medForm.dosageAmountHint}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        type="button"
                        onClick={() => setDosageAmount(prev => Math.max(0.5, prev - 0.5))}
                        className="w-11 h-11 rounded-full bg-muted flex items-center justify-center hover:bg-accent-surface transition-all cursor-pointer"
                      >
                        <Minus className="w-4 h-4 text-foreground" strokeWidth={2.5} />
                      </button>
                      <div className="flex items-center gap-2 bg-muted rounded-2xl px-4 py-2.5">
                        <input
                          type="number"
                          step="0.5"
                          min="0.5"
                          required
                          value={dosageAmount}
                          onChange={(e) => setDosageAmount(parseFloat(e.target.value) || 1)}
                          className="text-center w-16 bg-transparent text-foreground font-[var(--font-mono)] text-lg font-bold focus:outline-none"
                        />
                        <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
                          {unitPhrase(unitType, dosageAmount)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDosageAmount(prev => prev + 0.5)}
                        className="w-11 h-11 rounded-full bg-muted flex items-center justify-center hover:bg-accent-surface transition-all cursor-pointer"
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
                  <div data-tour="mednew-inventory" className="flex items-center justify-between p-4 bg-muted rounded-2xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Layers className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 id="inventory-toggle-label" className="font-bold text-sm text-foreground">{t.medForm.trackStock}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{t.medForm.trackStockHint}</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enableInventory}
                        onChange={(e) => setEnableInventory(e.target.checked)}
                        aria-labelledby="inventory-toggle-label"
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-muted peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                  </div>

                  {/* The stock fields unmount entirely when the toggle is off, which
                      looked like the step had broken. Say what the off state means. */}
                  {!enableInventory && (
                    <p className="text-xs text-muted-foreground px-1">
                      Stock tracking is off — this step is complete. Turn it on if you want
                      low-stock alerts and automatic counting.
                    </p>
                  )}

                  {enableInventory && (
                    <div data-tour="mednew-stock" className="space-y-4 pt-2" style={{ animation: 'fadeIn 0.2s ease-out' }}>
                      <div>
                        <label className={labelClass}>{t.medForm.currentStock}</label>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            required={enableInventory}
                            value={currentStock}
                            onChange={(e) => setCurrentStock(e.target.value)}
                            className={inputClass}
                            placeholder={t.medForm.currentStockPlaceholder}
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                            {unitPhrase(unitType, 2)}
                          </span>
                        </div>
                      </div>
                      <div>
                        <label className={labelClass}>{t.medForm.lowStockThreshold}</label>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            required={enableInventory}
                            value={stockThreshold}
                            onChange={(e) => setStockThreshold(e.target.value)}
                            className={inputClass}
                            placeholder={t.medForm.lowStockThresholdPlaceholder}
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                            {unitPhrase(unitType, 2)}
                          </span>
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
                  <div data-tour="mednew-reason">
                    <label className={labelClass}>{t.medForm.reason}</label>
                    <p className="text-xs text-muted-foreground mb-2">{t.medForm.reasonHint}</p>
                    <input
                      type="text"
                      value={medicationReason}
                      onChange={(e) => setMedicationReason(e.target.value)}
                      className={inputClass}
                      placeholder={t.medForm.reasonPlaceholder}
                    />
                  </div>

                  <div data-tour="mednew-priority" className="pt-4 border-t border-border">
                    <label className={labelClass}>{t.medForm.priorityLevel}</label>
                    <p className="text-xs text-muted-foreground mb-3">{t.medForm.priorityHint}</p>
                    <div className="grid grid-cols-1 gap-2.5">
                      {/* This used to build a three-branch colorMap object inside the
                          map callback on every render, and derive the same colors again
                          with an inline ternary for the check badge. One tone lookup. */}
                      {priorities.map((p) => {
                        const isSelected = priority === p.id;
                        const t = getToneTheme(p.color);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setPriority(p.id as any)}
                            aria-pressed={isSelected}
                            className={`p-4 rounded-2xl text-left transition-all duration-200 flex items-center justify-between cursor-pointer ${
                              isSelected ? `${t.bg} ring-2 ${t.border}` : 'bg-muted hover:bg-accent-surface'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-200 ${
                                isSelected ? t.tile : 'bg-white text-muted-foreground'
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

                  {/* Appears the moment Critical or Important is selected —
                      configuration at the point of decision, which is when the
                      person actually knows how urgent this medication is. */}
                  <RetryLadderFields
                    priority={priority}
                    interval={retryInterval}
                    count={retryCount}
                    onIntervalChange={setRetryInterval}
                    onCountChange={setRetryCount}
                    isElderly={isElderly}
                    inputClass={inputClass}
                    labelClass={labelClass}
                    idPrefix="new-retry"
                  />
                </div>
              )}

              {/* STEP 6: Review & Save */}
              {step === 6 && (
                <div className="space-y-5">
                  {/* Summary Card */}
                  <div data-tour="mednew-review" className="rounded-2xl bg-muted overflow-hidden">
                    {/* Drug name header */}
                    <div className="bg-primary/8 px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-primary">
                          <Pill className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-bold text-foreground text-base font-[var(--font-mono)]">{drugName}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {unitLabel(unitType)}{strength ? ` · ${strength}` : ''}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Detail rows.
                        Two changes here. First, NAME is a row: it was only ever the card's
                        header, so the one field you type by hand — the one a typo actually
                        ruins — was the one field the review never asked you to confirm.
                        Second, every row is a button back to the step that owns it, tagged
                        with that step's own icon, so the review reads as a map of the flow
                        instead of a flat list you can only leave by going Back five times. */}
                    <div className="divide-y divide-border">
                      {([
                        { step: 1, icon: stepMeta[0].icon, label: 'Name', value: drugName, mono: true },
                        { step: 1, icon: stepMeta[0].icon, label: 'Form', value: unitLabel(unitType) },
                        { step: 2, icon: stepMeta[1].icon, label: 'Schedule', value: frequency.replace(/_/g, ' '), mono: true, capitalize: true },
                        { step: 2, icon: stepMeta[1].icon, label: 'Days', value: describeDoseDays(doseDays) },
                        { step: 2, icon: stepMeta[1].icon, label: 'Times', value: times.join(', '), mono: true },
                        { step: 3, icon: stepMeta[2].icon, label: 'Strength', value: strength || 'Not specified', muted: !strength },
                        { step: 3, icon: stepMeta[2].icon, label: 'Each dose', value: `${dosageAmount} ${unitPhrase(unitType, dosageAmount)}`, mono: true },
                        {
                          step: 4,
                          icon: stepMeta[3].icon,
                          label: 'Inventory',
                          value: enableInventory
                            ? `${currentStock} ${unitPhrase(unitType, Number(currentStock) || 2)} · alert at ${stockThreshold}`
                            : 'Not tracked',
                          muted: !enableInventory,
                        },
                        ...(medicationReason
                          ? [{ step: 5, icon: stepMeta[4].icon, label: 'Reason', value: medicationReason }]
                          : []),
                      ] as const).map((row, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => goToStep(row.step)}
                          aria-label={`${row.label}: ${row.value}. Edit in step ${row.step}.`}
                          className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-muted transition-colors cursor-pointer group/row"
                        >
                          <div className="flex items-center gap-2.5 shrink-0 text-muted-foreground">
                            {row.icon}
                            <span className="text-xs font-semibold">{row.label}</span>
                          </div>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-sm font-bold truncate ${
                              'muted' in row && row.muted ? 'text-muted-foreground font-medium' : 'text-foreground'
                            } ${'mono' in row && row.mono ? 'font-[var(--font-mono)]' : ''} ${
                              'capitalize' in row && row.capitalize ? 'capitalize' : ''
                            }`}>
                              {row.value}
                            </span>
                            <Pencil className="w-3.5 h-3.5 shrink-0 text-muted-foreground/40 group-hover/row:text-primary transition-colors" aria-hidden="true" />
                          </div>
                        </button>
                      ))}

                      <button
                        type="button"
                        onClick={() => goToStep(5)}
                        aria-label={`Priority: ${priorityMeta(priority).label}. Edit in step 5.`}
                        className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-muted transition-colors cursor-pointer group/row"
                      >
                        <div className="flex items-center gap-2.5 shrink-0 text-muted-foreground">
                          {stepMeta[4].icon}
                          <span className="text-xs font-semibold">{t.medForm.reviewPriority}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold flex items-center gap-1.5 ${getToneTheme(priorityMeta(priority).tone).text}`}>
                            <span className="w-2 h-2 rounded-full" style={{ background: TONE_VAR[priorityMeta(priority).tone] }} />
                            {priorityMeta(priority).label}
                          </span>
                          <Pencil className="w-3.5 h-3.5 shrink-0 text-muted-foreground/40 group-hover/row:text-primary transition-colors" aria-hidden="true" />
                        </div>
                      </button>
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
              <div className="flex items-center justify-between pt-5 mt-6 border-t border-border gap-3">
                {step > 1 ? (
                  <button
                    type="button"
                    onClick={handlePrevStep}
                    className={`px-5 font-semibold rounded-full text-foreground bg-muted hover:bg-accent-surface transition-all duration-200 flex items-center gap-2 cursor-pointer ${
                      isElderly ? 'h-[72px] text-lg' : 'h-11 text-sm'
                    }`}
                  >
                    <ArrowLeft className="w-4 h-4" strokeWidth={2.5} />
                    Back
                  </button>
                ) : (
                  <Link
                    href="/medications"
                    className={`px-5 font-semibold rounded-full text-foreground bg-muted hover:bg-accent-surface transition-all duration-200 flex items-center justify-center gap-2 ${
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
                    className={`px-6 py-2.5 font-semibold rounded-full bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all duration-200 flex items-center gap-2 cursor-pointer ${
                      isElderly ? 'h-[72px] text-lg' : 'h-11 text-sm'
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
                    className={`px-6 py-2.5 font-semibold rounded-full bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all duration-200 flex items-center gap-2 cursor-pointer disabled:opacity-50 ${
                      isElderly ? 'h-[72px] text-lg' : 'h-11 text-sm'
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
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
            <Activity className="w-5 h-5 text-muted-foreground" />
          </div>
          Loading patient configuration...
        </div>
      )}

      {/* Auto-start the guided tour once for first-time users (then summonable via
          the ? button). No `accountHasData` here: this page never loads the
          medication list, and adding a query for a count the dashboard and the
          medications page both already have would be a round trip to learn
          nothing new. Whichever of them the user came through has recorded it —
          see GuideAutoStart's ESTABLISHED_KEY. */}
      {targetTelegramChatId && <GuideAutoStart tour="newMedication" />}
    </div>
  );
}
