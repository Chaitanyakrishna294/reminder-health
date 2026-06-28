# Re-MIND-eЯ — Design Brief & System Reference

> A complete, self-contained context document for design work. Paste this into Claude (or any
> design tool) to get help with UI/UX, mockups, new screens, or visual refinement. It captures the
> product, audience, brand, exact design tokens, components, every screen, and the signature
> interaction patterns as they exist today.

---

## 1. Product overview

**Re-MIND-eЯ** is a **medication reminder + caregiver coordination** app for patients (including
elderly users) and the family/caregivers who support them.

- **Surfaces that share one database:**
  - **Telegram bot** — sends dose reminders, escalations, and lets users respond (TAKEN/SKIP/SNOOZE).
  - **Web app (PWA)** — Next.js dashboard for patients and caregivers; installable on phones.
  - **Voice calls (scaffolded, not yet live)** — an automated reminder/confirmation call channel
    (Exotel IVR), monetized via a **Care+** subscription. Built behind `VOICE_CALLS_ENABLED`;
    see `docs/VOICE_CALLS_DESIGN.md`. v1 = patient daily confirmation call + caregiver miss-alert.
- **Backend:** Supabase (Postgres + Auth + Storage + RLS). Hosting: Vercel (web), separate host (bot).
- **Core jobs:** never miss a dose; let trusted caregivers help; keep an accurate medication record;
  hold emergency + medical info; track adherence.

**Brand name styling:** written as **Re-MIND-eЯ** (note the reversed "Я" and the brain logo between
"Re" and "eЯ"). The mascot and identity is a **friendly pink brain**.

---

## 2. Audience & design principles

- **Primary users are on mobile.** Design **mobile-first**; desktop is secondary.
- **Two user types:** **Patients** (some elderly, low tech confidence) and **Caregivers** (family,
  often managing one or more patients).
- **"Elderly mode"** is a global toggle (glasses icon in the navbar) that scales everything up —
  larger text, bigger touch targets, simplified dashboard. Every screen must work in both modes.
- **Tone:** calm, warm, reassuring, never clinical-cold or alarming. The brain mascot softens
  medical moments.
- **Accessibility matters:** large tap targets, clear contrast, screen-reader labels, reduced-motion
  support, never trap the user (e.g., emergency info always reachable).

---

## 3. Visual identity

### 3.1 Color palette (exact tokens — from `globals.css`, exposed as CSS vars + Tailwind colors)

| Token | Hex | Use |
|---|---|---|
| `--background` | `#F8F9FB` | App background (very light blue-gray) |
| `--foreground` | `#0F1C5A` | Primary text / ink (deep navy) |
| `--card` | `#FFFFFF` | Card surfaces |
| `--primary` | `#F26B8A` | **Mind Pink** — brand accent, primary buttons |
| `--primary-hover` | `#ED5276` | Pressed/hover pink |
| `--primary-soft` | `#FDEEF2` | Tinted pink surface (soft fills, gate background) |
| `--success` | `#34C759` | Taken / on-track (green) |
| `--warning` | `#FF9500` | Skipped / caution (orange) |
| `--danger` | `#FF3B30` | Missed / destructive (red) |
| `--muted` | `#EEF4FB` | Secondary background |
| `--muted-foreground` | `#64748B` | Muted/secondary text |
| `--accent-surface` | `#EAF3FF` | Accent surface (light blue) |
| `--border` | `rgba(15,23,42,0.07)` | Soft card borders |

- **Body background** has a whisper-subtle radial tint: pink (`rgba(242,107,138,0.05)`) top-right +
  blue (`rgba(91,141,239,0.05)`) top-left over `#F8F9FB`.
- **Dark mode:** a working **light/dark toggle** (Sun/Moon button in the navbar) is **live**. It's
  driven by a `.dark` class on `<html>` with a navy dark palette (`:root.dark`) plus a centralized
  compatibility layer that flips hardcoded light surfaces. The choice persists (localStorage) with a
  no-flash boot script; it defaults to the OS preference. **Light is still the primary design target.**

### 3.2 Typography

- **Sans (body):** Inter (`--font-sans`), weights 400–900.
- **Mono (headings/labels):** JetBrains Mono (`--font-mono`) — applied to all `h1–h6`, `.badge`,
  `.metric`, `.time-tag`, nav labels. Headings get slight negative letter-spacing.
- Lots of **tiny uppercase micro-labels** (`text-[10px] font-black uppercase tracking-wider`) for
  section eyebrows.

### 3.3 Layout tokens

- **Corner radius:** `--radius: 1.75rem` (28px). Cards use `rounded-3xl`; pills/buttons `rounded-xl`
  / `rounded-2xl`; avatars fully round.
- **Shadows:** navy-tinted, soft — `--shadow-sm/md/lg` (e.g. `0 18px 40px rgba(15,28,90,0.10)`).
- **Spacing rhythm:** generous; cards `p-6`, sections `space-y-8`.
- **Animations:** `animate-fade-in` (step transitions), a gentle float, red-glow for critical alerts,
  toast slide. All respect `prefers-reduced-motion`.

---

## 4. The brain mascot system

A friendly **pink brain** character is the emotional core of the UI. Assets live in
`web/public/mascot/` as transparent PNGs (~512px, optimized to ~10–23 KB each). A single reusable
`<BrainMascot mood="…" size={n}/>` component maps moods → images, with an inline-SVG brain as
fallback.

**8 moods (file → meaning → where used):**

| Mood (`reminder.png` etc.) | Feeling | Where |
|---|---|---|
| `reminder` | gentle nudge | dose gate (default) |
| `concerned` | worried/care | dose gate when overdue, dashboard hero when missed/escalated |
| `happy` | celebrates progress | dashboard hero when on track |
| `proud` | proud of consistency | dashboard hero when all caught up |
| `curious` | asking, helpful | guide/empty states |
| `encouraging` | cheering on | mid-progress |
| `sorry` | apologetic | "reminders too frequent", errors (planned) |
| `peaceful` | rest/recovery | calm/night states (planned) |

Plus **`point-left.png` / `point-right.png`** (pointing) and **`guider.png`** (used inside the guide
tour's message bubble).

---

## 5. Information architecture & navigation

- **Bottom nav (mobile) / left rail (desktop) — exactly 5 icons (keep it to 5):**
  Dashboard · Medications · Scheduler · Health Vault · Settings.
- **Secondary destinations live in the profile menu** (tap the avatar top-right): Medical Profile,
  Emergency Card, Sign Out. (Do NOT add a 6th nav icon — mobile dock space is limited.)
- **Top navbar:** brand logo (Re-MIND-eЯ + brain), notification bell, elderly-mode glasses toggle,
  profile avatar dropdown.

### Routes / screens

| Route | Purpose |
|---|---|
| `/dashboard` | Home: greeting + brain hero, Next/Missed medication card, compliance ring, Today's Schedule, caregiver console (for caregivers) |
| `/medications`, `/medications/new`, `/medications/[id]` | Med list (with stock + "+ Add" refill), add/edit med |
| `/schedule-planner` | Plan/visualize reminder times |
| `/health-vault` | Upload & preview medical documents (private storage, signed-URL preview) |
| `/medical-profile` | Medical identity card: photo, DOB/age, gender, blood group, height/weight/BMI, allergies, conditions, emergency contact, language/timezone; "share photo with caregivers" toggle |
| `/emergency` | One-tap high-contrast emergency card: name, blood group, allergies, emergency contact (tap-to-call), current meds. Red card. |
| `/care-circle`, `/care-circle/[patientId]`, `/care-circle/manage`, `/care-circle/requests` | Connect/manage caregivers & patients, per-patient view (gated medical card + meds + adherence), permission presets, accept/decline requests |
| `/settings` | Profile, **Connect Code** (universal sharable code), elderly-mode, **Care+ plan card** (Free-vs-Care+ + free trial), **Call Schedule** (voice reminder setup, gated behind Care+), linked caregivers, legal links, **Delete Account** danger zone |
| `/login`, `/register`, `/forgot-password`, `/update-password`, `/link-account` | Auth (Supabase) + Telegram linking; register has an 18+ & Terms/Privacy consent checkbox + optional Turnstile CAPTCHA |
| `/privacy`, `/terms` | Public legal pages |

---

## 6. Signature interaction patterns (the things that make it feel like Re-MIND-eЯ)

1. **Medication-due gate (brain-led).** When a patient opens the app and a dose is **due/overdue and
   unresolved**, a calm full-screen layer appears **before** the dashboard: soft pink→cream gradient,
   the brain mascot (reminder/concerned mood), "Did you take your <med>?", overdue time, and large
   buttons **Yes, I took it / No, skip this dose**, plus **"Not yet — remind me later"** (30-min
   snooze) and an always-available **Emergency card** link. It steps through all due doses, re-checks
   live, then reveals the dashboard. Never shown to caregivers viewing a patient.
2. **Guided spotlight tour (tap `?`).** A `?` button starts a step-by-step walkthrough: the page
   **lightly dims** with a pink **spotlight ring** on the target section (scrolled into view), and a
   **message bubble with the guider brain inside it** explains each step (Back/Next/Done/Skip,
   progress dots). Falls back to a centered card if a target can't be cleanly highlighted (mobile).
   Registry-driven (`guide-content.ts`) so any section can add a tour.
3. **Dose correction.** On a resolved dose in Today's Schedule, a small **"Change"** link flips
   Taken↔Skipped (same-day only); stock auto-adjusts.
4. **Elderly mode.** Global scale-up of type/targets and a simplified dashboard.
5. **(Planned) mascot confirmation dialogs** for destructive actions (delete medication, disconnect
   caregiver, delete account) — concerned/sorry brain explaining the consequence.

---

## 7. Component inventory (current building blocks)

- **Cards:** white, `rounded-3xl`, soft navy-tinted shadow, `p-6`. Severity-tinted variants (danger
  border for missed, etc.).
- **Buttons:** primary = pink fill, white text, `rounded-xl/2xl`, hover-darken + active-scale.
  Secondary = white/muted with border. Destructive = danger fill or danger-soft.
- **Badges/pills:** small uppercase mono, tinted by status (success/warning/danger/primary).
- **Status badges:** Taken (green/check), Skipped (orange/skip), Missed (red), Snoozed (primary).
- **Take / Skip buttons** for resolving a dose. *(The older slide-to-confirm knob was removed — it's
  now standard buttons. In the Scheduler, dragging a dose opens a confirmation popup to reschedule it.)*
- **Theme toggle** (Sun/Moon) and **Elderly-mode toggle** (glasses) in the navbar.
- **Care+ card** — Free-vs-Care+ comparison + "Start 7-day free trial" (the voice-feature paywall).
- **Compliance ring** (circular progress).
- **Toasts** (premium slide-up), **notification center** (bell dropdown with per-item delete).
- **Avatars:** profile photo (signed URL) or initials circle; brain mascot accents.
- **Cookie-consent banner**, **install (PWA) prompt** banner that collapses to a small icon.

---

## 8. Content & voice

- Warm, plain language; sentence case (avoid ALL CAPS except tiny eyebrow labels).
- Reassuring, not scolding ("Attention: you have missed doses" → kept gentle; mascot softens it).
- Short, scannable. Medical terms only where needed.

---

## 9. Constraints & notes for design

- **Mobile-first, 5-icon nav, elderly mode** are hard constraints (see §2, §5).
- **Light + dark themes** both ship (navbar Sun/Moon toggle); design for both, light is the default.
- **Health data is sensitive** — emergency info must always be reachable; don't design flows that
  fully trap the user.
- **Tailwind v4** with CSS variables; use the tokens in §3 rather than arbitrary hex.
- **Tech stack for context:** Next.js (App Router) + React 19 + Tailwind v4 + Supabase. Icons:
  `lucide-react`. Fonts via `next/font` (Inter + JetBrains Mono).

---

## 10. What I'd like design help with

(Use this section to tell Claude your goal — e.g. "redesign the dashboard," "design a dark theme,"
"new onboarding," "improve the medications list," "polish the emergency card.") Keep the palette,
mascot, mobile-first, and 5-icon-nav constraints above unless you explicitly decide to change them.
