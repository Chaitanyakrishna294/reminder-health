import type { LegalDocSet } from './types';

/**
 * ENGLISH IS THE AUTHORITATIVE VERSION of all three documents, and the other six
 * files in this folder say so on the page itself (`legal.translationNotice`).
 *
 * That is not a hedge about translation quality — it is the standard and honest way
 * to publish an operative legal text in more than one language. A reader gets the
 * document in a language they actually read; the version that governs is named, so
 * nobody has to guess which one wins if they differ.
 *
 * The wording here is carried over VERBATIM from the previous hand-written JSX pages
 * (web/src/app/{privacy,terms,disclaimer}/page.tsx). It has not been re-drafted —
 * this change moved the content from markup into data, and rewriting a live legal
 * text while restructuring how it renders would make both impossible to review.
 */

const CONTACT_EMAIL = 'hello.remindre@gmail.com';
const OPERATOR = 'Chaitanya Krishna';
const JURISDICTION = 'Nellore, Andhra Pradesh, India';

const en: LegalDocSet = {
  privacy: {
    title: 'Privacy Policy',
    updated: 'August 11, 2026',
    sections: [
      {
        paragraphs: [
          `This Privacy Policy explains how ${OPERATOR} ("we", "us") collects, uses, shares, stores, and protects your information when you use Re-MIND-eЯ (the "Service"), a medication-reminder and caregiver-coordination app. By using the Service you agree to this Policy. If you do not agree, please do not use the Service.`,
        ],
      },
      {
        heading: '1. Information we collect',
        bullets: [
          '**Account data:** email address, display name, and role (patient or caregiver).',
          '**Contact data:** phone number and Telegram chat ID, where you provide them.',
          '**Health data (sensitive):** medication names, dosages, schedules, adherence history, reasons/notes, and any documents you upload to the Health Vault. This is sensitive personal data and we treat it with heightened care.',
          '**Care-circle data:** the links you create between patients and caregivers and the permissions you grant.',
          '**Device & technical data:** web-push subscription details for notification delivery, and minimal security/operational logs (e.g. IP, timestamps) used to protect the Service.',
          '**Payment data (only if you subscribe):** handled by our payment processor; we do not store your full card/UPI details on our servers.',
        ],
      },
      {
        heading: '2. How and why we use it (legal basis)',
        paragraphs: [
          'We use your information to: deliver medication reminders; escalate missed/unconfirmed doses to caregivers you authorize; show your adherence history; store the documents you choose to upload; verify your phone for optional call/SMS features; provide support; and operate, secure, and improve the Service. Our legal bases are your **consent** (which you can withdraw) and the **performance of our agreement** with you. **We do not sell your data.**',
        ],
      },
      {
        heading: '3. How we share it',
        bullets: [
          {
            text: '**With caregivers you authorize:** the core function of the app. Caregivers in your Care Circle can see only the data and adherence information you permit, until you revoke access.',
          },
          {
            text: '**With service providers (processors) who act on our instructions:**',
            sub: [
              '**Supabase** — database, authentication, and file storage. This is where your medications, schedules, adherence history, and Health Vault documents live.',
              '**Vercel** — application hosting.',
              '**Telegram** — delivery of reminder and caregiver-escalation messages, where you have connected a Telegram account. Telegram receives the message content needed to show your reminder, which includes the medication name.',
              '**Your browser or device push provider** — notification delivery.',
              '**Cloudflare Turnstile** — bot and abuse protection on the sign-in and sign-up screens. It receives technical signals from your browser (such as IP address and browser characteristics) to confirm you are a real person. It is not used for advertising, and it does not receive any of your health data.',
              '**Sentry** — anonymized crash and error reports, so we can find faults that would otherwise stop reminders silently. See §5a for exactly what is and is not included.',
              'If you enable optional reminder calls/SMS or a paid plan, we also use a telephony/SMS provider and a payment processor.',
            ],
          },
          {
            text: '**For legal reasons:** where required by law or to protect rights, safety, and security.',
          },
        ],
        afterBullets: [
          'We do not sell or rent your personal data, and we do not use it for third-party advertising.',
        ],
      },
      {
        heading: '4. Where your data is stored (international transfer)',
        paragraphs: [
          'Our database and file storage are hosted on Supabase infrastructure located in **Singapore**, and application hosting is provided by Vercel, which may process data in other countries. Crash reports are processed by Sentry in the **United States**. This means your information may be stored and processed **outside India**. We rely on your consent and on contractual safeguards with these providers for such transfers.',
        ],
      },
      {
        heading: '4a. Data stored on your own device (Android app)',
        paragraphs: [
          'The Android app keeps a copy of your medication schedule on your phone so that reminders still work when you have no internet connection. This copy contains medication names, dosages, and reminder times, plus any Taken/Skipped/Snoozed responses that have not yet reached our servers.',
        ],
        bullets: [
          'It is stored in the app’s private storage and is **encrypted at rest**, with the encryption key held in the Android Keystore.',
          'It is **erased when you sign out** or switch accounts, and when you delete the app.',
          'It is never sent anywhere except back to our own servers to record your responses.',
        ],
      },
      {
        heading: '5. Security',
        paragraphs: [
          'We protect your data with industry-standard measures, including encryption in transit (HTTPS), database row-level security so each user can access only their own records, a private (non-public) storage bucket with short-lived signed links for document access, and least-privilege access controls. No system is perfectly secure, but we work to protect your information and limit access to it.',
        ],
      },
      {
        heading: '5a. Crash reports (what we deliberately do not collect)',
        paragraphs: [
          'When something goes wrong, the app sends an anonymized error report to Sentry so we can fix faults that would otherwise cause reminders to fail silently. We have configured this to send as little as possible:',
        ],
        bullets: [
          '**No screen recording or session replay** of any kind.',
          '**No medication names**, dosages, or schedules. Where a report needs to identify a medication, it carries an internal number only.',
          '**No email address, name, phone number, or Telegram ID.** Reports are linked to an opaque account identifier, and IP addresses are not collected.',
          '**No cookies, request contents, or web addresses containing your details** — anything after a "?" in a link is removed before the report is sent.',
        ],
        afterBullets: [
          'What is sent is the technical fault itself: the error, where in our code it happened, and basic device and app-version information.',
        ],
      },
      {
        heading: '6. Data retention',
        paragraphs: [
          'We keep your data while your account is active. When you delete your account, your personal data and uploaded documents are erased. We may retain minimal, de-identified operational logs for a limited period for security and to meet legal obligations.',
        ],
      },
      {
        heading: '7. Your rights',
        paragraphs: [
          'Subject to applicable law (including India’s **Digital Personal Data Protection Act, 2023 (DPDP Act)** and, where relevant, the GDPR and CCPA), you may have the right to access, correct, update, or delete your data, to withdraw consent, to nominate another person to exercise your rights, and to lodge a grievance or complaint.',
          'You can permanently delete your account and all associated data at any time from **Settings → Delete Account**. For any other request, contact us (see §11).',
        ],
      },
      {
        heading: '8. Cookies',
        paragraphs: [
          'We use only essential cookies required to keep you signed in (managed by our authentication provider). We do not use advertising or third-party tracking cookies.',
        ],
      },
      {
        heading: '9. Children’s privacy',
        paragraphs: [
          'The Service is intended for adults (18+) and is not directed to children. We do not knowingly collect data from children. If you believe a child has provided us data, contact us and we will delete it.',
        ],
      },
      {
        heading: '10. Changes to this Policy',
        paragraphs: [
          'We may update this Policy from time to time. We will revise the "Last updated" date above and, for significant changes, provide a more prominent notice. Continued use after an update means you accept the revised Policy.',
        ],
      },
      {
        heading: '11. Contact & Grievance Officer',
        paragraphs: [
          `For privacy questions, requests, or grievances, contact us at **${CONTACT_EMAIL}**. We will acknowledge and respond to grievances within the timelines required by applicable law.`,
        ],
      },
    ],
  },

  terms: {
    title: 'Terms of Service',
    updated: 'June 29, 2026',
    sections: [
      {
        paragraphs: [
          `These Terms of Service ("Terms") govern your use of Re-MIND-eЯ (the "Service"), operated by ${OPERATOR}. By creating an account or using the Service, you agree to these Terms and to our Privacy Policy. If you do not agree, do not use the Service.`,
        ],
      },
      {
        heading: '1. Not medical advice (important)',
        paragraphs: [
          'Re-MIND-eЯ is a reminder and organization tool only. It **does not provide medical advice, diagnosis, or treatment**, and is not a substitute for professional healthcare. Always follow your doctor or pharmacist. **Never rely on the Service for emergencies.** In an emergency, contact your local emergency services. You are solely responsible for your medical decisions and for taking your medications.',
        ],
      },
      {
        heading: '2. Reminders & alerts are best-effort',
        paragraphs: [
          'We strive to deliver reminders and caregiver alerts reliably, but delivery depends on third parties (e.g. Telegram, push and telephony providers, networks) and on your device and settings. We **do not guarantee** that any reminder, call, or alert will be delivered or delivered on time, and **we are not liable for missed, late, or undelivered reminders or for any missed dose.**',
        ],
      },
      {
        heading: '3. Eligibility & your account',
        paragraphs: [
          'You must be at least **18 years old** (or the age of majority in your jurisdiction) to use the Service. You are responsible for the accuracy of the information you enter, for keeping your login credentials secure, and for all activity under your account. Notify us promptly of any unauthorized use.',
        ],
      },
      {
        heading: '4. Caregivers & shared access',
        paragraphs: [
          'The Service lets you connect "caregivers" and grant them permission to view or act on certain data. Only link caregivers you trust. You are responsible for the access you grant; caregivers you authorize can see the data you permit until you revoke access. We are not responsible for how an authorized caregiver uses information you have shared with them.',
        ],
      },
      {
        heading: '5. Acceptable use',
        paragraphs: [
          'Do not misuse the Service, attempt to access other users’ data, upload unlawful, infringing, or harmful content, reverse-engineer or disrupt the platform, or use it to violate any law. We may suspend or terminate accounts that violate these Terms.',
        ],
      },
      {
        heading: '6. Your content',
        paragraphs: [
          'You retain ownership of the information and documents you upload (e.g. Health Vault files and messages). You grant us a limited, non-exclusive licence to store and process that content solely to operate the Service for you and the caregivers you authorize. You are responsible for the content you upload and confirm you have the right to upload it.',
        ],
      },
      {
        heading: '7. Subscriptions, trials, fees & refunds',
        paragraphs: [
          'Core reminders are currently free. Optional paid features (e.g. "Care+" with reminder phone calls) may be offered as a subscription. If you subscribe:',
        ],
        bullets: [
          'The price, billing cycle, and what is included will be shown before you are charged.',
          'A free trial (if offered) converts to a paid subscription only if you choose to continue; we will follow applicable rules for recurring payments, including any required advance notice before a charge.',
          'Subscriptions renew until cancelled. You can cancel anytime; cancellation stops future charges.',
          'Payments are handled by a third-party payment processor. Our refund policy, if any, will be stated at the point of purchase.',
        ],
      },
      {
        heading: '8. Disclaimers',
        paragraphs: [
          'The Service is provided **"as is" and "as available"** without warranties of any kind, whether express or implied, including fitness for a particular purpose, accuracy, or uninterrupted or error-free operation, to the maximum extent permitted by law.',
        ],
      },
      {
        heading: '9. Limitation of liability',
        paragraphs: [
          `To the maximum extent permitted by law, ${OPERATOR} and the Service will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss arising from missed, late, or undelivered reminders or from your medical decisions. To the extent liability cannot be excluded, it is limited to the amount you paid us (if any) in the 12 months before the claim.`,
        ],
      },
      {
        heading: '10. Indemnity',
        paragraphs: [
          `You agree to indemnify and hold harmless ${OPERATOR} from claims, damages, and expenses arising out of your misuse of the Service, your content, or your violation of these Terms or of any law or third-party right.`,
        ],
      },
      {
        heading: '11. Termination',
        paragraphs: [
          'You may stop using the Service and delete your account at any time from Settings. We may suspend or terminate access if you violate these Terms or to protect the Service or other users. Sections that by their nature should survive termination (e.g. disclaimers, liability, indemnity) will survive.',
        ],
      },
      {
        heading: '12. Changes to these Terms',
        paragraphs: [
          'We may update these Terms from time to time. We will revise the "Last updated" date and, for material changes, provide a more prominent notice. Continued use after an update means you accept the revised Terms.',
        ],
      },
      {
        heading: '13. Governing law & disputes',
        paragraphs: [
          `These Terms are governed by the laws of **India**. Subject to applicable law, the courts at **${JURISDICTION}** will have jurisdiction over any dispute.`,
        ],
      },
      {
        heading: '14. Severability & entire agreement',
        paragraphs: [
          'If any provision is held unenforceable, the rest remains in effect. These Terms and the Privacy Policy are the entire agreement between you and us regarding the Service.',
        ],
      },
      {
        heading: '15. Contact',
        paragraphs: [`Questions about these Terms: **${CONTACT_EMAIL}**.`],
      },
    ],
  },

  disclaimer: {
    title: 'Medical Disclaimer',
    updated: 'August 11, 2026',
    callout:
      'Re-MIND-eЯ is a reminder tool. It is not a medical device, and it does not give medical advice.',
    sections: [
      {
        heading: 'What this app does',
        paragraphs: [
          'It reminds you to take medication you have already been prescribed, keeps a record of what you marked as taken or skipped, and can let people in your Care Circle know when a dose is missed. That is all it does.',
        ],
      },
      {
        heading: 'What this app never does',
        bullets: [
          'It does not tell you which medication to take, or how much.',
          'It does not change a dose, suggest a change, or warn you about interactions.',
          'It does not diagnose anything or interpret your symptoms.',
          'It does not check that what you entered is correct. The medication names, doses, and times are the ones **you** typed in.',
        ],
        afterBullets: [
          'Always follow your doctor or pharmacist. If their instructions differ from what this app shows, **they are right and the app is wrong** — and please correct the app.',
        ],
      },
      {
        heading: 'Reminders are best-effort',
        paragraphs: [
          'A reminder can be late or can fail to arrive. Phones get switched off, run out of battery, lose signal, or silence notifications. Some phones stop background apps automatically to save power — the app will tell you when it detects this and show you how to fix it, but it cannot fix it for you.',
          '**Do not rely on this app alone for medication that is critical to your health.** Treat it as a helpful backup to your own routine, not a replacement for it.',
        ],
      },
      {
        heading: 'In an emergency',
        paragraphs: [
          'Do not use this app. Contact your local emergency services or your doctor immediately. The Care Circle feature notifies people you have chosen; it is not an emergency service and nobody is guaranteed to be watching.',
        ],
      },
      {
        heading: 'Questions',
        paragraphs: [
          `Contact us at **${CONTACT_EMAIL}**. The full legal terms are in our Terms of Service, and how we handle your data is in our Privacy Policy.`,
        ],
      },
    ],
  },
};

export default en;
