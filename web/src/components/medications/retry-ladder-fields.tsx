'use client';

/**
 * "If you do not answer" — the retry-ladder controls, shared by the add wizard
 * and the edit form.
 *
 * ONE COMPONENT BECAUSE THE VALIDATION MUST BE IDENTICAL. The rule is a safety
 * property, not a preference: `interval × count ≤ 30` exists because the server
 * clamps its escalation anchor at `created_at + 30 minutes`, and a longer ladder
 * would have the phone politely re-asking at +35 while the caregiver was already
 * being told the dose was missed. Two copies of that check is two chances for
 * one of them to drift, and the drift would be invisible until it mattered.
 *
 * DEFAULT IS A CHOICE, NOT AN EMPTY FIELD. The first version asked people to
 * "leave these empty to use the usual pattern", which makes the common case look
 * like an unfinished form — and on the ADD wizard, where the medication is being
 * decided rather than revisited, that reads as a question you failed to answer.
 * Two explicit options, default preselected, and the custom inputs only appear
 * once custom is chosen.
 *
 * THE PREVIEW SHOWS RINGS, NOT RULES. "+5, +10, +15 minutes after the dose is
 * due" is checkable against what the phone actually does. "5 × 5, max 30" is
 * arithmetic homework, and nobody does homework to check a reminder.
 *
 * Routine is excluded entirely — see `isConfigurable`. A supplement does not need
 * its own retry schedule, and it would be one more decision on a form that
 * already asks plenty.
 */

import React from 'react';
import {
  DEFAULT_LADDERS,
  RETRY_CAP_MINUTES,
  isConfigurable,
  ladderError,
  normalisePriority,
  retryOffsets,
} from '@/lib/schedule/retry-ladder';

export interface RetryLadderFieldsProps {
  priority: string;
  /** Empty string means "not set" — the inputs are text-typed for partial entry. */
  interval: string;
  count: string;
  onIntervalChange: (v: string) => void;
  onCountChange: (v: string) => void;
  isElderly: boolean;
  /** The host form's input styling, so this looks native to whichever page it is on. */
  inputClass: string;
  labelClass: string;
  /** Unique per page — both forms can be mounted in one app session. */
  idPrefix?: string;
}

/** True when either field carries a value, i.e. the user chose custom. */
export function isCustomLadder(interval: string, count: string): boolean {
  return interval.trim() !== '' || count.trim() !== '';
}

export default function RetryLadderFields({
  priority,
  interval,
  count,
  onIntervalChange,
  onCountChange,
  isElderly,
  inputClass,
  labelClass,
  idPrefix = 'retry',
}: RetryLadderFieldsProps) {
  if (!isConfigurable(priority)) return null;

  const level = normalisePriority(priority);
  const fallback = DEFAULT_LADDERS[level];
  const custom = isCustomLadder(interval, count);
  const problem = custom ? ladderError(Number(interval), Number(count)) : null;
  const offsets = retryOffsets(
    priority,
    custom ? { interval: Number(interval), count: Number(count) } : null,
  );

  const body = isElderly ? 'text-base' : 'text-xs';
  const option = `flex-1 min-h-11 px-3 rounded-xl border font-bold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    isElderly ? 'text-base py-3' : 'text-xs'
  }`;

  return (
    <div className="pt-4 border-t border-border">
      <label className={labelClass}>If you do not answer</label>
      <p className={`text-muted-foreground mb-3 ${body}`}>
        Your phone asks again before anyone in your care circle is told.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { onIntervalChange(''); onCountChange(''); }}
          aria-pressed={!custom}
          className={`${option} ${
            custom
              ? 'border-border bg-card text-foreground hover:bg-muted'
              : 'border-primary/40 bg-primary-soft text-primary-strong'
          }`}
        >
          Usual — every {fallback.interval} min, {fallback.count}{' '}
          {fallback.count === 1 ? 'time' : 'times'}
        </button>
        <button
          type="button"
          // Seeded with the default rather than blank, so the custom panel opens
          // on a valid, meaningful pair instead of two empty boxes and an error.
          onClick={() => {
            if (!custom) {
              onIntervalChange(String(fallback.interval));
              onCountChange(String(fallback.count));
            }
          }}
          aria-pressed={custom}
          className={`${option} ${
            custom
              ? 'border-primary/40 bg-primary-soft text-primary-strong'
              : 'border-border bg-card text-foreground hover:bg-muted'
          }`}
        >
          Choose my own
        </button>
      </div>

      {custom && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label htmlFor={`${idPrefix}-interval`} className={`block font-semibold text-muted-foreground mb-1.5 ${body}`}>
              Every (minutes)
            </label>
            <input
              id={`${idPrefix}-interval`}
              type="number"
              inputMode="numeric"
              min={1}
              max={RETRY_CAP_MINUTES}
              value={interval}
              onChange={(e) => onIntervalChange(e.target.value)}
              placeholder={String(fallback.interval)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-count`} className={`block font-semibold text-muted-foreground mb-1.5 ${body}`}>
              How many times
            </label>
            <input
              id={`${idPrefix}-count`}
              type="number"
              inputMode="numeric"
              min={1}
              max={RETRY_CAP_MINUTES}
              value={count}
              onChange={(e) => onCountChange(e.target.value)}
              placeholder={String(fallback.count)}
              className={inputClass}
            />
          </div>
        </div>
      )}

      {problem ? (
        <p className={`mt-2.5 font-semibold text-danger-strong ${body}`} role="alert">
          {problem}
        </p>
      ) : (
        <p className={`mt-2.5 text-muted-foreground font-semibold tabular-nums ${body}`}>
          Reminds you at {offsets.map((o) => `+${o}`).join(', ')} minutes after the dose is due.
        </p>
      )}
    </div>
  );
}
