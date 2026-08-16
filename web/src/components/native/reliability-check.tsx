'use client';

// M3 OEM onboarding, dashboard banner.
//
// Renders nothing outside the Android app, and nothing once every check passes —
// a permanent "all good" panel is noise that teaches people to ignore the one
// place real warnings appear.
//
// A SUMMARY, NOT THE GUIDE (shortened 2026-08-14). This used to render the full
// SetupStepCard for every outstanding item: the reason, the numbered steps, the
// "how you know it worked" panel, and two buttons — four times over. On a fresh
// install that is the entire dashboard, above the doses, on the screen someone
// opened to find out whether they had taken their tablet.
//
// It also contradicted this file's own design note, which has always said the
// banner is the INTERRUPTION and the Settings guide is the permanent home you
// return to. An interruption that reproduces the whole document it is pointing at
// is not an interruption, and the length made it likelier to be dismissed
// unread — the opposite of what it is for.
//
// So: the warning, what is outstanding by name, and the way to the guide. The
// steps live in exactly one place, `reminder-setup-guide.tsx`, which shares the
// same hook and the same data so the two can never disagree.

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useReliability } from '@/components/native/use-reliability';
import { brandLabel } from '@/lib/native/setup-guide';
import { useUiMode } from '@/context/ui-mode-context';

export default function ReliabilityCheck() {
  const pathname = usePathname();
  const { status, outstanding } = useReliability(pathname);
  const { isElderly } = useUiMode();

  if (!status || outstanding.length === 0) return null;

  const brand = brandLabel(status);

  return (
    <section
      aria-labelledby="reliability-heading"
      className="mb-4 rounded-[var(--r-card)] border border-warning/40 bg-warning/10 p-4"
    >
      <h2
        id="reliability-heading"
        className={`font-bold text-foreground font-mono ${isElderly ? 'text-xl' : 'text-sm'}`}
      >
        Your phone may stop these reminders
      </h2>

      <p className={`mt-1 text-muted-foreground text-balance ${isElderly ? 'text-base' : 'text-xs'}`}>
        {brand
          ? `${brand} phones switch these off by default. Each one takes a few seconds, and only you can change them.`
          : 'Most phones switch these off by default. Each one takes a few seconds, and only you can change them.'}
      </p>

      {/* Names only. Enough to know what is being asked and roughly how long it
          will take; not enough to be a second copy of the guide. */}
      <ul className={`mt-2.5 space-y-1 ${isElderly ? 'text-base' : 'text-[13px]'}`}>
        {outstanding.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-foreground">
            <span
              aria-hidden
              className={`mt-1.5 shrink-0 rounded-full bg-warning-strong ${isElderly ? 'h-2 w-2' : 'h-1.5 w-1.5'}`}
            />
            <span className="min-w-0 font-semibold leading-snug">{item.title}</span>
          </li>
        ))}
      </ul>

      {/* The only action, and it has to be unmissable: stripping the inline
          buttons removed the way people actually completed this, so what is left
          has to read as the next thing to do rather than as a footnote.

          `/settings/setup-guide`, NOT `/settings#reminder-setup`. That anchor
          was on this link for as long as it existed and never resolved — the
          `#reminder-setup` section lives on the setup-guide page, so the link
          landed on the Settings hub with nothing highlighted. Exactly the dead
          anchor that notifications-client-view was written to fix, still live
          one file over. A row that goes nowhere teaches people the app is
          broken, and this one was the only route to the steps. */}
      <Link
        href="/settings/setup-guide"
        className={`mt-3 inline-flex items-center gap-1 rounded-lg bg-primary px-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          isElderly ? 'min-h-14 text-lg' : 'min-h-11 text-xs'
        }`}
      >
        Full setup guide in Settings
        <ChevronRight aria-hidden className={isElderly ? 'h-5 w-5' : 'h-3.5 w-3.5'} />
      </Link>
    </section>
  );
}
