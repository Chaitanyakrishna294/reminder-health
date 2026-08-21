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
/**
 * The landing page ships as **Remily**; the rest of the product is still
 * Re-MIND-eЯ (65 references, the Android `app_name`, the Play listing). That seam
 * is deliberate and tracked — see `lib/landing/config.ts`. The name lives in one
 * constant so the eventual rename is a sweep, not a rebuild.
 */
const TITLE = 'Remily — medication reminders that reach the family';
const DESCRIPTION =
  'Remily rings on the phone itself at dose time, so reminders work offline, with the app closed and after a restart — and the family is told when nobody answers.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website' },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
};

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect('/dashboard');

  return <LandingPage />;
}
