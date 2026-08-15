import type { Metadata } from 'next';
import LegalDocument from '@/components/legal/legal-document';

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
 * in the audience — which is also exactly why it is the document most worth having
 * in all seven languages. See ../privacy/page.tsx for the data/metadata split.
 */
export const metadata: Metadata = {
  title: 'Medical Disclaimer | Re-MIND-eЯ',
  description:
    'Re-MIND-eЯ is a reminder tool, not a medical device. It does not give medical advice and reminders are best-effort.',
};

export default function DisclaimerPage() {
  return <LegalDocument docKey="disclaimer" footerLinks={['terms', 'privacy']} />;
}
