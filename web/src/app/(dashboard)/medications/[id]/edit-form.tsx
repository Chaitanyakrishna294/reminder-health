'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { calculateNextReminder } from '@/lib/medication-utils';
import { useUiMode } from '@/context/ui-mode-context';

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
  };
}

export default function EditMedicationForm({ medication }: EditMedicationFormProps) {
  const [step, setStep] = useState(1);
  const [drugName, setDrugName] = useState(medication.drug_name);
  const [dosage, setDosage] = useState(medication.dosage);
  const [frequency, setFrequency] = useState<'once_daily' | 'twice_daily' | 'thrice_daily'>(
    medication.frequency as any
  );
  const [times, setTimes] = useState<string[]>(medication.reminder_times);
  const [tabletCount, setTabletCount] = useState(medication.tablet_count);
  const [priority, setPriority] = useState<'normal' | 'important' | 'critical'>(
    medication.priority_level as any
  );
  const [lowStockEnabled, setLowStockEnabled] = useState(medication.low_stock_alert_enabled);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleNextStep = (e: React.MouseEvent) => {
    e.preventDefault();
    setError(null);
    if (step === 1) {
      if (!drugName.trim()) {
        setError('Please enter a medication name.');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3) {
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      for (const t of times) {
        if (!timeRegex.test(t)) {
          setError('Invalid time format. Please enter valid hours and minutes.');
          return;
        }
      }
      setStep(4);
    }
  };

  const handlePrevStep = (e: React.MouseEvent) => {
    e.preventDefault();
    setError(null);
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (tabletCount < 0) {
      setError('Tablet count cannot be negative.');
      setLoading(false);
      return;
    }

    const sortedTimes = [...times].sort((a, b) => a.localeCompare(b));
    
    let nextReminder: Date | null = null;
    if (medication.active) {
      nextReminder = calculateNextReminder(sortedTimes);
    }

    try {
      const { error: updateErr } = await supabase
        .from('medications')
        .update({
          drug_name: drugName.trim(),
          dosage: dosage.trim() || 'N/A',
          frequency,
          reminder_times: sortedTimes,
          tablet_count: tabletCount,
          priority_level: priority,
          low_stock_alert_enabled: lowStockEnabled,
          ...(nextReminder ? { next_reminder_at: nextReminder.toISOString() } : {}),
        })
        .eq('id', medication.id);

      if (updateErr) throw updateErr;

      router.push('/medications');
      router.refresh();
    } catch (err: any) {
      console.error('[EditMed] Error updating medication:', err);
      setError('Failed to update medication. Please try again.');
      setLoading(false);
    }
  };

  const labelClass = `block font-bold text-foreground ${isElderly ? 'text-xl mb-2' : 'text-sm font-semibold mb-1'}`;
  const inputClass = `mt-1 block w-full px-4 py-3 border border-input rounded-2xl bg-background text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm transition-all duration-200 ${
    isElderly ? 'py-4 text-xl rounded-2xl border-2' : ''
  }`;

  const frequencies = [
    { id: 'once_daily', title: 'Once Daily', desc: 'One dose per day', icon: '☀️' },
    { id: 'twice_daily', title: 'Twice Daily', desc: 'Morning and night', icon: '🌤' },
    { id: 'thrice_daily', title: 'Thrice Daily', desc: 'Morning, noon, and night', icon: '🌙' }
  ];

  const priorities = [
    { id: 'normal', title: 'Normal', desc: 'General vitamins/supplements', icon: '🟢', colorClass: 'border-success bg-success/5 text-success' },
    { id: 'important', title: 'Important', desc: 'Core medication, low delay tolerated', icon: '🟠', colorClass: 'border-warning bg-warning/5 text-warning' },
    { id: 'critical', title: 'Critical', desc: 'Life-critical doses, alarms caregiver on miss', icon: '🔴', colorClass: 'border-danger bg-danger/5 text-danger' }
  ];

  return (
    <div className={`mx-auto transition-all duration-300 ${isElderly ? 'max-w-2xl space-y-8' : 'max-w-xl space-y-6'}`}>
      
      {/* Title */}
      <div>
        <h1 className={`font-black text-foreground tracking-tight ${isElderly ? 'text-4xl' : 'text-2xl'}`}>Edit Medication</h1>
        <p className={`text-muted-foreground ${isElderly ? 'text-lg mt-2' : 'text-sm font-semibold'}`}>
          Modify scheduling details for your medication routine.
        </p>
      </div>

      {error && (
        <div className="bg-danger/10 text-danger text-sm p-4 rounded-2xl border border-danger/20">
          ⚠️ {error}
        </div>
      )}

      <div className={`bg-card rounded-3xl border border-border shadow-sm p-6 md:p-8 ${isElderly ? 'border-4' : ''}`}>
        
        {/* Progress Header */}
        <div className="mb-6">
          <div className="flex justify-between items-center text-xs font-black text-muted-foreground uppercase tracking-wider mb-2">
            <span>Step {step} of 4: {
              step === 1 ? 'Details' : step === 2 ? 'Frequency' : step === 3 ? 'Reminders' : 'Priority'
            }</span>
            <span>{Math.round(((step - 1) / 3) * 100)}% Complete</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden border border-border">
            <div 
              className="bg-primary h-full transition-all duration-300" 
              style={{ width: `${(step / 4) * 100}%` }} 
            />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* STEP 1: Name & Dosage */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Medication Name</label>
                <input
                  type="text"
                  required
                  value={drugName}
                  onChange={(e) => setDrugName(e.target.value)}
                  className={inputClass}
                  placeholder="Aspirin"
                />
              </div>
              <div>
                <label className={labelClass}>Dosage</label>
                <input
                  type="text"
                  value={dosage}
                  onChange={(e) => setDosage(e.target.value)}
                  className={inputClass}
                  placeholder="500mg"
                />
              </div>
            </div>
          )}

          {/* STEP 2: Frequency Cards */}
          {step === 2 && (
            <div className="space-y-4">
              <label className={labelClass}>Select Frequency</label>
              <div className="grid grid-cols-1 gap-4">
                {frequencies.map((freq) => (
                  <button
                    key={freq.id}
                    type="button"
                    onClick={() => setFrequency(freq.id as any)}
                    className={`p-5 rounded-2xl border text-left transition-all flex items-center justify-between cursor-pointer ${
                      frequency === freq.id 
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20 font-black' 
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-3xl">{freq.icon}</span>
                      <div>
                        <h3 className="font-bold text-foreground text-sm">{freq.title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{freq.desc}</p>
                      </div>
                    </div>
                    {frequency === freq.id && <span className="text-primary text-xl">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP 3: Reminder Timings */}
          {step === 3 && (
            <div className="space-y-4">
              <label className={labelClass}>Set Reminder Timings (24-hour)</label>
              <div className="grid grid-cols-1 gap-4">
                {times.map((time, idx) => (
                  <div key={idx} className="bg-muted/40 p-4 rounded-2xl border border-border flex items-center justify-between gap-4">
                    <span className="text-xs font-bold text-muted-foreground uppercase">Dose #{idx + 1}</span>
                    <input
                      type="time"
                      required
                      value={time}
                      onChange={(e) => handleTimeChange(idx, e.target.value)}
                      className={`px-4 py-2 border border-input rounded-xl bg-background text-foreground text-sm font-mono font-bold focus:ring-2 focus:ring-primary ${
                        isElderly ? 'py-3 text-lg' : ''
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 4: Priority & Stock */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="space-y-3">
                <label className={labelClass}>Priority Level</label>
                <div className="grid grid-cols-1 gap-3">
                  {priorities.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPriority(p.id as any)}
                      className={`p-4 rounded-2xl border text-left transition-all flex items-center justify-between cursor-pointer ${
                        priority === p.id 
                          ? `${p.colorClass} border-current ring-2 ring-current/25 font-black` 
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{p.icon}</span>
                        <div>
                          <h3 className="font-bold text-foreground text-sm">{p.title}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
                        </div>
                      </div>
                      {priority === p.id && <span className="text-xl">✓</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelClass}>Tablet Stock Count</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={tabletCount}
                  onChange={(e) => setTabletCount(parseInt(e.target.value) || 0)}
                  className={inputClass}
                />
              </div>

              <div className={`flex items-center ${isElderly ? 'border border-border p-4 rounded-2xl' : ''}`}>
                <input
                  type="checkbox"
                  id="lowStockAlert"
                  checked={lowStockEnabled}
                  onChange={(e) => setLowStockEnabled(e.target.checked)}
                  className={`text-primary bg-background border-input rounded focus:ring-primary focus:ring-2 cursor-pointer ${
                    isElderly ? 'w-6 h-6' : 'w-4 h-4'
                  }`}
                />
                <label htmlFor="lowStockAlert" className={`ml-2 text-foreground cursor-pointer font-bold ${
                  isElderly ? 'text-lg' : 'text-xs font-semibold'
                }`}>
                  Enable Low Stock Alerts
                </label>
              </div>
            </div>
          )}

          {/* Wizard Navigation Actions */}
          <div className="flex items-center justify-between pt-6 border-t border-border gap-3">
            {step > 1 ? (
              <button
                type="button"
                onClick={handlePrevStep}
                className={`px-6 font-bold rounded-2xl border border-border text-foreground bg-muted hover:bg-muted/80 transition-all cursor-pointer ${
                  isElderly ? 'h-[88px] text-xl flex items-center justify-center' : 'py-2.5 text-xs'
                }`}
              >
                ← Back
              </button>
            ) : (
              <Link
                href="/medications"
                className={`px-6 font-bold rounded-2xl border border-border text-foreground bg-muted hover:bg-muted/80 transition-all flex items-center justify-center ${
                  isElderly ? 'h-[88px] text-xl' : 'py-2.5 text-xs'
                }`}
              >
                Cancel
              </Link>
            )}

            {step < 4 ? (
              <button
                type="button"
                onClick={handleNextStep}
                className={`px-6 font-bold rounded-2xl bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer ${
                  isElderly ? 'h-[88px] text-xl flex items-center justify-center' : 'py-2.5 text-xs'
                }`}
              >
                Next Step →
              </button>
            ) : (
              <button
                type="submit"
                disabled={loading}
                className={`px-6 font-bold rounded-2xl bg-success text-success-foreground hover:bg-success/95 transition-all cursor-pointer disabled:opacity-50 ${
                  isElderly ? 'h-[88px] text-xl flex items-center justify-center' : 'py-2.5 text-xs'
                }`}
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            )}
          </div>

        </form>
      </div>
    </div>
  );
}
