'use client';

// Shared pieces of the "we emailed you something" auth screens (login sign-in
// code, register confirmation code, password-reset link). Centralised because
// both carry non-obvious details that must not drift per page:
//
// - The code input's letter-spacing is an INLINE style: globals.css's unlayered
//   `.font-mono { letter-spacing: -0.01em }` outranks any Tailwind utility
//   (unlayered CSS beats @layer utilities), so `tracking-*` silently loses.
// - The spam wording exists because the free Gmail SMTP sender lands in Spam
//   for most new users (see docs — Resend/domain deferred to stay free).

import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';

export function CodeInput({
  id,
  value,
  onChange,
  autoFocus = false,
}: {
  id: string;
  value: string;
  /** Receives digits only — non-digits are stripped before this is called. */
  onChange: (digits: string) => void;
  autoFocus?: boolean;
}) {
  const { isElderly } = useUiMode();
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={10}
      required
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      className={`w-full px-4 rounded-2xl bg-white border border-border text-foreground shadow-sm text-center font-mono placeholder:tracking-normal placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all ${isElderly ? 'py-5 text-3xl' : 'py-4 text-2xl'}`}
      style={{ letterSpacing: '0.35em' }}
      placeholder="Enter code"
    />
  );
}

export function SpamCallout({ noun = 'code' }: { noun?: 'code' | 'link' }) {
  const { isElderly } = useUiMode();
  return (
    <div className="rounded-2xl bg-primary-soft border border-primary/20 p-4 flex items-start gap-3 text-left">
      <ShieldCheck
        className={`shrink-0 mt-0.5 text-primary-strong ${isElderly ? 'w-6 h-6' : 'w-5 h-5'}`}
        aria-hidden
      />
      <div className={isElderly ? 'text-base' : 'text-xs'}>
        <p className="font-bold text-primary-strong">Didn&apos;t get the {noun}?</p>
        <p className="mt-1 text-foreground/80">
          {/* Explicit {' '} — this JSX transform drops the leading space of the
              text node that follows an inline element. */}
          Check your <b>Spam / Junk</b>{' '}folder and mark it &quot;Not spam&quot; — it
          usually arrives within a minute.
        </p>
      </div>
    </div>
  );
}
