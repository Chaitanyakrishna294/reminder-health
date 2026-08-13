'use client';

// One setup item: what it is, why alarms die without it, numbered steps, a
// deep-link button, and a status.
//
// Shared by the dashboard banner and the permanent Settings guide so the two can
// never drift into telling the user different things about the same switch.
//
// The steps are visible by default whenever the item is NOT satisfied. That is
// deliberate: on the vivo test device the deep link landed on generic App Info
// and the user then hunted for three minutes. Written steps hidden behind a
// "show me how" toggle would have been just as invisible during that hunt.

import { useState } from 'react';
import { openReliabilitySetting } from '@/lib/native/schedule-bridge';
import type { ReliabilityTarget } from '@/lib/native/schedule-bridge';
import type { SetupItem } from '@/lib/native/setup-guide';
import { Check, ChevronRight, CircleAlert } from 'lucide-react';

interface SetupStepCardProps {
  item: SetupItem;
  satisfied: boolean;
  /** Shown for items Android cannot verify, so the user can confirm themselves. */
  onMarkDone?: (id: ReliabilityTarget) => void;
  onUndoDone?: (id: ReliabilityTarget) => void;
}

export default function SetupStepCard({ item, satisfied, onMarkDone, onUndoDone }: SetupStepCardProps) {
  // Null until tried. False means native exhausted its whole intent chain, which
  // is the case where the written steps are the ONLY thing that helps.
  const [deepLinkFailed, setDeepLinkFailed] = useState(false);

  const openSetting = async () => {
    const opened = await openReliabilitySetting(item.id).catch(() => false);
    setDeepLinkFailed(!opened);
  };

  return (
    <li className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
            satisfied ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning-strong'
          }`}
        >
          {satisfied
            ? <Check className="h-3.5 w-3.5" aria-hidden="true" />
            : <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold text-foreground">{item.title}</p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                satisfied ? 'bg-success/15 text-success' : 'bg-warning/20 text-warning-strong'
              }`}
            >
              {satisfied ? 'Done' : item.autoDetected ? 'Needs your attention' : 'Please check'}
            </span>
          </div>

          <p className="mt-1 text-xs text-muted-foreground">{item.why}</p>

          {!satisfied && (
            <>
              <ol className="mt-2.5 space-y-1.5">
                {item.steps.map((step, i) => (
                  <li key={step} className="flex gap-2 text-xs text-foreground">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0">{step}</span>
                  </li>
                ))}
              </ol>

              {/* HOW YOU KNOW IT WORKED. A checklist that ends on its last
                  instruction ends in doubt — you did four things and the only
                  confirmation is your own memory. Naming the visible end state also
                  rescues someone whose phone routed them through different menus but
                  who arrived at the right screen anyway. */}
              <p className="mt-2.5 flex gap-2 rounded-lg bg-success/10 px-2.5 py-2 text-[11px] font-semibold text-success-strong">
                <Check className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0">{item.done}</span>
              </p>

              {deepLinkFailed && (
                <p className="mt-2 rounded-lg bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  Your phone would not let the app open that screen directly — please follow the
                  steps above.
                </p>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openSetting}
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 cursor-pointer"
                >
                  Take me there
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>

                {/* Only for what Android cannot tell us. Offering "mark as done"
                    on a detectable item would let the checklist disagree with
                    reality, which is worse than having no checklist. */}
                {!item.autoDetected && onMarkDone && (
                  <button
                    type="button"
                    onClick={() => onMarkDone(item.id)}
                    className="min-h-11 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
                  >
                    Mark as done
                  </button>
                )}
              </div>
            </>
          )}

          {satisfied && !item.autoDetected && onUndoDone && (
            <button
              type="button"
              onClick={() => onUndoDone(item.id)}
              className="mt-1.5 min-h-11 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground cursor-pointer"
            >
              I need to check this again
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
