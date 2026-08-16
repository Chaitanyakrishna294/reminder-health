import type { Metadata } from 'next';
import LegalDocument from '@/components/legal/legal-document';

export const metadata: Metadata = {
  title: 'Privacy Policy | Re-MIND-eЯ',
  description: 'How Re-MIND-eЯ collects, uses, stores, shares, and protects your data.',
};

/**
 * The content moved to lib/i18n/legal/*.ts and the markup to
 * components/legal/legal-document.tsx, so this page renders in all seven languages
 * from one implementation. The English wording is unchanged from the hand-written
 * version that used to live here.
 *
 * METADATA STAYS ENGLISH, deliberately. It is the browser tab, the Play listing and
 * the search result — read by crawlers and by people arriving from outside the app,
 * neither of which has seen the reader's in-app language choice. The choice lives in
 * localStorage, which the server cannot read while generating metadata.
 */
export default function PrivacyPolicyPage() {
  return <LegalDocument docKey="privacy" footerLinks={['terms', 'disclaimer']} />;
}
