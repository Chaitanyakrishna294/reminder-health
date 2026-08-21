import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import LandingPage from '@/components/landing/landing-page';

/**
 * THE PUBLIC HOMEPAGE.
 *
 * Signed in → the dashboard, unchanged. Signed out → the landing page, which is
 * new: this route used to bounce strangers to `/welcome`.
 *
 * **`/welcome` is deliberately still there.** The two are different jobs, not
 * duplicates — the landing page explains the product to somebody who has never
 * heard of it, while `/welcome` is the auth-world front door that hands an email
 * address to `/login`. It keeps its own hardcoded illustration palette and its
 * "must fit 375x812 without scrolling" constraint, neither of which a scrolling
 * marketing page wants. The landing page's "Sign in" is what reaches it.
 */
export const metadata: Metadata = {
  title: 'Re-MIND-eЯ — medication reminders that work offline',
  description:
    'Medication reminders for the people you look after. On Android the alarm is built into the phone, so it rings offline, with the app closed, and after a restart — and the family is told when a dose goes unanswered.',
  openGraph: {
    title: 'Re-MIND-eЯ — medication reminders that work offline',
    description:
      'The alarm rings even when the internet does not. Medication reminders for the people you look after, with the family told when a dose goes unanswered.',
    type: 'website',
  },
};

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect('/dashboard');

  return <LandingPage />;
}
