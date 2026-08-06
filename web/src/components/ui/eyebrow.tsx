'use client';

// The small-caps label that sits above a value or a section heading.
//
// Six files carried their own version of `text-[10px] font-black uppercase tracking-wider`
// at four different weights and three different letter-spacings, and at that size the
// lighter ones stopped reading as labels and just looked like undersized body text.
// One scale, slightly wider tracking, and a muted-but-legible default color.

import React from 'react';
import { useUiMode } from '@/context/ui-mode-context';

export function Eyebrow({
  as: Tag = 'p',
  className = '',
  children,
}: {
  as?: 'p' | 'h2' | 'h3' | 'h4' | 'span' | 'div';
  className?: string;
  children: React.ReactNode;
}) {
  const { isElderly } = useUiMode();
  return (
    <Tag
      className={`font-black uppercase text-muted-foreground ${
        isElderly
          ? 'text-sm tracking-[0.14em]'
          : 'text-[11px] tracking-[0.12em]'
      } ${className}`}
    >
      {children}
    </Tag>
  );
}
