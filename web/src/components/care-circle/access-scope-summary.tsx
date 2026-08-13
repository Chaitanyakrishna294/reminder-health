'use client';

/**
 * "Here is what they will be able to see" — shown BEFORE an invitation is sent.
 *
 * WHY THIS EXISTS. The connect flow resolved a code to a name and immediately
 * called `invite_caregiver`. One tap, and someone gained standing access to your
 * medication list and your missed doses, with nothing on screen having said so.
 * The consent was real and the information was not.
 *
 * BOTH LISTS, ALWAYS. Saying only what they CAN see leaves the reader to assume
 * the rest — and people assume in whichever direction they already feared. The
 * "cannot" column is the one that makes this reassuring rather than alarming,
 * and it is the reason the Health Vault line is worth printing even though the
 * answer is no.
 *
 * The words come from lib/care-circle/access-scope.ts, which also holds the
 * defaults the database actually applies. This component never decides what a
 * permission means.
 */

import React from 'react';
import { Check, X } from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';
import { describeAccess, type AccessFlags } from '@/lib/care-circle/access-scope';

export default function AccessScopeSummary({
  flags,
  personName,
}: {
  flags: AccessFlags;
  /** Used in the heading so the reader sees WHO, not "this caregiver". */
  personName: string;
}) {
  const { isElderly } = useUiMode();
  const { can, cannot } = describeAccess(flags);

  const item = `flex items-start gap-2 ${isElderly ? 'text-base' : 'text-[13px]'}`;
  const icon = isElderly ? 'w-5 h-5' : 'w-4 h-4';

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-4">
      <p className={`font-extrabold text-foreground ${isElderly ? 'text-lg' : 'text-sm'}`}>
        What {personName} will be able to see
      </p>

      {can.length > 0 && (
        <ul className="space-y-2">
          {can.map((line) => (
            <li key={line} className={`${item} text-foreground font-semibold`}>
              <Check className={`${icon} shrink-0 mt-0.5 text-success-strong`} aria-hidden />
              <span className="min-w-0">{line}</span>
            </li>
          ))}
        </ul>
      )}

      {cannot.length > 0 && (
        <div className="space-y-2">
          <p className={`font-bold text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
            They will not be able to:
          </p>
          <ul className="space-y-2">
            {cannot.map((line) => (
              <li key={line} className={`${item} text-muted-foreground font-semibold`}>
                <X className={`${icon} shrink-0 mt-0.5`} aria-hidden />
                <span className="min-w-0">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Says the decision is reversible, which is the fact that makes it
          possible to say yes. Named where it happens, not vaguely "in settings". */}
      <p className={`text-muted-foreground font-semibold ${isElderly ? 'text-base' : 'text-xs'}`}>
        You can change any of this later, or disconnect them, from Care circle.
      </p>
    </div>
  );
}
