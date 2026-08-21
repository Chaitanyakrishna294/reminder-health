import React from 'react';
import Link from 'next/link';
import { WifiOff, BellRing, Languages, Eye, MonitorSmartphone, FolderLock } from 'lucide-react';
import BrainMascot from '@/components/dashboard/brain-mascot';
import { mascotSlot } from '@/components/dashboard/mascot-slots';
import {
  APP_CTA_HREF,
  APP_CTA_LABEL,
  ANDROID_BUILD_AVAILABLE,
  ADHERENCE_SOURCE,
} from '@/lib/landing/config';

/**
 * THE PUBLIC LANDING PAGE.
 *
 * A SERVER component on purpose — it is static marketing text and the first thing
 * a stranger loads, often on a mid-range Android over mobile data. Nothing here
 * needs state. `BrainMascot` is the one client component, and it is *rendered*
 * from here rather than *called*, which is the distinction that 500'd the auth
 * routes once (see mascot-slots.ts).
 *
 * ── WHAT THIS PAGE IS ALLOWED TO CLAIM ──
 *
 * Everything below is either shipped and device-verified, or absent:
 *
 *  - The offline / app-closed / after-reboot alarm behaviour is M2, verified on a
 *    vivo I2202 (airplane mode, process dead, and a real reboot re-arming from the
 *    local store).
 *  - Seven languages including the native alarm screen shipped 2026-08-15/16.
 *  - Telegram escalation to the care circle is the server pipeline, running.
 *  - **Family voice alarms are NOT mentioned.** They are the post-M2 flagship and
 *    only the Room columns and fallback hooks exist. The landing blueprint wanted
 *    them as the headline; advertising an unbuilt feature on a health product is
 *    worse than an invented statistic, so the headline is a thing that works.
 *  - Exactly ONE statistic, with its source linked. No outcome claim is made for
 *    this app — describing the problem is allowed, claiming to measurably solve it
 *    is not.
 *  - Nothing implies the app checks a medicine, a dose or a schedule (ux-copy §5).
 */

const FEATURES = [
  {
    icon: WifiOff,
    title: 'Alarms that ring without a signal',
    body:
      'On Android the alarm is built into the phone itself, like its own alarm clock. It rings offline, with the app closed, and after a restart.',
  },
  {
    icon: BellRing,
    title: 'The family hears about a missed dose',
    body:
      'If a dose goes unanswered, the care circle gets a message on Telegram. Most reminders only ever reach the patient.',
  },
  {
    icon: Languages,
    title: 'Seven languages, alarm included',
    body:
      'English, हिन्दी, తెలుగు, தமிழ், ಕನ್ನಡ, മലയാളം and मराठी. The alarm screen speaks the language chosen in the app, not the one the phone is set to.',
  },
  {
    icon: Eye,
    title: 'A screen that asks one thing',
    body:
      'Elderly mode shows one dose at a time in large type, with one obvious button. No week strip, no history, no menus to get lost in.',
  },
  {
    icon: MonitorSmartphone,
    title: 'Set it up from your own phone',
    body:
      'Add medicines, set times and check the week from anywhere. The patient decides what each family member is allowed to see.',
  },
  {
    icon: FolderLock,
    title: 'Prescriptions in one place',
    body:
      'Keep photos of prescriptions and reports in the health vault. Water reminders are there too, off by default until you want them.',
  },
] as const;

const STEPS = [
  'Add the medicines and the times they are taken.',
  'The phone rings at those times, on its own.',
  'Taken or skipped is recorded. If nobody answers, the family is told.',
] as const;

const LEGAL = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/disclaimer', label: 'Medical disclaimer' },
] as const;

/** Shared focus ring — every interactive element on the page carries it (a11y §5). */
const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export default function LandingPage() {
  return (
    <main className="board min-h-dvh">
      {/* ── 1 · HERO ─────────────────────────────────────────────────────── */}
      <section className="ground-hero px-6 pt-10 pb-12 text-center">
        {/* Mono is correct here — the design DNA lists the wordmark alongside times
            and counts. `uppercase` is NOT: the name's casing is deliberate, and the
            transform rendered it "RE-MIND-EЯ", flattening the lowercase e that the
            reversed Я plays against. A wordmark is a name, not a structural label. */}
        <p className="font-mono text-[12px] font-bold tracking-[0.08em] text-muted-foreground">
          Re-MIND-eЯ
        </p>

        <div className="mt-6 flex justify-center">
          <BrainMascot {...mascotSlot('landing')} />
        </div>

        <h1 className="title-page mt-5 text-foreground">
          The alarm rings even when the internet doesn&apos;t.
        </h1>

        <p className="mx-auto mt-4 max-w-[38ch] text-balance text-base font-semibold text-muted-foreground">
          Medication reminders for the people you look after — and a message to you
          when a dose goes unanswered.
        </p>

        <Link
          href={APP_CTA_HREF}
          className={`mt-7 inline-flex min-h-12 items-center justify-center rounded-[var(--r-control)] bg-primary-strong px-7 py-3.5 text-base font-black text-primary-strong-foreground shadow-md transition-colors hover:bg-primary-strong-hover ${FOCUS}`}
        >
          {APP_CTA_LABEL}
        </Link>

        {/* The caveat sits WITH the button, not in a footnote. Someone installing
            the web version must not walk away believing they have the offline
            alarms the headline promises — those are Android-only. */}
        {!ANDROID_BUILD_AVAILABLE && (
          <p className="mx-auto mt-4 max-w-[34ch] text-[13px] font-semibold leading-relaxed text-muted-foreground">
            This installs the web version, which needs a connection for reminders.
            The Android app with offline alarms is still in testing.
          </p>
        )}

        {/* "Sign in" is a real 44px target, not a word inside a sentence. WCAG 2.5.8
            would exempt an inline link, but this project's floor does not care about
            the exemption: the person reaching for it may be 70 and holding the phone
            at arm's length. So the sentence is text and the action is a control. */}
        <p className="mt-7 text-sm font-semibold text-muted-foreground">
          Already have an account?
        </p>
        <Link
          href="/login"
          className={`mt-1 inline-flex min-h-11 items-center justify-center rounded-[var(--r-control)] px-4 text-sm font-black text-primary-strong underline underline-offset-4 hover:text-primary-strong-hover ${FOCUS}`}
        >
          Sign in
        </Link>
      </section>

      {/* ── 2 · THE PROBLEM ──────────────────────────────────────────────── */}
      <section className="px-6 py-12">
        <div className="mx-auto max-w-xl">
          <h2 className="title-section text-balance text-foreground">
            Missed doses are ordinary. Finding out is not.
          </h2>
          <p className="mt-4 text-[15px] font-semibold leading-relaxed text-muted-foreground">
            {ADHERENCE_SOURCE.claim}{' '}
            <a
              href={ADHERENCE_SOURCE.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-primary-strong underline underline-offset-4 hover:text-primary-strong-hover ${FOCUS}`}
            >
              {ADHERENCE_SOURCE.cite}
            </a>
          </p>
          <p className="mt-4 text-[15px] font-semibold leading-relaxed text-muted-foreground">
            A reminder only the patient sees is one that can fail quietly. When
            someone you look after lives somewhere else, the thing you actually need
            to know is that today did not go to plan.
          </p>
        </div>
      </section>

      {/* ── 3 · WHAT IT DOES ─────────────────────────────────────────────── */}
      <section className="px-6 pb-12">
        <div className="mx-auto max-w-xl">
          <h2 className="title-section text-foreground">What it does</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="card-lift stagger-in p-5">
                <Icon aria-hidden className="h-6 w-6 text-primary-strong" strokeWidth={2.25} />
                <h3 className="mt-3 text-[15px] font-black text-foreground">{title}</h3>
                <p className="mt-1.5 text-[13.5px] font-semibold leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4 · HOW IT WORKS ─────────────────────────────────────────────── */}
      <section className="px-6 pb-12">
        <div className="mx-auto max-w-xl">
          <h2 className="title-section text-foreground">How it works</h2>
          <ol className="mt-5 space-y-3">
            {STEPS.map((step, i) => (
              <li key={step} className="card-lift flex items-start gap-4 p-5">
                {/* Mono for the step NUMBER — a value, never a sentence. */}
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-surface font-mono text-sm font-bold text-accent-surface-foreground"
                >
                  {i + 1}
                </span>
                <p className="text-[15px] font-semibold leading-relaxed text-foreground">
                  {step}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── 5 · GETTING IT ───────────────────────────────────────────────── */}
      <section className="px-6 pb-12">
        <div className="mx-auto max-w-xl">
          <h2 className="title-section text-foreground">Getting it</h2>
          <div className="card-lift mt-5 p-6">
            <h3 className="text-[15px] font-black text-foreground">Today, in your browser</h3>
            <p className="mt-1.5 text-[13.5px] font-semibold leading-relaxed text-muted-foreground">
              Add Re-MIND-eЯ to your home screen and it opens like an app. Everything
              works except the native alarms: reminders come from our servers, so the
              phone needs a connection to receive them.
            </p>
            <Link
              href={APP_CTA_HREF}
              className={`mt-4 inline-flex min-h-11 items-center justify-center rounded-[var(--r-control)] bg-primary-strong px-5 py-2.5 text-sm font-black text-primary-strong-foreground transition-colors hover:bg-primary-strong-hover ${FOCUS}`}
            >
              {APP_CTA_LABEL}
            </Link>

            <hr className="my-6 border-0 border-t border-border" />

            <h3 className="text-[15px] font-black text-foreground">
              The Android app, when testing finishes
            </h3>
            <p className="mt-1.5 text-[13.5px] font-semibold leading-relaxed text-muted-foreground">
              This is the version with the offline alarms. It is in closed testing and
              is not on the Play Store yet. There is no download link here because
              there is nothing honest to link to.
            </p>
          </div>
        </div>
      </section>

      {/* ── 6 · FOOTER ───────────────────────────────────────────────────── */}
      <footer className="px-6 pb-12">
        <div className="mx-auto max-w-xl">
          <div className="surface-sunk p-5">
            <p className="text-[13px] font-semibold leading-relaxed text-muted-foreground">
              Re-MIND-eЯ is a reminder tool. It does not check what you enter and it
              does not give medical advice. Talk to a doctor or pharmacist about
              anything to do with your medicines.
            </p>
          </div>
          <nav className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-1">
            {LEGAL.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                /* px-2 is not decoration: "Terms" is 40px of text, and a 44px floor
                   is a floor in BOTH dimensions (a11y §1). */
                className={`inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-[13px] font-bold text-muted-foreground underline underline-offset-4 hover:text-foreground ${FOCUS}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <p className="mt-2 text-center text-xs font-semibold text-muted-foreground">
            Made in India.
          </p>
        </div>
      </footer>
    </main>
  );
}
