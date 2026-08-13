import React from 'react';
import { redirect } from 'next/navigation';
import { Check } from 'lucide-react';
import { resolveUserData } from '@/lib/supabase/cached-queries';

export const revalidate = 0;

/**
 * Settings → Language. A HONEST PLACEHOLDER, not a fake picker.
 *
 * Multi-language is phased on purpose (CLAUDE.md): phase 1 is the family voice
 * feature, which solves the alarm-language problem without any translation work;
 * phase 2 translates the patient-facing surfaces into Hindi and Telugu via
 * next-intl. Rendering a list of languages that do nothing when tapped would be
 * worse than this page — it would promise the one thing the user came here for.
 *
 * When phase 2 lands, the picker goes HERE, and every language is written in its own
 * script (English / తెలుగు / हिन्दी). A language list written only in English is
 * unusable by exactly the person who needs to change it.
 */
export default async function LanguageSettingsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header className="px-1">
        <h1 className="text-2xl font-black text-foreground tracking-tight">Language</h1>
      </header>

      <div className="rounded-3xl border border-border overflow-hidden">
        <div className="w-full flex items-center gap-3 px-4 py-4 bg-card">
          <span className="flex-1 font-bold text-foreground text-[15px]">English</span>
          <Check className="w-5 h-5 text-primary-strong shrink-0" aria-label="Selected" />
        </div>
      </div>

      <p className="px-1 text-xs text-muted-foreground font-semibold text-balance">
        More languages are coming. Your reminders already speak whatever language you
        record them in.
      </p>
    </div>
  );
}
