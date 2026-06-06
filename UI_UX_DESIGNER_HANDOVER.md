# Re-MIND-eЯ: UI/UX Designer & Claude Handover Specification

Welcome to the **Re-MIND-eЯ** design specification. This document outlines the project architecture, database models, current styling tokens, user workflows, and accessibility guidelines (Normal vs. Elderly Mode) to help you enhance the user interface and user experience.

---

## 🚀 1. Project Overview & Product Philosophy

Re-MIND-eЯ is a hybrid medication manager and adherence tracking system comprising:
1. **Telegram Bot**: Operates as the patient's scheduler. It sends alerts, handles retries, snoozes, and alerts caregivers if a patient misses a dose.
2. **Next.js Web Portal**: Acts as the dashboard. Patients manage their medication catalog, and caregivers can monitor patient adherence rates, track stock levels, and resolve escalated alarms.

### Core UX Objectives:
*   **Trust and Reliability**: Clean visual cues indicating active monitoring states.
*   **Split-Role Experience**: Patients need ease of logging and inventory checks. Caregivers need quick analytical overviews and alert call-outs.
*   **Seamless Onboarding**: Simple linking between web profiles and Telegram chats.
*   **Accessibility**: A two-click option to switch the entire application into a simplified, high-contrast, large-font dashboard for elderly patients.

---

## 💻 2. Technology Stack & Directory Map

*   **Framework**: Next.js 15 (App Router, React 19, TypeScript)
*   **Styling**: Tailwind CSS v4 (configured via native CSS variables `@theme inline`)
*   **Database & Auth**: Supabase (PostgreSQL, Row-Level Security, Realtime WebSockets)
*   **Charts**: Recharts (fully responsive SVGs)
*   **Time Handling**: Timezones (reconciles client local time with server UTC & Asia/Kolkata schedules)

### File Structure Map:
```
/ (Root Directory)
├── index.js                     # Telegram Bot entry server & Cron Schedulers
├── setup_db.sql                 # SQL Migrations (tables, triggers, RLS policies)
├── src/
│   ├── bot.js                   # Telegram Bot Engine initialization
│   ├── commands.js              # Command handlers (e.g. /linkweb, /start)
│   ├── scheduler.js             # Minute checks, retry logic, missed dose logs
│   └── utils.js                 # Calculations (calculateNextReminder in IST)
└── web/                         # Next.js 15 Web Application
    ├── src/
    │   ├── app/                 # Page layouts and route segments
    │   │   ├── (auth)/          # protected auth views (/login, /register)
    │   │   ├── (dashboard)/     # main dashboard views (/dashboard, /medications)
    │   │   ├── globals.css      # Core styles & Tailwind v4 Theme Variables
    │   │   └── layout.tsx       # Root layout containing the global UI Mode Context
    │   ├── components/          # React components
    │   │   ├── dashboard/       # dashboard client views, checklists, and charts
    │   │   ├── layout/          # navbar and wrapper layouts
    │   │   ├── medications/     # medication lists and creation forms
    │   │   └── shared/          # realtime notifications bell
    │   ├── context/
    │   │   └── ui-mode-context.tsx # Global Normal vs. Elderly Mode state manager
    │   └── lib/
    │       └── supabase/        # Browser and Server DB clients
```

---

## 🗄️ 3. Database Schema Guide

Here are the key PostgreSQL tables that feed the UI. All tables enforce RLS (Row-Level Security) to ensure users only access their own records (or linked patients).

```mermaid
erDiagram
    profiles ||--o| medications : "owns"
    profiles ||--o| notifications : "receives"
    medications ||--o| reminder_events : "generates"
    medications ||--o| reminder_logs : "records"
    caregiver_info }|--|| profiles : "links patients & caregivers"

    profiles {
        uuid id PK "matches auth.users"
        text role "PATIENT | CAREGIVER"
        text full_name
        text telegram_chat_id UNIQUE "links web profile to bot chat"
    }
    
    medications {
        bigint id PK
        text telegram_id FK "matches patient profile"
        text drug_name
        text dosage "e.g. 500mg, 1 tablet"
        text frequency "once_daily | twice_daily | thrice_daily"
        text_array reminder_times "e.g. ['08:00', '20:00'] in HH:MM format"
        integer tablet_count "stock tracking"
        text priority_level "normal | important | critical"
        timestamptz next_reminder_at
        boolean active "allows pausing routines"
    }

    reminder_events {
        bigint id PK
        bigint medication_id FK
        text telegram_id
        timestamptz scheduled_for
        text reminder_status "PENDING_PATIENT | TAKEN | SKIPPED | MISSED | ESCALATED_TO_CG"
        timestamptz escalated_at
        timestamptz resolved_at
        text resolved_by "PATIENT | CAREGIVER | SYSTEM"
    }

    reminder_logs {
        bigint id PK
        text telegram_id
        bigint medication_id FK
        timestamptz scheduled_time
        text response "TAKEN | SKIP | MISSED"
        integer delay_minutes "minutes elapsed between schedule and action"
    }

    notifications {
        uuid id PK
        uuid user_id FK "recipient profile"
        text title
        text message
        text type "TAKEN | SKIPPED | MISSED | ESCALATED"
        boolean is_read
    }
```

---

## 🎨 4. Design System & Theme Variables

Tailwind CSS v4 variables are configured in `globals.css`. The color system uses a modern, calming **Healthcare SaaS** palette:

*   **Primary (Blue)**: Represents healthcare security, cleanliness, and focus.
*   **Success (Green)**: Represents taken doses and good compliance.
*   **Warning (Amber)**: Represents skipped doses or low stock levels.
*   **Danger (Red)**: Represents missed doses or critical alarms.

### Core Variables (`:root`):
```css
:root {
  --background: #f8fafc;        /* Soft slate background */
  --foreground: #0f172a;        /* Deep slate text */
  --card: #ffffff;
  --border: #e2e8f0;
  
  --primary: #2563eb;           /* Brand Blue */
  --success: #22c55e;           /* Compliance Green */
  --warning: #f59e0b;           /* Warning Amber */
  --danger: #ef4444;            /* Alarm Red */
  
  --radius: 0.5rem;
}
```

---

## 👵 5. Normal Mode vs. Elderly Mode UX Matrix

To toggle modes, patients click **`👵 Elderly Mode`** in the Navbar. Here is the matrix comparing how pages behave under each setting:

| Page / Element | Normal Mode (SaaS Dashboard) | Elderly Mode (Large Print Accessibility) |
| :--- | :--- | :--- |
| **Grid Column Count** | 2-column or 3-column layouts to optimize spacing. | 1-column layouts only to encourage linear scanning. |
| **Typography Sizing** | Standard body text (`text-sm`/`text-base`). | Scaled up text (`text-xl`/`text-3xl`/`text-4xl`), bolding, and high contrast. |
| **Checklist Actions** | Compact inline buttons for "Mark Taken" & "Mark Skip". | Giant block buttons (`h-20`, font size `2xl`) for shaky fingers to prevent misclicks. |
| **Analytics & Data** | Recharts area/bar charts displaying 7-day adherence. | Hidden charts; replaced with a giant **Progress Bar** ("2 of 3 taken"). |
| **Stock Warnings** | Small indicator values in a KPI card. | Large, highlighted soft-colored alert banners detailing exact refill notifications. |
| **Menu Navigation** | Sleek left sidebar (`w-64`). | Wider layout sidebar (`w-80`) with massive icon/text buttons. |

---

## 🎯 6. UX Enhancements & Design Challenges for You

Here are the key areas where you can provide enhancements:

### 1. The Onboarding On-Screen Linking Screen (`/link-account`)
*   **Current State**: Form requesting users to type `RMDR-XXXXXX` from the bot.
*   **Enhancement Area**: Design a gorgeous step-by-step graphic illustrating where to find the code in Telegram, adding animations, or displaying a QR code link to trigger the command instantly.

### 2. Form Ergonomics (`/medications/new` and `/medications/[id]`)
*   **Current State**: Basic text inputs and select elements.
*   **Enhancement Area**: Design custom frequency picker selectors (e.g. interactive card toggles with visual symbols instead of dropdown options) and customized time pickers (wheels or large analog/digital visualizers) to simplify setup.

### 3. Realtime Alerts & Visual Feedback
*   **Current State**: Simple unread count badge in Navbar bell dropdown.
*   **Enhancement Area**: Animate the bell icon shake on receiving new notifications. Create beautiful, non-intrusive toast notifications when state changes occur (e.g. a caregiver receives a toast: *"Chaitanya has taken Dolo 650mg."*).

### 4. Interactive Compliance gamification
*   **Current State**: Progress bars and basic chart logs.
*   **Enhancement Area**: Design gorgeous "Streak counters" (e.g., "5 days in a row!") or celebratory reward screens (confetti triggers) when all daily doses are checked off.

### 5. Caregiver Alarm Portal
*   **Current State**: Simple alarms counter on dashboard.
*   **Enhancement Area**: Designing a highly visible critical alert console overlay for caregivers during active patient escalations, displaying contact hotlinks (e.g. Call Patient, Call Emergency, Check Location) to streamline care loops.
