'use client';

/**
 * One row of the Settings hub: soft icon tile · label · optional value · chevron.
 *
 * The hub replaced a single long-scrolling page where every control was expanded at
 * once — theme, elderly mode, the connect code, care-circle identity, the setup
 * guide, delete account. Finding anything meant reading everything, and the one
 * genuinely destructive control sat in the same visual language as a display
 * preference. Rows put each concern behind its own door, which also means a new
 * setting has an obvious home instead of being appended to the bottom.
 *
 * A LINK, not a button, when it navigates: it pushes onto the stack like every other
 * sub-page, so Android back and the layout's <PageBack /> both work without this
 * component knowing they exist.
 */

import React from 'react';
import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';

interface SettingsRowProps {
  icon: LucideIcon;
  label: string;
  /** Shown right-aligned before the chevron — mono, for values like "English". */
  value?: string;
  href?: string;
  onClick?: () => void;
  /**
   * Quiet danger. Ink, not a red shout: Log out is not a mistake, it is just the
   * one row you should not hit by accident. Colour that screams here would make
   * every OTHER row look safe by comparison, which is the wrong lesson.
   */
  tone?: 'default' | 'danger';
}

export default function SettingsRow({
  icon: Icon, label, value, href, onClick, tone = 'default',
}: SettingsRowProps) {
  const { isElderly } = useUiMode();

  const body = (
    <>
      <span
        aria-hidden
        className={`shrink-0 rounded-2xl flex items-center justify-center ${
          isElderly ? 'w-14 h-14' : 'w-10 h-10'
        } ${tone === 'danger' ? 'bg-danger/10 text-danger-strong' : 'bg-muted text-muted-foreground'}`}
      >
        {/* 28px in elderly — the written floor. */}
        <Icon className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
      </span>

      <span className={`flex-1 min-w-0 font-bold text-left ${
        isElderly ? 'text-xl' : 'text-[15px]'
      } ${tone === 'danger' ? 'text-danger-strong' : 'text-foreground'}`}>
        {label}
      </span>

      {value && (
        <span className={`shrink-0 font-mono tabular-nums text-muted-foreground ${
          isElderly ? 'text-base' : 'text-xs'
        }`}>
          {value}
        </span>
      )}

      <ChevronRight
        aria-hidden
        className={`shrink-0 text-muted-foreground ${isElderly ? 'w-6 h-6' : 'w-4 h-4'}`}
      />
    </>
  );

  // 56px elderly / 44px otherwise — the floor, applied to the ROW so the whole
  // strip is the target rather than the label inside it.
  const cls = `w-full flex items-center gap-3 px-4 bg-card hover:bg-muted/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
    isElderly ? 'min-h-[72px] py-3' : 'min-h-[56px] py-2.5'
  }`;

  if (href) return <Link href={href} className={cls}>{body}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{body}</button>;
}

/** A titled group of rows. The title is a structural eyebrow, so uppercase mono. */
export function SettingsGroup({
  title, children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const { isElderly } = useUiMode();
  return (
    <section className="space-y-2">
      {title && (
        <h2 className={`font-mono uppercase tracking-[0.14em] text-muted-foreground px-1 ${
          isElderly ? 'text-sm' : 'text-[11px]'
        }`}>
          {title}
        </h2>
      )}
      {/* One rounded card with hairline dividers, rather than a gap between every
          row: the group is the object, the rows are its contents. */}
      <div className="rounded-3xl border border-border overflow-hidden divide-y divide-border">
        {children}
      </div>
    </section>
  );
}
