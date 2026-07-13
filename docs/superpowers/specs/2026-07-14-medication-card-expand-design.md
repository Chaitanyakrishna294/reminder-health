# Medication List Card Expand-in-Place — Design Spec

**Date:** 2026-07-14
**Status:** Approved design, pending implementation plan
**Related:** `web/src/components/medications/medication-list.tsx`, `docs/superpowers/specs/2026-07-12-medication-catalog-link-design.md` (the catalog-link feature this declutters)

## Problem

The medication list card already shows a linked catalog composition line
(brand, composition, discontinued badge, "as of" caption) alongside a row of
action buttons (Add Stock, Pause/Resume, Edit, Delete). This is purely a
decluttering concern, not a missing-data concern: the card is getting busy,
and a separate audit found `linked_manufacturer` is fetched (in both the
list's select queries) but never rendered anywhere — a small dead field, not
a security gap.

An earlier, broader version of this idea (a tap-to-open detail modal/route)
was rejected: the medication card has no existing tap target today, a fuller
detail view already exists via the Edit page's `MedicationCatalogLink`
summary, and there is no additional data to justify a new surface. This spec
covers only the narrower, approved version.

## Goal / non-goals

**Goal:** Each medication card gets an independent expand/collapse toggle on
its linked-composition line. Collapsed (default) looks exactly as it does
today. Expanded shows the composition in full (no truncation) plus the
previously-unrendered `linked_manufacturer`.

**Non-goals:**
- No change to the Care Circle view's composition line (scoped out — its
  line is already short and simple).
- No change to the Edit page's `MedicationCatalogLink` summary, which has
  the same missing-manufacturer gap but is out of scope here.
- No new query, column, or fetch — `linked_manufacturer` is already selected
  by both of the list's existing queries and already on the `Medication`
  interface. This is a display-only change.
- No access-control change — the expanded view is gated by the same page-
  level access (`can_view_medications`) as everything else on this list.

## Approach

**State:** `medication-list.tsx` gets one new piece of state,
`expandedIds: Set<number>` (`useState(new Set())`), plus a toggle function
that adds/removes a medication's `id`. Each card's expand state is
independent — not accordion-exclusive, so multiple cards can be open at once.

**Collapsed rendering (unchanged, plus one new affordance):** the existing
truncated composition line, discontinued badge, and "Patient-selected from
catalog · as of ⟨date⟩" caption stay exactly as they are today. A small
`ChevronDown` icon is appended as the tap target that toggles this card's id
in `expandedIds`.

**Expanded rendering:** the `truncate` class is dropped from the composition
text (it wraps instead), and a new line renders `med.linked_manufacturer`
when present. The discontinued badge and "as of" caption remain visible. The
chevron rotates 180° and serves as the collapse control.

**Data flow:** none — purely local component state driving conditional
className/JSX on already-fetched fields.

## Testing

Manual only (matches this app's established convention for UI changes):
verify each card expands/collapses independently of its siblings, confirm
`linked_manufacturer` renders only in the expanded state, confirm collapsed
cards are visually identical to the pre-change list, and confirm no overlap
or layout shift affects the adjacent action-button row.
