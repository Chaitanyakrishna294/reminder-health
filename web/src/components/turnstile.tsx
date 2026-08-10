'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
// If the widget hasn't rendered by this point (script blocked, slow/dead
// network, restrictive webview), stop waiting silently and show a fallback.
const LOAD_TIMEOUT_MS = 8000;

/** True when a Turnstile site key is configured. Forms use this to decide
 *  whether a CAPTCHA token is required before submitting. */
export const captchaEnabled = !!SITE_KEY;

/**
 * Cloudflare Turnstile widget. Renders nothing (and never blocks) until
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so the app works out of the box and
 * CAPTCHA can be switched on later by adding the key + enabling it in Supabase.
 *
 * If the Cloudflare script fails to load or never calls back within
 * LOAD_TIMEOUT_MS, this shows a visible error + Retry instead of leaving the
 * caller stuck on a blank div with no token and no explanation (the original
 * failure mode — confirmed to have no mitigation, see Android M0 checklist).
 */
export default function Turnstile({ onVerify }: { onVerify: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;
    let widgetId: string | null = null;

    const timeoutId = window.setTimeout(() => {
      if (!cancelled && widgetId === null) setStatus('failed');
    }, LOAD_TIMEOUT_MS);

    const render = () => {
      if (cancelled || !ref.current || !window.turnstile || widgetId !== null) return;
      widgetId = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        callback: (token: string) => onVerifyRef.current(token),
        'expired-callback': () => onVerifyRef.current(null),
        'error-callback': () => {
          onVerifyRef.current(null);
          if (!cancelled) setStatus('failed');
        },
      });
      window.clearTimeout(timeoutId);
      if (!cancelled) setStatus('ready');
    };

    const onScriptError = () => {
      window.clearTimeout(timeoutId);
      if (!cancelled) setStatus('failed');
    };

    if (window.turnstile) {
      render();
    } else {
      let script = document.getElementById('cf-turnstile-script') as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement('script');
        script.id = 'cf-turnstile-script';
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', render);
      script.addEventListener('error', onScriptError);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (widgetId !== null && window.turnstile) {
        try { window.turnstile.remove(widgetId); } catch { /* ignore */ }
      }
    };
  }, [retryKey]);

  if (!SITE_KEY) return null;

  if (status === 'failed') {
    return (
      <div className="bg-danger/10 text-danger-strong text-sm p-3 rounded-2xl border border-danger/20 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
        <div className="flex flex-col items-start gap-1.5">
          <span>Verification failed to load. Check your connection and try again.</span>
          <button
            type="button"
            onClick={() => {
              document.getElementById('cf-turnstile-script')?.remove();
              delete window.turnstile;
              onVerifyRef.current(null);
              setStatus('loading');
              setRetryKey((k) => k + 1);
            }}
            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <div ref={ref} className="flex justify-center" />;
}
