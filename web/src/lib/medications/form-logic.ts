// Presentation-neutral logic shared by the "new" and "edit" medication wizards.
// The two pages keep their own (intentionally divergent) markup and styling, but the
// per-step validation rules and the medication row fields they write are identical —
// centralized here so the two can never silently drift apart.

import type { CatalogLinkValue } from '@/lib/medications/catalog';

export const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The wizard fields that drive validation and the persisted medication row. */
export interface MedicationFormState {
  drugName: string;
  frequency: string;
  times: string[];
  dosageAmount: number;
  strength: string;
  enableInventory: boolean;
  currentStock: string;
  stockThreshold: string;
  medicationReason: string;
  priority: string;
  unitType: string;
  /** Optional, explicit human-selected catalog link. Never auto-populated. */
  catalogLink: CatalogLinkValue | null;
}

/**
 * Validate one wizard step. Returns an error message to display, or null if the
 * step is valid and the user may advance. Mirrors the original inline checks in
 * both forms exactly (same messages, same order).
 */
export function validateMedicationStep(
  step: number,
  s: Pick<
    MedicationFormState,
    'drugName' | 'times' | 'dosageAmount' | 'enableInventory' | 'currentStock' | 'stockThreshold'
  >,
): string | null {
  if (step === 1) {
    if (!s.drugName.trim()) return 'Please enter a medication name.';
  } else if (step === 2) {
    for (const t of s.times) {
      if (!TIME_REGEX.test(t)) {
        return 'Invalid time format. Please enter valid hours and minutes.';
      }
    }
  } else if (step === 3) {
    if (s.dosageAmount <= 0) return 'Dosage amount must be greater than zero.';
  } else if (step === 4) {
    if (s.enableInventory) {
      const stockNum = Number(s.currentStock);
      const thresholdNum = Number(s.stockThreshold);
      if (isNaN(stockNum) || stockNum < 0) {
        return 'Current stock must be a non-negative number.';
      }
      if (isNaN(thresholdNum) || thresholdNum < 0) {
        return 'Low stock threshold must be a non-negative number.';
      }
    }
  }
  return null;
}

/**
 * The medication row fields written identically by both the insert (new) and the
 * update (edit) paths. Callers add their own page-specific fields (e.g. telegram_id,
 * active, next_reminder_at) by spreading this result.
 *
 * @param sortedTimes reminder times already sorted ascending by the caller
 */
export function buildSharedMedicationFields(
  s: MedicationFormState,
  sortedTimes: string[],
) {
  return {
    drug_name: s.drugName.trim(),
    dosage: s.strength.trim() || 'N/A',
    frequency: s.frequency,
    reminder_times: sortedTimes,
    unit_type: s.unitType,
    dosage_amount: Number(s.dosageAmount),
    current_stock: s.enableInventory && s.currentStock !== '' ? Number(s.currentStock) : null,
    stock_threshold: s.enableInventory && s.stockThreshold !== '' ? Number(s.stockThreshold) : null,
    medication_reason: s.medicationReason.trim() || null,
    priority_level: s.priority,
    low_stock_alert_enabled: s.enableInventory,
    // Copied at selection time from an explicit human pick (MedicationCatalogLink) —
    // never auto-matched. null when nothing was linked.
    catalog_id: s.catalogLink?.catalogId ?? null,
    linked_brand_name: s.catalogLink?.brandName ?? null,
    linked_composition: s.catalogLink?.composition ?? null,
    linked_manufacturer: s.catalogLink?.manufacturer ?? null,
    linked_snapshot_date: s.catalogLink?.snapshotDate ?? null,
    linked_is_discontinued: s.catalogLink?.isDiscontinued ?? null,
  };
}
