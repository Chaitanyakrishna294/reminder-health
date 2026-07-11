# `link_codes` Hijack + Brute-Force Hardening — Design Spec

**Date:** 2026-07-11
**Status:** Approved design, pending implementation plan
**Related:** `docs/KNOWN_ISSUES.md`, `src/commands.js` (`/linkweb`), `web/src/app/link-account/page.tsx`,
memory `render-bot-uses-service-role`, precedent: `web/src/app/api/voice/verify/{send,check}/route.ts`
(`phone_verifications.code_hash`)

## Problem

`link_codes` is the table backing Telegram-to-web account linking (`/linkweb` in the bot
generates a short code; the user pastes it into `/link-account` on the web app to attach
their Telegram identity — `profiles.telegram_chat_id` — to their Supabase auth account).
`profiles.telegram_chat_id` is the key every patient/caregiver data relationship in the
schema hangs off (medications, reminder_events, health vault, everything), so redeeming a
code is equivalent to claiming that person's entire data history.

Two independent, currently-exploitable paths let any authenticated user redeem **someone
else's** pending code, hijacking that identity onto their own login:

1. **Over-permissive RLS.** The table's only policy is `"Allow code verification by
   authenticated users"` — `ALL` commands, `qual: true`, for the `authenticated` role. Any
   logged-in user can `SELECT * FROM link_codes` with no filter (browse every pending code
   across every user currently mid-onboarding) or `DELETE`/`UPDATE` any row. This can't be
   fixed by narrowing the policy to "own rows only" — the web user doesn't have a
   `telegram_chat_id` yet; establishing one is the entire point of the flow. There is no
   ownership column to filter by. Possession of the code *is* the authorization, which is a
   shape RLS alone cannot express — it needs a SECURITY DEFINER RPC, matching how every
   other secret-possession check in this codebase already works (`invite_caregiver`,
   `resolve_reminder_event`, `phone_verifications`).
2. **No rate limiting.** `link-account/page.tsx` calls Supabase directly from the browser,
   bypassing the API-route layer where this codebase's `checkRateLimit()` fixed-window
   guard normally lives (`voice/verify/send`, `voice/verify/check`, `billing/*`, etc.). The
   code space is 1,000,000 values (`RMDR-######`) with a 15-minute TTL and no throttle, so a
   pure brute-force guess against a live code is realistic within its window — a second,
   independent path to the same hijack outcome that fixing RLS alone would not close.

A third, smaller bug compounds both: the current redemption is two unguarded, non-atomic
client calls — `UPDATE profiles.telegram_chat_id` followed by `DELETE FROM link_codes`, with
**no error handling on the delete**. If the delete silently fails, the "used" code remains
valid for up to 15 more minutes and a second user can redeem it again, re-linking the same
Telegram identity onto a different profile.

## Goal / non-goals

**Goal:** Close both hijack paths (RLS + brute force) and the non-atomic redemption bug,
using the exact patterns this codebase already established elsewhere, so the change reads
as consistent rather than a one-off.

**Non-goals:** Changing the `/linkweb` UX, the code format/length, or the 15-minute TTL.
Not building a general secrets-hashing abstraction — this mirrors `phone_verifications`
directly rather than extracting a shared helper (YAGNI; two call sites don't justify one).

## Approach

**Chosen: SECURITY DEFINER `redeem_link_code` RPC, code hashed at rest, redemption moved
behind a new rate-limited API route.**

- **RLS lockdown, no replacement policy.** Drop the always-true policy and add nothing back
  — direct table access from any client role is never legitimate here. The bot already
  writes via its service_role key, which bypasses RLS regardless (memory
  `render-bot-uses-service-role`), so locking the table down doesn't touch the write path.
- **Hash the code at rest (SHA-256), not plaintext.** Matches `phone_verifications.code_hash`
  exactly. Defense-in-depth: even if RLS were ever misconfigured again, or the table
  contents leaked through some other surface (an admin tool, a backup, a future feature), no
  usable code would be exposed. The plaintext code only ever exists transiently — in the
  bot's Telegram DM to the user and in the browser's form input — never in a persisted row.
- **Atomic RPC, not two client calls.** `redeem_link_code(p_code text)` does the hash lookup,
  the expiry check, the `profiles` update, and the `link_codes` delete in one transaction.
  Removes the non-atomic bug by construction — there is no window where a code is "used but
  not deleted."
- **Rate-limited API route, not a direct RPC call from the client.** Supabase RPCs can be
  invoked from the browser at the same volume as a direct table query — moving to an RPC
  alone does not add throttling. A `POST /api/link-account/redeem` route wraps the RPC call
  in `checkRateLimit()`, the only place in this codebase that pattern lives, keyed by client
  IP (mirrors `voice/verify/check`'s 10-per-10-minutes).
- **Bot generates the code with `crypto.randomInt`, not `Math.random`.** `Math.random()` is
  not cryptographically secure. Since `/linkweb` is being edited anyway (to hash before
  insert), swapping the generator in the same function is a zero-marginal-risk fix, not
  scope creep — it's the same file, same lines, same deploy.

**Rejected: narrow the RLS policy instead of an RPC.** As explained above, there is no
column to scope by for an unauthenticated-identity-establishing flow; this doesn't actually
solve the problem, only makes it slightly harder to exploit via the ORM instead of raw SQL.

**Rejected: keep the code in plaintext, fix only RLS + rate limiting.** Would close both
demonstrated attack paths on its own. Rejected because it leaves a plaintext secret
persisted with no reason to, when this codebase already has a proven hashing pattern one
file away (`phone_verifications`) — hashing costs one column and one hash call on each side,
and removes an entire class of future exposure (misconfig, leak, backup) for that price.

## Components

- **Migration** `db/migrations/migration_link_codes_hardening_2026_07.sql`:
  - `ALTER TABLE link_codes ADD COLUMN code_hash text`, `DROP COLUMN code` (clean cutover —
    rows are 15-minute-TTL and the table is near-empty at any given moment in this app's
    traffic; no dual-write transition period is needed).
  - `DROP POLICY "Allow code verification by authenticated users"` — no replacement.
  - `CREATE FUNCTION redeem_link_code(p_code text)` — `SECURITY DEFINER`,
    `SET search_path = 'public'`. Requires `auth.uid()` non-null. Hashes the input
    (uppercased/trimmed, matching the bot's always-uppercase `RMDR-######` format) and looks
    up by `code_hash`. Raises a distinct, mappable error for "not found" vs. "expired" (the
    expired case also deletes the stale row before raising, so it doesn't linger). On match:
    updates `profiles.telegram_chat_id` for the calling user and deletes the `link_codes` row,
    both inside the function's implicit transaction.
  - `GRANT EXECUTE ... TO authenticated`, `REVOKE ... FROM anon` (the caller is always a
    signed-in web user completing onboarding).
- **New route** `web/src/app/api/link-account/redeem/route.ts`: `POST`, requires an
  authenticated session, `checkRateLimit('link-account:redeem:' + ip, 10, 600)` before
  calling the RPC (429 on trip, matching the existing `tooManyRequests()` helper). Maps the
  RPC's specific error text to the same user-facing strings the page already shows today
  (invalid code / expired code), plus the new rate-limited case.
- **Bot** `src/commands.js`, `/linkweb` handler: generates the code with
  `crypto.randomInt(100000, 1000000)` instead of `Math.random()`; inserts `code_hash`
  (SHA-256 hex of the generated code) instead of plaintext `code`. The message sent to the
  user in Telegram is unchanged — they still see and paste the plain code; only what's
  persisted server-side changes.
- **Web page** `web/src/app/link-account/page.tsx`: `handleVerify` replaces its direct
  `link_codes`/`profiles` Supabase calls with a single `fetch('/api/link-account/redeem', ...)`
  call. Same success/redirect behavior; same error copy for the existing cases; one new
  branch for a 429 response.

## Data flow

```
Telegram /linkweb
  -> bot: crypto.randomInt code, SHA-256 hash, INSERT link_codes(code_hash, telegram_chat_id, expires_at)
  -> bot DMs the plaintext code to the user (unchanged)
User pastes code into /link-account (web)
  -> POST /api/link-account/redeem { code }
     -> auth check (401 if unauthenticated)
     -> checkRateLimit(ip) (429 if tripped)
     -> supabase.rpc('redeem_link_code', { p_code: code })
        -> hash input, look up by code_hash
        -> not found -> raise "Invalid code"
        -> expired -> delete row, raise "Code expired"
        -> match -> UPDATE profiles.telegram_chat_id + DELETE link_codes row (atomic)
     -> 200 on success / mapped error text otherwise
  -> page shows success and redirects to /dashboard (unchanged), or the mapped error
```

## Error handling

- Unauthenticated request to the route → 401 (mirrors every other authed route in this
  codebase).
- Rate limit tripped → 429 via the existing `tooManyRequests()` helper.
- Code not found (never existed, already redeemed, or wrong guess) → RPC raises, route maps
  to the existing "Invalid verification code" copy — deliberately indistinguishable from
  "expired" or "already used" to avoid leaking which case applies to a guesser.
- Code found but expired → RPC deletes the stale row, raises, route maps to the existing
  "This verification code has expired" copy.
- Any other RPC failure (unexpected) → route returns a generic "Failed to link account,
  please try again" 500, matching this codebase's existing catch-all pattern.

## Testing

The core logic (hash lookup, expiry check, atomic update+delete) is SQL inside the RPC, not
JS — not practically unit-testable the way `dose-engine.test.ts` or `bot-liveness.test.ts`
are. Verification is a manual acceptance pass after deploy, the same shape as the
send-failover acceptance test:
1. Generate a real code via `/linkweb` in Telegram.
2. Confirm the DB row has a `code_hash`, no plaintext `code` column.
3. Redeem it through the web flow; confirm `profiles.telegram_chat_id` updates and the row
   is deleted.
4. Attempt to redeem the same code again; confirm a clean "invalid code" error (not a crash,
   not a second successful link).
5. Attempt >10 redemption calls within 10 minutes from the same origin; confirm the 11th
   returns 429.
6. Manually expire a code (or wait out the TTL) and confirm redemption fails with "expired"
   and the row is gone afterward.

## Deploy ordering

Same playbook already used for the send-failover heartbeat rollout: **apply migration →
redeploy bot → deploy web.** There is a brief window after the migration where the
old (pre-deploy) bot's `/linkweb` still tries to insert a `code` column that no longer
exists, and will error until the bot redeploys. Low-stakes and time-bounded: `/linkweb` is a
one-time onboarding command, not on any reminder-delivery critical path — the same
trade-off already accepted for the heartbeat migration.

## Risks / open items

- **PostgreSQL's built-in `sha256()`** (via `encode(sha256(convert_to(text,'UTF8')),'hex')`)
  requires PG 13+; Supabase projects run modern PG, but the exact syntax should be smoke-
  tested against this project during implementation rather than assumed correct from this
  spec.
- **Hash-uppercasing consistency:** the bot always generates uppercase codes
  (`RMDR-######`), and the web page already `.trim().toUpperCase()`s user input before
  today's lookup — the RPC must apply the same normalization before hashing so a
  user-pasted code with stray whitespace or lowercase still matches. This is a detail the
  implementation plan must get exactly right, not a design ambiguity (the normalization rule
  itself — trim + uppercase — is unambiguous and already precedented in the current code).
