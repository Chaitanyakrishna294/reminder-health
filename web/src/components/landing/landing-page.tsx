import React from 'react';
import Link from 'next/link';
import {
  WifiOff, BellRing, Languages, Eye, FolderLock, GlassWater, RefreshCw,
  Plane, PowerOff, RotateCcw, Lock, ShieldOff, Check,
} from 'lucide-react';
import BrainMascot from '@/components/dashboard/brain-mascot';
import { mascotSlot } from '@/components/dashboard/mascot-slots';
import { LOCALE_META, pickableLocales } from '@/lib/i18n/locales';
import { Reveal, DoseRail, HeroStickers, HighlightOnView } from './landing-motion';
import { AlarmMock, TodayMock } from './phone-mock';
import {
  BRAND, DOWNLOAD_READY, WEB_APP_HREF, ADHERENCE_SOURCE, SECTIONS, sectionGround,
} from '@/lib/landing/config';

/**
 * THE PUBLIC LANDING PAGE — a scroll through one day of doses.
 *
 * Structure and motion come from the scroll reference; the palette, type and
 * every claim come from this repo. The reference invented a dawn-to-night colour
 * story — we already had one that MEANS something (the day rail's morning /
 * midday / evening / night slots), so the page is tinted from those. Scrolling it
 * walks the same palette the app uses to bucket a day.
 *
 * ── WHAT IS ALLOWED ON THIS PAGE ──
 *
 * Every feature card and every reliability fact maps to something shipped and
 * device-verified. Specifically excluded:
 *
 *  - **The home-screen widget.** The reference sells one and the brief said to
 *    verify it. It does not exist: zero `appwidget` entries in the manifest, no
 *    Glance or AppWidgetProvider source. M4, not built. Cut entirely.
 *  - **Family voice alarms.** Post-M2 flagship; only the Room columns and the
 *    AlarmActivity fallback hooks exist. It gets ONE quiet line under the feature
 *    grid and no card, because a card is a promise.
 *  - **"The reminder you can't sleep through."** The reference's headline, and
 *    the brief rightly rejected its register: coercion is not this product's
 *    voice. The alarm is loud so a dose is not missed, not so a person cannot
 *    escape it.
 *  - **Any outcome claim.** The problem is described and cited; nothing claims
 *    this app measurably fixes it (ux-copy §5).
 */

const FEATURES = [
  {
    icon: WifiOff,
    slot: 'evening',
    title: 'Full-screen alarms, offline',
    body: 'On Android the alarm is registered with the phone itself. It rings without a signal, with the app closed, and after a restart.',
  },
  {
    icon: BellRing,
    slot: 'morning',
    title: 'Care circle and escalation',
    body: 'If a dose goes unanswered, the family gets a Telegram message. The patient chooses what each person can see.',
  },
  {
    icon: RefreshCw,
    slot: 'midday',
    title: 'Retry ladders',
    body: 'A dose that has not been answered is asked again on a schedule, and the ladder stops the moment anyone answers — from any device.',
  },
  {
    icon: Eye,
    slot: 'evening',
    title: 'Elderly mode',
    body: 'One dose at a time, in large type, with one obvious button. No week strip, no history, nothing to get lost in.',
  },
  {
    icon: FolderLock,
    slot: 'night',
    title: 'Health vault',
    body: 'Photos of prescriptions and reports, kept together. Limits are enforced by the database, not by the upload form.',
  },
  {
    icon: GlassWater,
    slot: 'midday',
    title: 'Water reminders',
    body: 'Off by default, and deliberately the quietest thing here — an ordinary notification that never escalates and never counts a miss against you.',
  },
] as const;

const FACTS = [
  {
    icon: Plane,
    k: 'Rings in airplane mode',
    p: 'The schedule lives on the phone, encrypted. Verified on a vivo I2202 with the network off.',
  },
  {
    icon: PowerOff,
    k: 'Survives a force-close',
    p: 'Android cold-starts the app purely to deliver the alarm. Verified with the process dead.',
  },
  {
    icon: RotateCcw,
    k: 'Survives a reboot',
    p: 'Every dose is re-registered when the phone restarts. Verified on a real reboot: 19 medications re-armed.',
  },
  {
    icon: Lock,
    k: 'Encrypted on the device',
    p: 'The local medicine store is SQLCipher-encrypted, so a stolen phone gives up no drug names.',
  },
  {
    icon: ShieldOff,
    k: 'Nothing sold, ever',
    p: 'No ads and no selling health data. Caregivers see only what the patient has switched on.',
  },
  {
    icon: Check,
    k: 'One clock, not two',
    p: 'Fire times are computed on the device only. All three implementations pass the same shared test vectors.',
  },
] as const;

const STEPS = [
  { n: 1, t: 'Add the medicine', b: 'Name, dose, the times it is taken and which days. Set once, from any phone.' },
  { n: 2, t: 'The phone rings', b: 'Full screen when locked, a heads-up notification when in use. One tap answers it.' },
  { n: 3, t: 'The family knows', b: 'Taken or skipped is recorded. If nobody answers, the care circle is told.' },
] as const;

const LEGAL = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/disclaimer', label: 'Medical disclaimer' },
] as const;

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

function Eyebrow({ time, label, slot }: { time: string; label: string; slot: string }) {
  return (
    <p
      className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]"
      style={{ color: `var(--slot-${slot}-ink)` }}
    >
      {time} · {label}
    </p>
  );
}

export default function LandingPage() {
  const S = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<
    string,
    (typeof SECTIONS)[number]
  >;
  const languages = pickableLocales();

  return (
    <main>
      <DoseRail />

      {/* ═══ 07:00 · HERO ═══════════════════════════════════════════════ */}
      <section
        id="top"
        className="relative overflow-hidden px-6 pb-16 pt-12 text-center"
        style={{ background: sectionGround(S.top.slot, S.top.tint) }}
      >
        <HeroStickers />

        <div className="relative mx-auto max-w-xl">
          <p className="font-mono text-[13px] font-bold tracking-[0.06em] text-muted-foreground">
            {BRAND}
          </p>

          <div className="mt-6 flex justify-center">
            <BrainMascot {...mascotSlot('landing')} />
          </div>

          {/* The headline renders before anything else loads — it is plain text on a
              token background, so it is the LCP element and costs no request. */}
          <h1 className="title-page mt-5 text-foreground">
            Someone should know when a dose is missed.
          </h1>

          <p className="mx-auto mt-4 max-w-[38ch] text-balance text-base font-semibold text-muted-foreground">
            {BRAND} rings on the phone itself at dose time, and tells the family when
            nobody answers.
          </p>

          <Link
            href={WEB_APP_HREF}
            className={`mt-7 inline-flex min-h-12 items-center justify-center rounded-[var(--r-control)] bg-primary-strong px-7 py-3.5 text-base font-black text-primary-strong-foreground shadow-md transition-colors hover:bg-primary-strong-hover ${FOCUS}`}
          >
            {DOWNLOAD_READY ? 'Download for Android' : 'Open the web app'}
          </Link>

          {/* Trust line — mono, because it is a list of facts, and every one of
              these three is device-verified. */}
          <p className="mt-4 font-mono text-[11px] font-bold tracking-[0.04em] text-muted-foreground">
            Free · Android · Works offline, after reboots, after force-close
          </p>

          {!DOWNLOAD_READY && (
            <p className="mx-auto mt-4 max-w-[36ch] text-[13px] font-semibold leading-relaxed text-muted-foreground">
              The Android app is in closed testing. The web version works today, with
              reminders that need a connection.
            </p>
          )}

          <p className="mt-7 text-sm font-semibold text-muted-foreground">
            Already have an account?
          </p>
          <Link
            href="/login"
            className={`mt-1 inline-flex min-h-11 items-center justify-center rounded-[var(--r-control)] px-4 text-sm font-black text-primary-strong underline underline-offset-4 hover:text-primary-strong-hover ${FOCUS}`}
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* ═══ 09:00 · THE GAP ════════════════════════════════════════════ */}
      <section
        id="gap"
        className="px-6 py-16"
        style={{ background: sectionGround(S.gap.slot, S.gap.tint) }}
      >
        <div className="mx-auto max-w-xl">
          <Reveal>
            <Eyebrow time={S.gap.time} label={S.gap.label} slot={S.gap.slot} />
            <h2 className="title-section mt-3 text-balance text-foreground">
              Missed doses are ordinary. Finding out is not.
            </h2>

            {/* Ten doses, five emptied. Shape carries it, not colour — the same
                second channel the app's dose strip uses. */}
            <div
              role="img"
              aria-label="Ten doses, of which five are shown as not taken."
              className="mt-6 flex flex-wrap gap-2"
            >
              {Array.from({ length: 10 }).map((_, i) => (
                <span
                  key={i}
                  className="h-11 w-6 rounded-full"
                  style={
                    i < 5
                      ? { background: 'var(--primary)', boxShadow: 'var(--lift-1)' }
                      : { background: 'transparent', border: '2px dashed var(--border)' }
                  }
                />
              ))}
            </div>

            {/* The claim and its source sit on a CARD, not on the tinted ground.
                Measured reason: `--primary-strong` on the section's morning tint came
                out at 4.47:1, under the floor, because tinting the ground darkens
                what text tuned for `--background` sits on. On the card's white
                surface the same link is 4.55+. Giving a citation its own quiet
                surface is also just better typography than floating it in the wash. */}
            <div className="card-lift mt-6 p-5">
              <p className="text-[15px] font-semibold leading-relaxed text-muted-foreground">
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
            </div>
            <p className="mt-4 text-[15px] font-semibold leading-relaxed text-muted-foreground">
              A reminder only the patient sees is one that can fail quietly. When the
              person you look after lives somewhere else, the thing you actually need
              to know is that today did not go to plan.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══ 13:00 · HOW IT WORKS ═══════════════════════════════════════ */}
      <section
        id="how"
        className="px-6 py-16"
        style={{ background: sectionGround(S.how.slot, S.how.tint) }}
      >
        <div className="mx-auto max-w-4xl">
          <Reveal>
            <Eyebrow time={S.how.time} label={S.how.label} slot={S.how.slot} />
            <h2 className="title-section mt-3 text-foreground">
              Set it once. The phone does the rest.
            </h2>
          </Reveal>

          <div className="mt-8 grid items-center gap-10 md:grid-cols-2">
            <Reveal>
              <ol className="space-y-3">
                {STEPS.map((s) => (
                  <li key={s.n} className="card-lift flex items-start gap-4 p-5">
                    <span
                      aria-hidden
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-surface font-mono text-sm font-bold text-accent-surface-foreground"
                    >
                      {s.n}
                    </span>
                    <div>
                      <p className="text-[15px] font-black text-foreground">{s.t}</p>
                      <p className="mt-0.5 text-[13.5px] font-semibold leading-relaxed text-muted-foreground">
                        {s.b}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </Reveal>

            <Reveal delay={80}>
              <HighlightOnView>
                <TodayMock />
              </HighlightOnView>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══ 17:00 · WHAT IS INSIDE ═════════════════════════════════════ */}
      <section
        id="features"
        className="px-6 py-16"
        style={{ background: sectionGround(S.features.slot, S.features.tint) }}
      >
        <div className="mx-auto max-w-4xl">
          <Reveal>
            <Eyebrow time={S.features.time} label={S.features.label} slot={S.features.slot} />
            <h2 className="title-section mt-3 text-balance text-foreground">
              Built for the dose that actually gets missed.
            </h2>
          </Reveal>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body, slot }) => (
              <Reveal key={title}>
                <div className="card-lift h-full p-5">
                  <Icon
                    aria-hidden
                    className="h-6 w-6"
                    strokeWidth={2.25}
                    style={{ color: `var(--slot-${slot}-ink)` }}
                  />
                  <h3 className="mt-3 text-[15px] font-black text-foreground">{title}</h3>
                  <p className="mt-1.5 text-[13.5px] font-semibold leading-relaxed text-muted-foreground">
                    {body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Seven languages, shown in their own scripts — a list written only in
              English is unusable by exactly the person who needs to change it. */}
          <Reveal>
            <div className="card-lift mt-6 p-5">
              {/* The COUNT is derived, never typed. `pickableLocales()` is gated on
                  the completeness test, so a language that is half-translated is not
                  in this list — and a hardcoded "seven" would keep claiming seven
                  after that gate dropped one. The heading cannot drift from the
                  chips because they read the same source. */}
              <h3 className="text-[15px] font-black text-foreground">
                {languages.length} languages, alarm screen included
              </h3>
              <p className="mt-1.5 text-[13.5px] font-semibold leading-relaxed text-muted-foreground">
                The alarm speaks the language chosen in the app, not the one the phone
                is set to.
              </p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {languages.map((code) => (
                  <li
                    key={code}
                    lang={LOCALE_META[code].htmlLang}
                    className="rounded-full px-3 py-1.5 text-[13px] font-bold text-foreground"
                    style={{ background: 'var(--surface-sunk)' }}
                  >
                    {LOCALE_META[code].nativeName}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          {/* The unbuilt flagship gets one honest line, never a card. */}
          <Reveal>
            <p className="mt-5 text-center text-[13px] font-semibold text-muted-foreground">
              Alarms in a family member&apos;s recorded voice are being built. They are
              not in the app yet.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══ 20:00 · RELIABILITY ════════════════════════════════════════ */}
      <section
        id="reliability"
        className="px-6 py-16"
        style={{ background: sectionGround(S.reliability.slot, S.reliability.tint) }}
      >
        <div className="mx-auto max-w-4xl">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <Reveal>
              <Eyebrow
                time={S.reliability.time}
                label={S.reliability.label}
                slot={S.reliability.slot}
              />
              <h2 className="title-section mt-3 text-balance text-foreground">
                A reminder is only worth the night it survives.
              </h2>
              <p className="mt-3 text-[15px] font-semibold leading-relaxed text-muted-foreground">
                Every claim below was checked on a real phone, not reasoned about.
              </p>
              <div className="mt-6">
                <AlarmMock />
              </div>
            </Reveal>

            <Reveal delay={80}>
              <ul className="space-y-3">
                {FACTS.map(({ icon: Icon, k, p }) => (
                  <li key={k} className="card-lift flex items-start gap-3 p-4">
                    <Icon
                      aria-hidden
                      className="mt-0.5 h-5 w-5 shrink-0 text-primary-strong"
                      strokeWidth={2.25}
                    />
                    <div>
                      <p className="text-[14px] font-black text-foreground">{k}</p>
                      <p className="mt-0.5 text-[13px] font-semibold leading-relaxed text-muted-foreground">
                        {p}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══ 23:00 · GET IT (night) ═════════════════════════════════════ */}
      <section
        id="get"
        className="px-6 py-16"
        style={{ background: 'var(--slot-night)' }}
      >
        <div className="mx-auto max-w-4xl">
          <div className="grid gap-10 md:grid-cols-[1.2fr_.8fr] md:items-center">
            <Reveal>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">
                {S.get.time} · {S.get.label}
              </p>
              <h2 className="title-section mt-3 text-balance text-white">
                Set up tonight&apos;s dose in two minutes.
              </h2>
              <p className="mt-3 max-w-[44ch] text-[15px] font-semibold leading-relaxed text-white/75">
                Add the medicines, pick a language, and the first alarm rings the same
                day.
              </p>

              {DOWNLOAD_READY ? (
                <p className="mt-6 text-sm font-semibold text-white/70">
                  Install steps appear here once the build is published.
                </p>
              ) : (
                <div className="mt-6 rounded-[var(--r-card)] bg-white/10 p-5">
                  <p className="text-[13.5px] font-black text-white">
                    The Android build is not public yet
                  </p>
                  <p className="mt-1.5 text-[13px] font-semibold leading-relaxed text-white/75">
                    It is in closed testing, so there is no download link on this page —
                    there is nothing honest to link to. The web version works today and
                    installs to your home screen.
                  </p>
                  <Link
                    href={WEB_APP_HREF}
                    className={`mt-4 inline-flex min-h-11 items-center justify-center rounded-[var(--r-control)] bg-primary-strong px-5 py-2.5 text-sm font-black text-primary-strong-foreground transition-colors hover:bg-primary-strong-hover ${FOCUS}`}
                  >
                    Open the web app
                  </Link>
                </div>
              )}
            </Reveal>

            {/* QR: a placeholder that says so. It will point at DOWNLOAD_URL, the
                same constant the buttons read, so there is exactly one link to
                change on Play-Store day. */}
            <Reveal delay={80}>
              <div className="mx-auto w-full max-w-[240px] rounded-[var(--r-card)] bg-white p-5 text-center">
                <div
                  aria-hidden
                  className="aspect-square rounded-[var(--r-control)]"
                  style={{
                    background:
                      'repeating-conic-gradient(var(--slot-night) 0% 25%, #fff 0% 50%) 0 0/20px 20px',
                    opacity: DOWNLOAD_READY ? 1 : 0.25,
                  }}
                />
                <p className="mt-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {DOWNLOAD_READY ? 'Scan to install' : 'QR when the build ships'}
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═════════════════════════════════════════════════════ */}
      <footer className="px-6 pb-12 pt-10" style={{ background: 'var(--slot-night)' }}>
        <div className="mx-auto max-w-4xl">
          <p className="max-w-[60ch] text-[13px] font-semibold leading-relaxed text-white/70">
            {BRAND} helps you remember doses a doctor has already prescribed. It does
            not check what you enter, does not give medical advice, and does not
            diagnose anything. Always follow your doctor or pharmacist.
          </p>
          <nav className="mt-5 flex flex-wrap gap-x-4 gap-y-1">
            {LEGAL.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-[13px] font-bold text-white/70 underline underline-offset-4 hover:text-white ${FOCUS}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </main>
  );
}
