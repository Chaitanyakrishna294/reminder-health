/**
 * THE SHAPE OF A LEGAL DOCUMENT — data, not JSX.
 *
 * The three pages used to be hand-written JSX, which is fine for one language and
 * unmaintainable for seven: translating them that way means seven copies of the
 * markup, and the day a section is added it gets added to one of them. As data there
 * is one renderer (components/legal/legal-document.tsx) and seven content files, so a
 * missing section is a missing array entry rather than a silently divergent page.
 *
 * INLINE EMPHASIS uses `**double asterisks**`, parsed by the renderer. Real markdown
 * would be a dependency for one feature of one syntax. The emphasis is not decoration
 * in these documents — "we do not sell your data", "never rely on the Service for
 * emergencies" — so dropping it from the translations would make the translated
 * versions quietly weaker than the English, which is the opposite of the point.
 */

/** A bullet that may carry its own nested list — §3's list of processors needs this. */
export interface LegalBullet {
  text: string;
  sub?: string[];
}

export interface LegalSection {
  /** Omitted for the opening preamble, which has no heading in any of the three. */
  heading?: string;
  paragraphs?: string[];
  bullets?: (string | LegalBullet)[];
  /** Paragraphs rendered AFTER the bullets. §3 and §5a both need this. */
  afterBullets?: string[];
}

export interface LegalDoc {
  title: string;
  /** Free text, already formatted for the locale. Not a Date — these are editorial. */
  updated: string;
  /** The boxed line at the top. Only the medical disclaimer has one. */
  callout?: string;
  sections: LegalSection[];
}

export interface LegalDocSet {
  privacy: LegalDoc;
  terms: LegalDoc;
  disclaimer: LegalDoc;
}

/** Which document a page is asking for. */
export type LegalDocKey = keyof LegalDocSet;
