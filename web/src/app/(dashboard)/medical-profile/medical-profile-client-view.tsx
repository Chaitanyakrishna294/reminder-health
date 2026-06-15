'use client';

import React, { useState } from 'react';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { HeartPulse, Save, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'] as const;
const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'] as const;

export interface MedicalProfile {
  user_id: string;
  date_of_birth: string | null;
  gender: string | null;
  blood_group: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  drug_allergies: string[] | null;
  food_allergies: string[] | null;
  other_allergies: string[] | null;
  chronic_conditions: string[] | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  primary_language: string | null;
  preferred_reminder_language: string | null;
  timezone: string | null;
  avatar_path: string | null;
}

interface Props {
  userId: string;
  fullName: string;
  email: string;
  initial: MedicalProfile | null;
  initialAvatarUrl: string | null;
}

const csvToArr = (s: string): string[] =>
  s.split(',').map((x) => x.trim()).filter(Boolean);
const arrToCsv = (a: string[] | null | undefined): string => (a && a.length ? a.join(', ') : '');

const FormSchema = z.object({
  date_of_birth: z.string().optional().nullable(),
  gender: z.string().max(40).optional().nullable(),
  blood_group: z.enum(BLOOD_GROUPS).optional().nullable(),
  height_cm: z.number().positive().max(300).optional().nullable(),
  weight_kg: z.number().positive().max(700).optional().nullable(),
  emergency_contact_phone: z.string().max(40).optional().nullable(),
});

function computeAge(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}

function computeBmi(h: number | null, w: number | null): string | null {
  if (!h || !w) return null;
  const m = h / 100;
  const bmi = w / (m * m);
  if (!isFinite(bmi) || bmi <= 0) return null;
  return bmi.toFixed(1);
}

export default function MedicalProfileClientView({ userId, fullName, email, initial, initialAvatarUrl }: Props) {
  const supabase = createClient();
  const { isElderly } = useUiMode();

  const [dob, setDob] = useState(initial?.date_of_birth ?? '');
  const [gender, setGender] = useState(initial?.gender ?? '');
  const [bloodGroup, setBloodGroup] = useState(initial?.blood_group ?? '');
  const [height, setHeight] = useState(initial?.height_cm?.toString() ?? '');
  const [weight, setWeight] = useState(initial?.weight_kg?.toString() ?? '');
  const [drugAllergies, setDrugAllergies] = useState(arrToCsv(initial?.drug_allergies));
  const [foodAllergies, setFoodAllergies] = useState(arrToCsv(initial?.food_allergies));
  const [otherAllergies, setOtherAllergies] = useState(arrToCsv(initial?.other_allergies));
  const [conditions, setConditions] = useState(arrToCsv(initial?.chronic_conditions));
  const [ecName, setEcName] = useState(initial?.emergency_contact_name ?? '');
  const [ecPhone, setEcPhone] = useState(initial?.emergency_contact_phone ?? '');
  const [ecRel, setEcRel] = useState(initial?.emergency_contact_relationship ?? '');
  const [primaryLang, setPrimaryLang] = useState(initial?.primary_language ?? '');
  const [reminderLang, setReminderLang] = useState(initial?.preferred_reminder_language ?? '');
  const [timezone, setTimezone] = useState(initial?.timezone ?? '');

  const [avatarPath, setAvatarPath] = useState(initial?.avatar_path ?? '');
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [uploading, setUploading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const age = computeAge(dob || null);
  const bmi = computeBmi(height ? Number(height) : null, weight ? Number(weight) : null);

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file for your photo.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Photo must be under 5 MB.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      setAvatarPath(path);
      setAvatarUrl(URL.createObjectURL(file));
    } catch (err: any) {
      setError(err?.message || 'Failed to upload photo.');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(false);

    const parsed = FormSchema.safeParse({
      date_of_birth: dob || null,
      gender: gender || null,
      blood_group: (bloodGroup || null) as any,
      height_cm: height ? Number(height) : null,
      weight_kg: weight ? Number(weight) : null,
      emergency_contact_phone: ecPhone || null,
    });
    if (!parsed.success) {
      setError('Please check the values entered (height/weight must be positive numbers).');
      return;
    }

    setSaving(true);
    try {
      const { error: upErr } = await supabase.from('medical_profiles').upsert({
        user_id: userId,
        date_of_birth: dob || null,
        gender: gender || null,
        blood_group: bloodGroup || null,
        height_cm: height ? Number(height) : null,
        weight_kg: weight ? Number(weight) : null,
        drug_allergies: csvToArr(drugAllergies),
        food_allergies: csvToArr(foodAllergies),
        other_allergies: csvToArr(otherAllergies),
        chronic_conditions: csvToArr(conditions),
        emergency_contact_name: ecName || null,
        emergency_contact_phone: ecPhone || null,
        emergency_contact_relationship: ecRel || null,
        primary_language: primaryLang || null,
        preferred_reminder_language: reminderLang || null,
        timezone: timezone || null,
        avatar_path: avatarPath || null,
      });
      if (upErr) throw upErr;
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err?.message || 'Failed to save medical profile.');
    } finally {
      setSaving(false);
    }
  };

  const label = `block font-semibold text-foreground ${isElderly ? 'text-base mb-1.5' : 'text-xs mb-1'}`;
  const input = `w-full px-3 py-2 rounded-xl bg-background border border-border text-foreground focus:outline-none focus:border-primary transition-all ${isElderly ? 'text-lg py-3' : 'text-sm'}`;
  const card = 'bg-card border border-border rounded-3xl p-6 shadow-sm space-y-4';
  const sectionTitle = `font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-28">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
          <HeartPulse className="w-6 h-6" />
        </div>
        <div>
          <h1 className={`font-black text-foreground ${isElderly ? 'text-3xl' : 'text-xl'}`}>Medical Profile</h1>
          <p className="text-xs text-muted-foreground">Your medical identity card — used for reminders and emergencies.</p>
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 text-danger text-sm p-3 rounded-2xl border border-danger/20 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="bg-success/10 text-success text-sm p-3 rounded-2xl border border-success/20 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> <span>Medical profile saved.</span>
        </div>
      )}

      {/* Personal Information */}
      <div className={card}>
        <h3 className={sectionTitle}>Personal Information</h3>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 overflow-hidden flex items-center justify-center shrink-0">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Profile photo" className="w-full h-full object-cover" />
            ) : (
              <span className="text-primary font-black text-xl">{fullName.substring(0, 2).toUpperCase()}</span>
            )}
          </div>
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-muted hover:bg-muted/80 border border-border text-sm font-semibold cursor-pointer transition-all">
            <Upload className="w-4 h-4" />
            <span>{uploading ? 'Uploading…' : 'Upload photo'}</span>
            <input type="file" accept="image/*" className="hidden" onChange={handleAvatar} disabled={uploading} />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={label}>Full Name</label>
            <input className={`${input} opacity-70`} value={fullName} disabled readOnly />
          </div>
          <div>
            <label className={label}>Email</label>
            <input className={`${input} opacity-70`} value={email} disabled readOnly />
          </div>
          <div>
            <label className={label}>Date of Birth</label>
            <input type="date" className={input} value={dob} onChange={(e) => setDob(e.target.value)} />
          </div>
          <div>
            <label className={label}>Age{age !== null ? '' : ' (auto)'}</label>
            <input className={`${input} opacity-70`} value={age !== null ? `${age} years` : '—'} disabled readOnly />
          </div>
          <div>
            <label className={label}>Gender</label>
            <select className={input} value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Select…</option>
              {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Medical Identity */}
      <div className={card}>
        <h3 className={sectionTitle}>Medical Identity</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className={label}>Blood Group</label>
            <select className={input} value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)}>
              <option value="">—</option>
              {BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Height (cm)</label>
            <input type="number" className={input} value={height} onChange={(e) => setHeight(e.target.value)} />
          </div>
          <div>
            <label className={label}>Weight (kg)</label>
            <input type="number" className={input} value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>
          <div>
            <label className={label}>BMI (auto)</label>
            <input className={`${input} opacity-70`} value={bmi ?? '—'} disabled readOnly />
          </div>
        </div>
      </div>

      {/* Health Information */}
      <div className={card}>
        <h3 className={sectionTitle}>Health Information</h3>
        <p className="text-xs text-muted-foreground -mt-2">Separate multiple entries with commas.</p>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className={label}>Drug Allergies</label>
            <input className={input} value={drugAllergies} onChange={(e) => setDrugAllergies(e.target.value)} placeholder="Penicillin, Aspirin" />
          </div>
          <div>
            <label className={label}>Food Allergies</label>
            <input className={input} value={foodAllergies} onChange={(e) => setFoodAllergies(e.target.value)} placeholder="Peanuts, Shellfish" />
          </div>
          <div>
            <label className={label}>Other Allergies</label>
            <input className={input} value={otherAllergies} onChange={(e) => setOtherAllergies(e.target.value)} placeholder="Latex, Pollen" />
          </div>
          <div>
            <label className={label}>Chronic Conditions</label>
            <input className={input} value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Diabetes, Hypertension, Asthma" />
          </div>
        </div>
      </div>

      {/* Emergency Information */}
      <div className={card}>
        <h3 className={sectionTitle}>Emergency Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={label}>Emergency Contact</label>
            <input className={input} value={ecName} onChange={(e) => setEcName(e.target.value)} placeholder="Name" />
          </div>
          <div>
            <label className={label}>Emergency Phone</label>
            <input className={input} value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} placeholder="+91…" />
          </div>
          <div>
            <label className={label}>Relationship</label>
            <input className={input} value={ecRel} onChange={(e) => setEcRel(e.target.value)} placeholder="Spouse, Son…" />
          </div>
        </div>
      </div>

      {/* Medical Preferences */}
      <div className={card}>
        <h3 className={sectionTitle}>Medical Preferences</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={label}>Primary Language</label>
            <input className={input} value={primaryLang} onChange={(e) => setPrimaryLang(e.target.value)} placeholder="English" />
          </div>
          <div>
            <label className={label}>Preferred Reminder Language</label>
            <input className={input} value={reminderLang} onChange={(e) => setReminderLang(e.target.value)} placeholder="English" />
          </div>
          <div>
            <label className={label}>Time Zone</label>
            <input className={input} value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Kolkata" />
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 sm:static bg-background/90 sm:bg-transparent backdrop-blur sm:backdrop-blur-none border-t border-border sm:border-0 p-4 sm:p-0 z-40">
        <button
          onClick={handleSave}
          disabled={saving || uploading}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-primary text-primary-foreground font-black hover:bg-primary-hover transition-all disabled:opacity-50 cursor-pointer"
        >
          <Save className="w-5 h-5" />
          <span>{saving ? 'Saving…' : 'Save Medical Profile'}</span>
        </button>
      </div>
    </div>
  );
}
