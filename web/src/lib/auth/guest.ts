// Guest (anonymous) sessions — one definition, used by the server layout, the
// client gates, and the upgrade flow.
//
// A guest is a real Supabase user created by `signInAnonymously()`: real
// auth.uid(), real profile row (handle_new_user() makes it, same as any web-only
// signup), real RLS. The ONLY things that differ are `is_anonymous: true` on the
// JWT and the absence of an email. That is why converting a guest to a permanent
// account moves no data — the uid never changes.
//
// The database enforces the same distinction independently via
// `public.is_anonymous_user()` and the guard triggers in
// migration_anonymous_guests_2026_08_10.sql. Nothing here is a security control;
// these helpers exist so the UI can explain the boundary before the user hits it.

import type { User } from '@supabase/supabase-js';

/**
 * Is this session a no-signup guest?
 *
 * Defaults to FALSE for a null user and for older sessions issued before the
 * claim existed — the permissive direction, because the real gate is the DB
 * trigger. A false negative here shows a prompt the user does not need; a false
 * positive would lock a paying-attention real user out of their own care circle.
 */
export function isGuest(user: Pick<User, 'is_anonymous'> | null | undefined): boolean {
  return user?.is_anonymous === true;
}

/**
 * The sentinel raised by public.guard_guest_write(). PostgREST passes the
 * message through, so the client can tell "you need an account for this" apart
 * from a genuine failure and offer the upgrade instead of a red error.
 */
export const GUEST_GUARD_CODE = 'GUEST_ACCOUNT_REQUIRED';

/** Did this Supabase/Postgres error come from the guest write guard? */
export function isGuestGuardError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && message.includes(GUEST_GUARD_CODE);
}

/**
 * What a guest cannot do, and the sentence explaining why. Kept next to the
 * predicate so the copy cannot drift from the DB triggers it describes — if you
 * add a table to the guard migration, add its reason here.
 */
export const GUEST_LOCKED = {
  careCircle: 'Connecting with a caregiver needs a saved account, so they can still reach you tomorrow.',
  healthVault: 'Storing records needs a saved account — files would be lost with a guest session.',
  telegram: 'Linking Telegram needs a saved account to link it to.',
} as const;
