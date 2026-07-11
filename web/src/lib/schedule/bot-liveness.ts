// Liveness + duplicate-send guards for the reminder send-failover cron.
// Pure (no I/O) so they are cheap to unit-test.

/**
 * True if the Render bot ticked within `thresholdMs`. A null/blank/unparseable
 * beat returns false (fail-safe: the web cron then takes over sending).
 */
export function isBotAlive(
  lastBeat: string | null | undefined,
  now: number = Date.now(),
  thresholdMs = 180_000,
): boolean {
  if (!lastBeat) return false;
  const t = new Date(lastBeat).getTime();
  if (Number.isNaN(t)) return false;
  return now - t < thresholdMs;
}

/**
 * True if a medication was sent within `windowMs` (mirrors the bot's 60s
 * anti-duplicate guard). Null/unparseable returns false (not recently sent).
 */
export function isRecentlySent(
  lastSentAt: string | null | undefined,
  now: number = Date.now(),
  windowMs = 60_000,
): boolean {
  if (!lastSentAt) return false;
  const t = new Date(lastSentAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t < windowMs;
}
