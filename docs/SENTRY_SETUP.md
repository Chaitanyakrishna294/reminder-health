# Sentry setup (M3)

Crash reporting is **wired but switched off**. No DSN is configured, so the SDK
never initialises, nothing is sent, no build step is added, and the app behaves
and costs exactly as it did before. Everything below is what turns it on.

Nothing here is required for the app to work. If you never do it, the only thing
you lose is the ability to see *why* something failed on someone else's phone.

---

## 1. Create the projects (free tier)

Sentry's Developer plan is free and covers 5k errors/month, which is far more
than this app will produce. Create **two** projects in the same org so web and
native errors stay separable:

| Project | Platform |
| --- | --- |
| `reminder-health-web` | Next.js |
| `reminder-health-android` | Android |

Each gives you a **DSN** — a URL like `https://abc123@o456.ingest.sentry.io/789`.
A DSN is **not a secret**: it is write-only, public by design, and safe to ship in
the APK and the JS bundle. (This matters because CLAUDE.md forbids shipping
secrets — the DSN does not count, the same way the Supabase anon key does not.)

## 2. Web

Add to Vercel (Project → Settings → Environment Variables) **and** to
`web/.env.local` for local development:

```
NEXT_PUBLIC_SENTRY_DSN=https://…ingest.sentry.io/…
```

That alone turns it on. Two optional extras:

- `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` — defaults to `0` (errors only).
  Leave it there unless you want performance data; tracing multiplies event
  volume and is the usual way a free tier gets exhausted.
- `SENTRY_AUTH_TOKEN` — enables source-map upload at build time, which turns
  minified stack traces into readable ones. Without it the build still succeeds
  and errors still group correctly; the frames are just minified.

Redeploy after setting it: `next.config.ts` only applies the Sentry build plugin
when the DSN is present, so the variable has to exist **at build time**, not just
at runtime.

## 3. Android

Add the DSN as a string resource. Create
`android-app/android/app/src/main/res/values/sentry.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="sentry_dsn">https://…ingest.sentry.io/…</string>
</resources>
```

`Crash.init()` looks that resource up by name and does nothing if it is absent.

**Do not commit that file if you would rather keep the DSN out of the repo** — it
is not a secret, but it is also not useful to anyone else. Add it to
`.gitignore` and keep a copy with the keystore backup.

---

## What is deliberately NOT enabled

These are decisions, not omissions. This app handles medication names, dose
times, adherence history and care-circle relationships for named people, and a
crash reporter is a pipe to a third party.

- **Session Replay** (web and native). It records the screen; on this app that
  screen is a list of someone's medications. There is no masking setting that
  makes filming a patient's dose schedule an acceptable default.
- **`sendDefaultPii`.** Off explicitly on both sides, so a future SDK changing
  its default cannot quietly turn it on.
- **Native breadcrumbs** (`maxBreadcrumbs = 0`). The alarm core logs drug names
  to logcat on purpose, for on-device debugging. Breadcrumbs would sweep those
  straight into events.
- **The web tunnel option**, which would route Sentry traffic through this app's
  own domain to dodge ad blockers. It would make the app a proxy for third-party
  traffic — a poor trade on a health app.
- **User identity beyond an opaque id.** `beforeSend` reduces `event.user` to
  `id` only. That is enough to tell "one user hit this 40 times" from "40 users
  hit it once", which is the only thing user context is needed for here.

Also scrubbed on the web: query strings (they carry ids), cookies, request
bodies, all headers except `user-agent`, and console breadcrumb text.

**The honest limit:** an exception *message* can still contain data if the code
put it there — `Failed to save "Telmikind"`. No `beforeSend` regex reliably
catches that. The real defence is not writing patient data into error strings,
which is why `Crash.report()` on the native side takes a **medication id rather
than a name**. Keep that habit when adding new reports.

---

## Verifying it works

Web: temporarily throw in a page, load it, and confirm the issue appears with a
scrubbed URL and no cookies.

Native: `Crash.report("test event", 1L)` from anywhere, or force an exception in
the alarm path. Look for `Sentry initialised for the native alarm core` in
logcat — if you instead see `Sentry not configured`, the string resource is not
being found.

## What already reports itself

Two silent failures were wired up because they are invisible otherwise:

- **`calculateNextReminder` failing** for a medication — that row then gets no
  alarm ever again and says nothing about it.
- **Dose actions stranded** after exhausting their retries — a patient's
  recorded "I took it" that will never reach the server.

Both send an id and an error, never a drug name.
