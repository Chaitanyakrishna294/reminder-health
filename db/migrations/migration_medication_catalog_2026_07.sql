-- medication_catalog: read-only reference data (India medicines dataset, imported by
-- db/scripts/import-medication-catalog.js) used to let a patient/caregiver OPTIONALLY
-- link a medication to a real brand + generic composition, via explicit human
-- search-and-select only — no auto-matching. See
-- docs/superpowers/specs/2026-07-12-medication-catalog-link-design.md.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.medication_catalog (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_name text NOT NULL,
  manufacturer_name text,
  composition_text text,
  pack_size_label text,
  type text,
  is_discontinued boolean NOT NULL DEFAULT false,
  snapshot_date date NOT NULL
);

-- Trigram index powers both substring search and the similarity()-ranked fuzzy search in
-- search_medication_catalog below, against ~254k brand names.
CREATE INDEX medication_catalog_brand_name_trgm_idx
  ON public.medication_catalog USING gin (brand_name gin_trgm_ops);

-- Global reference data: any authenticated user may read it. Nothing in this table is
-- patient-specific, so there is no per-row ownership to filter by. Writes happen only via
-- the service_role import script (db/scripts/import-medication-catalog.js), which bypasses
-- RLS entirely — no INSERT/UPDATE/DELETE policy is defined for any client role.
ALTER TABLE public.medication_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read medication catalog"
  ON public.medication_catalog FOR SELECT
  TO authenticated
  USING (true);

-- Fuzzy, typo-tolerant search backing the "Link to real medication" UI. Returns nothing
-- for a query under 2 characters (avoids a full-table trigram scan on near-empty input).
-- Default SECURITY INVOKER is sufficient: it only reads through the SELECT policy above.
CREATE OR REPLACE FUNCTION public.search_medication_catalog(p_query text, p_limit int DEFAULT 20)
RETURNS TABLE (
  id bigint,
  brand_name text,
  manufacturer_name text,
  composition_text text,
  pack_size_label text,
  is_discontinued boolean,
  snapshot_date date
)
LANGUAGE plpgsql
STABLE
SET search_path = 'public'
AS $$
BEGIN
  IF p_query IS NULL OR length(trim(p_query)) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.id, c.brand_name, c.manufacturer_name, c.composition_text, c.pack_size_label,
         c.is_discontinued, c.snapshot_date
  FROM public.medication_catalog c
  WHERE c.brand_name % p_query
  ORDER BY similarity(c.brand_name, p_query) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_medication_catalog(text, int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.search_medication_catalog(text, int) FROM anon;

-- Nullable, populated ONLY by an explicit human search-and-select action in
-- MedicationCatalogLink (web/src/components/medications/medication-catalog-link.tsx) —
-- never by any matching algorithm. Values are copied at selection time, not live-joined
-- against medication_catalog, so a later catalog refresh (re-running the import script)
-- cannot silently rewrite what a doctor already saw on an existing patient's record.
-- ON DELETE SET NULL: if a re-imported catalog replaces the referenced row, catalog_id
-- goes null but the linked_* display fields are untouched — the record still shows what
-- the patient originally selected.
ALTER TABLE public.medications
  ADD COLUMN IF NOT EXISTS catalog_id bigint NULL
    REFERENCES public.medication_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_brand_name text NULL,
  ADD COLUMN IF NOT EXISTS linked_composition text NULL,
  ADD COLUMN IF NOT EXISTS linked_manufacturer text NULL,
  ADD COLUMN IF NOT EXISTS linked_snapshot_date date NULL,
  ADD COLUMN IF NOT EXISTS linked_is_discontinued boolean NULL;
