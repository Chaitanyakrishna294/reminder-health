'use client';

/**
 * The in-app back arrow every sub-page carries.
 *
 * TWO DOORS, same rule as notification deletion: the system back button is the
 * gesture people expect, and a visible control is the one that actually works. An
 * elderly user often does not know the phone's back gesture exists, and on the web
 * there is no hardware button at all — so a sub-page whose only exit is the system
 * back is a sub-page some people cannot leave.
 *
 * `fallback` is not decoration. A deep link (a notification opening
 * /dashboard?day=…) can land here with nothing behind it in history; without a
 * fallback, back would do nothing at all and the arrow would look broken.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';

export default function PageBack({
  fallback = '/dashboard',
  label = 'Back',
}: {
  /** Where to go when this page was opened directly and there is no history. */
  fallback?: string;
  /** Accessible name. Say where it goes when that is not obvious. */
  label?: string;
}) {
  const router = useRouter();
  const { isElderly } = useUiMode();

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.replace(fallback);
      }}
      className={`shrink-0 -ml-2 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        isElderly ? 'w-14 h-14' : 'w-11 h-11'
      }`}
    >
      <ArrowLeft className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} aria-hidden />
    </button>
  );
}
