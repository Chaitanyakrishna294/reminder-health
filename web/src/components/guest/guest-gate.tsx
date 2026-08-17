import Link from 'next/link';
import { Lock, ArrowRight } from 'lucide-react';

/**
 * Shown in place of a feature a guest cannot use.
 *
 * The rule this renders is enforced in the database (the guard triggers in
 * migration_anonymous_guests_2026_08_10.sql) and, for Telegram linking, in the
 * redeem route. This component is only the explanation — its job is to make the
 * boundary legible BEFORE the user invests effort, and to give them the one
 * action that removes it, rather than letting them fill in a form and meet a
 * raw Postgres error at submit.
 */
export default function GuestGate({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-[var(--r-card)] bg-surface-sunk dark:bg-muted overflow-hidden">
        <div className="px-6 py-8 text-center">
          <span className="mx-auto w-14 h-14 rounded-[var(--r-control)] bg-primary/10 flex items-center justify-center text-primary">
            <Lock className="w-7 h-7" aria-hidden />
          </span>
          <h1 className="mt-4 text-xl font-bold text-foreground">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{reason}</p>

          <Link
            href="/save-account"
            className="mt-6 w-full h-14 inline-flex items-center justify-center gap-2 rounded-[var(--r-control)] bg-primary text-white font-bold text-base shadow-md hover:brightness-95 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-all"
          >
            Save my account
            <ArrowRight className="w-5 h-5" aria-hidden />
          </Link>
          <p className="mt-3 text-xs text-muted-foreground">
            Takes one email. Everything you have already added stays exactly as it is.
          </p>
        </div>
      </div>
    </div>
  );
}
