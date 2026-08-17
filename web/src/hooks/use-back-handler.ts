'use client';

import { useEffect, useRef } from 'react';
import { pushBackHandler } from '@/lib/navigation/back-stack';

/**
 * Claim the hardware back press while `active` is true.
 *
 * ```tsx
 * useBackHandler(previewUrl !== null, closePreview);
 * ```
 *
 * The handler is held in a ref and the effect depends ONLY on `active`. That is
 * load-bearing rather than tidiness: registration order is what decides which
 * overlay wins, so re-registering whenever an inline closure changes identity —
 * i.e. on nearly every render — would silently shuffle a dialog underneath the
 * viewer it was opened on top of.
 */
export function useBackHandler(active: boolean, handler: () => void): void {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => latest.current());
  }, [active]);
}

/**
 * Marks a FOCUSED TASK — a surface that owns the whole screen while it is open.
 *
 * Stamps `data-focus-task` on <html>, which one rule in globals.css uses to hide
 * the floating bottom nav. The nav lives in the dashboard layout and the tasks that
 * conflict with it (the vault upload wizard) live several components away with no
 * shared state, so this is the seam between them.
 *
 * It is the same class of bug as the dose gate: two `position: fixed` elements
 * fighting for the bottom edge, where the one that wins is decided by stacking
 * context rather than by intent.
 *
 * Counted, not boolean — two focused tasks could overlap, and the last one to close
 * must not clear the flag while another is still open.
 */
let focusCount = 0;

export function useFocusTask(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    focusCount += 1;
    document.documentElement.dataset.focusTask = '1';
    return () => {
      focusCount = Math.max(0, focusCount - 1);
      if (focusCount === 0) delete document.documentElement.dataset.focusTask;
    };
  }, [active]);
}
