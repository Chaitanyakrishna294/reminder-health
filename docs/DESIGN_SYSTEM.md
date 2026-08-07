# DESIGN SYSTEM — colour meaning, vocabulary, shared components

> Written 2026-08-06 during the UX audit remediation pass. This file exists because the
> app's screens were built independently: the same concept (a priority level, a care
> relationship, an empty state, an alert colour) was expressed differently on each screen,
> and fixing them one screen at a time would just let them drift apart again.
>
> **The rule this file enforces: no new hex literals in components.** If you are reaching
> for a colour, it means something — find that meaning below and use its token.

Source of truth in code:
- `web/src/lib/design/semantics.ts` — meaning → tone, and the canonical labels
- `web/src/lib/severity-theme.ts` — tone → Tailwind classes
- `web/src/app/globals.css` — tone → CSS custom properties
- `web/src/components/ui/` — the shared primitives

---

## 1. Colour → meaning

Each colour means exactly one thing. If you want a colour for a reason not on this list,
the answer is `neutral`.

| Tone | Token | Means | Never use for |
|---|---|---|---|
| `danger` | `--danger` | Destructive action, missed dose, critical priority | Neutral empty states, trust messaging |
| `warning` | `--warning` | Actionable warning — low stock, skipped dose, important priority | A past day with nothing scheduled (that is `neutral`) |
| `success` | `--success` | Taken, on track, safe, routine priority | — |
| `info` | `--info` | Informational, trust, security, "how this works", snoozed | Anything the user must act on |
| `primary` | `--primary` (pink) | Brand, and the **one** primary CTA per screen | Priority levels, chart bands, status |
| `neutral` | `--muted` / `--muted-foreground` | Nothing has happened here yet | Anything that is actually a problem |

Two consequences worth stating outright, because both were violated before:

- **Pink is not a status colour.** It was simultaneously the brand, the primary CTA, the
  "routine" priority dot, and the Evening band on the schedule chart. On the planner, a
  pink dot could mean three different things at once.
- **Orange is not "no data".** Past days with nothing logged were rendered the same as
  missed doses. A day you had no medication is not a day you failed.

### Solid primary buttons use `--primary-strong`, not `--primary`

White on Mind Pink `#F26B8A` is **2.9:1** — every primary CTA in the app failed the 4.5:1
floor. `--primary-strong` (`#CC3D64` light / `#F583A0` with navy ink in dark) is the same
hue taken to 4.75:1, and it is used **only for solid button fills**:

```
bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover
```

`--primary` keeps every decorative use — tints (`bg-primary/10`), borders, `text-primary`
on a light surface, icons, focus rings, the logo. The brand colour did not change; only
the surface that has to carry white text did.

### Text on tinted surfaces

`--warning-foreground`, `--danger-foreground` and `--success-foreground` are **white**.
They are correct on a solid fill (`bg-warning`) and invisible on a tint (`bg-warning/10`).
That mistake is what made the dashboard's "Refill recommended for:" row unreadable.

For any text on a tinted status surface use the `-strong` variants, which clear 4.5:1
there in both themes:

| Use | Class |
|---|---|
| Text on `bg-warning/10` | `text-warning-strong` |
| Text on `bg-danger/10` | `text-danger-strong` |
| Text on `bg-success/10` | `text-success-strong` |
| Text on `bg-info/5` | `text-info-strong` |

`getToneTheme(tone).text` gives you the right one without thinking about it.

Same trap on **solid** status fills: white on `--danger` (`#FF3B30`, iOS system red) is
only 3.55:1. Solid danger buttons use `bg-danger-strong text-card` — `--danger-strong`
darkens in light mode and lightens in dark, `--card` does the opposite, so the pair clears
7:1 in both. `getToneTheme('danger').solid` already returns it.

Same trap again on `text-primary` used as *readable text* rather than as an icon: pink on
a light card is 2.9:1. A code the user has to read, a selected option's label, a link —
those take `text-primary-strong`. Icons, dots and decorative accents keep `text-primary`.

### Colour is never the only signal

This app's audience includes older adults, for whom age-related colour-vision change
(blues desaturating in particular) is common. Every status that is encoded as colour must
also carry a word or an icon — `doseLabel()` in `semantics.ts` exists for exactly this,
and the weekly-ring chart on the dashboard carries a text legend for the same reason.

---

## 2. Vocabulary

One word per concept, used verbatim. These live in `semantics.ts`; import them rather
than typing the string.

### Medication priority — `PRIORITY`

DB values stay lowercase `normal | important | critical` (`medications.priority_level`).
Only the **labels** are fixed here.

| DB value | Label | Tone |
|---|---|---|
| `normal` | **Routine** | `success` |
| `important` | **Important** | `warning` |
| `critical` | **Critical** | `danger` |

"Routine", not "Normal": the app already uses "Normal" for the non-elderly view mode
("Switch to Normal view"), and a settings word and a clinical-urgency word should not be
the same word.

### Care relationships — `CARE_LABELS`

| Key | Label | Meaning |
|---|---|---|
| `asPatient` | **People Caring For Me** | The user is the patient |
| `asCaregiver` | **People I Care For** | The user is the caregiver |

**Order: patient-side first, everywhere.** It is the relationship every user has.
Previously Settings said "People Who Care For Me" and listed the two the other way round
from Care Circle, so "am I the patient or the caregiver on this screen" needed working out.

### Where these live

- `/care-circle` is **canonical** for care relationships: the lists, accepting requests,
  disconnecting, and entering monitor mode. `components/care-circle/connection-actions.tsx`
  owns those mutations, including the legacy `caregiver_info` branches.
- `/settings` holds **identity only** — your connect code, your caregiver ID, the field for
  entering someone else's code — and links out.

---

## 3. Shared primitives (`web/src/components/ui/`)

Each reads `isElderly` from `useUiMode()` internally, so call sites stop hand-branching.

| Component | Use it for | Notes |
|---|---|---|
| `Button` / `buttonClasses()` / `IconButton` | Any button | `buttonClasses()` for `<Link>`. Every size ≥44×44px |
| `Badge` / `CountBadge` | Status pills, counters | `CountBadge` renders nothing at 0 |
| `EmptyState` | "Nothing here yet" | Icon tone defaults to `neutral` — never a warning shape |
| `Eyebrow` | Small-caps label above a value | One scale, app-wide |

### Button variants

| Variant | For |
|---|---|
| `primary` | The **one** main action on the screen |
| `secondary` | Everything else that is a real action |
| `ghost` | Low-emphasis / inline |
| `danger` | **Irreversible only** — deleting an account, not signing out |
| `danger-ghost` | Destructive but recoverable (delete one medication) |

If two things on a screen are solid pink, neither reads as the main action. If Sign Out
and Delete Account look the same — which they did, class for class — the tap you cannot
take back looks as safe as the one you can.

### Touch targets

44×44px minimum, and more spacing where a destructive control sits next to a routine one.
The medication list's four action icons were 36px circles in a row, one of which deleted
the medication; the schedule planner's per-dose controls were 24px **and** hover-only,
i.e. unreachable on a phone.

---

## 4. Layout: the floating dock

The mobile nav is a floating pill (`bottom-6` + 72px tall, 96px in elderly mode), not a
docked bar, so it does **not** take space in the flow. Two things follow:

1. `<main>` in `dashboard-main-layout.tsx` owns the clearance
   (`pb-[calc(7.5rem+env(safe-area-inset-bottom))]`). Pages must not add their own — that
   just double-pads.
2. `env(safe-area-inset-*)` only resolves because `app/layout.tsx` exports
   `viewport = { viewportFit: 'cover' }`. Removing that silently zeroes every inset.

Floating overlays rendered from the **root** layout (install FAB/banner, toasts) know
nothing about the dock. They use the `.floating-bottom` class in `globals.css`, which uses
`:has(nav[data-tour="dash-nav"])` to lift itself only on pages where the dock exists.
