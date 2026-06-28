import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — Re-MIND-eЯ',
  description: 'The terms that govern your use of Re-MIND-eЯ.',
};

const UPDATED = 'June 29, 2026';
const CONTACT_EMAIL = 'hello.remindre@gmail.com';
const OPERATOR = 'Chaitanya Krishna';
const JURISDICTION = 'Nellore, Andhra Pradesh, India';

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-foreground">
      <h1 className="text-3xl font-black mb-2">Terms of Service</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: {UPDATED}</p>

      <section className="space-y-6 text-sm leading-relaxed">
        <div>
          <p>These Terms of Service (&quot;Terms&quot;) govern your use of Re-MIND-eЯ (the &quot;Service&quot;),
            operated by {OPERATOR}. By creating an account or using the Service, you agree to these Terms and to
            our{' '}
            <Link href="/privacy" className="text-primary font-semibold hover:underline">Privacy Policy</Link>.
            If you do not agree, do not use the Service.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">1. Not medical advice — important</h2>
          <p>Re-MIND-eЯ is a reminder and organization tool only. It <strong>does not provide medical advice,
            diagnosis, or treatment</strong>, and is not a substitute for professional healthcare. Always follow
            your doctor or pharmacist. <strong>Never rely on the Service for emergencies</strong> — in an
            emergency, contact your local emergency services. You are solely responsible for your medical
            decisions and for taking your medications.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">2. Reminders &amp; alerts are best-effort</h2>
          <p>We strive to deliver reminders and caregiver alerts reliably, but delivery depends on third parties
            (e.g. Telegram, push and telephony providers, networks) and on your device and settings. We
            <strong> do not guarantee</strong> that any reminder, call, or alert will be delivered or delivered on
            time, and <strong>we are not liable for missed, late, or undelivered reminders or for any missed dose.</strong></p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">3. Eligibility &amp; your account</h2>
          <p>You must be at least <strong>18 years old</strong> (or the age of majority in your jurisdiction) to
            use the Service. You are responsible for the accuracy of the information you enter, for keeping your
            login credentials secure, and for all activity under your account. Notify us promptly of any
            unauthorized use.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">4. Caregivers &amp; shared access</h2>
          <p>The Service lets you connect &quot;caregivers&quot; and grant them permission to view or act on
            certain data. Only link caregivers you trust. You are responsible for the access you grant; caregivers
            you authorize can see the data you permit until you revoke access. We are not responsible for how an
            authorized caregiver uses information you have shared with them.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">5. Acceptable use</h2>
          <p>Do not misuse the Service, attempt to access other users&apos; data, upload unlawful, infringing, or
            harmful content, reverse-engineer or disrupt the platform, or use it to violate any law. We may
            suspend or terminate accounts that violate these Terms.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">6. Your content</h2>
          <p>You retain ownership of the information and documents you upload (e.g. Health Vault files and
            messages). You grant us a limited, non-exclusive licence to store and process that content solely to
            operate the Service for you and the caregivers you authorize. You are responsible for the content you
            upload and confirm you have the right to upload it.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">7. Subscriptions, trials, fees &amp; refunds</h2>
          <p>Core reminders are currently free. Optional paid features (e.g. &quot;Care+&quot; with reminder
            phone calls) may be offered as a subscription. If you subscribe:</p>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li>The price, billing cycle, and what is included will be shown before you are charged.</li>
            <li>A free trial (if offered) converts to a paid subscription only if you choose to continue; we will
              follow applicable rules for recurring payments, including any required advance notice before a charge.</li>
            <li>Subscriptions renew until cancelled. You can cancel anytime; cancellation stops future charges.</li>
            <li>Payments are handled by a third-party payment processor. Our refund policy, if any, will be stated
              at the point of purchase.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">8. Disclaimers</h2>
          <p>The Service is provided <strong>&quot;as is&quot; and &quot;as available&quot;</strong> without
            warranties of any kind, whether express or implied, including fitness for a particular purpose,
            accuracy, or uninterrupted or error-free operation, to the maximum extent permitted by law.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">9. Limitation of liability</h2>
          <p>To the maximum extent permitted by law, {OPERATOR} and the Service will not be liable for any
            indirect, incidental, special, consequential, or punitive damages, or for any loss arising from missed,
            late, or undelivered reminders or from your medical decisions. To the extent liability cannot be
            excluded, it is limited to the amount you paid us (if any) in the 12 months before the claim.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">10. Indemnity</h2>
          <p>You agree to indemnify and hold harmless {OPERATOR} from claims, damages, and expenses arising out of
            your misuse of the Service, your content, or your violation of these Terms or of any law or third-party
            right.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">11. Termination</h2>
          <p>You may stop using the Service and delete your account at any time from Settings. We may suspend or
            terminate access if you violate these Terms or to protect the Service or other users. Sections that by
            their nature should survive termination (e.g. disclaimers, liability, indemnity) will survive.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">12. Changes to these Terms</h2>
          <p>We may update these Terms from time to time. We will revise the &quot;Last updated&quot; date and, for
            material changes, provide a more prominent notice. Continued use after an update means you accept the
            revised Terms.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">13. Governing law &amp; disputes</h2>
          <p>These Terms are governed by the laws of <strong>India</strong>. Subject to applicable law, the courts
            at <strong>{JURISDICTION}</strong> will have jurisdiction over any dispute.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">14. Severability &amp; entire agreement</h2>
          <p>If any provision is held unenforceable, the rest remains in effect. These Terms and the Privacy Policy
            are the entire agreement between you and us regarding the Service.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">15. Contact</h2>
          <p>Questions about these Terms: <strong>{CONTACT_EMAIL}</strong>.</p>
        </div>
      </section>

      <div className="mt-10 flex gap-4 text-sm">
        <Link href="/privacy" className="text-primary font-semibold hover:underline">Privacy Policy</Link>
        <Link href="/login" className="text-primary font-semibold hover:underline">Back to sign in</Link>
      </div>
    </main>
  );
}
