import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service-role';

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
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
