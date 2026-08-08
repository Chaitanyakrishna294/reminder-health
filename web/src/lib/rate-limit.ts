import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service-role';

/** Best-effort client IP from proxy headers, resistant to header spoofing. */
export function getClientIp(request: Request): string {
  // SECURITY: never trust the LEFTMOST x-forwarded-for entry — it is client-supplied
  // (an attacker can prepend arbitrary IPs), so keying rate limits on it lets every
  // request land in a fresh bucket and bypasses the limiter entirely. On Vercel,
  // x-real-ip is set by the edge to the true client IP and overwrites any incoming
  // value, so it cannot be spoofed. Prefer it.
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  // Fallback for non-Vercel / local dev: use the LAST x-forwarded-for hop (the one the
  // nearest trusted proxy appended), not the attacker-controlled leftmost token.
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return 'unknown';
}

/**
 * Fixed-window rate limit backed by the Postgres `check_rate_limit` RPC.
 * Returns true if the request is ALLOWED, false if it is over the limit.
 * Fails OPEN (returns true) on any DB error so a transient hiccup can't lock
 * users out. Swap the body for Upstash/Redis later without touching callers.
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error('[RateLimit] check failed, failing open:', error);
      return true;
    }
    return data === true;
  } catch (e) {
    console.error('[RateLimit] error, failing open:', e);
    return true;
  }
}

/** Standard 429 response for a rate-limited request. */
export function tooManyRequests(): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Please slow down and try again shortly.' },
    { status: 429 }
  );
}
