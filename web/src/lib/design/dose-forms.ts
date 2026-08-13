/**
 * THE EIGHT DOSE FORMS — one registry, one icon per form, one label per form.
 *
 * A medication's form is the fastest thing to recognise on a list: you know your
 * inhaler from your eye drops at a glance long before you have read either name.
 * That only works if the same shape means the same thing on every surface, so
 * this file is the single source and nothing else may map a `unit_type` to a
 * picture.
 *
 * WHY EIGHT when `unit_type` has ten values: the extra values are *measurements*,
 * not forms. ML and TEASPOON are both syrup — a spoon and a measuring cup are how
 * you take it, not what it is — and UNIT is what an injection is counted in. The
 * form is what you look for in a cupboard; the unit is what you write on a chart.
 * `unitOptions` in medication-form-options.ts keeps all ten because the wizard
 * asks the measurement question; this keeps eight because the eye asks a
 * different one.
 *
 * ICONS ARE LUCIDE PLACEHOLDERS except the three already drawn (tablet, syrup
 * spoon, topical bottle). Swapping in the custom set is an edit to THIS file and
 * nothing else — that is the point of routing every surface through it. Until
 * then the placeholders are chosen for silhouette, since at 20px a silhouette is
 * all anyone reads.
 */

import React from 'react';
import { Pill, Droplets, Syringe, Wind, Bandage, Package } from 'lucide-react';
import { SpoonIcon, CreamBottleIcon, TabletIcon } from '@/components/ui/custom-icons';

export type DoseForm =
  | 'tablet'
  | 'capsule'
  | 'syrup'
  | 'drops'
  | 'injection'
  | 'inhaler'
  | 'patch'
  | 'topical'
  | 'other';

export interface DoseFormMeta {
  form: DoseForm;
  /** Sentence case — this is copy, and it appears in running text. */
  label: string;
  /** True once a bespoke icon exists, so the remaining gaps stay countable. */
  drawn: boolean;
  Icon: React.ComponentType<{ className?: string }>;
}

export const DOSE_FORMS: Record<DoseForm, DoseFormMeta> = {
  tablet: { form: 'tablet', label: 'Tablet', drawn: true, Icon: TabletIcon },
  capsule: { form: 'capsule', label: 'Capsule', drawn: false, Icon: Pill },
  syrup: { form: 'syrup', label: 'Syrup', drawn: true, Icon: SpoonIcon },
  drops: { form: 'drops', label: 'Drops', drawn: false, Icon: Droplets },
  injection: { form: 'injection', label: 'Injection', drawn: false, Icon: Syringe },
  inhaler: { form: 'inhaler', label: 'Inhaler', drawn: false, Icon: Wind },
  patch: { form: 'patch', label: 'Patch', drawn: false, Icon: Bandage },
  topical: { form: 'topical', label: 'Cream or ointment', drawn: true, Icon: CreamBottleIcon },
  other: { form: 'other', label: 'Other', drawn: false, Icon: Package },
};

/**
 * `medications.unit_type` → dose form.
 *
 * Unknown values fall to `other` rather than to `tablet`. Guessing "tablet" would
 * put a pill icon on a syringe, and on a medication list a confidently wrong
 * picture is worse than an honest blank one.
 */
const UNIT_TO_FORM: Record<string, DoseForm> = {
  TABLET: 'tablet',
  CAPSULE: 'capsule',
  ML: 'syrup',
  LIQUID: 'syrup',
  TEASPOON: 'syrup',
  DROP: 'drops',
  DROPS: 'drops',
  UNIT: 'injection',
  INJECTION: 'injection',
  INHALATION: 'inhaler',
  INHALER: 'inhaler',
  SPRAY: 'inhaler',
  PATCH: 'patch',
  APPLICATION: 'topical',
  CREAM: 'topical',
  OTHER: 'other',
};

export function doseFormOf(unitType?: string | null): DoseFormMeta {
  return DOSE_FORMS[UNIT_TO_FORM[(unitType || '').toUpperCase()] ?? 'other'];
}

/** How many of the eight still need drawing. Read by nothing yet; kept honest. */
export const UNDRAWN_FORMS = Object.values(DOSE_FORMS).filter((f) => !f.drawn).length;
