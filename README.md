# Re-MIND-eЯ 💊 (V.o1)

Re-MIND-eЯ is a Telegram-based healthcare reminder bot developed as Version 1 (MVP) to help users remember and track their medications easily.

The project mainly focuses on elderly and non-technical users by providing a simple, button-based medication reminder system through Telegram.

This version includes:

* medication reminders
* adherence tracking
* tablet stock management
* refill alerts
* simple user-friendly interaction

---

# Features in Version 1

* Add medications
* Daily medicine reminders
* Multiple reminder timings
* Medication adherence tracking
* Tablet stock tracking
* Low stock refill alerts
* Snooze reminders
* Skip reminders
* Elderly-friendly button interface
* Medication logs
* Adherence statistics

---

# Technologies Used

## Backend

* Node.js
* Express.js
* dotenv

## Telegram Bot

* node-telegram-bot-api

## Database

* Supabase PostgreSQL
* @supabase/supabase-js

## Scheduler

* node-cron

## Hosting

* Render Free Tier

---

# Project Structure

```bash id="9xwghp"
reminder-health-bot/
│
├── index.js
├── package.json
├── package-lock.json
├── .env
├── .env.example
├── .gitignore
│
└── src/
    ├── bot.js
    ├── commands.js
    ├── scheduler.js
    ├── db.js
    ├── constants.js
    ├── utils.js
```

---

# Environment Variables

Create a `.env` file and add:

```env id="c4kq6u"
TELEGRAM_BOT_TOKEN=your_bot_token
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
PORT=3000
```

---

# Installation

## Clone Repository

```bash id="kk67qg"
git clone https://github.com/yourusername/reminder-health-bot.git
```

## Navigate to Project Folder

```bash id="qon30k"
cd reminder-health-bot
```

## Install Dependencies

```bash id="bndu3m"
npm install
```

## Run the Project

```bash id="rkl31y"
node index.js
```

---

# Telegram Commands

```txt id="m2t8jh"
/start   - Start the bot
/addmed  - Add medication
/mylog   - View medication logs
/stats   - View adherence statistics
```

---

# Database Tables

## medications

Stores:

* medicine name
* dosage
* reminder timings
* tablet count
* next reminder time

## reminder_logs

Stores:

* reminder responses
* medication history
* adherence logs

---

# Reminder Workflow

1. Scheduler runs every minute
2. Checks due reminders
3. Sends reminder notification
4. User selects:

   * ✅ TAKEN
   * ⏰ Snooze
   * ⏭ SKIP
5. Logs are saved in database
6. Next reminder is updated automatically

---

# Low Stock Alert

When tablet count becomes low, the bot sends a refill alert.

Example:

```txt id="40tws7"
⚠️ Your medication stock is running low.
Only 5 tablets remaining.
```

---

# Deployment

The project is deployed using Render Free Tier.

## Render Settings

Build Command:

```bash id="g79dzu"
npm install
```

Start Command:

```bash id="x1zglk"
node index.js
```

---

# Important Notes

* `.env` file should never be uploaded to GitHub
* Use `.gitignore` to protect secret keys
* UptimeRobot is recommended to keep Render awake

---

# Future Improvements (Version 2)

* Caregiver monitoring
* Missed dose detection
* Daily adherence reports
* Web dashboard
* Advanced analytics
* Notification improvements

---

# Conclusion

Re-MIND-eЯ Version 1 is a beginner-friendly healthcare reminder system designed to improve medication adherence using a simple Telegram-based interface for elderly and non-technical users.
