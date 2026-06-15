import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — Re-MIND-eЯ',
  description: 'The terms that govern your use of Re-MIND-eЯ.',
};

const UPDATED = 'June 15, 2026';

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-foreground">
      <h1 className="text-3xl font-black mb-2">Terms of Service</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: {UPDATED}</p>

      <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 mb-8 text-sm">
        <strong>Template notice:</strong> These terms are a starting point. Have them reviewed by
        qualified counsel and tailored to your jurisdiction before relying on them in production.
      </div>

      <section className="space-y-6 text-sm leading-relaxed">
        <div>
          <h2 className="text-xl font-bold mb-2">1. Not medical advice</h2>
          <p>Re-MIND-eЯ is a reminder and organization tool. It does not provide medical advice,
            diagnosis, or treatment, and is not a substitute for professional healthcare. Always follow
            the guidance of your doctor or pharmacist. Do not rely on the app for emergencies.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">2. Reminders are best-effort</h2>
          <p>We strive to deliver reminders and caregiver alerts reliably, but delivery depends on third
            parties (Telegram, browser push providers, networks) and your device settings. We do not
            guarantee that every reminder will be delivered on time, and we are not liable for missed doses.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">3. Eligibility & your account</h2>
          <p>You must be at least 18 years old (or the age of majority in your jurisdiction) to create an
            account. The service is not directed to children under 13, and we do not knowingly collect their
            data. You are responsible for the accuracy of the information you enter and for keeping your login
            secure. Only link caregivers you trust; caregivers you authorize can view the data you permit.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">4. Acceptable use</h2>
          <p>Do not misuse the service, attempt to access other users' data, upload unlawful content, or
            disrupt the platform. We may suspend or terminate accounts that violate these terms.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">5. Your content</h2>
          <p>You retain ownership of the information and documents you upload (e.g. Health Vault files and
            messages). You grant us a limited licence to store and process that content solely to operate the
            service for you and the caregivers you authorize. You are responsible for the content you upload.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">6. Fees & refunds</h2>
          <p>The service is currently provided free of charge. If paid plans are introduced, billing terms,
            renewal dates, cancellation, and a refund policy will be presented before you are charged.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">7. Your data</h2>
          <p>Your use of the service is also governed by our{' '}
            <Link href="/privacy" className="text-primary font-semibold hover:underline">Privacy Policy</Link>.
            You can delete your account and data at any time from Settings.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">8. Disclaimer & liability</h2>
          <p>The service is provided "as is" without warranties of any kind. To the maximum extent permitted
            by law, we are not liable for any indirect or consequential damages arising from use of the service.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">9. Governing law & disputes</h2>
          <p>These terms are governed by the laws of <strong>[your country/state — e.g., India]</strong>.
            Any dispute will be resolved in the courts of that jurisdiction, unless applicable law requires
            otherwise. Confirm this clause with counsel for your situation.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">10. Changes & contact</h2>
          <p>We may update these terms; continued use means you accept the changes. Questions:
            <strong> [your-contact-email]</strong>.</p>
        </div>
      </section>

      <div className="mt-10 flex gap-4 text-sm">
        <Link href="/privacy" className="text-primary font-semibold hover:underline">Privacy Policy</Link>
        <Link href="/login" className="text-primary font-semibold hover:underline">Back to sign in</Link>
      </div>
    </main>
  );
}
