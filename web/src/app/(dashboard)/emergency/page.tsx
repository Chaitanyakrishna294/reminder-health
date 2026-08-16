import { redirect } from 'next/navigation';
import Link from 'next/link';
import { resolveUserData, getMedicalProfile } from '@/lib/supabase/cached-queries';
import { createClient } from '@/lib/supabase/server';
import { Phone, Pencil, Siren } from 'lucide-react';

export const metadata = { title: 'Emergency Card | Re-MIND-eЯ' };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/20 py-3">
      <p className="text-xs uppercase tracking-wide text-white/70 font-bold">{label}</p>
      <div className="text-lg font-black mt-0.5">{children}</div>
    </div>
  );
}

export default async function EmergencyPage() {
  const data = await resolveUserData();
  if (!data) redirect('/login');

  const { user, profile } = data;
  const medical = await getMedicalProfile(user.id);

  let meds: { drug_name: string; dosage: string | null }[] = [];
  if (profile.telegram_chat_id) {
    const supabase = await createClient();
    const { data: medRows } = await supabase
      .from('medications')
      .select('drug_name, dosage')
      .eq('telegram_id', profile.telegram_chat_id)
      .eq('active', true);
    meds = medRows || [];
  }

  const allergies = [
    ...(medical?.drug_allergies || []),
    ...(medical?.food_allergies || []),
    ...(medical?.other_allergies || []),
  ];

  return (
    <div className="max-w-xl mx-auto">
      {/* This panel is shown to paramedics, so it stays a committed red in BOTH themes —
          that is exactly what `--danger-solid` is for (see globals.css; `--danger` is too
          light to carry white, and `--danger-strong` deliberately flips lightness between
          modes, which a fill must never do). Was the raw `red-600`. */}
      {/* THE ONE CARD THAT DOES NOT JOIN THE BOARD.
          Every other surface in the app is a white card floating on the tray. This
          is a solid danger fill at the top of the elevation ladder, and it stays
          that way on purpose: it is read by a stranger, in an emergency, on
          somebody else's locked phone. Looking like the rest of the app is the
          opposite of what it needs. It takes the OVERLAY step (--lift-3) rather
          than shadow-2xl so it is on the ladder even while it refuses the tray. */}
      <div className="rounded-[20px] bg-danger-solid text-danger-solid-foreground card-overlay p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-widest bg-white/15 px-3 py-1 rounded-full">
            <Siren className="w-4 h-4" /> Emergency Card
          </span>
          {/* Icon-only, so it gets a real 44px target — it was the bare 20px glyph.
              (The "Medical Profile" link at the foot of this page stays as-is: it sits
              inline in a sentence, which WCAG 2.5.8 exempts.) */}
          <Link
            href="/medical-profile"
            className="-mr-2 w-11 h-11 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors"
            aria-label="Edit medical profile"
          >
            <Pencil className="w-5 h-5" />
          </Link>
        </div>

        <h1 className="text-3xl sm:text-4xl font-black mt-5">{profile.full_name || 'Unknown'}</h1>

        <Row label="Blood Group">{medical?.blood_group && medical.blood_group !== 'UNKNOWN' ? medical.blood_group : 'Not set'}</Row>

        <Row label="Allergies">
          {allergies.length ? (
            <div className="flex flex-wrap gap-2">
              {allergies.map((a, i) => (
                <span key={i} className="bg-white/20 rounded-lg px-2 py-1 text-sm font-bold">{a}</span>
              ))}
            </div>
          ) : (
            <span className="text-white/80">None recorded</span>
          )}
        </Row>

        <Row label="Conditions">
          {medical?.chronic_conditions?.length ? (
            <div className="flex flex-wrap gap-2">
              {medical.chronic_conditions.map((c: string, i: number) => (
                <span key={i} className="bg-white/20 rounded-lg px-2 py-1 text-sm font-bold">{c}</span>
              ))}
            </div>
          ) : (
            <span className="text-white/80">None recorded</span>
          )}
        </Row>

        <Row label="Emergency Contact">
          {medical?.emergency_contact_name ? (
            <div className="flex items-center justify-between gap-3">
              <span>
                {medical.emergency_contact_name}
                {medical.emergency_contact_relationship ? ` (${medical.emergency_contact_relationship})` : ''}
              </span>
              {medical.emergency_contact_phone && (
                <a
                  href={`tel:${medical.emergency_contact_phone.replace(/[^\d+]/g, '')}`}
                  /* Sits ON the committed-red panel, so it must be theme-independent too.
                     `bg-white` was NOT: globals.css rewrites `.bg-white` to `--card` in
                     dark mode, which turned this into dark-red text on a navy pill over a
                     red card. The two `danger-solid` tokens are #fff / #B3261E in both
                     modes, so the pairing holds either way. Also now a 44px target. */
                  className="inline-flex items-center justify-center gap-1.5 bg-danger-solid-foreground text-danger-solid font-black rounded-[var(--r-control)] px-3 h-11 text-sm shrink-0"
                >
                  <Phone className="w-4 h-4" /> Call
                </a>
              )}
            </div>
          ) : (
            <span className="text-white/80">Not set</span>
          )}
        </Row>

        <Row label="Current Medications">
          {meds.length ? (
            <ul className="space-y-1">
              {meds.map((m, i) => (
                <li key={i} className="text-base font-bold">
                  • {m.drug_name}{m.dosage ? ` (${m.dosage})` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-white/80">None</span>
          )}
        </Row>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-4">
        Show this screen to medical staff. Update details on your{' '}
        <Link href="/medical-profile" className="text-primary font-semibold hover:underline">Medical Profile</Link>.
      </p>
    </div>
  );
}
