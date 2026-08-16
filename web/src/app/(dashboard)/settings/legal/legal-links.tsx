'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight, FileText, ShieldCheck, Stethoscope } from 'lucide-react';
import { useLanguage } from '@/context/language-context';

/**
 * The three links, translated. The destinations are unchanged — /privacy, /terms and
 * /disclaimer live OUTSIDE the dashboard group because they must be readable
 * signed-out, and each of those pages picks up the same locale from the same
 * provider, so the label and the document it opens always agree.
 */
export default function LegalLinks() {
  const { t } = useLanguage();

  const links = [
    { href: '/privacy', label: t.legal.privacy, icon: ShieldCheck },
    { href: '/terms', label: t.legal.terms, icon: FileText },
    { href: '/disclaimer', label: t.legal.disclaimer, icon: Stethoscope },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header className="px-1">
        <h1 className="title-page text-foreground">{t.legal.title}</h1>
      </header>

      <div className="card-lift overflow-hidden divide-y divide-border">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="w-full flex items-center gap-3 px-4 min-h-[56px] py-2.5 bg-card hover:bg-muted/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <span aria-hidden className="shrink-0 w-10 h-10 rounded-[var(--r-control)] bg-muted text-muted-foreground flex items-center justify-center">
              <Icon className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0 font-bold text-foreground text-[15px]">{label}</span>
            <ChevronRight aria-hidden className="shrink-0 w-4 h-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}
