import React from 'react';
import { redirect } from 'next/navigation';
import { Mail } from 'lucide-react';
import { resolveUserData } from '@/lib/supabase/cached-queries';

export const revalidate = 0;

/** The support address from the Play listing — one source, kept in sync there. */
const SUPPORT_EMAIL = 'hello.remindre@gmail.com';

/**
 * Settings → Help & support.
 *
 * One real way to reach a person, and nothing else yet. An FAQ belongs here when
 * there are questions worth answering; inventing one now would mean writing answers
 * to questions nobody has asked, which is how help pages end up unread.
 *
 * Reachable in ELDERLY mode, deliberately — it is one of the three rows that survive
 * the filter, because "I don't know what to do" is the situation it exists for.
 */
export default async function HelpSettingsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header className="px-1">
        <h1 className="text-2xl font-black text-foreground tracking-tight">Help &amp; support</h1>
        <p className="text-xs text-muted-foreground font-semibold mt-1">
          Tell us what is not working and we will help.
        </p>
      </header>

      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        className="rounded-3xl border border-border bg-card px-4 min-h-[56px] flex items-center gap-3 hover:bg-muted/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span aria-hidden className="shrink-0 w-10 h-10 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center">
          <Mail className="w-5 h-5" />
        </span>
        <span className="min-w-0">
          <span className="block font-bold text-foreground text-[15px]">Email support</span>
          {/* Mono, because it is a value to read and copy rather than prose. */}
          <span className="block font-mono text-xs text-muted-foreground truncate">{SUPPORT_EMAIL}</span>
        </span>
      </a>

      <p className="px-1 text-xs text-muted-foreground font-semibold text-balance">
        This app is a reminder tool. It does not give medical advice — for anything
        about your medicines, speak to your doctor or pharmacist.
      </p>
    </div>
  );
}
