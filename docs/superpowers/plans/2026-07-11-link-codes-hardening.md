# `link_codes` Hijack + Brute-Force Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two independent account-hijack paths on Telegram-to-web account linking — an always-true RLS policy on `link_codes` and a complete lack of rate limiting on redemption — plus a non-atomic delete bug that lets a "used" code be redeemed twice.

**Architecture:** A SECURITY DEFINER `redeem_link_code` RPC replaces all direct client access to `link_codes` (RLS is locked down with no replacement policy); the code is hashed at rest (SHA-256, matching the existing `phone_verifications.code_hash` pattern); a new rate-limited API route (`checkRateLimit`, matching `voice/verify/check`) is the only caller; the bot switches from `Math.random()` to `crypto.randomInt` for the code itself.

**Tech Stack:** Supabase Postgres (SQL migration, `plpgsql` SECURITY DEFINER function), Next.js 16 route handler (Node runtime), `zod`, Node.js CommonJS (bot, `node:crypto`).

## Global Constraints

- DB migrations are `.sql` files under `db/migrations/`, applied manually by the maintainer via the Supabase SQL editor (project `jaflclnakwtikqbfhfdk`) — no task may attempt to apply one itself.
- Web deploys from `web/` (Vercel monorepo `directory: web`) and must not import the repo-root `src/` (the bot). The bot (`src/commands.js`) and the web app (`web/...`) are edited independently in this plan; they share no code.
- After dropping the always-true RLS policy on `link_codes`, add **no replacement policy**. Direct client access to this table must not exist in any form — redemption goes exclusively through the `redeem_link_code` RPC.
- `redeem_link_code` must perform its lookup, expiry check, `profiles` update, and `link_codes` delete **atomically** (one `plpgsql` function body, one implicit transaction) — no follow-up client call finishes the job.
- RPC failures raise plain, lower-case-matchable English phrases (`'Not authenticated'`, `'Invalid code'`, `'Code expired'`), and callers match them via `(error.message || '').toLowerCase().includes(...)` — this is the exact convention already used in `web/src/app/(dashboard)/settings/settings-client-view.tsx` for `invite_caregiver`'s errors; do not invent a JSON-error-code convention instead.
- Rate limit is exactly `checkRateLimit(`link-account:redeem:${ip}`, 10, 600)` (10 requests per 600 seconds) — matches `voice/verify/check`'s limit verbatim.
- Commit message trailer for every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Work on the current branch (`main`). Do not create branches.

---

### Task 1: `link_codes` hardening migration

**Files:**
- Create: `db/migrations/migration_link_codes_hardening_2026_07.sql`

**Interfaces:**
- Produces: `public.link_codes.code_hash` (text, replaces the dropped `code` column), function `public.redeem_link_code(p_code text) RETURNS void` — `SECURITY DEFINER`, raises `'Not authenticated'` / `'Invalid code'` / `'Code expired'` on failure, otherwise updates `profiles.telegram_chat_id` for `auth.uid()` and deletes the matched row.

This task only creates and commits the migration file. Do NOT apply it to any database — that is a separate manual step by the maintainer (Task 5).

- [ ] **Step 1: Write the migration file**

Create `db/migrations/migration_link_codes_hardening_2026_07.sql` with exactly this content:

```sql
-- Harden link_codes against two independent account-hijack paths:
--   1. An always-true RLS policy let any authenticated user browse, redeem, or delete
--      ANY pending link code (profiles.telegram_chat_id drives every patient/caregiver
--      data relationship in the schema, so redeeming a code is a full identity hijack).
--   2. Redemption had no rate limiting (1,000,000-code space, 15-min TTL, brute-forceable).
-- Fix: hash the code at rest (matches phone_verifications.code_hash), remove all direct
-- client access to the table, and move redemption behind a SECURITY DEFINER RPC that a
-- new rate-limited API route calls (web/src/app/api/link-account/redeem/route.ts).
-- Also fixes a non-atomic bug: the old flow updated profiles then deleted the code as two
-- separate, unguarded client calls (the delete had no error handling) — a silent delete
-- failure left a "used" code redeemable again for up to 15 more minutes. The RPC below
-- does both in one transaction. See docs/superpowers/specs/2026-07-11-link-codes-hardening-design.md.

ALTER TABLE public.link_codes ADD COLUMN code_hash text;
ALTER TABLE public.link_codes DROP COLUMN code;

-- No replacement policy: direct client access to this table is never legitimate again.
-- The bot writes via its service_role key, which bypasses RLS regardless.
DROP POLICY IF EXISTS "Allow code verification by authenticated users" ON public.link_codes;

CREATE OR REPLACE FUNCTION public.redeem_link_code(p_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid uuid;
  v_hash text;
  v_row record;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Bot always generates uppercase codes ('RMDR-' + digits); normalize the same way here
  -- so a user-pasted code with stray whitespace or lowercase still matches.
  v_hash := encode(sha256(convert_to(upper(trim(p_code)), 'UTF8')), 'hex');

  SELECT * INTO v_row FROM public.link_codes WHERE code_hash = v_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid code';
  END IF;

  IF v_row.expires_at < now() THEN
    DELETE FROM public.link_codes WHERE id = v_row.id;
    RAISE EXCEPTION 'Code expired';
  END IF;

  UPDATE public.profiles SET telegram_chat_id = v_row.telegram_chat_id WHERE id = v_uid;
  DELETE FROM public.link_codes WHERE id = v_row.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_link_code(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.redeem_link_code(text) FROM anon;
```

- [ ] **Step 2: Commit**

```bash
git add db/migrations/migration_link_codes_hardening_2026_07.sql
git commit -m "$(printf 'feat(db): hash link_codes, lock down RLS, add redeem_link_code RPC\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

- [ ] **Step 3: Ask the maintainer to apply it**

Post to the maintainer: "Apply `db/migrations/migration_link_codes_hardening_2026_07.sql` in the Supabase SQL editor (project `jaflclnakwtikqbfhfdk`), then confirm." Verify by running in the SQL editor:

```sql
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='link_codes';
```

Expected: `id`, `telegram_chat_id`, `code_hash`, `created_at`, `expires_at` — no `code` column.

```sql
SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='link_codes';
```

Expected: **zero rows**.

**Note for the maintainer:** applying this migration will make the *currently running* bot's `/linkweb` command error (it still tries to insert into the now-dropped `code` column) until Task 4 (bot redeploy) ships. This is expected and low-stakes — `/linkweb` is a one-time onboarding command, not on any reminder-delivery path. It self-resolves once the bot redeploys.

---

### Task 2: Rate-limited redeem route (web)

**Files:**
- Create: `web/src/app/api/link-account/redeem/route.ts`

**Interfaces:**
- Consumes: `checkRateLimit`, `getClientIp`, `tooManyRequests` from `@/lib/rate-limit` (existing); `createClient` from `@/lib/supabase/server` (existing); the `redeem_link_code(p_code text)` RPC from Task 1.
- Produces: `POST /api/link-account/redeem` — body `{ code: string }`, returns `{ success: true }` (200) or `{ error: string }` (401 unauthenticated, 400 invalid input/code/expired, 429 rate-limited, 500 unexpected).

- [ ] **Step 1: Write the route**

Create `web/src/app/api/link-account/redeem/route.ts` with exactly this content:

```ts
// Redeem a Telegram link code and attach it to the caller's profile. Replaces the old
// direct-client link_codes/profiles access (now blocked by RLS) with a rate-limited,
// atomic SECURITY DEFINER RPC call. See docs/superpowers/specs/2026-07-11-link-codes-hardening-design.md.
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, getClientIp, tooManyRequests } from '@/lib/rate-limit';

const Schema = z.object({ code: z.string().min(1).max(32) });

export async function POST(request: Request) {
  try {
    if (!(await checkRateLimit(`link-account:redeem:${getClientIp(request)}`, 10, 600))) {
      return tooManyRequests();
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = Schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Enter the verification code.' }, { status: 400 });
    }

    const { error } = await supabase.rpc('redeem_link_code', { p_code: parsed.data.code });

    if (error) {
      const m = (error.message || '').toLowerCase();
      if (m.includes('expired')) {
        return NextResponse.json(
          { error: 'This verification code has expired. Please request a new one by typing /linkweb in the bot.' },
          { status: 400 }
        );
      }
      if (m.includes('invalid code')) {
        return NextResponse.json({ error: 'Invalid verification code. Please check and try again.' }, { status: 400 });
      }
      console.error('[link-account/redeem] RPC error:', error);
      return NextResponse.json({ error: 'Failed to link account. Please try again.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[link-account/redeem] error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/link-account/redeem/route.ts
git commit -m "$(printf 'feat(web): rate-limited /api/link-account/redeem route\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Bot `/linkweb` hardening

**Files:**
- Modify: `src/commands.js:1-5` (add `crypto` require)
- Modify: `src/commands.js:618-651` (the `/linkweb` handler)

**Interfaces:**
- Produces: `/linkweb` now generates its code via `crypto.randomInt(100000, 1000000)` (was `Math.random()`) and inserts `code_hash` (SHA-256 hex of the uppercase code) instead of plaintext `code` — matching the `code_hash` column from Task 1. The message sent to the user in Telegram is unchanged (they still see and paste the plain code).

- [ ] **Step 1: Add the `crypto` import**

In `src/commands.js`, find this exact block at the top of the file:

```js
const { bot } = require('./bot');
const { supabase } = require('./db');
const moment = require('moment-timezone');
const { STATES, FREQUENCIES, CALLBACK_ACTIONS, MAIN_MENU, MAX_SNOOZES, SNOOZE_MINUTES } = require('./constants');
const { isValidTime, calculateNextReminder, escapeHTML, activeSnoozes } = require('./utils');
```

Replace with:

```js
const crypto = require('crypto');
const { bot } = require('./bot');
const { supabase } = require('./db');
const moment = require('moment-timezone');
const { STATES, FREQUENCIES, CALLBACK_ACTIONS, MAIN_MENU, MAX_SNOOZES, SNOOZE_MINUTES } = require('./constants');
const { isValidTime, calculateNextReminder, escapeHTML, activeSnoozes } = require('./utils');
```

- [ ] **Step 2: Rewrite the `/linkweb` handler**

In `src/commands.js`, find this exact block:

```js
  // /linkweb command
  bot.onText(/\/linkweb/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const randomCode = 'RMDR-' + Math.floor(100000 + Math.random() * 900000);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      // Delete any existing codes for this chat ID
      await supabase
        .from('link_codes')
        .delete()
        .eq('telegram_chat_id', chatId.toString());

      const { error } = await supabase
        .from('link_codes')
        .insert([{
          telegram_chat_id: chatId.toString(),
          code: randomCode,
          expires_at: expiresAt
        }]);

      if (error) {
        console.error('[LinkWeb] Error inserting code:', error);
        await bot.sendMessage(chatId, '❌ Failed to generate verification code. Please try again later.');
        return;
      }

      const responseMsg = `🔑 <b>Verification Code Generated!</b>\n\nYour code is:\n<code>${randomCode}</code>\n\nExpiry: <b>15 minutes</b>\n\nPlease enter this code on the registration page of the Web Portal to link your account.`;
      await bot.sendMessage(chatId, responseMsg, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[LinkWeb] Unexpected error:', err);
      await bot.sendMessage(chatId, '❌ An unexpected error occurred. Please try again.');
    }
  });
```

Replace with:

```js
  // /linkweb command
  bot.onText(/\/linkweb/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      // crypto.randomInt is cryptographically secure (Math.random() is not) — this code
      // grants full account access on redemption, so it must not be predictable.
      const randomCode = 'RMDR-' + crypto.randomInt(100000, 1000000);
      // Hash before storing (matches phone_verifications.code_hash): the plaintext code only
      // ever exists in this Telegram message and the user's clipboard, never persisted.
      // Normalize the same way the redeem_link_code RPC does (upper + trim) so they always match.
      const codeHash = crypto.createHash('sha256').update(randomCode.toUpperCase().trim()).digest('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      // Delete any existing codes for this chat ID
      await supabase
        .from('link_codes')
        .delete()
        .eq('telegram_chat_id', chatId.toString());

      const { error } = await supabase
        .from('link_codes')
        .insert([{
          telegram_chat_id: chatId.toString(),
          code_hash: codeHash,
          expires_at: expiresAt
        }]);

      if (error) {
        console.error('[LinkWeb] Error inserting code:', error);
        await bot.sendMessage(chatId, '❌ Failed to generate verification code. Please try again later.');
        return;
      }

      const responseMsg = `🔑 <b>Verification Code Generated!</b>\n\nYour code is:\n<code>${randomCode}</code>\n\nExpiry: <b>15 minutes</b>\n\nPlease enter this code on the registration page of the Web Portal to link your account.`;
      await bot.sendMessage(chatId, responseMsg, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[LinkWeb] Unexpected error:', err);
      await bot.sendMessage(chatId, '❌ An unexpected error occurred. Please try again.');
    }
  });
```

- [ ] **Step 3: Confirm existing bot tests still pass**

Run (from repo root): `npm test`
Expected: all `node:test` suites pass. No test covers `/linkweb` directly; this confirms nothing else broke.

- [ ] **Step 4: Commit**

```bash
git add src/commands.js
git commit -m "$(printf 'feat(bot): hash /linkweb codes, use crypto.randomInt\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

- [ ] **Step 5: Note for deploy** — this file runs on **Render**, not Vercel. Until the bot redeploys (Task 5), `/linkweb` will error against the migrated schema (see Task 1 Step 3's note) — expected and self-resolving.

---

### Task 4: Web page rewiring

**Files:**
- Modify: `web/src/app/link-account/page.tsx:17-81` (the `handleVerify` function body only)

**Interfaces:**
- Consumes: `POST /api/link-account/redeem` from Task 2.
- Produces: `handleVerify` now posts to the new route instead of touching `link_codes`/`profiles` directly. `handleSkip` and `handleLogout` (later in the same file) are untouched and keep using the existing `supabase` client — do not remove the top-level `const supabase = createClient();` or its import.

- [ ] **Step 1: Rewrite `handleVerify`**

In `web/src/app/link-account/page.tsx`, find this exact block:

```tsx
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formattedCode = code.trim().toUpperCase();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be signed in to link your account.');
        setLoading(false);
        return;
      }

      const { data: linkData, error: fetchErr } = await supabase
        .from('link_codes')
        .select('*')
        .eq('code', formattedCode)
        .single();

      if (fetchErr || !linkData) {
        setError('Invalid verification code. Please check and try again.');
        setLoading(false);
        return;
      }

      const expiresAt = new Date(linkData.expires_at).getTime();
      if (expiresAt < Date.now()) {
        setError('This verification code has expired. Please request a new one by typing /linkweb in the bot.');
        setLoading(false);
        return;
      }

      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ telegram_chat_id: linkData.telegram_chat_id })
        .eq('id', user.id);

      if (updateErr) {
        console.error('[LinkAccount] Profile update error:', updateErr);
        setError('Failed to update profile. Please try again.');
        setLoading(false);
        return;
      }

      await supabase
        .from('link_codes')
        .delete()
        .eq('id', linkData.id);

      setSuccess(true);
      setLoading(false);

      setTimeout(() => {
        router.refresh();
        router.push('/dashboard');
      }, 1500);

    } catch (err) {
      console.error('[LinkAccount] Unexpected error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };
```

Replace with:

```tsx
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formattedCode = code.trim().toUpperCase();

    try {
      const res = await fetch('/api/link-account/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: formattedCode }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body?.error || 'An unexpected error occurred. Please try again.');
        setLoading(false);
        return;
      }

      setSuccess(true);
      setLoading(false);

      setTimeout(() => {
        router.refresh();
        router.push('/dashboard');
      }, 1500);
    } catch (err) {
      console.error('[LinkAccount] Unexpected error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Production build**

Run: `cd web && npm run build`
Expected: `✓ Compiled successfully`; `/link-account` and `/api/link-account/redeem` both appear in the route list; no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/link-account/page.tsx
git commit -m "$(printf 'feat(web): link-account page calls the new redeem route\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Activation and acceptance

**Files:** none (ops + acceptance test).

- [ ] **Step 1: Confirm the migration is applied**

If Task 1 Step 3 hasn't been confirmed yet, do it now before continuing.

- [ ] **Step 2: Redeploy the bot to Render**

Deploy the current `main` (commit from Task 3 or later) to the Render bot service. In Render's **Logs**, confirm the service reaches "Live" with no startup errors.

- [ ] **Step 3: Push and deploy the web app**

From the repo root:
```bash
git push origin main
npx vercel deploy --prod --yes
```
Wait for `readyState: READY`.

- [ ] **Step 4: Acceptance test — happy path**

In Telegram, send `/linkweb` to the bot. Confirm you receive a code in the `RMDR-######` format. In the Supabase SQL editor, confirm the stored row has no plaintext code:

```sql
SELECT id, telegram_chat_id, code_hash, expires_at FROM public.link_codes ORDER BY created_at DESC LIMIT 1;
```

Expected: one row, `code_hash` populated (64 hex characters), no `code` column exists at all (schema-level, not just null).

On the web app, go to `/link-account`, paste the code, submit. Expected: success screen, redirect to `/dashboard`, and `profiles.telegram_chat_id` for your account now matches the bot's chat id. Confirm the row is gone:

```sql
SELECT count(*) FROM public.link_codes WHERE telegram_chat_id = '<your chat id>';
```

Expected: `0`.

- [ ] **Step 5: Acceptance test — reuse is rejected**

Immediately submit the **same** code again on `/link-account` (or via `curl` against `/api/link-account/redeem` with a valid session cookie). Expected: a clean "Invalid verification code" error, HTTP 400 — not a crash, not a second successful link, and no change to `profiles.telegram_chat_id`.

- [ ] **Step 6: Acceptance test — rate limiting**

Generate a fresh code via `/linkweb`. From the web app (or `curl` with a valid session), submit 11 redemption requests within a short window (deliberately wrong codes are fine — the limit is per-IP, not per-code). Expected: the 11th response is HTTP 429 with the "Too many requests" message.

- [ ] **Step 7: Acceptance test — expiry**

Generate a fresh code via `/linkweb`. In the Supabase SQL editor, force it to look expired:

```sql
UPDATE public.link_codes SET expires_at = now() - interval '1 minute'
WHERE telegram_chat_id = '<your chat id>';
```

Submit that code on `/link-account`. Expected: "This verification code has expired..." error, HTTP 400. Confirm the row was deleted by the RPC:

```sql
SELECT count(*) FROM public.link_codes WHERE telegram_chat_id = '<your chat id>';
```

Expected: `0`.

---

## Self-Review

**Spec coverage:**
- RLS lockdown, no replacement policy → Task 1 (`DROP POLICY`, no `CREATE POLICY`), verified in Task 1 Step 3 and implicitly by every acceptance test in Task 5 (direct table access no longer works, only the RPC path is exercised). ✓
- Code hashed at rest (SHA-256, matches `phone_verifications`) → Task 1 (`code_hash` column, `sha256()` call verified against the live DB before writing this plan), Task 3 (bot hashes before insert). ✓
- Atomic redemption (single transaction) → Task 1, `redeem_link_code` does the update+delete in one `plpgsql` function body. ✓
- Rate-limited API route (not a direct client RPC call) → Task 2, exact `checkRateLimit` call from the spec. Verified in Task 5 Step 6. ✓
- `crypto.randomInt` instead of `Math.random()` → Task 3. ✓
- Error mapping matches the existing lower-case-`.includes()` convention → Task 2's route, using the exact RPC exception text from Task 1. ✓
- Non-atomic double-redemption bug fixed → covered by Task 1's atomicity + verified directly in Task 5 Step 5. ✓
- Deploy ordering (migration → bot → web) → Task 5 Steps 1-3, with the expected-error window called out in Task 1 Step 3 and Task 3 Step 5. ✓
- Manual acceptance testing (no practical unit test for the SQL logic) → Task 5 Steps 4-7, matching all six scenarios listed in the spec's Testing section. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; every command has expected output. ✓

**Type consistency:** The RPC name `redeem_link_code` and its parameter `p_code` (Task 1) match exactly what Task 2's route calls (`supabase.rpc('redeem_link_code', { p_code: parsed.data.code })`). The `code_hash` column name (Task 1) matches what Task 3's bot insert writes. The route path `/api/link-account/redeem` (Task 2) matches what Task 4's page fetches. The RPC's exact exception strings (`'Not authenticated'`, `'Invalid code'`, `'Code expired'`, Task 1) match the substrings Task 2's route checks for (`'expired'`, `'invalid code'`). ✓
