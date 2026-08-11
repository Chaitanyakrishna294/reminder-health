'use client';

// M3 OEM onboarding, dashboard banner.
//
// Renders nothing outside the Android app, and nothing once every check passes —
// a permanent "all good" panel is noise that teaches people to ignore the one
// place real warnings appear.
//
// Shows the SAME cards as the Settings setup guide, from the same hook and the
// same data, so the two can never tell the user different things. The banner is
// the interruption; the guide is the permanent home you can return to.

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import SetupStepCard from '@/components/native/setup-step-card';
import { useReliability } from '@/components/native/use-reliability';
import { brandLabel } from '@/lib/native/setup-guide';

export default function ReliabilityCheck() {
  const pathname = usePathname();
  const { status, outstanding, satisfied, markDone, undoDone } = useReliability(pathname);

  if (!status || outstanding.length === 0) return null;

  const brand = brandLabel(status);

  return (
    <section
      aria-labelledby="reliability-heading"
      className="mb-4 rounded-2xl border border-warning/40 bg-warning/10 p-4"
    >
      <h2 id="reliability-heading" className="text-sm font-bold text-foreground font-mono">
        Your phone may stop these reminders
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {brand
          ? `${brand} phones switch these off by default. Each one takes a few seconds, and only you can change them.`
          : 'These are settings only you can change. Each one takes a few seconds.'}
      </p>

      <ul className="mt-3 space-y-2">
        {outstanding.map((item) => (
          <SetupStepCard
            key={item.id}
            item={item}
            satisfied={satisfied(item)}
            onMarkDone={markDone}
            onUndoDone={undoDone}
          />
        ))}
      </ul>

      <Link
        href="/settings#reminder-setup"
        className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold text-primary underline underline-offset-2"
      >
        Full setup guide in Settings
      </Link>
    </section>
  );
}
