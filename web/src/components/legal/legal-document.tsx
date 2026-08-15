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
        <h1 className="text-3xl font-black mb-2">{doc.title}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {t.legal.lastUpdated}: {doc.updated}
        </p>

        {/* WHICH VERSION GOVERNS, said before the document rather than after it.
            A reader deciding whether to trust a translated legal text needs that
            fact first; at the bottom it is a disclaimer nobody reaches. */}
        {isTranslated && (
          <div className="rounded-2xl border border-border bg-muted/50 p-4 mb-8 space-y-3">
            <p className="text-sm font-semibold text-foreground">{t.legal.translationNotice}</p>
            <button
              type="button"
              onClick={() => setShowEnglish((v) => !v)}
              aria-pressed={showEnglish}
              className="min-h-11 px-4 rounded-xl bg-card border border-border font-bold text-sm text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showEnglish ? labelFor[docKey] : t.legal.readInEnglish}
            </button>
          </div>
        )}

        {doc.callout && (
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 mb-8">
            <p className="text-sm font-semibold">{renderEmphasis(doc.callout)}</p>
          </div>
        )}

        <section className="space-y-6 text-sm leading-relaxed">
          {doc.sections.map((section, i) => (
            <Section key={i} section={section} />
          ))}
        </section>
      </article>

      <div className="mt-10 flex flex-wrap gap-4 text-sm">
        {footerLinks.map((key) => (
          <Link
            key={key}
            href={hrefFor[key]}
            className="text-primary font-semibold hover:underline"
          >
            {labelFor[key]}
          </Link>
        ))}
        <Link href="/login" className="text-primary font-semibold hover:underline">
          {t.legal.backToSignIn}
        </Link>
      </div>
    </main>
  );
}
