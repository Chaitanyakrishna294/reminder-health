# Deployment Guide

This document covers deployment steps, service components, configuration, and environment variables required to run Re-MIND-eЯ.

---

## 1. Required Environment Variables

Deployments must configure environment variables for the root backend process and the Next.js web application.

### Root Backend (Telegram Bot & Scheduler Worker)
Create a `.env` file in the root directory:
```env
# Server Port Configuration
PORT=3000

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Supabase Configuration
SUPABASE_URL=https://your_project_ref.supabase.co
SUPABASE_KEY=your_supabase_service_role_key

# Web Push Notifications (VAPID)
VAPID_SUBJECT=mailto:your_email@example.com
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key
```

### Frontend Web App (Next.js)
Create a `.env.local` file inside the `web/` directory:
```env
# Supabase Public Keys
NEXT_PUBLIC_SUPABASE_URL=https://your_project_ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Supabase Server Key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Web Push Notification Public Key
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_vapid_public_key
```

---

## 2. Frontend Deployment (Vercel)

The web application is built with Next.js and is optimized for hosting on **Vercel**.

1. **Prerequisites**: Ensure you have the Vercel CLI installed or connect your repository to Vercel.
2. **Build Settings**:
   - **Framework Preset**: Next.js
   - **Root Directory**: `web`
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`
3. **Environment Variables**: Configure the four frontend keys in the Vercel project settings.

---

## 3. Backend Setup (Supabase)

Re-MIND-eЯ utilizes Supabase for database management, user authentication, and real-time database state replication.

1. **Authentication**: Enable GoTrue authentication provider paths (Email/Password).
2. **Database Schema**: Execute SQL migrations in the Supabase SQL editor in chronological order:
   - Initial layout setup.
   - Core trust center migrations (`migration_5.6d_trust_center.sql`).
   - Adherence status migrations (`migration_5.7b_escalation_outcomes_ddl.sql`).
   - Corrective migrations (`migration_carecircle_rca_fixes.sql`).
3. **Row-Level Security (RLS)**: Ensure RLS is enabled on all tables. Policies use security definer functions to validate relationships inside `caregiver_connections`.

---

## 4. Scheduler (Cron & Node Workers)

The background worker manages routine tasks such as checking for due reminders, processing escalations, and compiling adherence summaries.

- **Execution**: The scheduler is run by executing:
  ```bash
  node src/scheduler.js
  ```
- **Intervals**:
  - `* * * * *` (Every minute): Run `scan_and_escalate_overdue_reminders` and check for due active medications.
  - `0 7 * * *` (Daily at 7:00 AM): Send Morning Patient Summaries.
  - `0 9 * * *` (Daily at 9:00 AM): Send Low-Stock Alerts.
  - `30 21 * * *` (Daily at 9:30 PM): Send Daily Caregiver Summaries.
  - `0 20 * * 0` (Weekly on Sundays at 8:00 PM): Send Weekly Health Summaries.
- **Process Manager**: Use a manager like `pm2` to keep the scheduler process alive continuously:
  ```bash
  pm2 start src/scheduler.js --name "remind-scheduler"
  ```

---

## 5. Telegram Bot Setup

The Telegram bot provides quick confirmation actions and onboarding interfaces.

1. **Bot Registration**: Talk to **@BotFather** on Telegram to create a new bot and obtain a `TELEGRAM_BOT_TOKEN`.
2. **Polling Mode (Local/Worker)**: Start the bot polling server:
   - Command: `node index.js`
   - Process manager: `pm2 start index.js --name "remind-bot"`
3. **Webhook URL (Production alternative)**:
   - If deploying serverless, configure a webhook endpoint targeting your API route, passing requests to the bot callback handler using:
     ```
     https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-domain.com/api/telegram-webhook
     ```
