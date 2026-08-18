# reminder-health

Medication-reminder system for Indian patients + caregivers. Three surfaces, one Supabase Postgres:
Telegram bot + schedulers (`index.js`, `src/`, Render, service_role), Next.js 16 web PWA
(`web/`, Vercel, anon key + RLS), and SQL state machines (`db/migrations/`, applied manually).

**Before searching the repo, read [docs/WORK_LEDGER.md](docs/WORK_LEDGER.md)** — the canonical map:
file/route/table/RPC inventory, "how to add X" recipes, env vars, known landmines, and which docs
are stale. Keep it updated when you add or move anything.

## Hard rules
- **Migrations are applied manually** by the maintainer in the Supabase SQL editor. Never attempt to apply one; just write `db/migrations/migration_<slug>.sql` (+ rollback/validation when warranted).
- **Every new RPC starts locked: `REVOKE ALL … FROM PUBLIC` *and* `REVOKE ALL … FROM anon`,
  then grant only the roles that actually call it.** Start from
  `db/migrations/_TEMPLATE_new_rpc.sql`, which carries the footer and the reasoning.
  **Both revokes, always** — a role holds EXECUTE two different ways and each needs its own:
  a NULL `proacl` means Postgres's default of EXECUTE to PUBLIC (and every role is PUBLIC),
  while Supabase's `ALTER DEFAULT PRIVILEGES` adds a *direct* grant to `anon` on new
  functions. `REVOKE … FROM anon` cannot touch PUBLIC-derived access and **raises no error
  when it fails to** — that silent no-op is why the 2026-07 sweep left functions open while
  reporting success, and why `correct_reminder_event` still validated `anon = true` on
  2026-08-13 after passing through both that sweep and a `REVOKE … FROM PUBLIC`.
  This matters more here than in most projects: **anon is the key shipped inside the APK**,
  which anyone can unpack, so anon's reach is the product's worst case. Validations must
  assert `NOT has_function_privilege('anon', …)` **and** that `proacl` is not NULL.
  - **THE RULE GENERALISES PAST anon — it is really THREE revokes.** Supabase's
    `ALTER DEFAULT PRIVILEGES` grants to `anon`, `authenticated` **and
    `service_role`**, so **writing no GRANT does not mean no grant for any of
    them**. Revoke all three, then grant back only what actually calls the
    function. Paid for 2026-08-14: `resend_caregiver_request` shipped with a
    footer literally commenting "no service_role grant" above an ACL reading
    `service_role=X/postgres`. Milder than the anon case — service_role is
    server-side and bypasses RLS anyway — but a privilege footer that describes
    an ACL the database does not have is worse than no footer, and the same
    blind spot with `anon` in it is a leak. Validations should assert
    `NOT has_function_privilege('service_role', …)` whenever it is not a caller;
    that check is what caught this.
- **IF AN RLS POLICY CALLS A FUNCTION, THE CALLER NEEDS EXECUTE ON IT — `SECURITY DEFINER`
  does not waive that.** A policy expression is evaluated with the privileges of the role
  running the query; there is no system exemption. DEFINER governs which role the *body*
  runs as, and that is checked **after** the EXECUTE privilege, not instead of it. Being
  definer is precisely what makes it feel like the rule shouldn't apply.
  - Paid for 2026-08-13: `vault_can_accept_upload()` was granted to nobody "because the
    policy evaluates it, not the client", and **every authenticated Health Vault upload
    failed** with `permission denied for function`. Fixed by
    `migration_vault_can_accept_grant_2026_08_13.sql`. The counter-example was in the same
    policy — `is_anonymous_user()`, one conjunct earlier, carries a grant and evaluated fine.
  - **This one fails CLOSED**, which is the opposite of the missing-revoke bug above: loud,
    immediate, caught by the first real call. Both are privilege-doctrine mistakes; one costs
    a leak, this one costs an outage. Neither is caught by reading the function.
  - So a policy-referenced function is granted to every role that performs the guarded
    operation (usually `authenticated`), and **the validation asserts it generically** — read
    the names out of `pg_get_expr(polwithcheck, polrelid)` and check
    `has_function_privilege('authenticated', …)` for each, so a conjunct added later is
    covered without editing the check. Pattern: `validation_vault_upload_limits_2026_08_13.sql`
    check 13.
- **THE BROWSER UPLOADS STRAIGHT TO SUPABASE STORAGE — so a form check is never a limit.**
  The Health Vault and the avatar picker both call the Storage API from the client with the
  anon key. Our Next.js server is not in that path at all, which means every size, type and
  quota check written in a component is *advice to whoever chooses to use our form*, and the
  person worth defending against is exactly the one who does not. **The only real places to
  refuse are `storage.buckets.file_size_limit` / `.allowed_mime_types` and the RLS policy on
  `storage.objects`.** Anything new that accepts a file gets its ceiling there first, and the
  UI copy second.
  - **Vault quota, set 2026-08-13** (`migration_vault_upload_limits_2026_08_13.sql`):
    **5 files per user, 5 MB per file, images + PDF only.** Counted as **storage objects, not
    `health_records` rows** — a direct API upload creates an object and no row, so a row count
    would sit at zero while the bucket filled.
  - **Trash occupies a slot until it is purged**, and the UI says so. A soft delete keeps the
    object in the bucket so Restore can work; `cleanup_expired_trash` removes it at 30 days.
    Since the limit counts objects, a trashed file is still a file — the honest options were
    "say so and offer permanent delete" or "break the restore we promised", and it is the
    first. Do not "fix" the counter to ignore trash; that would make it disagree with the
    policy, and a counter that disagrees with the limit is worse than no counter.
  - **The count function must stay SECURITY DEFINER owned by a BYPASSRLS role.** A policy on
    `storage.objects` that itself selects from `storage.objects` raises `infinite recursion
    detected in policy`. Check 5 of the validation asserts this; if it ever reads FAIL, roll
    back rather than debug live — every vault upload is failing.
  - **`vault_can_accept_upload()` takes a per-user advisory lock.** Without it, fifty
    parallel uploads all read the same count and all pass, which is precisely the attack the
    quota exists to stop. A polite client was never the threat. It **is** granted to
    `authenticated` — the policy calls it, and a policy runs as the caller (see the rule
    above); granting nobody took vault upload down on 2026-08-13.
  - **Existing users over the limit keep every file.** The rule is `count < 5` on INSERT only.
    Never enforce a new quota by deleting someone's medical records.
  - **DELETING AN ACCOUNT ORPHANS ITS FILES, EVERY TIME — this is a standing chore, not a
    one-off.** `storage.objects.owner` is FK to `auth.users` `ON DELETE SET NULL`, so each
    deletion converts that account's remaining objects into ones no policy can match:
    unlistable, undeletable through the app, billed forever (114 in `health-vault` on
    2026-08-13). `delete_my_account` **cannot** clean them — Supabase blocks `DELETE FROM
    storage.objects`, the 42501 that once broke all in-app account deletion (APPLIED.md #61).
    Bytes only move through the Storage API, so the companion is
    **`db/scripts/purge-orphan-storage.mjs`** (service_role; dry run by default,
    `--delete --confirm DELETE` to act). Run it after a batch of deletions.
    **It must never test `owner IS NULL`** — `avatars` policies key on the path's first
    segment, not on `owner`, so that test deletes live users' photos. It asks whether the
    account named by the first path segment still exists, and skips whatever it cannot
    classify.
  - **Still open (audited 2026-08-13, `db/audits/audit_unbounded_growth_2026_08_13.sql`):**
    `audit_logs` has `FOR ALL TO authenticated`, so the client can append rows without bound
    and the vault does exactly that on every action; and the `avatars` policy checks only the
    first path segment, so one user can hold unlimited objects under `{uid}/…`. Both are
    reachable by a guest, and guest sign-in is one tap.
- **moment-timezone stays** — `src/utils.js` and `web/src/lib/medication-utils.ts` must keep identical DST math. No Intl migration.
- **Dashboard nav = exactly 5 icons** (`dashboard-main-layout.tsx`); secondary pages go in the profile dropdown.
- **LIGHT MODE IS THE DEFAULT, ALWAYS.** The product never auto-follows the OS theme. **Do not write
  `prefers-color-scheme` anywhere** — not in `globals.css`, not in a component, not in the native
  alarm screen. Dark theme exists in the tokens and activates **only** via the explicit in-app
  Settings toggle. Elderly mode is always light, with the larger scale and stronger contrast. The
  native `AlarmActivity` follows the same rule: a dose alarm must look identical at 3am and 3pm,
  because recognising it instantly matters more than matching the OS. (The media query is the
  default thing to reach for, which is why it is banned by name rather than by convention — the
  redesign proposal itself shipped with one and rendered dark on a dark-set machine.)
  - Audited 2026-08-12: the **web already complies** (`theme-context.tsx` defaults to `'light'` and
    reads only `localStorage`; the two `prefers-color-scheme` hits in the repo are comments
    explaining why it is not used).
  - **The Settings toggle now actually exists (2026-08-12).** Until then the policy's "activates
    only via the explicit in-app Settings toggle" described a control that had never been built —
    the ONLY theme switch was a one-tap moon in the top bar, sitting between the notification bell
    and the elderly-mode glasses as a third equal-weight round icon, one mis-tap from repainting
    the whole app. That button is gone; the control is **Settings → Layout Preference**, disabled
    in elderly mode with the reason stated rather than silently ignored. `toggleTheme` was removed
    from `theme-context.tsx` as well, leaving only `setTheme(theme)` — a one-call flip is what a
    one-tap control is built from, so its absence keeps this structural rather than conventional. `AlarmTheme` is explicitly `Theme.Material.Light`. **One live
    violation remains:** `android-app/.../res/drawable-night/splash.png` (plus the
    `drawable-*-night-*` variants) — Android auto-selects these in dark mode, so the splash still
    follows the OS. Delete them when the new app icon and paper-token splash are built (launch
    layer (a)); they are Capacitor template placeholders being replaced anyway.
- **THREE DENSITIES, ONE SYSTEM (built 2026-08-13).** The same routes, the same data and
  the same derivations render at three densities. `web/src/lib/design/density.ts` holds the
  type, the resolution rule and `DENSITY_LAYOUT` — **a table, so the entire difference
  between the densities is readable in one place**; `web/src/context/density-context.tsx`
  resolves it and `useDensity()` hands out `{ density, layout, isApp, isBrowser }`.
  - **browser** — the full view, including the side column the redesign spec calls the
    *analytics column* (compliance ring · care circle · medication inventory). Health
    Insights is NOT in it: that card and its server-side 7-day aggregation were deleted
    2026-08-12 (the compliance ring is the adherence surface now). Any future dataviz pass
    lands in this column, at this density.
  - **app** — inside Capacitor (`isNativeApp()`, i.e. `Capacitor.isNativePlatform()`).
    A calm today-view: the analytics column is dropped whole, and so is the "Enable
    Browser Notifications" prompt, which offers a channel the app does not use. **Nothing
    is lost, only un-duplicated** — care circle and inventory are both tabs in the
    five-icon nav, and low stock still reaches Today via the refill gate, the refill strip
    and the per-dose "N left" chip.
  - **elderly** — the minimal presentation below. Outranks everything, including the dev
    override: `?preview=` is a developer's convenience, elderly is somebody's ability to
    read the screen.
  - **`?preview=app` / `?preview=browser`** forces a density from a desktop browser. It is
    **sticky for the session** (sessionStorage) so you can walk the app rather than
    re-appending a param to every URL — and because sticky invisible state is a trap, a
    badge says which density is forced and offers Exit. The two ship together.
  - **PRESENTATION ONLY.** No density may gate a derivation, a query, a write path or a
    safety check. If one ever needs its own copy of dose logic, the split is in the wrong
    place — that is exactly how the old elderly dashboard rotted.
  - **The first-paint half is deliberate duplication.** The server cannot know it is
    rendering into the Capacitor webview, so every page streams the *browser* density; the
    pre-paint script in `app/layout.tsx` stamps `data-density` on `<html>` and one rule in
    `globals.css` hides `.browser-only` until React catches up. **React is always the
    authority** — the attribute is an approximation (it cannot know about elderly, and it
    learns "this is the app" from a flag written on a previous load, so the first launch
    after install still flashes once). Never rely on `.browser-only` alone to keep
    something off the app.
  - **Tour steps carry `densities?: Density[]`** (`guide-content.ts`), filtered in
    `guide-tour.tsx`, so the app tour does not spend a step describing a card that is not
    on screen. `medications/new/page.tsx` indexes `TOURS.newMedication` directly — filter
    that tour and you must filter it there too, or the wizard and the tour drift apart.
- **ELDERLY IS THE THIRD DENSITY — browser · app · elderly-minimal.** Treat all three
  as one system; the density-split work must account for elderly, not bolt it on after.
  - **Elderly renders FEWER elements, not bigger ones.** Scaling the standard UI up was
    tried and was the wrong experience. `ElderlyToday` is a ONE-QUESTION SCREEN: the whole
    viewport answers "what do I do now?" — one dominant card (huge med name, dose-form
    icon, 88px Taken, quiet Skip below). **No rail, no drawers, no week strip, no date
    navigation, no dose strip, no inventory, no analytics.** Four states: due-now → the
    card · nothing due → "Nothing right now. Next: …" + Remi · missed → ONE gentle line
    ("… not taken", tap opens that dose) · all answered → check + Remi celebration.
  - **Corrections and history stay OUT of elderly.** Repairing the past needs judgement
    about the past; that is the caregiver's job from their own phone or standard mode.
  - **A PRESENTATION BRANCH, NEVER A SECOND IMPLEMENTATION.** The old elderly dashboard
    re-derived its own next-dose pick, resolve handler and totals — so the week strip,
    the rail, past-day correction and the deep link all landed in normal mode and reached
    none of it. `ElderlyToday` computes nothing: every value is a prop from the same
    derivation the standard view uses, and it resolves through the same
    `resolveReminderEvent`. Keep it that way, or it rots again.
  - Elderly nav collapses to **Today + Care Circle + Settings**. That is the one place the
    "exactly 5 icons" rule below does not apply.
- **THE VIEW LOCK, AND THE ANTI-JAIL INVARIANT.** Settings offers "Lock this view" while
  elderly is on; when locked, the mode control disappears from the top bar **in every
  mode**, and `setMode` refuses regardless of which control calls it — hiding a button is
  a promise about today's UI, the guard is a promise about every UI.
  - **THE LOCK MUST NEVER LOCK OUT SETTINGS.** It is cleared from Settings and nowhere
    else, so Settings stays reachable in every mode — that is why elderly's collapsed nav
    keeps its Settings icon, and why no future "simplify the nav" change may remove it.
    A lock that can hide the way to unlock it is a trap, not a lock.
  - Persisted on `profiles.ui_mode_locked` (migration 2026-08-13) so it survives a
    reinstall or a new phone — the moments when the person least able to re-find the
    setting is the one holding the device. localStorage mirrors it for the first frame
    and for offline; **the profile wins on conflict**, because a cleared browser must not
    quietly unlock someone's phone.
- **Navigation model: tabs replace, sub-pages push, back pops, root minimizes.**
  Defined in `web/src/lib/navigation/stack.ts`; every new page must pick a side.
  - **Root pages** are the five tab destinations (`ROOT_PATHS`). Their nav links carry
    Next's `replace`, so switching tabs never stacks history — otherwise back after four
    tab taps walks backwards through all four, which nobody expects from a tab bar.
  - **Sub-pages** (notifications, `/medications/[id]`, the legal pages…) push normally, and
    **each one renders `<PageBack />`** in its header. Two doors, same rule as notification
    deletion: the system gesture is the expected one, the visible arrow is the one that
    works for someone who does not know the gesture exists.
  - **Android back** is owned by `<AndroidBack />`, mounted once in the `(dashboard)` layout.
    Sub-page → pop one level. Root → the "Exit the app?" dialog, whose **Cancel is the
    primary button** (the safe action takes the accent) and whose Exit calls
    `minimizeApp()`, never `exitApp()`. `/dashboard?day=…` is a deep link, NOT a root view:
    back there clears the param and returns to today.
  - The dialog copy never warns about reminders, because **alarms keep working regardless** —
    they are native `AlarmManager` registrations, independent of the webview. The only line
    worth saying is the reassurance, which is why Remi is in that dialog at all (`happy`,
    never `peaceful` — a sleeping mascot on a goodbye screen implies the reminders sleep).
  - **Requires `@capacitor/app`** (added to `android-app/` 2026-08-12, `cap sync` run). Any
    APK built before that has no `window.Capacitor.Plugins.App`, so `supportsBackButton()`
    is false and the back button keeps its old behaviour. Per the server.url note above,
    this needs BOTH a fresh APK and a web deploy before it can be tested on a device.
  - Mascot placement is a registry, not a convention: `MASCOT_SLOTS` in `brain-mascot.tsx`.
    Adding a slot is a design decision — make it there, on purpose.
- **Medication catalog links are human-select-only** — never auto-match a nickname to a real drug (patient safety).
- **WATER INTAKE IS THE QUIET TIER, AND THAT IS THE WHOLE DESIGN (2026-08-14).**
  Opt-in, OFF by default, and deliberately the least insistent thing in the
  product: a normal swipeable notification on its own low-importance channel,
  **never the full-screen alarm path**, no retry ladder, no missed tracking, no
  escalation, no streaks. Ignoring a nudge records nothing; a missed water day
  says nothing about anybody. If the goal is already met, remaining nudges
  silently skip.
  - **Water yields to medicine.** A nudge within 10 minutes of a scheduled dose is
    DROPPED, not moved — moving it puts the cup somewhere the user did not choose
    and can cascade into the next one. `withoutDoseClashes` in
    `web/src/lib/water/hydration.ts`.
  - **Nudges are INEXACT** (WorkManager / inexact alarms). Exact alarms stay
    medication-only — that is a hard rule and a glass of water does not earn one.
  - **The goal is a rule of thumb, never advice**: weight × 35 ml/kg, 25 ml/kg at
    65+, ÷ cup size, rounded to whole cups. Editable, shown as a suggestion, and
    the setup screen carries the safety line FIRST, not as a footnote: "If you
    have heart or kidney conditions or take fluid pills, ask your doctor about
    your water goal." For someone on a fluid restriction, a cheerful app telling
    them to drink ten glasses is the one genuinely unsafe thing here.
  - **`--hydration-*` is a SCOPED accent — the only exception to the one-accent
    rule.** Sky blue exists so a glass of water is never mistaken for a dose. It
    belongs to the water widget and its settings room and nowhere else; if it ever
    appears on a dose card, a rail, a gate or the alarm, that is the bug.
    `--hydration-ink` for any text (the raw hue is ~2.6:1 on paper).
  - **The tumbler animates only as feedback to a touch.** No idle loop, no
    breathing, nothing that moves while someone reads the screen. One composited
    `translateY` on the fill plus one small slosh, and `prefers-reduced-motion`
    snaps both — a real branch, not a shortened duration, because this is an
    elderly app.
  - **Sync is last-write-wins on `water_logs`, NOT "larger count wins".** Taking
    the larger number is the obvious rule for a counter and the wrong one: it
    makes undo impossible by resurrecting the count the user just corrected. Local
    first (`localStorage`), the row is the shared truth. The cost — an offline
    change can be overwritten by another device — is acceptable precisely because
    nothing else reads this data.
  - **BUT the device tally merges with `max()`, and that is not a contradiction.**
    These are two different situations and the rule follows the situation, not the
    datatype:
    - **Two EDITS of one value** (this phone's row vs another phone's row) →
      **last write wins**. One of them is a correction, and the later one is it.
    - **Two INDEPENDENT TALLIES of the same day** (cups added on the notification,
      which native counts locally, vs cups added in the app, which the row counts)
      → **`max()`, on the way in only**. Neither is a correction of the other;
      they are partial counts of the same thing, and taking the lower one silently
      discards cups the user actually logged.
    Undo still wins wherever it matters, because undo writes the ROW — and the row
    is what the next merge compares against. `ScheduleSync` is the only place the
    `max()` is applied.
  - **No caregiver read.** `water_settings` / `water_logs` are own-row only.
    Nobody escalates on water, and a caregiver seeing whether someone drank enough
    is surveillance without a purpose.
- **THE GATE AND THE RAIL MUST NEVER DISAGREE ABOUT WHICH DOSES ARE OUTSTANDING.** Both ask
  "did you take it?", and both are kept deliberately: the gate is the full-screen interruption
  on app open, the rail's due-now card is the in-page version.
  - **Doses at the SAME INSTANT are presented together and answered independently.** A noon
    handful is one handful; asking about it one pill at a time means the second question
    arrives after the person has already swallowed all four, and they answer it from memory.
  - **Earliest-first ordering still governs ACROSS different instants** — an unanswered 08:00
    dose still outranks a 14:00 one on both surfaces.
  - **Elderly asks one question at a time**, per the one-question philosophy. That is the one
    density where the grouping is presentation-only: the doses are still all outstanding, the
    screen just shows them one at a time.
  - Narrowed from "both pick the EARLIEST overdue dose" on 2026-08-14. That wording was built
    on there being exactly one earliest, which is false for the case it most needed to cover:
    four medications at 08:00 have no earliest, and a 4-med device test found two fighting for
    the full screen while two sat as notifications. The safety property was never "one dose at
    a time" — it was "the two surfaces show the same work", and that is what the rule now says.
  - `buildGateQueue` (`lib/schedule/dose-attention.ts`) and `DayRail` are the two
    implementations. **If either ordering or grouping changes, change both**, or the app will
    ask about one dose while highlighting another.
  - **THE NATIVE ALARM IS THE THIRD SURFACE, and it obeys the same rule (2026-08-14).** One
    notification id per dose *instant*, one `singleInstance` `AlarmActivity` reading
    `DosesAtInstant.rowsAt`, per-dose answering. `AlarmPrefs.elderly` (bridged from the web)
    is what makes elderly ask one at a time there too.
    - **THE FOCUSED LIST.** All same-instant doses are on screen, but exactly ONE is
      active: it rings with big Taken/Skip, the rest sit below showing their state and
      can be tapped to jump the queue in any order. Answering advances the focus; so
      does running out of ring time, which **yields** — that dose stops taking the
      screen's attention *without being resolved*, so its ladder and its missed notice
      carry on as if the screen had never opened. When every dose has had its turn, the
      screen closes. Four cards with two buttons each is eight equal choices at 3am, and
      it also let one unanswered dose hold the screen while the other three were never
      asked at all.
    - **The rotation lives in `DoseFocus`, not the Activity.** A dose quietly dropped
      from it is a dose never asked about, which on screen is indistinguishable from a
      dose that was never due. An Activity cannot be unit-tested; three sets can.
    - **Ring duration is `profiles.alarm_ring_seconds`, 60-300s, PER DOSE** — so a
      handful of four at 2 minutes runs for 8. The setting says the total out loud
      rather than leaving it to be discovered at 3am. Bridged like `elderly`.
    - **The backdrop and the sound are DEVICE-LOCAL and belong to the PRESENTATION** —
      one picture and one tone for the whole handful, never per row. Files live in
      app-private storage (`AlarmMedia`), never Supabase, never a URL, so the alarm
      shows and plays them in airplane mode with the process dead. Three bundled
      gradients ship in the APK; a gallery pick is COPIED IN, so deleting the original
      cannot break the alarm. **Contrast is structural**: every backdrop sits under the
      same 55% black scrim and the buttons keep opaque fills, so no image can make them
      hard to see. Picked images are decoded downsampled — a 50MP photo decoded whole is
      an OOM on the one screen that must never crash.
    - **This is the one bridge area where NATIVE owns the data.** The webview cannot
      write to app-private storage, so the picker is Kotlin and the web only learns
      which choice is active. See BRIDGE_CONTRACT.md §1c.
    - **THE SETTINGS MINIATURE IS A RENDER OF THE REAL SCREEN, NEVER A LOOKALIKE.**
      `renderAlarmPreview` inflates the same XML, binds it through the same
      `AlarmScreenBinder`, and draws it to a bitmap the webview shows in an `<img>`.
      A CSS recreation would be a second implementation of the most safety-critical
      screen in the product, and a preview that quietly stops matching is worse than
      no preview — it is a promise about a screen the user next sees at 3am, with no
      way to check it until then. **`AlarmScreenBinder` exists only to make the two
      paths one; if a future change composes the alarm without it, the guarantee is
      gone.** Measured at real screen size then scaled, or long names would wrap
      differently in the preview than on the alarm. Sound is previewed by playing it
      (`USAGE_ALARM`, non-looping, self-stopping) — it cannot be shown.
    - **Global image/sound, not per medication** — decided 2026-08-14. Per-medication
      override is half built already (`Medication.alarmAudioPath`/`alarmPhotoPath` in
      Room v2, and the resolution order already prefers them); it needs a server column
      and per-med UI, not a rewrite.
    - **The group is derived from the SCHEDULE, never from alarm state.** That is what makes a
      retry rung, a rung rebuilt after a reboot, and the original ring all compute the same
      group without knowing about each other. Asking "which alarms are pending" would be wrong
      exactly when it matters — a rung races the original, and after a reboot nothing is pending
      until `rescheduleAll` has run.
    - **Closing the screen with doses unanswered marks ONLY those doses unattended.** Their
      ladders keep running and their missed notice posts; the answered ones stay answered.
    - **The alarm that rang is never swallowed.** The schedule decides the group, but a
      medication edited out of that instant between registration and firing still gets asked —
      `DosesAtInstant.mergeWithFallback`. A stale question can be answered Skip; a question
      never asked has no move at all.
- **A RETRY LADDER MUST DIE ON ANY RESOLVE THE DEVICE LEARNS ABOUT — from any surface, including
  ones it was not part of.** The ladder is native (chained exact alarms), so cancellation is
  native, and the choke point is `DoseActionQueue.record` — every answer routes through it and it
  is what calls `cancelLadder`.
  - Paid for 2026-08-14: that choke point only ever saw **native-originated** answers. A dose
    marked SKIP from the app's own rail resolved on the server and the device never heard, so two
    **critical** medications read as skipped everywhere on screen while the phone re-asked every
    five minutes. Being chased for a dose you already dealt with is how people learn to ignore the
    alarm — the exact opposite of what a retry ladder is for. The notification path had always
    worked, which is what made the gap invisible.
  - Fixed with `ScheduleBridge.doseResolved` (immediate, called from
    `web/src/lib/reminder-events.ts` — the one function every web surface resolves through) plus
    `getActiveLadders` reconciliation in `ScheduleSync` for answers the device was never part of,
    i.e. **a caregiver resolving from their own phone**. See BRIDGE_CONTRACT.md §1b.
  - **Report resolves through `record(alreadyOnServer = true)`, never straight to
    `cancelLadder`.** An answer also has to leave the dose out of the coalesced alarm group,
    narrow or clear the notification, and reach a visible alarm screen. A second cancellation
    path covers the first of those and silently misses the rest — which is the same shape as the
    bug it would be fixing.
  - **Honest bound, do not overstate it:** reconciliation runs when the webview runs, so a
    caregiver's remote answer can leave the phone re-asking until the app is next opened
    (at most one ladder, ≤30 min). Closing that gap means the device polling the server, which is
    forbidden and would break the offline guarantee the alarm core exists for.
- **PRODUCTION DEPLOYS NEED AN EXPLICIT GO — otherwise deploy a PREVIEW.** `--prod`
  only when the maintainer has said so for that deploy, or when every commit in the
  working tree is one they have already approved. Anything else is
  `npx vercel deploy --yes --scope …` (no `--prod`), which returns a preview URL.
  Paid for 2026-08-14: a `--prod` ran from a tree that was the freshly-merged design
  branch **plus an unreviewed commit**. It was harmless — the new code was gated off
  and its every read was no-op wrapped — but "harmless this time" is not the standard,
  and Vercel ships the WORKING TREE, so the blast radius of a stray `--prod` is
  whatever happens to be checked out. Check `git status` AND `git log origin/main..HEAD`
  before reaching for the flag.
  - Preview URLs break Turnstile (domain lock) — alias them to one stable hostname
    and whitelist it once. See the Turnstile note in M3.
- Web deploys from **repo root**: `npx vercel deploy --prod --yes --scope chaitanya-krishnas-projects-397d3a53`. **The `--scope` is required** — without it the CLI returns `Not authorized` even though `vercel whoami` succeeds, because `.vercel/repo.json` pins an `orgId` that no longer resolves for the logged-in user. Root `.vercel/repo.json` maps the repo to project `reminder-health` with `directory: web`, so deploy from the ROOT, never from `web/`. Vercel ships the **working tree, not the commit** — check `git status` first, or uncommitted work goes to production too.
- For nontrivial Next.js work, heed `web/AGENTS.md`: this Next 16 differs from training data; check `node_modules/next/dist/docs/`.
- Exclude `.claude/worktrees/` from repo-wide greps (stale full checkout).

## Android conversion (Capacitor) — plan v2, 2026-08-10
Supersedes the v1 sketch after a full repo read. Correction from v1: `web/` is Next.js 16 App
Router (server components, 19 API routes, proxy/middleware) — **cannot be statically bundled**
into Capacitor. A prior Bubblewrap **TWA** attempt was abandoned and **deleted 2026-08-10**
(`android-twa/`, never published, no obligation to its keystore/fingerprint — see Keystore
below) — a TWA can't
host native alarms and is not the path forward.

**Architecture: native-first alarm core + remote webview.** Capacitor `server.url` mode — the
webview loads the deployed Vercel site (medication CRUD, care circle, vault, settings); the
native bridge stays available to that page (this is NOT a TWA — the page can call Kotlin
plugins). A Kotlin alarm core owns everything reliability-critical with **zero webview
dependency**: a local schedule store (Room/SQLite or DataStore — device-side copy of
`reminder_times`/`timezone`/`dose_days`/next-fire-time) · `AlarmManager.setExactAndAllowWhileIdle()`
for only the next few upcoming doses, rescheduled after each fires, no polling/timers/foreground
service · full-screen alarm activity via **notification full-screen intent** (not
`SYSTEM_ALERT_WINDOW`) with Taken/Skip/Snooze, wake lock released on dismiss or 60s auto-timeout ·
`BOOT_COMPLETED` receiver re-registers alarms · an offline action queue (Taken/Skip/Snooze
recorded locally, synced via the existing `resolve_reminder_event` RPC when online).

**Testing on a real device needs BOTH sides shipped, every time.** `server.url` mode means the
webview always loads the *deployed* Vercel site, never local `web/` source — so a web-side change
(e.g. a new bridge call in `web/src/lib/native/`) is invisible on-device until it's actually
deployed to production, even if the APK itself was just rebuilt with the matching native code.
Conversely a native-only change needs a fresh APK install; the deployed web doesn't change that.
Concretely: **rebuild+reinstall the APK AND `npx vercel deploy --prod --yes --scope
chaitanya-krishnas-projects-397d3a53` from repo root** before assuming a webview↔native feature
is actually testable — mismatched-side testing is a real, already-hit failure mode (2026-08-10:
`ScheduleSync`'s success log never appeared on-device because only the APK had shipped, not the
web deploy carrying `schedule-sync.tsx`).

**Bridge contract (webview ↔ native):** `syncSchedule(medications)` — web calls after any
medication create/edit/delete, native store + alarms update immediately · `setSession(accessToken,
refreshToken)` — web hands off the Supabase session so native can call RPCs, stored via
EncryptedSharedPreferences · `getPendingActions()` / native→web events as needed. Offline: alarms
+ alarm UI + action recording work fully offline; the management UI needs network (accepted for
v1 — the existing service worker's offline splash covers that failure mode). A static-export or
RN rewrite stays a later option; nothing here forecloses it.

**Server pipeline stays — do not retire.** Web-only and Telegram-only users depend entirely on
the bot-tick + Vercel-failover pipeline (see WORK_LEDGER §1/§3). End state: server pipeline
unchanged for all users; Android users get device alarms **as well as** server push/Telegram —
duplicate notifications are an accepted v1 cost (`reminder_events` `UNIQUE(medication_id,
scheduled_for)` already keeps state consistent). Per-device suppression of server sends (an
`android_active` flag) is a later optimization, not v1. The server keeps owning the
`reminder_events` state machine and caregiver escalation; the device is a delivery channel +
offline action queue, nothing more — device actions reconcile via `resolve_reminder_event`.

**Scheduling math: fixture first, Kotlin second (hard rule).** The two "lockstep" JS copies of
`calculateNextReminder` (`src/utils.js` / `web/src/lib/medication-utils.ts`) have already drifted
(bot throws on empty `reminder_times`; web returns `new Date()`), and no DST regression test
exists. Before any Kotlin scheduling code: (1) create `schedule-test-vectors.json` —
`(reminder_times, timezone, dose_days, now) → expected UTC`, covering empty/invalid input,
once-weekly offset-7 rollover, multi-time days, DST spring-forward/fall-back (`America/New_York`,
`Europe/London` — `Asia/Kolkata` has no DST), midnight edges; (2) wire it into both the bot
(`node:test`) and web tests, resolving the empty-input drift (pick one behavior — the bot's
pre-filter + throw is the safer contract); (3) the Kotlin implementation must pass the same
fixture — port from the fixture + algorithm spec, not by transcribing JS from memory.

**Keystore decision (resolved).** Generate a **fresh** keystore for the Capacitor app; package
name `com.reminderhealth.app` may be reused. Back the new keystore + passwords up in ≥2 places
outside the repo (password manager + cloud drive) **before** the first Play Console upload.
`web/public/.well-known/assetlinks.json` (TWA-only artifact) and `android-twa/` (old keystore
included) were both **deleted 2026-08-10** — the TWA was never published, so neither carried any
obligation. Back up the *new* Capacitor app's keystore per the paragraph above once it exists.

**Pre-code checklist (before `npm i @capacitor/core`):**
- [x] Live schema check (done 2026-08-10 via PostgREST OpenAPI introspection, read-only):
      `medications.reminder_times` is **`jsonb`** (the baseline reconstruction's `TEXT[]` guess
      was wrong). `medications.dose_days` exists live. `reminder_events`/`reminder_logs` both
      have `drug_name_snapshot`, confirming `migration_preserve_dose_history.sql` applied — FK is
      `ON DELETE SET NULL`. See `db/migrations/APPLIED.md` entries #62–64.
- [x] Both "PENDING" migrations (`migration_dose_days_2026_08_10.sql`,
      `migration_anonymous_guests_2026_08_10.sql`) turned out to already be live — found during
      the same schema check; `APPLIED.md`'s PENDING section had simply never been updated. Ledger
      fixed (entries #63–64). Nothing left to apply. Still confirm the Supabase dashboard
      Anonymous-sign-ins + CAPTCHA toggle separately — that can't be checked from the DB side.
- [x] Fixed `web/src/components/turnstile.tsx` (2026-08-10): script `onerror` handler + 8s
      timeout → visible error + Retry instead of the silent dead-end. Verified live in-browser
      (happy path, forced-failure path, and recovery via Retry all confirmed).
- [x] Minimal CI added (`.github/workflows/ci.yml`, 2026-08-10): runs worker `npm test` and every
      `web/src/lib/**/*.test.ts` on push/PR.
- [x] `test/schedule-test-vectors.json` fixture built + wired into both `test/utils.test.js` and
      the new `web/src/lib/medication-utils.test.ts` (2026-08-10). Also fixed the confirmed
      empty-input drift: `medication-utils.ts` used to silently `return new Date()`, now throws
      like the bot — closed the gap safely by adding the same pre-filter guard `src/scheduler.js`
      already had to `web/src/app/api/cron/tick/route.ts`, the medication add form, and the edit
      form (the add-form's step validation had a real, reachable hole: it never required at least
      one reminder time — fixed in `web/src/lib/medications/form-logic.ts`). 39/39 bot tests and
      13/13 web fixture vectors pass.
- [x] **Keystore generated 2026-08-11** — 4096-bit RSA, 10,000 days, alias `reminder-health-upload`,
      at `C:/Users/chait/android-keystores/reminder-health-upload.jks` (**outside the repo on
      purpose**, so no `git add -A` can reach it). Passwords are in
      `android-app/android/keystore.properties`, gitignored — that file was NOT covered by the
      existing `*.jks` rule and had to be added; a leaked password plus a keystore from any backup
      is the same compromise as leaking the keystore.
- [ ] **Back up the keystore + password in ≥2 places outside the repo — needs the maintainer**
      (password manager + cloud drive). Do this BEFORE the first Play upload: a lost upload key
      cannot be recovered without a Play support reset. This is the only truly unrecoverable
      artifact in the project.

**Constraints carried over from v1 (still binding):**
- Permissions: `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM`, `USE_FULL_SCREEN_INTENT`,
  `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` — nothing else, no `SYSTEM_ALERT_WINDOW`.
  - **`VIBRATE` added 2026-08-11** (one beyond the original list, flagged rather than slipped in):
    the alarm activity vibrates in a loop alongside the sound, which is what wakes a sleeping
    user when the ringer is down. Normal permission — auto-granted at install, no prompt, no
    privacy surface. If this is unwanted, deleting `startVibration()` in `AlarmActivity` and the
    manifest line removes it cleanly; the notification channel's own vibration would remain.
  - **Library-merged permissions (audited 2026-08-11 from the manifest-merger report).** The APK's
    final permission list is LONGER than the list above, and that is expected — Gradle merges
    permissions from dependencies. Confirmed provenance, so nobody re-litigates it from a Sentry
    event or a Play listing:
    - `WAKE_LOCK`, `ACCESS_NETWORK_STATE`, `FOREGROUND_SERVICE` — all three `ADDED from
      androidx.work:work-runtime` (the offline action queue's `ActionSyncWorker`).
    - `<applicationId>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` — from `androidx.core`; a
      signature-level permission scoped to this app, not a capability.
    - **This does NOT relax either rule below.** `WAKE_LOCK` being *present* is not the same as
      holding one: `AlarmActivity` still holds none, which is why nothing can leak. Likewise
      `FOREGROUND_SERVICE` is WorkManager's, and this app still starts no foreground service —
      `ActionSyncWorker` is a one-shot with a network constraint. If either rule is ever revisited,
      revisit it on purpose; do not treat the merged list as prior approval.
    - Re-check after adding any dependency:
      `android-app/android/app/build/outputs/logs/manifest-merger-debug-report.txt`.
  - **`WAKE_LOCK` is deliberately NOT declared BY US — do not add it to our manifest.** An earlier `AlarmActivity`
    acquired a `PARTIAL_WAKE_LOCK` and crashed on launch (`SecurityException: ...has
    android.permission.WAKE_LOCK`, 2026-08-11). The right fix was removing the lock, not adding
    the permission: `setTurnScreenOn` + `FLAG_KEEP_SCREEN_ON` already wake the display and hold
    it while the alarm is visible, and a lit screen keeps the CPU running — so the lock bought
    nothing. Holding none is also the strongest possible form of the "wake locks always
    released" rule below: there is nothing that *can* leak.
- No foreground service, no polling loops; wake locks always released (currently: none held at
  all — see above).
- OEM battery managers (Xiaomi/Oppo/Vivo/Realme) kill background alarms — onboarding must detect
  the OEM and walk the user through battery-optimization exemption + autostart; test on a real
  device from one of these brands before release.
- No secrets in anything shipped; anon key is fine. RLS is the only real defence — the M3 audit
  must specifically revisit the legacy `caregiver_info` dual-read branch that bypasses the
  `can_*` permission flags (see WORK_LEDGER §5 / risk list) before any Android caregiver feature
  ships. Encrypt native-stored data; disable webview debugging in release builds; minify.
- Still a reminder tool only — no feature may recommend, adjust, or interpret medication/dosage.
- Release paperwork: privacy policy URL, ToS, in-app + listing medical disclaimer, Sentry, Play
  closed test (~12 testers / 14 days), support email.

**Milestones (revised):**
- **M0 — Groundwork.** Full pre-code checklist above, plus the schedule-test-vector fixture wired
  into bot + web tests with the empty-input drift resolved.
- **M1 — Shell. ✅ DONE 2026-08-10.** Capacitor project in `android-app/` (fresh, not derived from
  the old TWA), `server.url` pointed at the deployed site, icon/splash, proof the remote page can
  call a trivial native plugin. **Verified on a real device (vivo I2202):** app built, installed,
  and launched; logcat showed the Ping bridge round-trip (`[Ping] native replied: pong: hello from
  webview`) multiple times; the live site loads in the webview with the full flow working end to
  end (Turnstile renders and executes, login, dashboard, guest login all work). Bonus finding:
  **Turnstile works fine inside the Capacitor webview** — the M0 checklist's "may need to drop it
  on the app build" concern is closed; keep the onerror/timeout fallback (2026-08-10) as insurance
  regardless.
- **M2 — Alarm core.** Kotlin module: local schedule store, `syncSchedule` bridge, exact alarms
  passing the shared fixture, full-screen alarm activity with Taken/Skip/Snooze, boot receiver,
  offline action queue calling `resolve_reminder_event` via the bridged session. Server pipeline
  untouched, running in parallel. Deliverable: phone in airplane mode, app force-closed, reboot —
  alarm still fires full-screen at the right local time; action syncs when back online.
  - Steps 1-3 ✅ **verified on the real device (vivo I2202, 2026-08-11)**: Room schedule store +
    `syncSchedule` (7 real medications), Kotlin `calculateNextReminder` passing all 16 shared
    fixture vectors, and exact alarms firing 21-25ms late — including **with the app process dead**
    (Android cold-started it purely to deliver the alarm), **in airplane mode**, and **on the lock
    screen**. Each firing re-registers the following dose, so the chain is self-sustaining with no
    polling. Steps 4-6 (full-screen activity, boot receiver, offline queue) still to come.
  - **Known gap found during step-3 testing:** tapping the notification while offline opens the
    remote webview to a blank white screen (`server.url` mode can't load the site without
    network). A local `offline.html` fallback now covers that; the deeper answer is step 4 — the
    full-screen alarm activity is pure native, so alarm *interaction* never depends on the network.
  - Step 4 (full-screen alarm) ✅ **verified on device 2026-08-11**: rendered with the dose's local
    time and the §4/S30 hierarchy; Taken dismissed cleanly and the loop re-registered the next dose.
  - **Unattended-alarm hardening ✅ verified on device 2026-08-11** (commit `e9ab3ac`). Prompted by
    an overnight 100%→0% battery drain that vivo's own battery stats later attributed to **Pillo**,
    the competitor app installed for the teardown — **not this app**. The audit was still worth
    doing and found a genuine bug: the 60s auto-timeout called `dismiss()`, which *cancels the
    notification*, so an alarm that rang while the patient slept **erased its own trace**. Now the
    timeout posts a quiet persistent "Missed: take X" on an IMPORTANCE_LOW channel and leaves the
    dose UNRESOLVED, so server-side escalation still owns missed doses. Verified: alarm rang exactly
    60000ms with no action, auto-dismissed, `ALARM SCREEN-ON RELEASED`, fallback posted, process
    ended cleanly. Bonus: `BootReceiver` fired on `MY_PACKAGE_REPLACED` and re-registered 13 alarms
    from the store — that is step 5's `rescheduleAll` path proven end to end.
  - **`clearSchedule()` on account change ✅ verified on device 2026-08-11.** Signed in as a guest,
    the native store had still held the previous account's 12 medications and rang for them —
    telling someone to take medication that isn't theirs. Verified: logout wiped the store and
    cancelled alarms on **both** exits (navbar + settings), a guest synced 0 meds and stayed silent,
    a tripwire dose passed in silence while logged out, re-login re-synced and re-registered, and
    unsynced actions were kept rather than deleted.
  - **Still open: test C** — a clean overnight battery reading with Pillo uninstalled and alarms
    scheduled (expect a single-digit drop). Not blocking; runs on the next overnight.
  - **Steps 5-6 ✅ VERIFIED on device 2026-08-11 — M2's alarm core is complete.**
    - Step 6: alarm fired for med 136, **Taken tapped on the notification alone** → queued in 26ms
      → synced 1.2s later, no screen opened, no `STRANDED` lines.
    - Step 5: a **real reboot** on the vivo produced
      `BootReceiver: android.intent.action.BOOT_COMPLETED — re-registering alarms from the local
      store` → `rescheduleAll: 19 medication(s)`. This was the one genuinely in doubt, since vivo's
      autostart restrictions target `BOOT_COMPLETED` specifically. **No autostart exemption was
      needed on this device** — do not assume that generalises to Xiaomi/Oppo/Realme; M3's OEM
      onboarding still stands.
    - Snooze: `synced SNOOZE for med 137 (Op) scheduled 2026-08-11T10:30:00Z` — the **original**
      dose instant while the re-fire sat at `10:40:13Z`, proving both the `scheduledFor` split and
      the 42702 fix. The action had failed twice before the migration landed and recovered by
      itself afterwards, which is the offline queue's entire promise demonstrated on real data.
  - **Known gap — a reboot cancels an in-flight snooze (device side only).** A snooze is a
    transient `AlarmManager` re-registration; it is NOT persisted in the Room store, and
    `BootReceiver`'s `rescheduleAll` recomputes purely from `reminder_times`. So rebooting between
    a snooze and its re-fire silently drops the device's re-prompt — observed 2026-08-11, where med
    137's post-boot alarm jumped straight to the next day. **Not urgent:** the server has the dose
    `SNOOZED` with `retry_reminder_at` set, so Telegram/push re-prompts and the escalation ladder
    still cover it — the device just goes quiet. Fixing it properly means persisting a pending
    snooze (dose instant + re-fire time) in the store and having `rescheduleAll` honour one that
    has not yet passed. Worth doing before release; not a blocker for M2.
  - **Two migrations applied 2026-08-11** (validations all DONE):
    `migration_snooze_reminder_event_2026_08_11.sql` and
    `migration_resolve_event_device_queue_2026_08_11.sql`. The second exists because the alarm is
    pure native and can never send `p_event_id`, so every device action was treated as a
    client-fabricated dose and hit two guards meant for the web —
    `VIRTUAL_EVENT_MUST_BE_FOR_TODAY` (killed anything syncing after the local day rolled over,
    i.e. exactly the offline-overnight case) and `INVALID_SCHEDULED_TIME` (killed anything syncing
    after `reminder_times` was edited). Both permanent, so the device retried 5× and dropped a
    patient's recorded "I took it". The guards are now gated on whether a `reminder_events` row
    exists rather than on whether the caller knew its id.
  - **Snooze bug found and fixed 2026-08-11.** `AlarmScheduler.scheduleAt` wrote `fireAt` into
    `EXTRA_SCHEDULED_FOR`. Identical for a normal dose, so invisible — but a snooze re-fires 10
    minutes out while still asking about the *original* dose, so the re-fired alarm carried its own
    re-fire time as the dose identity. Answering it queued a `scheduled_for` matching no
    `reminder_times` entry and no event row → permanent `INVALID_SCHEDULED_TIME` → answer dropped.
    `scheduleAt` now takes `scheduledFor` separately from `fireAt`. **Snooze still needs on-device
    re-verification.**

**Alarm presentation: two shapes, both correct (confirmed on device 2026-08-11 — do not "fix").**
Android decides how to present the dose alarm's full-screen intent:
- phone **locked or idle** → the full-screen `AlarmActivity` takes over the screen;
- phone **unlocked and in active use** → a **heads-up notification** instead (tapping it opens the
  full alarm screen).

That second case is Android deliberately not hijacking the screen of someone who is demonstrably
already using their phone. It is correct and desirable. **Never attempt to override it** — the ways
to do so are exactly the ones CLAUDE.md already forbids (`SYSTEM_ALERT_WINDOW`, a foreground
service). The design consequence is that **the notification must be fully answerable on its own**:
- **Taken / Skip / Snooze 10 min are action buttons on the notification itself**, handled by
  `DoseActionReceiver` (a BroadcastReceiver — no UI opens) and routed through the *same*
  `DoseActionQueue` as the full-screen buttons. Snooze does both halves: local re-registration
  **and** `snooze_reminder_event`. Nobody should have to open a takeover screen to answer a dose
  they are awake for.
- Both the live alarm and the "Missed: take X" fallback are **persistent** (`setOngoing(true)` +
  `setAutoCancel(false)`) and stay until the dose is actually resolved. The missed fallback carries
  the same three buttons — it has to, since a persistent notification with no way to answer it is
  just a stuck notification.
- **A HANDFUL GETS ONE NOTIFICATION, not one per medicine (2026-08-14).** The id is derived from
  the dose *instant*, so four medications at 12:00 update a single notification with a single
  full-screen intent instead of racing to launch four alarm screens. A notification has three
  action slots and a handful can have four doses, so the grouped one carries **Taken all · Open ·
  Snooze**: "Taken all" is the one answer that is honest for a whole handful, "Open" is how you
  answer them individually, and **Skip-all is deliberately not a one-tap on a lock screen** —
  declining every medicine at once deserves the screen that shows you which ones. The single-dose
  notification keeps Taken / Skip / Snooze exactly as before.
- **Android 14+ caveat:** a user can still *deliberately* dismiss an ongoing notification; the
  platform stopped treating `setOngoing` as absolute. Accepted, not fought — the missed-dose
  fallback and above all the **server-side escalation ladder** are the real backstop. A
  notification the OS lets someone dismiss was never the last line of defence.
  - **Steps 5-6 built 2026-08-11, awaiting device verification.** `BootReceiver` (step 5's
    `rescheduleAll` already proven via `MY_PACKAGE_REPLACED`; a real reboot still to test — vivo
    autostart restrictions target `BOOT_COMPLETED` specifically, so that is the one that matters).
    Step 6: the offline action queue, `snooze_reminder_event`, notification action buttons, and the
    `resolve_reminder_event` fix that makes the queue actually survive (see below). **Two migrations
    are PENDING and must be applied before step 6 works end to end** —
    `migration_snooze_reminder_event_2026_08_11.sql` and
    `migration_resolve_event_device_queue_2026_08_11.sql`, then their validation files.
  - **Why the second migration exists (found while wiring step 6):** the alarm is pure native and
    fires with no server round-trip, so it can never send `p_event_id`. Every device action was
    therefore treated as a client-fabricated dose and hit two guards meant for the web —
    `VIRTUAL_EVENT_MUST_BE_FOR_TODAY` (killed anything syncing after the local day rolled over, i.e.
    exactly the offline-overnight case the queue exists for) and `INVALID_SCHEDULED_TIME` (killed
    anything syncing after `reminder_times` was edited). Both permanent, so the device retried 5×
    and dropped a patient's recorded "I took it". The guards are now gated on whether a
    `reminder_events` row exists rather than on whether the caller knew its id.
- **M3 — Hardening.** OEM battery onboarding, RLS audit (incl. legacy `caregiver_info` branch),
  Sentry (webview + native), encryption at rest, Turnstile verified or disabled for app origin,
  disclaimer/policy pages, closed test track.
  - **⬜ OPEN, and it is a launch gate: rate-limit the two directory lookups before the
    closed test.** `lookup_profile_by_connect_code` and `lookup_caregiver_by_code` turn a
    short code into a real person's name + profile UUID. As of 2026-08-13 both are locked
    at the grant (`authenticated` only) **and** guarded with `auth.uid()` in the body —
    two locks, per the template. But **"authenticated" is a weak gate for this specific
    risk**: guest sign-in is one tap, so anyone can hold a session and walk the code space.
    That is fine while every tester is someone the maintainer knows; it stops being fine
    the day strangers can make accounts.
    Shape: call `check_rate_limit` **inside** the two SECURITY DEFINER bodies, keyed on
    `auth.uid()`. NOT from the client — `check_rate_limit(text, int, int)` is
    **service_role only** (`authenticated` revoked by
    `migration_rpc_grant_lockdown_2026_08_08.sql`), so a browser call cannot work; a
    definer body runs as the owner and can. Own migration, own validation.
    Also tracked in `docs/PLAY_LISTING.md` §"Still open before submitting".
  - **Function EXECUTE grants ✅ swept 2026-08-13** (`migration_revoke_anon_execute_sweep_2026_08_13.sql`,
    all 6 validation checks DONE: 47 of ours locked, 31 extension-owned pg_trgm skipped).
    The audit found **68** functions `anon` could execute — the key shipped inside the APK.
    Two were live holes, not defence-in-depth: the lookups above had **no auth check at
    all**, and `expire_stale_connection_requests` / `cleanup_*` take no arguments, check no
    caller, and UPDATE/DELETE — including wiping `rate_limits`, which is what makes rate
    limiting mean anything. Root cause is in the Hard rules above: **both revokes, always**.
    Re-audit any time with `db/audits/audit_function_execute_grants_2026_08_13.sql`.
  - **RLS audit ✅ DONE 2026-08-11** (`migration_caregiver_legacy_branch_gated_2026_08_11.sql`,
    APPLIED.md #67, all 7 validation checks DONE). **The flagged `caregiver_info` dual-read is
    closed.** Three caregiver SELECT policies (`medications`, `reminder_events`, `reminder_logs`)
    `UNION`ed a modern branch gated on a `can_*` flag with a legacy branch gated on nothing but
    ACCEPTED + is_active — and a `UNION` grants if *either* side matches, so any caregiver with an
    accepted legacy row read the patient's medications, doses and adherence history **regardless of
    that patient's permission toggles**. The toggles were decorative for those relationships.
    Audited first (`db/audits/audit_rls_caregiver_dual_read_2026_08_11.sql`): 3 legacy rows, 0
    without a modern counterpart, 0 currently over-granted — so removal cost nobody anything and
    closed the bypass permanently. Of those 3, only **one** is a live relationship; the other two
    are abandoned half-written invitations with a NULL `patient_telegram_id` that never granted
    anything. **`caregiver_info` is therefore far less load-bearing than the docs implied** —
    retiring it entirely is now a realistic future cleanup, not a rewrite.
    - Same audit also confirmed, and these are worth not re-deriving: **no policy grants the `anon`
      role** (which matters because the APK ships the anon key and can be unpacked — anon's reach
      *is* the app's worst case), no `public` table has RLS disabled, `FORCE RLS` is still on both
      PHI tables, and the six policy-less tables (`link_codes`, `phone_verifications`,
      `push_tracking_tokens`, `rate_limits`, `scheduler_heartbeat`, `scheduler_locks`) match
      WORK_LEDGER's documented service-role-only list exactly, with no extras.
    - **Still in M3 scope for the voice feature:** Storage-bucket RLS for family voice recordings
      (see Post-M2 §1). Unblocked now — "who counts as this patient's care circle" finally has one
      answer instead of two.
  - **Encryption at rest ✅ DONE 2026-08-11, verified on device.** `schedule.db` is SQLCipher-
    encrypted via Room's `openHelperFactory`, so entities and DAOs are untouched. Passphrase lives
    in its own EncryptedSharedPreferences file, **deliberately separate from `SessionStore`** —
    that one is wiped on sign-out, and wiping the DB key on sign-out would make the store
    unreadable rather than merely empty. Stored as a **hex string, not raw bytes**: SQLCipher
    derives a key from a passphrase, so the conversion (SQL string literal) and Room (byte array)
    must agree on what the passphrase *is*, or the store converts and then cannot be opened.
    - **In-place upgrade, not a wipe:** an existing plaintext store is read out through Room,
      written to a staged encrypted DB, then swapped; the plaintext file is deleted only after the
      copy is closed, so a process death mid-conversion leaves the original intact. Row-by-row
      rather than SQLCipher's `ATTACH` + `sqlcipher_export()` recipe — that ATTACH **silently did
      not take** on this device ("unknown database encrypted").
    - **`getInstance` never throws.** It runs inside the alarm and boot receivers, where an
      exception means no reminders at all. The native-library load is checked first and separately
      (a missing `.so` is an environment problem, not corruption, and must never reach the
      delete-and-resync path); a Keystore that cannot supply a key means running unencrypted with a
      loud log rather than encrypting under a key nobody wrote down.
  - **Turnstile ✅ verified for the app origin 2026-08-11 — no Cloudflare change needed, and the
    reason matters.** Capacitor runs in `server.url` mode pointed at
    `https://reminder-health.vercel.app`, so **the webview's origin IS the deployed domain** — the
    same origin a desktop browser has. Turnstile site keys are domain-locked, and that one domain
    already covers both surfaces, which is why the widget worked in the app on day one (M1) with
    no separate app entry. Verified live on that origin: widget renders
    (`cf-chl-widget-…_response`), a real **794-char token** is issued, no error fallback, submit
    enabled.
    - **PREVIEW DEPLOYMENTS BREAK LOGIN, and this will recur on every design review.**
      A Vercel preview lands on its own hostname
      (`reminder-health-<hash>-<team>.vercel.app`), which is NOT in the site key's
      allowed domains — so Turnstile fails and nobody can sign in to review the
      branch. Nothing is wrong with the branch; it is the domain lock doing its job.
      **Fix: alias the preview to ONE stable hostname and whitelist that once** —
      `npx vercel alias set <deployment-url> reminder-health-refresh.vercel.app --scope …`,
      then add `reminder-health-refresh.vercel.app` in Cloudflare → Turnstile →
      the widget → Settings → Domains. Re-point the same alias at each new preview
      and the whitelist never needs touching again.
      **Do NOT "fix" it by pointing Preview at Turnstile's always-passes test key**
      (`1x00000000000000000000AA`): Supabase verifies the token against the real
      SECRET key, so a dummy site key produces a token Supabase rejects, and login
      breaks in a more confusing way than it does now.
    - **What would break it:** moving to bundled assets — the M5 "static export or RN migration"
      option — changes the origin to `capacitor://localhost` / `https://localhost`, which is NOT in
      the site key's allowed domains. CAPTCHA would then fail on the app while still working on the
      web, and (per the 2026-08-10 outage) Supabase would reject those logins outright. If that
      migration is ever attempted, add the localhost origin in Cloudflare **first**.
    - Timing note for anyone re-testing: the token can take well over 12s on a cold load. Absence
      of a token is not evidence of failure — check for the app's own error fallback instead.
  - **Sentry ✅ wired 2026-08-11, switched OFF until a DSN is set.** See
    [docs/SENTRY_SETUP.md](docs/SENTRY_SETUP.md) for turning it on. Web via `@sentry/nextjs`
    (`src/instrumentation.ts` + `src/instrumentation-client.ts`, shared scrubbing in
    `src/lib/observability/sentry-shared.ts`); native via `io.sentry:sentry-android` in
    `Crash.kt`. **Both are complete no-ops without a DSN** — no init, no build plugin, no cost —
    so this changed nothing about how the app runs today.
    - **Never enabled, deliberately:** Session Replay (it records the screen, and that screen is a
      list of someone's medications), `sendDefaultPii`, native breadcrumbs (`maxBreadcrumbs = 0`,
      because the alarm core logs drug names to logcat on purpose), and the web tunnel option
      (it would make the app a proxy for third-party traffic). Web scrubbing drops query strings,
      cookies, request bodies, all headers but `user-agent`, and console breadcrumb text;
      `event.user` is reduced to an opaque id.
    - **Landmine, paid for once (2026-08-11):** piping the DSN into `vercel env add` from
      PowerShell prefixed it with a **UTF-8 BOM**, and the SDK rejected it with `Invalid Sentry
      Dsn` — in a browser console nobody was reading. Web reporting was completely dead while
      looking correctly configured, which is the worst failure mode a crash reporter has. Re-added
      via bash (`printf '%s' … | vercel env add`), and `sentry-shared.ts` now strips a leading
      U+FEFF **by code-point comparison**, never by matching a literal BOM in the source — an
      invisible character in a source file is one editor save from vanishing and taking the guard
      with it. Verified live: `hasClient: true`, `enabled: true`, `dsn.charCodeAt(0) === 104`.
    - **The limit worth remembering:** an exception *message* still carries whatever the code put
      in it. No `beforeSend` regex fixes that — which is why `Crash.report()` takes a **medication
      id, never a name**. Keep that habit for new reports.
    - Two silent failures now report themselves: `calculateNextReminder` failing for a medication
      (that row gets no alarm ever again, silently) and dose actions stranded after exhausting
      retries (a patient's recorded "I took it" that will never reach the server).
    - **`Permissions-Policy: microphone=()` in `web/next.config.ts` will block the planned family
      voice recording** — it must be relaxed to `microphone=(self)` when that feature is built.
      Noted here because the failure mode is a silently dead record button.
    - **Landmine, paid for once:** the plaintext detector compared against `"SQLite format 3 "`
      with a trailing **space**; the real header ends in a **NUL**. The check never matched, so
      SQLCipher was pointed at a plaintext file and the recovery path deleted a live local store.
      Recovered from the server exactly as designed — but a data-deleting path was one wrong byte
      from being reachable by accident.
- **M4 — Widget.** Native Glance/RemoteViews widget showing next dose, reading the native
  schedule store. Update on data change or ≥15 min; never per-minute.
- **M5 (optional, later).** Per-device suppression of duplicate server sends; static export or
  RN migration only if the remote-webview model proves limiting.

## Post-M2 features (decided 2026-08-11 — do not start before M2 is done)

### 1. Family voice alarms — flagship differentiator, build immediately after M2
A care-circle member records a short voice message (**~30s hard cap**) and sets a photo from the
web app; the dose alarm then plays *that person's voice* and shows their face instead of a generic
tone. This is the feature the product is differentiated on, not a nice-to-have.

**UI placement (decided 2026-08-11 — settled, not open for re-litigation):**
- **Recording UI lives on the Care Circle page**: a per-patient "Voice & Photo reminder" card —
  record ≤30s, pick a photo, preview, re-record, delete. Care-circle members record *for* the
  patient; the patient can also record their own.
- **Phase 1 is ONE voice + photo per patient**, used for all of that patient's alarms.
- **Per-medication override** ("custom alarm for this medicine") lives in the medication edit
  form — **phase 2, not the first build.**
- **Settings holds listener-side controls only**, alongside the planned Alarm-style setting:
  Family voice vs Default tone · alarm volume · show/hide photo. Nothing is *recorded* from
  Settings; that would split one feature across two pages.

- **Files live in Supabase Storage**, uploaded from the web (care circle side).
- **The app downloads them to LOCAL device storage during `ScheduleSync`.** Non-negotiable:
  the alarm must work in airplane mode, so it **must never stream at fire time** — if the file
  isn't already on disk when the alarm fires, the alarm falls back rather than waiting on network.
- **The native alarm activity plays the local audio and shows the photo full-screen**, falling
  back to the default alarm tone + mascot art when either is absent or unreadable.
- **Storage RLS: only the patient's own care circle may upload for them.** Add this to the
  **M3 RLS audit scope** — and note it interacts with the already-flagged legacy `caregiver_info`
  dual-read branch that bypasses the `can_*` flags, since "who counts as this patient's care
  circle" is exactly the question that branch answers inconsistently today.
- Health-data sensitivity: a voice recording of a family member is personal data. Same
  on-device-encryption and private-bucket discipline as the vault.
- ✅ **Step 4 is already built to receive this** (2026-08-11): `AlarmActivity` accepts an optional
  local photo path and optional local audio path per medication, with verified-readable checks and
  clean fallbacks, and the Room store carries `alarmAudioPath`/`alarmPhotoPath`. So the voice
  feature plugs in by populating those two columns + adding the download step — **the alarm screen
  does not need rebuilding.**

### 2. Multi-language — phased, deliberately

**PART OF PHASE 2 SHIPPED 2026-08-15 — read [docs/I18N.md](docs/I18N.md) before touching
this area or assuming a surface is translated.** Seven languages (English · हिन्दी · ಕನ್ನಡ ·
മലയാളം · मराठी · தமிழ் · తెలుగు) now cover the nav labels, the Settings hub, the language
picker and **all three legal documents**. Two corrections to the plan below, both deliberate:
- **It does NOT use next-intl.** Its routing mode wants a `[locale]` segment across all 39
  routes; its no-routing mode is a provider around a flat dictionary, which is what
  `theme-context` / `density-context` / `ui-mode-context` already are here. `lib/i18n/messages/`
  is laid out the way next-intl expects, so adopting it later is a config change, not a rewrite.
- **The scope was wider than "Hindi + Telugu plus 1-2"** (six Indian languages) and
  **narrower in depth** — chrome and legal text only. Medication names are user data and are
  never translated.

**The alarm screen is still English, and that remains the important gap** — see the CRITICAL
note below, which is unchanged and unaddressed. The language picker says so on screen rather
than letting someone discover it at 3am.

- **Phase 1 is the voice feature itself.** A recorded message in the patient's own language from
  their own family solves the alarm-language problem *without any translation work*. This is why
  voice comes first.
- **Phase 2 translates only patient-facing surfaces** — the native alarm screen's buttons, elderly
  mode, onboarding — into **Hindi + Telugu** plus 1-2 more, via **next-intl**.
- **Full-app i18n only if demand shows.** Do not translate the caregiver console, settings, vault,
  or admin surfaces on spec; that is a large ongoing cost for an unproven need.
- Practical note for phase 2: the alarm screen's strings already live in
  `android-app/android/app/src/main/res/values/strings.xml`, so its translation is a `values-hi/`
  `values-te/` drop, independent of the web's next-intl work.

**Placement (decided 2026-08-11 — settled; the picker half BUILT 2026-08-15):**
- **Language picker lives in Settings** as a "Language" row, with **every language shown in its
  own script**: English / తెలుగు / हिन्दी. A language list written only in English is unusable by
  exactly the person who needs to change it. ✅ Built — `settings/language/language-picker.tsx`,
  a `radiogroup` with the native name as the label and the English name muted beneath it (for
  the caregiver setting up somebody else's phone). The Settings row's own value shows the
  current language in its own script for the same reason.
  - **Inter has no Indic glyphs, so this needed fonts, not just strings.** Five `Noto_Sans_*`
    families are appended to **both** the sans and mono stacks via `--font-indic-tail`
    (mono too — nav labels and badges are mono and JetBrains Mono has no Indic coverage
    either). `preload: false` + per-script unicode-range subsets mean an English page fetches
    none of them; verified in-browser that only the active script's file loads.
- **Also asked ONCE at first-launch onboarding, before any other screen**, so the permission and
  setup screens themselves render in the chosen language — those are the screens where a
  misunderstanding costs the user their alarms.
- **CRITICAL — the choice must cross the bridge.** `AlarmActivity` is Kotlin, not web, so the
  native alarm's button labels cannot read a web-side locale. The selected language must sync into
  the native store the way the session does (add a `language` field to `syncSchedule` and document
  it in BRIDGE_CONTRACT.md when this is built), or the alarm screen silently stays English — and
  it is the one screen that must work **offline, at 3am, for the least technical user**. Android
  resource qualifiers (`values-hi/`) pick up the *device* locale, which is NOT necessarily the
  language chosen in-app; the bridged value is what makes the two agree.

## ELEMENT CHECKS ARE NOT PAGE CHECKS — VERIFY FIT AT 375px

Paid for 2026-08-17. The conformance audit verified computed styles on ~250 sites
— radius, colour, shadow, contrast — and every one passed. It verified nothing
about whether any PAGE fits a phone, and three layout regressions were reported
from a device the same day: the dashboard cut off at the left edge, the nav
showing 4 of 5 icons, the dose gate no longer fitting one screen.

A screen can be perfectly tokenised and still overflow its viewport. **Per-element
verification and page-level verification are different checks; run both.**

The snippets live in [docs/VERIFY_DEVICE_WIDTH.md](docs/VERIFY_DEVICE_WIDTH.md) —
one that lists every element wider than the viewport or positioned off it, one
that checks a full-screen surface actually equals the viewport. Run at 375×812 as
the floor, and at 320px for anything with five or more inline targets.

## PRODUCTION IS A MERGE TO `main`. NOTHING ELSE. `--prod` IS BANNED.

Settled 2026-08-17 after five stale-tree production overwrites and a full
diagnosis (below). **The deploy model, in one line each:**

- **Production = merge a PR to `main`.** The GitHub webhook builds it and moves
  the production alias. No CLI step, ever. Verified four times on 2026-08-17:
  pushes to `main` and the two merges each produced their own
  `source: "git"` production build, `READY`, holding the alias.
- **Previews = push a branch.** The webhook builds those too, typically within
  ~3 minutes. `npx vercel deploy` is not needed for review any more.
- **The review hostname is permanent and needs no CLI.** Push to **`rev`** and the
  preview lands at `reminder-health-git-rev-chaitanya-krishnas-projects-397d3a53.vercel.app`,
  whitelisted once in Turnstile. This replaces the old
  `reminder-health-refresh.vercel.app` alias, which required `vercel alias set`
  after every deploy and is now dead weight.
  - **The branch is `rev`, not `review`, and the three characters are the point.**
    `review` produced a label of **exactly 63** — the DNS maximum. It resolved and
    served pages fine, but Turnstile answered every request from it with
    `110200` (unknown domain) even after the hostname was added to the correct
    widget, twice. `rev` brings the label to 60. If a future rename is ever
    tempting, keep the label comfortably under 63 and re-run the Turnstile check
    below before trusting it.
- **`npx vercel deploy --prod` is impossible, not merely banned** — the CLI is
  logged out; see below. There was no reason left to run it anyway: the merge
  does it correctly, from the committed tree rather than from whatever happens to
  be checked out.

### THE LOCK IS REAL: THE CLI IS LOGGED OUT (2026-08-17)

`npx vercel logout` was run and **`--prod` now fails before it can upload
anything**:

```
$ npx vercel deploy --prod --yes --scope chaitanya-krishnas-projects-397d3a53
Error: You do not have access to the specified account          (exit 1)
```

So this is no longer a rule anyone can forget — it is the absence of a
credential, and it binds every session on this machine equally, Claude's
included. **The one action that would undo it is `vercel login`. Do not run it**
without deciding, on purpose, to give the CLI production access back.

Nothing depends on the CLI any more:

| need | how, without the CLI |
|---|---|
| ship to production | merge to `main`; the webhook builds it |
| a preview to review | push to **`rev`**; the webhook builds it |
| a stable preview URL | `reminder-health-git-rev-….vercel.app`, minted automatically |
| check what is live | `curl` the canary vs `reminder-health.vercel.app` |
| roll back | the Vercel dashboard |

**Three gotchas learned while setting this up, all of which cost a wrong turn:**

- **A branch pointing at the same commit as `main` gets NO deployment at all.**
  Vercel does not rebuild a commit it has already built, so a freshly-branched
  `review` produced no preview and therefore no hostname. The branch needs a
  commit of its own before its alias exists.
- **The branch name must be short and slash-free.** Anything long, or containing
  a `/`, gets hashed into the hostname instead — `fix/auth-first-time-path`
  became `-git-7d6098-`, which is not stable and cannot be whitelisted in
  advance. **And a name that merely fits is not enough:** `review` produced a
  label of exactly 63, the DNS maximum, which resolved but which Turnstile
  refused with `110200`. The branch is `rev` (60) for that reason — leave it
  alone unless you re-run the Turnstile check.
- **Deployment Protection still guards every `.vercel.app` preview host.** A
  device opening the review URL hits `vercel.com/login` unless it has a Vercel
  session, or has been given the bypass cookie once via
  `?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true`
  (the secret lives in Settings → Deployment Protection → Protection Bypass for
  Automation). Whitelisting the hostname in Turnstile fixes *sign-in*, not
  *access* — they are two different gates.

### The predicate that was tried first, and why it could not work

**Tested 2026-08-17 and it FAILED, so do not trust it.** With the Ignored Build
Step saved as
`if [ "$VERCEL_ENV" = "production" ] && [ -z "$VERCEL_GIT_REPO_ID" ]; then exit 0; else exit 1; fi`,
a throwaway `npx vercel deploy --prod` from a clean tree built anyway and went
`READY` as `target: production` (`p7hwzamqd` / `dpl_BuwXwA4VvUPC8iPj4Ka88upeBPGY`).

The build logs say why it is probably unfixable rather than merely mis-tuned: a
git deploy logs `Cloning github.com/Chaitanyakrishna294/reminder-health (Branch:
main, Commit: …)`, while the CLI deploy logs `Retrieving list of deployment
files…` and goes straight to `Running "vercel build"`. **A CLI deploy is a file
upload with no repository attached**, and the Ignored Build Step is a Git
feature — Vercel's own canonical example for it is `git diff HEAD^ HEAD`, which
needs history an upload does not have. Neither log prints an ignore-step line, so
this is strong evidence rather than proof; what IS proven is that the predicate
does not stop a CLI `--prod`.

**The predicate was REMOVED afterwards** (`commandForIgnoringBuildStep: null`) —
an inert rule that enforces nothing is the same failure mode as a privilege
footer describing an ACL the database does not have, and this repo has already
paid for that once.

A timing note, because it is what makes the test trustworthy: the project's
`updatedAt` moved at 17:41:44Z, **seventeen minutes after** the throwaway ran at
17:24:09Z. The predicate was therefore in place during the test — the deploy
succeeded *despite* it, not because the setting had never been saved.

**There is no Vercel setting that disables CLI production deploys.** Checked
against the full project payload, not assumed. Which is why the answer ended up
being the credential, not a toggle.

**`reminder-health-git-main-….vercel.app` remains the canary** regardless: it
always tracks the git build of `main`, so if it and `reminder-health.vercel.app`
ever serve different content, something has bypassed the git path.

A detail worth knowing when reconstructing one of these: **a CLI deploy from a
working tree leaves NO provenance.** `vercel inspect` on `8ld615gnb` returned no
git metadata at all, and once its aliases moved it 302s, so what it contained is
now unrecoverable. `vercel ls` tells you WHICH deploy is live; nothing tells you
what was in it.

### THE OVERWRITER WAS THE CLI ITSELF — git auto-deploy was never broken

Diagnosed 2026-08-17 from the Vercel REST API, after five "overwrites" were
blamed on a second session and then on a dead git integration. **Both were
wrong.** The git path has worked the whole time and fires on every merge:

- Project link is live — `github / Chaitanyakrishna294 / reminder-health`,
  **Production Branch `main`**, **Root Directory `web`**,
  `gitProviderOptions.createDeployments: "enabled"`, and
  **`commandForIgnoringBuildStep: null`** (there has never been one).
- **61 of the last 100 deployments are `source: "git"`** — including one
  production build per merge: PR #7 → `dpl_8dRiWBef5A`, PR #8 → `dpl_cnqQeeoNi1`,
  PR #9 → `dpl_9UCjZPMhZK`. All `READY`. "Zero automatic deployments" was a
  misread of the dashboard, not a fact about the project.

**Why the dashboard cannot be read for this.** A CLI deploy from inside a git
repo **stamps the local HEAD onto itself** — `githubCommitSha`,
`githubCommitRef`, `githubCommitMessage`, even `githubDeployment: "1"`. So in the
Deployments list a CLI deploy is visually identical to a webhook deploy: same
commit message, same branch, same everything. A merge that auto-built and was
then overwritten by a CLI `--prod` of the same commit **looks like one
deployment**. That is why this went five rounds.

- **The one field that discriminates is `source` (`"git"` vs `"cli"`), and it is
  API-only.** It is not in `vercel ls`, not in `vercel inspect`, not in the UI.
- **Corrects the paragraph above**: a CLI deploy does not lack provenance, it
  carries *borrowed* provenance, which is worse — it looks authoritative and
  describes a commit that may share nothing with the uploaded tree.

**The actual mechanism, and it needs no second session:** production target is
production target. A `--prod` and a merge build both claim the production alias
**on completion, so the one that finishes LAST wins.** The 12:52 pair —
`dpl_8UNPdZG7X4` (git) and `dpl_4pax1rBicu` (cli), same minute, same commit — is
that race, and the CLI one holds `reminder-health.vercel.app` today. The
"16 seconds" was never two chats colliding; it was one chat racing the webhook it
had just triggered.

**Consequences worth keeping:**
- **`reminder-health-git-main-….vercel.app` always tracks the GIT build** of
  `main`. It is the honest canary: if it and `reminder-health.vercel.app` serve
  different content, a CLI deploy is sitting on production.
- **There is no Vercel setting that disables CLI production deploys.** The full
  project payload has no such field — checked, not assumed. So the lock cannot be
  a toggle; it is either an Ignored Build Step predicate that can tell the two
  apart, or removing the CLI's credentials. **The predicate route was then tried
  and it does not work** — see the section above; credential removal is the only
  mechanism left.
- An Ignored Build Step keyed on `VERCEL_GIT_COMMIT_SHA` being empty **will not
  work** — per the stamping above, CLI deploys populate it. `VERCEL_GIT_REPO_ID`
  *is* a genuine discriminator in the deployment metadata (`githubRepoId` is
  git-only), and it still did not help, because the ignore step appears not to
  run for an upload-based deploy at all.
- **The actor IS recorded, contrary to the "no provenance" note above.**
  `meta.actor` is present on CLI deploys and absent on git ones. All 13 CLI
  production deploys in the recent window read `claude-code_*_agent` — no second
  human, no rogue token. Every "overwrite" was a session racing the webhook it
  had just triggered by merging.

## TWO SESSIONS DEPLOYING = SILENT OVERWRITES, AND IT LOOKS LIKE A BROKEN FIX

Paid for 2026-08-16. A fix was deployed to production, verified, and reported
done; six minutes later **another chat's `--prod` deploy replaced it** with that
session's working tree, which did not contain the fix. The symptom on the device
was "no change" — three times in a row — which reads as the fix being wrong and
sent the debugging in entirely the wrong direction.

- **`vercel ls` is the check.** If the newest Production deployment is not the one
  you just created, yours has been overwritten. Do this BEFORE re-diagnosing a fix
  that "did not work" — it is cheap and it rules out the most misleading cause.
- Confusing detail to expect: **older commits survive the overwrite** (the other
  tree had them from an earlier pull) while the newest fix vanishes, so the app
  looks partially updated, which argues *against* a stale build.
- Only one session should hold the deploy at a time.

## SEE THE SCREEN BEFORE FIXING IT — BUILD A HARNESS FOR AUTHED SURFACES

Same day, same bug, and this is the one that cost the most: three fixes shipped to
the dose gate without the screen ever being rendered, because the gate only
appears behind auth with a dose outstanding. All three reasoned from source — a
guessed width breakpoint, a guessed height breakpoint, then a diagnosis that could
not be completed. All three were wrong or invisible.

**A temporary route rendering the real component with fabricated props takes about
five minutes** (`app/<name>/page.tsx`, `'use client'`, mount the component inside a
copy of its real wrapper, delete it after). Every provider it needs — theme, UI
mode, density, language — is in the ROOT layout, so a scratch route anywhere gets
them. That harness answered in one run what three rounds of reading could not, and
`getBoundingClientRect()` against `window.innerHeight` is what made the real cause
undeniable.

**Delete it before deploying** — Vercel ships the working tree, so a diagnostic
route left in place ships to production.

## `position: fixed` IS NOT VIEWPORT-RELATIVE IF ANY ANCESTOR HAS A TRANSFORM

**Full-screen overlays go through `createPortal` into `document.body`. Always.**
Both gates (`med-due-gate.tsx`, `refill-gate.tsx`) do; anything new that covers
the screen must too.

A transform, filter, backdrop-filter, perspective or `contain` on ANY ancestor
makes that ancestor the containing block for `fixed` descendants. The dashboard's
`page-enter` wrapper animates a transform, so `fixed inset-0` inside it measured
**3000px tall on a 764px viewport** — sized to the scrollable page, not the
screen.

- **It does not look like a positioning bug.** It looks like a spacing bug. The
  gate rendered under the header with the nav painted over it, and
  `justify-center` centred the question inside a 3000px box, so the screen was
  mostly blank space and read as "too long".
- **It silently defeats measurement code.** A fit search comparing
  `scrollHeight` to `clientHeight` found no overflow — correctly, against a
  3000px box. **Two consecutive spacing fixes were invisible by construction**,
  and both looked like wrong numbers rather than a wrong frame of reference.
- **z-index will not save you either**: inside a lower stacking context, the
  gate's `z-[120]` cannot beat the nav's `z-40`.
- Suspect this whenever a `fixed` element is the wrong size, is scrollable when
  it should not be, or sits under something with a lower z-index. Confirm by
  measuring `getBoundingClientRect().height` against `window.innerHeight`.

## A `'use client'` FILE EXPORTS NO VALUE A SERVER COMPONENT MAY CALL — AND NOTHING CATCHES IT

Paid for 2026-08-16 with a **production outage**: every route under `(auth)` —
login, register, forgot-password — returned a 500 for as long as it took to
notice. `mascotSlot()` lived in `brain-mascot.tsx`, which is `'use client'`, and
`(auth)/layout.tsx` is a **server** component that called it for Remi's greeting:

    Attempted to call mascotSlot() from the server but mascotSlot is on the
    client. It's not possible to invoke a client function from the server.

- **`next build` passes. `tsc --noEmit` passes. CI passes.** The boundary is
  enforced at REQUEST time, so nothing in the pipeline says a word — the first
  thing that knows is a user who cannot sign in. This is the opposite failure
  mode from most of this repo's landmines, which are loud and immediate.
- **It looked half-working**, which delayed the diagnosis: `/welcome` sits
  outside the route group and kept rendering perfectly, so the app appeared to
  load and only the sign-in step was dead.
- **Shared data goes in a plain module, not in the component file.** The registry
  now lives in `components/dashboard/mascot-slots.ts` — no `'use client'`, no
  React import — and `brain-mascot.tsx` re-exports only the **type**.
  **Re-exporting the VALUE through the client file puts it straight back behind
  the boundary**, which is the tempting "compatibility" fix and is the bug again.
- **Verifying a build is not verifying this.** It takes a running server:
  `next start` and an actual request to the route. A `web-prod` entry in
  `.claude/launch.json` (port 3005, gitignored so add it yourself) exists for
  exactly that — the dev server cannot always be reused, and two Next dev servers
  fight over one `.next`.
- Same shape to watch for anywhere else a server component imports from a
  component file: **importing a type is always fine; importing a value is not.**

## DESIGN DNA — FROZEN 2026-08-15

**READ THE SPEC BEFORE ANY VISUAL CHANGE — it is the constitution, and this
section is only its summary.**
[`docs/design/visual-refresh-2026-08-14.md`](docs/design/visual-refresh-2026-08-14.md)
is the design language (**§10 is what actually shipped; §1–§9 are the round-one
proposal kept for its reasoning**), and
[`docs/design/PR-looks-maxx.md`](docs/design/PR-looks-maxx.md) is what shipped and
why. Cited elsewhere as `design/…`; there is no top-level `design/` directory, so
both names mean these two files under `docs/`.

**Every change cites the spec section it satisfies.** If the spec is silent,
propose the addition to the spec first and get approval — code follows the spec,
never the reverse. That ordering is not ceremony: the spec sat one round out of
date until 2026-08-16, and a session "following" it would have reverted the four
elevation steps to three and re-derived dark mode from the light tokens.

**THE DESIGN TRACK IS CLOSED (2026-08-16)** — no further visual work until
Remi's final art lands. `design/looks-maxx` is merged and its branch deleted.
This is stronger than the freeze below: the freeze governs *how* a change is
made, this says there is no design work to make. Bug fixes to shipped surfaces
are of course still fixes.

**`/settings/help` IS AN ACCEPTED DEVIATION (2026-08-17) — do not "fix" it.**
It is the one surface deliberately off the 20/14/10 radius scale, keeping a
bordered `rounded-3xl` card and a 16px tile. It is a SERVER component that
elderly can reach, so `useUiMode` gives no branch to guard with; the only routes
to conformance are changing elderly's rendering (violates the standing
exclusion) or a CSS guard on `[data-density="elderly"]`, which is stamped in an
effect and would therefore show elderly one wrong frame on every load. For a
24px radius on a help page, **the cure costs more than the disease.** Full
reasoning in [`docs/design/conformance-audit.md`](docs/design/conformance-audit.md) §D6.

Two exceptions were re-confirmed as WON'T-FIX when the track closed, so nobody
re-opens them as tidying:
- **`/welcome`'s hardcoded palette stays** (`#0F1C5A`, `#CC3D64`, `#F59FB4`). It
  is the recorded auth-world exception. Revisit only if Remi's final art forces
  a palette pass there.
- **`space-y-3.5` on that screen stays.** It is off the 8pt grid, and the file's
  "must fit 375x812 without scrolling" warning outranks grid purity — 4px is not
  worth re-running the scrollHeight check for.

The visual language is **finished and frozen**. Changing any of it needs an
explicit unfreeze decision from the maintainer, stated as such. A drive-by edit to
a token, a type size, an elevation step or a motion timing is a defect, not a
tweak — the whole point of a system is that it is not re-decided per screen, and
this one was re-decided twice before it settled.

**Tokens.** Paper ground · white cards · ink text · **mind pink is THE one
accent** and only ever on touchable things · slot tints are SURFACES, never text
without `-ink` · verdict colours are softened on purpose. `--hydration-*` is the
single scoped exception and belongs to water alone. `--category-*` is folder
identity, never status.

**Type.** Inter for every sentence and heading; `title-page` for page titles.
**Mono is for VALUES ONLY** — times, counts, codes, structural labels, the
wordmark. Never a sentence. That rule was violated app-wide by one CSS selector
putting mono on `h1`–`h6`, and again on the auth headline, which sits outside the
`(dashboard)` group and is styled by class rather than tag. Both are fixed; if a
third turns up, it will be somewhere the tag selector cannot reach.

**Elevation.** Four visibly distinct steps: board → `card-lift` → `card-raised`
→ `card-overlay`. No borders on cards; a border survives only where it is a
BOUNDARY (input outlines, dividers, focus rings). Two shadow layers always.

**@layer components is not optional.** Everything this project writes in
`globals.css` outside a layer is UNLAYERED, and unlayered CSS BEATS Tailwind
utilities at equal specificity. That silently ate a `bg-primary-strong` on the nav
pill (which rendered grey for two failed fixes), 37 `shadow-*`, 2 `rounded-*`, and
would have left the redesigned Vault folder with one square corner and a stray CSS
tab. **Any new component class goes inside `@layer components`.**

**Dark is hand-tuned, not derived.** Near-black OLED ground; the cards are the
light, the same figure/ground relationship as day rather than its inverse.
Separation is a lightness step plus a hairline ring, because shadows barely read
on dark. **Anything hardcoded in a component slips straight through a token
re-derivation** — that is how the tumbler glass and the dose-strip pockets stayed
lit for a white page. Highlights are FRACTIONS OF THE ROOM'S LIGHT: on dark they
drop hard while shades DEEPEN, which is not a proportional dim.

**Motion is feedback, never attention.** `stagger-in` (40ms, capped at six) ·
`press-sink` · `page-enter` keyed on pathname · `check-draw` on the SVG path ·
`numeral-tick` · the nav pill's `translateX`. All ≤400ms, transforms only,
`prefers-reduced-motion` a REAL branch rather than a shorter duration.
- **`press-sink` belongs only to elements that rest at an elevation.** It resolves
  to `lift-1` on `:active`; on a tinted, borderless row that makes it LIFT under
  the finger. And never on a non-interactive `<div>` — `:active` fires there, so
  the press effect renders on something that does not respond.
- **Remi's idle bob is the one sanctioned loop** (with the all-taken
  celebration). It is a carve-out, not an oversight — but it must keep its
  reduced-motion branch.

**`motion-design`'s "always include an ambient layer" is a STANDING REFUSAL.**
Refused four times now: an ambient layer is a looping idle animation, and nothing
in this app may move for attention.

**Layout.** 8pt spacing · radius 20/14/10 with the concentric rule · 44px targets
(56–88px elderly) · 4.5:1 contrast · sentence case · zero-blame copy · light
default.

**Deliberate exceptions, so nobody "fixes" them:** the auth screens keep their own
radial world (they are not a working surface); the emergency card stays a solid
danger fill (a stranger reads it on a locked phone); elderly keeps its own scale
throughout.

**AND THE DOSE-STRIP POCKETS STAY SKEUOMORPHIC — this one is a REFUSAL, not an
oversight.** The looks-maxx brief asked for them to be "redesigned as a cleaner
progress language", and they were left alone on purpose after reading them.

The dome is not decoration, it is a SECOND INFORMATION CHANNEL: domed means the
pill is still in the pocket (upcoming, due now, missed), pressed-in means the
pocket has been emptied (taken, skipped). That mapping is why "missed" keeps its
dome rather than borrowing the emptied look. Flattening the pockets would leave
colour and a glyph carrying the state alone — and this app's audience includes
people with age-related colour vision changes, which is the exact case the
never-colour-alone rule exists for.

So the Vault folders were rightly de-skeuomorphised (a drawn folder tab carried
nothing) and these were rightly not (the dome carries state). "Skeuomorphic" is
not the test; whether the shape is doing a job is. If this is ever revisited, the
replacement has to carry state in form BEFORE the domes come out.

**ELDERLY WAS EXCLUDED from the whole redesign.** Where it owns a file it was not
touched; where markup is shared every change sits inside an `!isElderly` branch.
The honest check is `git log <base>..HEAD -- <elderly file>`, not a diff — the
i18n work legitimately edits those files.

## UI Redesign (planned — not started, do not begin without explicit go-ahead)
Recorded 2026-08-10. Design-inspired by **"Pillo: Pill Reminder & Alarm"** (Play Store,
pillo.care) — calm card-based UI, soft colors + one strong accent, a today-timeline of dose
cards, huge one-tap Take/Skip, visible pill counts, alarm-first identity. Build OUR identity
around the cartoon-brain mascot on top of that feeling — **inspired by, never a copy of**: no
similar name/icon, no near-identical screens. Pillo is a direct competitor in our Play Store
category, so this matters beyond taste — general UX patterns (card layouts, timelines, big tap
targets) aren't ownable, but specific screens/icons/copy/art must stay clearly our own.

**Reference:** [`docs/design/pillo-teardown.md`](docs/design/pillo-teardown.md) — a 32-screenshot
UI/UX teardown of Pillo, added 2026-08-10. Standing rules for using it:
- **§8 (Adopt / Adapt / Reject) is pre-approved** — those are already-made design decisions for
  this redesign, not options to re-litigate when design work starts.
- **§7 (Pillo's own defects) is a do-not-inherit list** — every ranked issue there (progress bar
  not advancing, no back button on the first question, `Done` overlapping the last settings row,
  etc.) is a mistake to design around from the start, not something to discover independently.
- **§1's color/typography tokens are approximations of THEIR design, for inspiration only.** We
  define our own palette and identity around our brain mascot — same discipline (one accent hue
  doing all the interactive work, calm cards, big one-tap actions), different look. Never clone
  their screens, name, icon, or colors — direct Play Store competitor, this matters beyond taste.
- **§4's S30 (full-screen alarm) breakdown is the reference blueprint for M2's native Kotlin
  full-screen alarm activity** — same hierarchy (primary action big and on top, honest decline
  grey below, deferral smallest), styled with our own tokens once the redesign defines them.
- **Known gaps in the teardown** (fill later, not blockers): Pillo's "Taken" confirmation screen,
  the snooze/reschedule picker, what the alarm does when ignored (re-fire timing), the Progress
  and Me tabs, and dark-mode values. The teardown's own §8 "Adapt" section already improves on
  the biggest gap (Pillo's flow ends at "Take now") with a 5-minute countdown + dose-form
  instruction spec — that's pre-approved too, per §8 above.

**Skills to use for design work (decided 2026-08-12 — apply these consistently):**
`interface-design` is the primary one (product UI: states, hierarchy, information design; it is
explicitly *not* for marketing pages, which is right for this app). Alongside it: `ponytail` for
restraint, `verification-before-completion` for evidence-before-claims, `dataviz` for the adherence
heatmap and stat tiles, `motion-design` + `gsap-*` for the launch idle animation and
micro-interactions, and `artifact-design` only when publishing a proposal artifact.

**SKILL VERDICT, recorded 2026-08-13 so it stops being re-decided per task.**
- **`ux-copy` and `project-a11y` are NOT OPTIONAL.** They trigger on *any* change
  that adds user-facing words or touches UI, and they are invoked at the START of
  the work, not as a review afterwards — both exist because these checks were
  failing when left to judgement (pink-on-white shipped at 2.9:1 twice; a slot
  tint shipped as label text at ~1.9:1).
- **`interface-design` is for VISUAL DIRECTION**, not mechanics. Use it when a
  screen's hierarchy, layout or information design is genuinely open. Do not
  invoke it for plumbing — a flow conversion, a nav label, a gesture handler —
  where the design is already decided and the work is making it true.
- **`ponytail` is applied as a principle rather than invoked per task.** Its whole
  content is "reuse what exists": the 2026-08-13 batch reused `CodeInput` for the
  reset code screen and navigated to the existing `/update-password` instead of
  building a second password form. If a task is tempted toward a parallel
  implementation of something the repo already has, that is the signal to reach
  for it explicitly.
- Everything in the "Deliberately NOT used" list below stays out. That list is
  about competing visual directions, and it does not expire.
- **`motion-design` — consulted 2026-08-14 for the water tumbler, verdict: USE IT
  FOR THE NUMBERS, NOT THE AMBITION.** Its timing/easing/material tables are
  genuinely useful (fluid material → ~1.5× duration and a settle rather than a
  bounce is why the fill is 380ms on `cubic-bezier(0.34,1.06,0.64,1)`). But its
  "always three motion layers — primary, secondary, **ambient**" rule is a direct
  conflict with the calm rule and was **refused**: an ambient layer is a looping
  idle animation, and nothing on Today may move for attention. Flagged per the
  conflict rule rather than followed. Same for its "success = particle burst".
- **`interface-design` — consulted for the same work, verdict: correct call, and
  its "use what exists" half did the most work.** The water card ended up on the
  page's existing card conventions and spacing scale rather than inventing a
  surface, which is what keeps it part of Today rather than a sticker on it. Its
  domain-exploration phase is for screens whose direction is open; the water
  direction was already decided in the request, so that half was skipped on
  purpose.

**SKILLS SERVE THE DESIGN SYSTEM; THEY NEVER OVERRIDE IT.** The approved proposal — tokens, the
one-accent rule, slot tints as surfaces only, Remi's five-part palette, the sticker-flat rendering
law, elderly sizing, and the light-mode default — is the authority. **If a skill's guidance
conflicts, the proposal wins and the conflict gets flagged**, never silently followed.

Deliberately NOT used, because each carries a competing visual direction: `taste-skill`,
`gpt-tasteskill` (mandates AIDA marketing structure and randomised layouts — actively wrong for a
screen opened six times a day to check a dose), `soft-skill`, `minimalist-skill`, `brutalist-skill`,
`redesign-skill`, `stitch-skill`, `brandkit`, `genjutsu:paint`, `imagegen-*`, `image-to-code-skill`.
Remi's expressions use **no** skill — the character sheet is the spec, and Claude only writes the
generation prompt (see [[mascot-asset-workflow]]: the maintainer generates and drops the PNGs).

**The five "design pro" skill sets** (maintainer's name for them — Design DNA · GSAP ×8 ·
Motion Design · Three.js ×10 · Genjutsu). Verdict on each, so this is not re-litigated:
- **Design DNA — use as a RECORDER, not a director.** It covers the same three dimensions the
  proposal already fixed (tokens, style, effects), so it is worth running to formalise the approved
  system into a structured profile future sessions apply mechanically. Do **not** point it at the
  app to *derive* a direction — that re-opens decisions already made.
- **Motion Design — yes, and before reaching for GSAP.** Timing/easing/choreography principles with
  no dependency added.
- **GSAP — only for real sequences** (the all-taken celebration, a countdown ring). It is ~50 KB;
  Remi's idle breathing is two CSS properties and does not justify it. Use `gsap-react` if it lands.
- **Three.js — no.** This app runs in a webview on low-end Android, and the alarm core's value is
  working when things are degraded. WebGL is cost with no benefit here.
- **Genjutsu — `cast` only** (micro-interactions for the celebration). `genjutsu:paint` is art
  direction for a whole visual universe and conflicts with a locked one.

**The governing constraint is CALM.** The teardown rejects interstitial encouragement screens,
elderly mode forbids personality escalation, and the launch rule is that animation never adds wait
time. Motion is earned in exactly two places — the all-taken celebration and Remi's idle — and is
otherwise a smell.

**Accessibility and copy are enforced by skills now, not by hand (2026-08-12).** Two project skills
live in `.claude/skills/` and trigger on any UI or copy change:
- **`ux-copy`** — the copy constitution: sentence case (uppercase mono for structural labels only,
  never sentences), zero-blame language, the elderly plainest register, Remi shows/doesn't chat, no
  emoji in interface copy, and never implying the app verifies medical correctness.
- **`project-a11y`** — the elderly-tuned floor: 44px targets, 4.5:1 contrast (**`--primary-strong`
  for pink text, `--slot-*-ink` for slot-coloured text**), 28px elderly icons, light mode always for
  elderly, arm's-length type sizes, visible `:focus-visible`.

For formal WCAG 2.2 A/AA conformance use the installed **`a11y-specialist-skills`** pack —
`reviewing-a11y` for severity-ranked issue discovery on a component or page, `auditing-wcag` for a
full Pass/Fail conformance run (worth doing once before the Play closed test).

Both project skills exist because these checks were failing when left to judgement: pink-on-white
shipped at 2.9:1 twice, and a slot tint shipped as label text at ~1.9:1.

**Rules for when this starts:**
1. Web-side only. Because M1's Capacitor shell loads the deployed site (`server.url` mode), a
   web redesign *is* the app redesign — no separate native UI work needed for this. Do not touch
   the bot, scheduler, RPCs, or database.
2. Every existing feature keeps working: elderly mode, guest mode, guided tour, care circle,
   dose gate, health vault, settings.
3. Mobile-first stays the priority (renders inside the Android webview) — the current dashboard
   nav's rail/dock breakpoint-switch pattern is the kind of thing to preserve, not something this
   redesign is expected to replace wholesale.
4. Tailwind v4 stays, config-free, through the existing `@theme inline` setup in `globals.css` —
   redesign happens through tokens + components, not a new styling system.
5. The native full-screen alarm activity (M2) is out of scope here, but the color/typography
   tokens chosen in this redesign **will** define its look — document them somewhere the Kotlin
   side can reuse (not just as CSS vars). Practically: lock the token decisions before M2's
   alarm-UI visuals are built, even if the rest of the redesign ships later.
6. First deliverable when this starts is a **design proposal, not code**: palette, typography,
   a visual mock of the redesigned Today screen. No changes to any of the 27 pages until approved.

**Sequencing:** M1 (Capacitor shell) first, so every design deploy shows up instantly inside the
app once it starts. Redesign begins after M1 — see the token-lock caveat in rule 5 above re: M2.

**Carries over unchanged:** all existing Hard rules still bind during the redesign, especially
**exactly 5 nav icons** and **medication-catalog links stay human-select-only** — a calm
card-based visual direction doesn't relax either.

**Conflict check against the Android plan (v2) above: none found.** The remote-webview
architecture is what makes "web redesign = app redesign" true, rather than a coincidence to
reconcile. The only real interaction is the M2 token-reuse dependency captured in rule 5.

## Commands
- Worker tests: `npm test` (node:test). Web: no test script; `web/src/lib/schedule/*.test.ts` and `web/src/lib/medication-utils.test.ts` run via `node --experimental-strip-types`. CI (`.github/workflows/ci.yml`) runs both on every push.
- `test/schedule-test-vectors.json` is the shared `calculateNextReminder` fixture (bot + web + future Kotlin port) — add cases there, not ad hoc in either test file.
- Web dev server: `.claude/launch.json` → `web` (port 3001).
