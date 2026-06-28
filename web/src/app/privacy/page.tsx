import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Re-MIND-eЯ',
  description: 'How Re-MIND-eЯ collects, uses, stores, shares, and protects your data.',
};

const UPDATED = 'June 29, 2026';
const CONTACT_EMAIL = 'hello.remindre@gmail.com';
const OPERATOR = 'Chaitanya Krishna';

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-foreground">
      <h1 className="text-3xl font-black mb-2">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: {UPDATED}</p>

      <section className="space-y-6 text-sm leading-relaxed">
        <div>
          <p>
            This Privacy Policy explains how {OPERATOR} (&quot;we&quot;, &quot;us&quot;) collects, uses,
            shares, stores, and protects your information when you use Re-MIND-eЯ (the
            &quot;Service&quot;) — a medication-reminder and caregiver-coordination app. By using the
            Service you agree to this Policy. If you do not agree, please do not use the Service.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">1. Information we collect</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Account data:</strong> email address, display name, and role (patient or caregiver).</li>
            <li><strong>Contact data:</strong> phone number and Telegram chat ID, where you provide them.</li>
            <li><strong>Health data (sensitive):</strong> medication names, dosages, schedules, adherence
              history, reasons/notes, and any documents you upload to the Health Vault. This is sensitive
              personal data and we treat it with heightened care.</li>
            <li><strong>Care-circle data:</strong> the links you create between patients and caregivers and
              the permissions you grant.</li>
            <li><strong>Device &amp; technical data:</strong> web-push subscription details for notification
              delivery, and minimal security/operational logs (e.g. IP, timestamps) used to protect the Service.</li>
            <li><strong>Payment data (only if you subscribe):</strong> handled by our payment processor; we do
              not store your full card/UPI details on our servers.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">2. How and why we use it (legal basis)</h2>
          <p>We use your information to: deliver medication reminders; escalate missed/unconfirmed doses to
            caregivers you authorize; show your adherence history; store the documents you choose to upload;
            verify your phone for optional call/SMS features; provide support; and operate, secure, and improve
            the Service. Our legal bases are your <strong>consent</strong> (which you can withdraw) and the
            <strong> performance of our agreement</strong> with you. <strong>We do not sell your data.</strong></p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">3. How we share it</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>With caregivers you authorize:</strong> the core function of the app. Caregivers in your
              Care Circle can see only the data and adherence information you permit, until you revoke access.</li>
            <li><strong>With service providers (processors) who act on our instructions:</strong> Supabase
              (database, authentication, file storage), Vercel (application hosting), Telegram and your browser&apos;s
              web-push provider (notification delivery). If you enable optional reminder calls/SMS or a paid plan,
              we also use a telephony/SMS provider and a payment processor.</li>
            <li><strong>For legal reasons:</strong> where required by law or to protect rights, safety, and security.</li>
          </ul>
          <p className="mt-2">We do not sell or rent your personal data, and we do not use it for third-party advertising.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">4. Where your data is stored (international transfer)</h2>
          <p>Our database and file storage are hosted on Supabase infrastructure located in
            <strong> Singapore</strong>, and application hosting is provided by Vercel, which may process data in
            other countries. This means your information — including health data — may be stored and processed
            <strong> outside India</strong>. We rely on your consent and on contractual safeguards with these
            providers for such transfers.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">5. Security</h2>
          <p>We protect your data with industry-standard measures, including encryption in transit (HTTPS),
            database row-level security so each user can access only their own records, a private (non-public)
            storage bucket with short-lived signed links for document access, and least-privilege access controls.
            No system is perfectly secure, but we work to protect your information and limit access to it.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">6. Data retention</h2>
          <p>We keep your data while your account is active. When you delete your account, your personal data and
            uploaded documents are erased. We may retain minimal, de-identified operational logs for a limited
            period for security and to meet legal obligations.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">7. Your rights</h2>
          <p>Subject to applicable law — including India&apos;s <strong>Digital Personal Data Protection Act, 2023
            (DPDP Act)</strong> and, where relevant, the GDPR and CCPA — you may have the right to access, correct,
            update, or delete your data, to withdraw consent, to nominate another person to exercise your rights,
            and to lodge a grievance or complaint.</p>
          <p className="mt-2">You can permanently delete your account and all associated data at any time from
            <strong> Settings → Delete Account</strong>. For any other request, contact us (see §11).</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">8. Cookies</h2>
          <p>We use only essential cookies required to keep you signed in (managed by our authentication provider).
            We do not use advertising or third-party tracking cookies.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">9. Children&apos;s privacy</h2>
          <p>The Service is intended for adults (18+) and is not directed to children. We do not knowingly collect
            data from children. If you believe a child has provided us data, contact us and we will delete it.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">10. Changes to this Policy</h2>
          <p>We may update this Policy from time to time. We will revise the &quot;Last updated&quot; date above and,
            for significant changes, provide a more prominent notice. Continued use after an update means you accept
            the revised Policy.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-2">11. Contact &amp; Grievance Officer</h2>
          <p>For privacy questions, requests, or grievances, contact us at <strong>{CONTACT_EMAIL}</strong>. We will
            acknowledge and respond to grievances within the timelines required by applicable law.</p>
        </div>
      </section>

      <div className="mt-10 flex gap-4 text-sm">
        <Link href="/terms" className="text-primary font-semibold hover:underline">Terms of Service</Link>
        <Link href="/login" className="text-primary font-semibold hover:underline">Back to sign in</Link>
      </div>
    </main>
  );
}
