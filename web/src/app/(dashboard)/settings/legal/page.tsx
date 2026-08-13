import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, FileText, ShieldCheck, Stethoscope } from 'lucide-react';
import { resolveUserData } from '@/lib/supabase/cached-queries';

export const revalidate = 0;

/**
 * Settings → Privacy & terms. Three links, no prose.
 *
 * The pages themselves live OUTSIDE the dashboard group (/privacy, /terms,
 * /disclaimer) because they must be readable signed-out — they are linked from the
 * sign-in screen and from the Play listing. This page just makes them findable from
 * inside the app, which Play review also expects.
 */
const LINKS = [
  { href: '/privacy', label: 'Privacy policy', icon: ShieldCheck },
  { href: '/terms', label: 'Terms of service', icon: FileText },
  { href: '/disclaimer', label: 'Medical disclaimer', icon: Stethoscope },
];

export default async function LegalSettingsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header className="px-1">
        <h1 className="text-2xl font-black text-foreground tracking-tight">Privacy &amp; terms</h1>
      </header>

      <div className="rounded-3xl border border-border overflow-hidden divide-y divide-border">
        {LINKS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="w-full flex items-center gap-3 px-4 min-h-[56px] py-2.5 bg-card hover:bg-muted/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <span aria-hidden className="shrink-0 w-10 h-10 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center">
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
