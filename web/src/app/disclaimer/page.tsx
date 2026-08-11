import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * Standalone medical disclaimer.
 *
 * The Terms already carry the legal version (§1 "Not medical advice"). This page
 * exists because that is not the same job: Play Store policy for health apps
 * expects a disclaimer the user can actually find and read, and the store listing
 * needs one too. Legalese buried at §1 of a 15-section document satisfies a
 * lawyer, not a person deciding whether to trust this with their mother's
 * medication.
 *
 * So this is deliberately short, plain, and written for the least technical user
 * in the audience. The §"For the Play Store listing" block at the bottom is the
 * condensed version, kept HERE rather than in a doc so the listing copy and the
 * in-app copy cannot drift apart.
 */
export const metadata: Metadata = {
  title: 'Medical Disclaimer | Re-MIND-eЯ',
  description:
    'Re-MIND-eЯ is a reminder tool, not a medical device. It does not give medical advice and reminders are best-effort.',
};

const UPDATED = 'August 11, 2026';
const CONTACT_EMAIL = 'hello.remindre@gmail.com';

export default function DisclaimerPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-foreground">
      <h1 className="text-3xl font-black mb-2">Medical Disclaimer</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: {UPDATED}</p>

      <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 mb-8">
        <p className="text-sm font-semibold">
          Re-MIND-eЯ is a reminder tool. It is not a medical device, and it does not give
          medical advice.
        </p>
      </div>

      <section className="space-y-6 text-sm leading-relaxed">
        <div>
          <h2 className="text-xl font-bold mb-2">What this app does</h2>
          <p>
            It reminds you to take medication you have already been prescribed, keeps a record of
            what you marked as taken or skipped, and can let people in your Care Circle know when a
            dose is missed. That is all it does.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">What this app never does</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>It does not tell you which medication to take, or how much.</li>
            <li>It does not change a dose, suggest a change, or warn you about interactions.</li>
            <li>It does not diagnose anything or interpret your symptoms.</li>
            <li>
              It does not check that what you entered is correct. The medication names, doses, and
              times are the ones <strong>you</strong> typed in.
            </li>
          </ul>
          <p className="mt-2">
            Always follow your doctor or pharmacist. If their instructions differ from what this app
            shows, <strong>they are right and the app is wrong</strong> — and please correct the app.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">Reminders are best-effort</h2>
          <p>
            A reminder can be late or can fail to arrive. Phones get switched off, run out of
            battery, lose signal, or silence notifications. Some phones stop background apps
            automatically to save power — the app will tell you when it detects this and show you how
            to fix it, but it cannot fix it for you.
          </p>
          <p className="mt-2">
            <strong>Do not rely on this app alone for medication that is critical to your health.</strong>{' '}
            Treat it as a helpful backup to your own routine, not a replacement for it.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">In an emergency</h2>
          <p>
            Do not use this app. Contact your local emergency services or your doctor immediately.
            The Care Circle feature notifies people you have chosen; it is not an emergency service
            and nobody is guaranteed to be watching.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">Questions</h2>
          <p>
            Contact us at <strong>{CONTACT_EMAIL}</strong>. The full legal terms are in our{' '}
            <Link href="/terms" className="text-primary font-semibold hover:underline">
              Terms of Service
            </Link>
            , and how we handle your data is in our{' '}
            <Link href="/privacy" className="text-primary font-semibold hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </section>

      <div className="mt-10 flex flex-wrap gap-4 text-sm">
        <Link href="/terms" className="text-primary font-semibold hover:underline">
          Terms of Service
        </Link>
        <Link href="/privacy" className="text-primary font-semibold hover:underline">
          Privacy Policy
        </Link>
        <Link href="/login" className="text-primary font-semibold hover:underline">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
