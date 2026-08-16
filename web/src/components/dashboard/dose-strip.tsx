'use client';

// TODAY, AS A BLISTER STRIP.
//
// The dashboard's signature element, and the thing that replaced the four skewed
// Morning/Afternoon/Evening/Night tiles. Those tiles spent ~78px of the phone's first
// screen to say one of four words per quarter of the day, and they aggregated: three
// doses in the morning collapsed into a single "Still due".
//
// This is the object the patient is actually holding — a strip of foil pockets, one per
// dose, in time order, filling in as the day goes. It is concrete where a donut chart is
// abstract, it survives being glanced at by someone in their seventies, and every pocket
// is a real touch target (the compliance ring's dose markers were hover-only, so on a
// phone — the only device most of these users have — they did nothing at all).
//
// Colour is never the only signal: each state has its own GLYPH (check / cross / alert /
// clock / dot) and its own words in the aria-label, per DESIGN_SYSTEM.md.

import React from 'react';
import { Check, X, AlertTriangle } from 'lucide-react';
import { doseTone, doseLabel, type Tone } from '@/lib/design/semantics';
import { getUnitIcon } from '@/lib/design/dose-forms';
import { Eyebrow } from '@/components/ui/eyebrow';
import type { ReminderEvent } from '@/components/dashboard/todays-schedule';

// ── The physical model ───────────────────────────────────────────────────────
// A pocket is DOMED while the pill is still in it, and PRESSED IN once you have
// pushed the pill out. That is the whole idea, and it maps exactly onto dose state:
//
//   domed   → upcoming, due now, missed   (the pill is still sitting there)
//   pressed → taken, skipped              (the pocket has been emptied)
//
// So the strip's state is readable from the SURFACE, not only from colour — which
// is worth real money for an audience with age-related colour vision changes, and
// is why "missed" stays domed rather than borrowing the emptied look.
//
// Both effects are pure box-shadow + a gradient sheen: no extra elements, nothing
// animated, and they composite fine inside a horizontal scroller.

/** Convex: a light sheen off the top-left, shadow gathering at the bottom.
 *  The sheen is kept to ~40% — at 55% it washed the pale neutral tint of an upcoming
 *  pocket out to near-white and the dome stopped reading as form at all. The bottom
 *  shadow does most of the work; the highlight only has to say where the light is. */
const DOMED: React.CSSProperties = {
  backgroundImage:
    'radial-gradient(110% 85% at 30% 16%, var(--pocket-sheen), rgba(255,255,255,0) 58%)',
  boxShadow:
    'inset 0 1px 1px var(--pocket-rim), inset 0 -5px 8px var(--pocket-shade), 0 1px 1.5px rgba(0,0,0,0.06)',
};

/** Concave: the highlight moves to the bottom lip and the shadow falls inside the
 *  top edge — the same trick, inverted, which is what makes it read as pushed-in. */
const PRESSED: React.CSSProperties = {
  boxShadow:
    'inset 0 3px 6px var(--pocket-well), inset 0 -1px 1px var(--pocket-lip)',
};

/** Per-pocket presentation. Derived from the dose's tone so it can never drift from
 *  the rest of the app's status colours, plus the glyph that carries the same meaning
 *  without colour. */
function pocketFace(tone: Tone, isDue: boolean) {
  if (isDue) {
    return {
      // The one pocket asking for something right now. Solid enough to find at a
      // glance on a page of tints, but it is NOT the page's CTA — the day rail's
      // due-now card is (it took that job from the hero card, now retired).
      shell: 'border-primary/45 bg-primary-soft',
      well: 'border-primary/40 bg-primary/20 text-primary-strong',
      label: 'text-primary-strong',
      filled: true,
      glyph: null,
    };
  }
  switch (tone) {
    case 'success':
      return {
        shell: 'border-success/30 bg-success/8',
        well: 'border-success/35 bg-success/20 text-success-strong',
        label: 'text-success-strong',
        filled: false,
        glyph: <Check className="w-5 h-5" aria-hidden />,
      };
    case 'warning':
      return {
        shell: 'border-warning/30 bg-warning/8',
        well: 'border-warning/35 bg-warning/20 text-warning-strong',
        label: 'text-warning-strong',
        filled: false,
        glyph: <X className="w-5 h-5" aria-hidden />,
      };
    case 'danger':
      // Missed. The dose was never taken, so the pill is still in there — this one
      // stays domed and keeps its pill, and the alarm rides on top of it.
      return {
        shell: 'border-danger/35 bg-danger/8',
        well: 'border-danger/40 bg-danger/20 text-danger-strong',
        label: 'text-danger-strong',
        filled: true,
        glyph: <AlertTriangle className="w-4 h-4 absolute -right-0.5 -top-0.5" aria-hidden />,
      };
    case 'info':
      return {
        shell: 'border-info/30 bg-info/8',
        well: 'border-info/35 bg-info/20 text-info-strong',
        label: 'text-info-strong',
        filled: true,
        glyph: null,
      };
    default:
      // Not due yet: a full pocket, quietly. Neutral tint, pill still visible.
      return {
        shell: 'border-border bg-card',
        well: 'border-input bg-muted text-muted-foreground',
        label: 'text-muted-foreground',
        filled: true,
        glyph: null,
      };
  }
}

export default function DoseStrip({
  events,
  mounted,
  now,
  selectedId,
  onSelect,
}: {
  events: ReminderEvent[];
  /** Times are rendered client-side only — the server has no user timezone. */
  mounted: boolean;
  /** "Now" in epoch ms, owned by the parent's 60s clock. Passed in rather than read
   *  from `Date.now()` here: reading the clock during render is impure (React would be
   *  free to re-render and silently change which pocket is "due"), and this way the
   *  strip re-evaluates on the same tick as the rest of the dashboard. */
  now: number;
  selectedId?: number | null;
  onSelect?: (event: ReminderEvent) => void;
}) {
  const ordered = [...events].sort(
    (a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()
  );

  const taken = ordered.filter(
    (e) => e.reminder_status === 'TAKEN' || e.reminder_status === 'RESOLVED_BY_CG'
  ).length;

  return (
    // Deliberately NOT wrapped in the usual `bg-card border rounded-3xl p-6` shell. The
    // pockets are already surfaces, so a card around them is a box of boxes — and on a
    // page where every other section is a white rounded card, one section that is just
    // content breaks the monotone rhythm. It also buys back ~32px of the phone's
    // vertical budget, which matters directly above the fold.
    <section aria-label="Today's doses">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <Eyebrow as="h2">Today&apos;s doses</Eyebrow>
        {ordered.length > 0 && (
          // Weight + colour carry this, not size — it sits beside an 11px eyebrow and
          // still reads as the value rather than another label.
          <p className="text-sm font-black text-foreground tabular-nums shrink-0">
            {taken}
            <span className="text-muted-foreground font-bold"> of {ordered.length} taken</span>
          </p>
        )}
      </div>

      {ordered.length === 0 ? (
        <p className="mt-2 px-1 text-sm text-muted-foreground font-semibold">
          Nothing scheduled for today.
        </p>
      ) : (
        // Horizontal scroll rather than wrap: the strip stays ONE line, so "how much of
        // today is left" is answered by its shape. The scrollbar is hidden because a
        // half-visible pocket at the edge is the affordance.
        <ul
          className="mt-2 px-1 flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory
                     [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {ordered.map((event, idx) => {
            const due =
              mounted &&
              new Date(event.scheduled_for).getTime() <= now &&
              !['TAKEN', 'RESOLVED_BY_CG', 'SKIPPED', 'MISSED'].includes(event.reminder_status);
            const face = pocketFace(doseTone(event.reminder_status), due);
            const isSelected = selectedId === event.id;
            const time = mounted
              ? new Date(event.scheduled_for).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })
              : '--:--';

            return (
              <li key={event.id} className="snap-start shrink-0">
                <button
                  type="button"
                  onClick={() => onSelect?.(event)}
                  aria-pressed={isSelected}
                  aria-label={`${event.medications.drug_name} at ${time} — ${doseLabel(event.reminder_status)}`}
                  // Micro-cascade: 40ms apart, capped so a 12-dose day still finishes
                  // the strip in under 300ms.
                  style={{ ['--rise-delay' as string]: `${Math.min(idx, 7) * 40}ms` }}
                  // 68px, not 58: a 12-hour time ("11:30 AM") wraps to two lines below
                  // ~66px, which cost 14px of height and made the pocket look broken.
                  // Widening beats shrinking the label — this audience includes people in
                  // their seventies, so an 9px meridiem was never the answer.
                  className={`rise-in w-[68px] rounded-[18px] border p-1.5 flex flex-col items-center gap-1.5
                              transition-[transform,box-shadow,background-color] duration-150 ease-out
                              active:scale-[0.97] cursor-pointer
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
                              ${face.shell} ${isSelected ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : ''}`}
                >
                  {/* The well. Concentric radius: 18px shell − 6px padding = 12px inner,
                      which is what stops nested rounded shapes from looking wrong.

                      Domed while the pill is still in it, pressed in once the pocket has
                      been emptied — see the note at the top of this file. A full pocket
                      shows the medication's OWN unit glyph (tablet / capsule / drops), so
                      you can see what is in there the way you can through real foil. */}
                  <span
                    className={`relative w-full h-12 rounded-[12px] border flex items-center justify-center overflow-visible ${face.well}`}
                    style={face.filled ? DOMED : PRESSED}
                  >
                    {face.filled && (
                      <span aria-hidden className="[&_svg]:w-5 [&_svg]:h-5 opacity-90">
                        {getUnitIcon(event.medications.unit_type, 'w-5 h-5')}
                      </span>
                    )}
                    {face.glyph}
                  </span>
                  <span className={`text-[11px] font-black tabular-nums leading-none whitespace-nowrap ${face.label}`}>
                    {time}
                  </span>
                  <span className="sr-only">{doseLabel(event.reminder_status)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
