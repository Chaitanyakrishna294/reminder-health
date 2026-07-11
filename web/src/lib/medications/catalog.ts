import type { SupabaseClient } from '@supabase/supabase-js';

// A row a user has explicitly selected from the medication catalog, ready to be spread
// onto a medications insert/update via buildSharedMedicationFields (form-logic.ts).
// Never populated by any matching algorithm — only by an explicit pick in
// MedicationCatalogLink. See docs/superpowers/specs/2026-07-12-medication-catalog-link-design.md.
export interface CatalogLinkValue {
  catalogId: number;
  brandName: string;
  composition: string | null;
  manufacturer: string | null;
  isDiscontinued: boolean;
  snapshotDate: string;
}

export interface CatalogSearchResult {
  id: number;
  brand_name: string;
  manufacturer_name: string | null;
  composition_text: string | null;
  pack_size_label: string | null;
  is_discontinued: boolean;
  snapshot_date: string;
}

/**
 * Typo-tolerant search against medication_catalog via the search_medication_catalog RPC.
 * Fails open: on any error it logs and returns an empty list rather than throwing, so a
 * catalog outage can never block adding or editing a medication.
 */
export async function searchMedicationCatalog(
  supabase: SupabaseClient,
  query: string,
): Promise<CatalogSearchResult[]> {
  const { data, error } = await supabase.rpc('search_medication_catalog', {
    p_query: query,
    p_limit: 20,
  });
  if (error) {
    console.error('[searchMedicationCatalog] RPC error:', error);
    return [];
  }
  return (data as CatalogSearchResult[]) || [];
}
