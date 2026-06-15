import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Re-MIND-eЯ',
  description: 'How Re-MIND-eЯ collects, uses, stores, and protects your data.',
};

const UPDATED = 'June 15, 2026';

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-foreground">
      <h1 className="text-3xl font-black mb-2">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: {UPDATED}</p>

      <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 mb-8 text-sm">
        <strong>Template notice:</strong> This policy describes how the app currently works. Have it
        reviewed by qualified counsel and tailored to your jurisdiction before relying on it in
        production.
      </div>

      <section className="space-y-6 text-sm leading-relaxed">
        <div>
          <h2 className="text-xl font-bold mb-2">1. What we collect</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Account data:</strong> email address, display name, and role (patient or caregiver).</li>
            <li><strong>Contact data:</strong> phone number and Telegram chat ID, where you provide them.</li>
            <li><strong>Health data:</strong> medication names, dosages, schedules, adherence history,
              and any documents you upload to the Health Vault. This is sensitive (special-category) data.</li>
            <li><strong>Care-circle data:</strong> links between patients and caregivers and the permissions you set.</li>
            <li><strong>Device data:</strong> web-push subscription details for notification delivery.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">2. How we use it</h2>
          <p>To deliver medication reminders, escalate missed doses to caregivers you authorize, show
            adherence history, store the documents you choose to upload, and operate and secure the service.
            We do not sell your data.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">3. Where it is stored</h2>
          <p>Data is stored in our managed Supabase (PostgreSQL + object storage) project and processed by
            our application hosting (Vercel). Notifications are delivered via Telegram and your browser's
            web-push provider. These providers process data on our behalf.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">4. Your rights</h2>
          <p>Depending on your jurisdiction (including GDPR/CCPA) you may access, correct, export, or delete
            your data. You can permanently delete your account and all associated data at any time from
            <strong> Settings → Delete Account</strong>. For other requests, contact us at the address below.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">5. Cookies</h2>
          <p>We use only essential cookies required to keep you signed in (managed by our authentication
            provider). We do not use advertising or third-party tracking cookies.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">6. Data retention</h2>
          <p>We keep your data while your account is active. When you delete your account, your personal
            data is erased. Minimal, de-identified operational logs may be retained for security.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">7. Children's privacy</h2>
          <p>The service is intended for adults (18+) and is not directed to children under 13 (or under 16
            where required by local law). We do not knowingly collect data from children. If you believe a
            child has provided us data, contact us and we will delete it.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">8. Contact</h2>
          <p>Questions or requests: <strong>[your-contact-email]</strong>.</p>
        </div>
      </section>

      <div className="mt-10 flex gap-4 text-sm">
        <Link href="/terms" className="text-primary font-semibold hover:underline">Terms of Service</Link>
        <Link href="/login" className="text-primary font-semibold hover:underline">Back to sign in</Link>
      </div>
    </main>
  );
}
