'use client';

// One button treatment for the whole app.
//
// Before this file every button was an inline Tailwind string — the dashboard alone
// carried five CTAs with four radii, four font sizes and a mix of `font-black`/`font-bold`,
// so nothing signalled which action was the primary one. Two rules are baked in here:
//
//   1. ONE `primary` per screen. Everything else is `secondary` or `ghost`. If two
//      things are solid pink, neither reads as the main action.
//   2. `danger` (solid red) is reserved for irreversible actions — deleting an account,
//      not signing out. Sign-out is `secondary`. They used to be class-for-class
//      identical, which is exactly the tap you cannot take back.
//
// Every size clears 44×44px so the controls stay usable with tremor or arthritis
// (Apple HIG / WCAG 2.2 target size). Elderly mode scales up from there.
//
// `<Link>` and `<a>` can't be this component, so the class builder is exported too:
//   <Link className={buttonClasses({ variant: 'secondary', isElderly })}>…</Link>

import React from 'react';
import { useUiMode } from '@/context/ui-mode-context';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'danger-ghost';

export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-strong text-primary-strong-foreground shadow-md shadow-primary/25 hover:bg-primary-strong-hover active:scale-[0.98]',
  secondary:
    'bg-card text-foreground border border-border hover:bg-muted active:scale-[0.98]',
  ghost:
    'bg-muted/70 text-foreground hover:bg-muted active:scale-[0.98]',
  danger:
    'bg-danger-strong text-card shadow-md shadow-danger/25 hover:brightness-95 active:scale-[0.98]',
  'danger-ghost':
    'bg-danger/10 text-danger-strong border border-danger/25 hover:bg-danger/15 active:scale-[0.98]',
};

// Minimum 44px height in every size — `sm` gets there through a shorter label and
// tighter padding rather than a shorter box.
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-11 px-3.5 text-xs gap-1.5 rounded-xl',
  md: 'h-12 px-5 text-sm gap-2 rounded-2xl',
  lg: 'h-14 px-6 text-base gap-2.5 rounded-2xl',
};

const ELDERLY_SIZES: Record<ButtonSize, string> = {
  sm: 'h-14 px-5 text-base gap-2 rounded-2xl',
  md: 'h-16 px-7 text-lg gap-2.5 rounded-2xl',
  lg: 'h-[72px] px-8 text-xl gap-3 rounded-3xl',
};

const BASE =
  'inline-flex items-center justify-center font-bold whitespace-nowrap transition-all ' +
  'cursor-pointer disabled:opacity-50 disabled:pointer-events-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-background';

export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  isElderly = false,
  fullWidth = false,
  className = '',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isElderly?: boolean;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  const sizing = isElderly ? ELDERLY_SIZES[size] : SIZES[size];
  return [BASE, VARIANTS[variant], sizing, fullWidth ? 'w-full' : '', className]
    .filter(Boolean)
    .join(' ');
}

/** Square icon-only control. Always labelled — see the required `label` prop. */
export function iconButtonClasses({
  variant = 'ghost',
  isElderly = false,
  className = '',
}: {
  variant?: ButtonVariant;
  isElderly?: boolean;
  className?: string;
} = {}): string {
  return [
    BASE,
    VARIANTS[variant],
    isElderly ? 'w-14 h-14 rounded-2xl' : 'w-11 h-11 rounded-full',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const { isElderly } = useUiMode();
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, isElderly, fullWidth, className })}
      {...rest}
    />
  );
}

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  variant?: ButtonVariant;
  /** Required: an icon with no text has no accessible name without it. `title` alone
   *  is not exposed reliably by screen readers and never on touch. */
  label: string;
}

export function IconButton({
  variant = 'ghost',
  label,
  className = '',
  type = 'button',
  children,
  ...rest
}: IconButtonProps) {
  const { isElderly } = useUiMode();
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={iconButtonClasses({ variant, isElderly, className })}
      {...rest}
    >
      {children}
    </button>
  );
}
