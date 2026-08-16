import Link from 'next/link';
import { ShieldAlert, ChevronRight } from 'lucide-react';

/**
 * Persistent "you are a guest" bar, shown on every dashboard page while the
 * session is anonymous.
 *
 * Deliberately NOT dismissible. The thing it is warning about — medicines that
 * vanish with the browser cookie because nothing proves the account is yours —
 * does not stop being true after a tap, and this is the only place a guest is
 * told. It is styled as a warning rather than a promotion for the same reason:
 * it is a data-loss notice, not an upsell.
 */
export default function GuestBanner() {
  return (
    <Link
      href="/save-account"
      className="group mb-4 flex items-center gap-3 rounded-[var(--r-card)] bg-warning/10 ring-1 ring-warning/25 px-4 py-3 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 transition-colors"
    >
      <span className="w-9 h-9 shrink-0 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-700 dark:text-amber-400">
        <ShieldAlert className="w-5 h-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-foreground">You&apos;re using a guest account</span>
        <span className="block text-xs text-muted-foreground mt-0.5">
          Add an email to keep your medicines if you change device or clear your browser.
        </span>
      </span>
      <ChevronRight
        className="w-5 h-5 shrink-0 text-muted-foreground group-hover:translate-x-0.5 transition-transform"
        aria-hidden
      />
    </Link>
  );
}
