'use client';

import React from 'react';
import Link from 'next/link';
import PageBack from '@/components/layout/page-back';
import { useLanguage } from '@/context/language-context';
import { getLegalDocs } from '@/lib/i18n/legal';
import type { LegalBullet, LegalDoc, LegalDocKey, LegalSection } from '@/lib/i18n/legal/types';

/**
 * ONE RENDERER FOR ALL THREE LEGAL DOCUMENTS, IN ALL SEVEN LANGUAGES.
 *
 * The pages used to be hand-written JSX. Seven languages would have meant seven
 * copies of that markup per document — twenty-one files that must agree about
 * structure forever, where adding a section means remembering twenty-one places. The
 * content is data now (lib/i18n/legal/*.ts) and this is the only markup.
 *
 * THE ENGLISH ESCAPE HATCH is local state, NOT a locale switch. Someone reading the
 * Telugu privacy policy who wants to check the original against it should not have to
 * put their whole app into English and then find their way back — especially since
 * the way back is a settings screen they would then be reading in English. The toggle
 * changes this document and nothing else.
 */

/** Minimal `**bold**` splitter. See lib/i18n/legal/types.ts for why not markdown. */
function renderEmphasis(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

function Bullets({ items }: { items: (string | LegalBullet)[] }) {
  return (
    <ul className="list-disc pl-6 space-y-1">
      {items.map((item, i) => {
        const bullet: LegalBullet = typeof item === 'string' ? { text: item } : item;
        return (
          <li key={i}>
            {renderEmphasis(bullet.text)}
            {bullet.sub && bullet.sub.length > 0 && (
              <ul className="list-disc pl-6 mt-1 space-y-1">
                {bullet.sub.map((sub, j) => (
                  <li key={j}>{renderEmphasis(sub)}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Section({ section }: { section: LegalSection }) {
  return (
    <div>
      {section.heading && <h2 className="text-xl font-bold mb-2">{section.heading}</h2>}
      {section.paragraphs?.map((p, i) => (
        <p key={i} className={i > 0 ? 'mt-2' : undefined}>
          {renderEmphasis(p)}
        </p>
      ))}
      {section.bullets && (
        <div className={section.paragraphs?.length ? 'mt-2' : undefined}>
          <Bullets items={section.bullets} />
        </div>
      )}
      {section.afterBullets?.map((p, i) => (
        <p key={i} className="mt-2">
          {renderEmphasis(p)}
        </p>
      ))}
    </div>
  );
}

interface LegalDocumentProps {
  docKey: LegalDocKey;
  /** Cross-links shown at the foot. The current document is never one of them. */
  footerLinks?: LegalDocKey[];
}

export default function LegalDocument({ docKey, footerLinks = [] }: LegalDocumentProps) {
  const { locale, t } = useLanguage();
  const [showEnglish, setShowEnglish] = React.useState(false);

  const isTranslated = locale !== 'en';
  const effectiveLocale = showEnglish ? 'en' : locale;
  const doc: LegalDoc = getLegalDocs(effectiveLocale)[docKey];

  const hrefFor: Record<LegalDocKey, string> = {
    privacy: '/privacy',
    terms: '/terms',
    disclaimer: '/disclaimer',
  };
  const labelFor: Record<LegalDocKey, string> = {
    privacy: t.legal.privacy,
    terms: t.legal.terms,
    disclaimer: t.legal.disclaimer,
  };

  return (
    // `lang` on the article, not the page: the document may be showing English while
    // the app is Telugu (the escape hatch above), and a screen reader should follow
    // what is actually on screen.
    <main className="mx-auto max-w-3xl px-6 py-12 text-foreground">
      {/* Sub-page, so it carries a back arrow like every other one. The fallback is
          "/" and not /dashboard: these are reachable from the sign-in screen too,
          and sending a signed-out reader to a protected route would bounce them
          somewhere they never asked to go. */}
      <div className="mb-2">
        <PageBack fallback="/" />
      </div>

      <article lang={effectiveLocale}>
        <h1 className="title-page mb-2">{doc.title}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {t.legal.lastUpdated}: {doc.updated}
        </p>

        {/* WHICH VERSION GOVERNS, said before the document rather than after it.
            A reader deciding whether to trust a translated legal text needs that
            fact first; at the bottom it is a disclaimer nobody reaches. */}
        {isTranslated && (
          /* A well, not a bordered box: it receives content and sits below the
             page (§1). Radius joins the scale — 20 for the panel, 14 for the
             control inside it, which is also the concentric rule in §2. */
          <div className="surface-sunk rounded-[var(--r-card)] p-4 mb-8 space-y-3">
            <p className="text-sm font-semibold text-foreground">{t.legal.translationNotice}</p>
            <button
              type="button"
              onClick={() => setShowEnglish((v) => !v)}
              aria-pressed={showEnglish}
              className="min-h-11 px-4 rounded-[var(--r-control)] bg-card border border-border font-bold text-sm text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showEnglish ? labelFor[docKey] : t.legal.readInEnglish}
            </button>
          </div>
        )}

        {doc.callout && (
          /* The warning KEEPS its border: §1 allows one where it is a BOUNDARY,
             and on a tint this faint the outline is what separates the callout
             from the page rather than decorating it. Radius only joins the
             scale. */
          <div className="rounded-[var(--r-card)] border border-warning/40 bg-warning/10 p-4 mb-8">
            <p className="text-sm font-semibold">{renderEmphasis(doc.callout)}</p>
          </div>
        )}

        <section className="space-y-6 text-sm leading-relaxed">
          {doc.sections.map((section, i) => (
            <Section key={i} section={section} />
          ))}
        </section>
      </article>

      {/* `--primary-strong`, never `--primary`, for pink TEXT — CLAUDE.md names
          this as the contrast bug this project has already shipped twice. These
          links measured 2.68:1 against the page ground; the strong token takes
          them to 4.29:1.

          FLAGGED, not silently accepted: 4.29 is still short of the 4.5:1 floor.
          --primary-strong only clears it on a WHITE card (4.75:1) — measured on
          the other grounds it is 4.29 on --background, 4.32 on --surface-sunk
          and 3.97 on --board. That is a token problem, not a per-file one, and
          the freeze puts it on the maintainer. */}
      <div className="mt-10 flex flex-wrap gap-4 text-sm">
        {footerLinks.map((key) => (
          <Link
            key={key}
            href={hrefFor[key]}
            className="text-primary-strong font-semibold hover:underline"
          >
            {labelFor[key]}
          </Link>
        ))}
        <Link href="/login" className="text-primary-strong font-semibold hover:underline">
          {t.legal.backToSignIn}
        </Link>
      </div>
    </main>
  );
}
