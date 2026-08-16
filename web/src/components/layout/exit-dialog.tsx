'use client';

/**
 * "Exit the app?" — the guard on the Android back button at a root page.
 *
 * WHY IT EXISTS. Back from a tab destination leaves the app. That is correct Android
 * behaviour and it is also, for the person this product is for, indistinguishable
 * from the app breaking: one stray tap and "the app disappeared". A confirm costs a
 * tap and removes a whole category of support call.
 *
 * CANCEL IS THE PRIMARY BUTTON. The dangerous action is the one that is hard to undo
 * for someone who is not sure how they got here, so the safe action takes the accent
 * and Exit is a ghost. This inverts the usual "confirm is primary" habit deliberately.
 *
 * THE COPY DOES NOT WARN. Alarms are registered natively with AlarmManager and fire
 * whether this webview is open, backgrounded or dead — so a line like "you'll stop
 * getting reminders" would be false. The only thing worth saying is the reassurance,
 * which is why Remi is here at all: `happy`, never `peaceful`, because a sleeping
 * mascot on a goodbye screen implies the reminders sleep too.
 */

import React, { useEffect, useRef } from 'react';
import { useUiMode } from '@/context/ui-mode-context';
import BrainMascot from '@/components/dashboard/brain-mascot';
import { MASCOT_SLOTS } from '@/components/dashboard/mascot-slots';

interface ExitDialogProps {
  open: boolean;
  onCancel: () => void;
  onExit: () => void;
}

export default function ExitDialog({ open, onCancel, onExit }: ExitDialogProps) {
  const { isElderly } = useUiMode();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const slot = MASCOT_SLOTS.dialog;

  useEffect(() => {
    if (!open) return;
    // Focus the SAFE action, so a second reflexive tap of anything cancels rather
    // than exits — the same instinct that makes Cancel the primary button.
    const t = setTimeout(() => cancelRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open, onCancel]);

  if (!open) return null;

  // Radius joins the scale (§2). Branch-guarded: the dialog renders in every
  // mode and elderly is excluded, so it keeps the 16 it had.
  const btn = `w-full font-bold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
    isElderly ? 'rounded-2xl min-h-16 text-lg' : 'rounded-[var(--r-control)] min-h-12 text-sm'
  }`;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-5 bg-foreground/40 backdrop-blur-[2px]"
      // The backdrop cancels: tapping away from a question is a way of not
      // answering it, and not answering must never be the destructive branch.
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="exit-dialog-title"
        aria-describedby="exit-dialog-body"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs card-lift card-lift-2 p-6 flex flex-col items-center text-center gap-4"
      >
        <BrainMascot size={isElderly ? slot.elderlySize : slot.size} mood={slot.mood} />

        <div className="space-y-1">
          <h2 id="exit-dialog-title" className={`font-black text-foreground ${isElderly ? 'text-2xl' : 'text-lg'}`}>
            Exit the app?
          </h2>
          <p id="exit-dialog-body" className={`text-muted-foreground font-semibold text-balance ${isElderly ? 'text-base' : 'text-xs'}`}>
            Your reminders will keep working.
          </p>
        </div>

        <div className="w-full space-y-2 pt-1">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className={`${btn} bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onExit}
            className={`${btn} text-muted-foreground hover:bg-muted`}
          >
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}
