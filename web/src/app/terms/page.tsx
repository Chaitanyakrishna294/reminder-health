import type { Metadata } from 'next';
import LegalDocument from '@/components/legal/legal-document';

export const metadata: Metadata = {
  title: 'Terms of Service | Re-MIND-eЯ',
  description: 'The terms that govern your use of Re-MIND-eЯ.',
};

/** See ../privacy/page.tsx for why the content is data and the metadata stays English. */
export default function TermsOfServicePage() {
  return <LegalDocument docKey="terms" footerLinks={['privacy', 'disclaimer']} />;
}
