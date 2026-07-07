import { HeartPulse } from 'lucide-react';

// Read-only medical card, used in the caregiver's gated patient view.
// Pure presentational (server-compatible).

export interface MedicalCardData {
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
}

function age(dob: string | null): string {
  if (!dob) return '—';
  const d = new Date(dob);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a >= 0 && a < 150 ? `${a} years` : '—';
}

function bmi(h: number | null, w: number | null): string {
  if (!h || !w) return '—';
  const m = h / 100;
  const v = w / (m * m);
  return isFinite(v) && v > 0 ? v.toFixed(1) : '—';
}

function Chips({ items }: { items: (string[] | null)[] }) {
  const flat = items.flatMap((x) => x || []);
  if (!flat.length) return <span className="text-muted-foreground">None recorded</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {flat.map((c, i) => (
        <span key={i} className="bg-muted text-foreground border border-border rounded-lg px-2 py-0.5 text-xs font-semibold">{c}</span>
      ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-bold">{label}</p>
      <div className="text-sm font-bold text-foreground mt-0.5">{value || '—'}</div>
    </div>
  );
}

export default function MedicalCard({ name, data }: { name: string; data: MedicalCardData }) {
  return (
    <div className="bg-card border border-border rounded-3xl p-6 shadow-sm space-y-5">
      <div className="flex items-center gap-2">
        <HeartPulse className="w-5 h-5 text-primary" />
        <h3 className="font-black text-foreground">Medical Profile: {name}</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Field label="Blood Group" value={data.blood_group && data.blood_group !== 'UNKNOWN' ? data.blood_group : '—'} />
        <Field label="Age" value={age(data.date_of_birth)} />
        <Field label="Gender" value={data.gender} />
        <Field label="BMI" value={bmi(data.height_cm, data.weight_kg)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Allergies" value={<Chips items={[data.drug_allergies, data.food_allergies, data.other_allergies]} />} />
        <Field label="Chronic Conditions" value={<Chips items={[data.chronic_conditions]} />} />
      </div>

      <Field
        label="Emergency Contact"
        value={
          data.emergency_contact_name
            ? `${data.emergency_contact_name}${data.emergency_contact_relationship ? ` (${data.emergency_contact_relationship})` : ''}${data.emergency_contact_phone ? ` · ${data.emergency_contact_phone}` : ''}`
            : '—'
        }
      />
    </div>
  );
}
