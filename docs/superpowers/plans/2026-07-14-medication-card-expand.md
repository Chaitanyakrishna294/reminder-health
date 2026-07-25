# Medication List Card Expand-in-Place Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each medication list card gets an independent expand/collapse toggle on its linked-composition line — collapsed looks exactly as today, expanded shows the full untruncated composition plus the currently-unrendered `linked_manufacturer` field.

**Architecture:** One new piece of local state (`expandedIds: Set<number>`) in `MedicationList`, plus a restructure of the existing linked-composition JSX block to make the truncated line tappable and conditionally reveal a manufacturer line. Zero backend changes — `linked_manufacturer` is already fetched by both of this component's existing queries and already on the `Medication` interface.

**Tech Stack:** Next.js 16 client component (React 19, TypeScript), Tailwind, `lucide-react` icons.

## Global Constraints

- Collapsed-state rendering must be pixel-identical to what exists today (same truncation, same discontinued badge, same "Patient-selected from catalog · as of ⟨date⟩" caption) — the only addition is the chevron toggle affordance.
- Each card's expand/collapse state is independent of every other card — not accordion-exclusive.
- `linked_manufacturer` renders ONLY in the expanded state, and only when the value is present (some linked medications may have a null manufacturer).
- No new query, no new column, no new prop, no new permission — purely local UI state over already-fetched data.
- Out of scope: the Care Circle view's composition line and the Edit page's `MedicationCatalogLink` summary are untouched, even though they have the same missing-manufacturer gap.
- Commit message trailer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Work on the current branch (`main`). Do not create branches.

---

### Task 1: Expand/collapse toggle on the linked-composition line

**Files:**
- Modify: `web/src/components/medications/medication-list.tsx:9` (import), `:54-56` (state), `:301-313` (JSX)

**Interfaces:**
- Consumes: `Medication.linked_manufacturer` (already defined on the interface at line 34, already selected by both of this file's existing Supabase queries — no query change needed).
- Produces: nothing consumed by other files — this is a self-contained, local UI change.

- [ ] **Step 1: Add the `ChevronDown` import**

In `web/src/components/medications/medication-list.tsx`, find this exact line:

```ts
import { Plus, Package, Clock, Pause, Play, SquarePen, Trash2, Pill, X } from 'lucide-react';
```

Replace with:

```ts
import { Plus, Package, Clock, Pause, Play, SquarePen, Trash2, Pill, X, ChevronDown } from 'lucide-react';
```

- [ ] **Step 2: Add the expand-tracking state and toggle function**

Find this exact block:

```ts
  const [meds, setMeds] = useState<Medication[]>(initialMeds);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [stockBusyId, setStockBusyId] = useState<number | null>(null);
```

Replace with:

```ts
  const [meds, setMeds] = useState<Medication[]>(initialMeds);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [stockBusyId, setStockBusyId] = useState<number | null>(null);

  // Tracks which medications' linked-composition line is expanded. A Set (not a single
  // id) so multiple cards can be open independently, not accordion-exclusive.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const toggleExpanded = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
```

- [ ] **Step 3: Restructure the linked-composition block**

Find this exact block:

```tsx
                      {med.linked_brand_name && (
                        <p className="text-[11px] text-muted-foreground/80 font-medium mt-1 truncate">
                          {med.linked_brand_name}{med.linked_composition ? ` — ${med.linked_composition}` : ''}
                          {med.linked_is_discontinued && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground align-middle">
                              Discontinued
                            </span>
                          )}
                          <span className="block text-[9px] text-muted-foreground/70 mt-0.5">
                            Patient-selected from catalog · as of {med.linked_snapshot_date}
                          </span>
                        </p>
                      )}
```

Replace with:

```tsx
                      {med.linked_brand_name && (
                        <div className="mt-1">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(med.id)}
                            className="flex items-center gap-1 text-left w-full cursor-pointer"
                          >
                            <span
                              className={`text-[11px] text-muted-foreground/80 font-medium flex-1 min-w-0 ${
                                expandedIds.has(med.id) ? '' : 'truncate'
                              }`}
                            >
                              {med.linked_brand_name}{med.linked_composition ? ` — ${med.linked_composition}` : ''}
                              {med.linked_is_discontinued && (
                                <span className="ml-1.5 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground align-middle">
                                  Discontinued
                                </span>
                              )}
                            </span>
                            <ChevronDown
                              className={`w-3.5 h-3.5 text-muted-foreground/60 shrink-0 transition-transform ${
                                expandedIds.has(med.id) ? 'rotate-180' : ''
                              }`}
                            />
                          </button>
                          {expandedIds.has(med.id) && med.linked_manufacturer && (
                            <p className="text-[9px] text-muted-foreground/70 mt-0.5">
                              Manufacturer: {med.linked_manufacturer}
                            </p>
                          )}
                          <span className="block text-[9px] text-muted-foreground/70 mt-0.5">
                            Patient-selected from catalog · as of {med.linked_snapshot_date}
                          </span>
                        </div>
                      )}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Manual verification in the browser**

Start the dev server, navigate to `/medications`, and for a medication with a catalog link:
- Confirm the collapsed card looks identical to before this change (truncated line, discontinued badge if applicable, "Patient-selected from catalog · as of ⟨date⟩" caption, chevron pointing down).
- Tap the composition line. Confirm: the text un-truncates (wraps if long), the chevron rotates 180°, and — if that medication has a `linked_manufacturer` value — a new "Manufacturer: ⟨name⟩" line appears between the composition and the "as of" caption.
- If two different medications both have catalog links, expand one and confirm the other stays collapsed (independent state, not accordion).
- Tap the composition line again on an expanded card and confirm it collapses back to the original truncated view.
- Confirm the action-button row (Add Stock / Pause / Edit / Delete) below is unaffected — no overlap, no layout shift beyond the card growing taller while expanded.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/medications/medication-list.tsx
git commit -m "$(cat <<'EOF'
feat(web): expand-in-place toggle on medication card composition line

Declutters the collapsed card (unchanged from today) while surfacing the
full composition text and the previously-unrendered linked_manufacturer
field one tap away. Local state only, no new query/column/permission.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Independent per-card expand/collapse (`Set<number>`, not a single id) → Task 1 Step 2. ✓
- Collapsed state pixel-identical to today (same truncation, badge, caption) → Task 1 Step 3 preserves every existing class/string, only adding the chevron. ✓
- Expanded state un-truncates and reveals `linked_manufacturer` only when present → Task 1 Step 3 (`{expandedIds.has(med.id) ? '' : 'truncate'}` and the manufacturer line's `&& med.linked_manufacturer` guard). ✓
- No new query/column/permission → confirmed no changes to either select statement or the `Medication` interface; `linked_manufacturer` already exists on both. ✓
- Care Circle view and Edit page's `MedicationCatalogLink` summary untouched → no task modifies either file. ✓
- Manual testing (no component-test framework in this codebase) → Task 1 Step 5, covering all behaviors from the spec's Testing section. ✓

**Placeholder scan:** No TBD/TODO; complete code in every step; exact commands with expected output. ✓

**Type consistency:** `expandedIds`/`toggleExpanded` are defined once (Step 2) and used only within the same file (Step 3) — no cross-file interface to drift. `med.linked_manufacturer` matches the `Medication` interface's existing field name exactly (`medication-list.tsx:34`). ✓
