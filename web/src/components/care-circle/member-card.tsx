'use client';

/**
 * One person in the care circle.
 *
 * Both halves of this page — the people who look after you, and the people you
 * look after — were separately-written card markup that had already diverged in
 * padding, avatar size and which actions appeared. One component, two directions,
 * because "who is this and what can they see" is the same question from either
 * side of the relationship.
 *
 * THE NAME IS THE FOCAL ELEMENT. You scan this list for a person, not for a
 * permission state, so the name takes the size and the weight and everything
 * else answers a follow-up.
 *
 * STATUS IS WORDS, NOT AN ENUM. The card used to render `conn.connection_status`
 * raw, so a patient read "ACCEPTED" and "PENDING" — database values shown to
 * someone deciding whether their daughter can see their medication list. They
 * are also shouted, which the copy rules reserve for structural labels and never
 * for a sentence.
 *
 * ELDERLY DROPS THE CONTROLS, not the people. Care Circle is in the elderly nav
 * because "who is looking after me?" is a question worth answering at any
 * density — but changing what someone can see, and disconnecting them, are
 * decisions about a relationship, which is the same class of judgement that
 * keeps dose correction and regimen editing out of elderly mode. The names, the
 * roles and the states stay; the buttons go.
 */

import React from 'react';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useUiMode } from '@/context/ui-mode-context';
import { connectionStateCopy } from '@/lib/care-circle/relationship';

export interface MemberCardProps {
  connectionId: string;
  name: string;
  /** Already resolved for the reader's side — "Daughter" vs "Mother". */
  roleLabel: string;
  /** Signed avatar URL, when the person consented to sharing a photo. */
  photoUrl?: string;
  connectionStatus: string;
  isActive: boolean;
  /**
   * Where "what they can see" goes. Now that every row carries a connection_id,
   * this is a link to THAT relationship rather than to the whole roster — the
   * settings icon used to drop everyone on the same page to find themselves.
   */
  manageHref?: string;
  /** The disconnect control, supplied by the caller so this stays presentational. */
  actions?: React.ReactNode;
  /** Extra row beneath — the monitor link on the patients side, for instance. */
  footer?: React.ReactNode;
}

export default function MemberCard({
  name,
  roleLabel,
  photoUrl,
  connectionStatus,
  isActive,
  manageHref,
  actions,
  footer,
}: MemberCardProps) {
  // Read here rather than taken as a prop: the care-circle page is a server
  // component and cannot know the mode, and threading it down through one would
  // mean a client wrapper whose only job is to pass a boolean.
  const { isElderly } = useUiMode();
  const state = connectionStateCopy(connectionStatus, isActive);

  return (
    <div
      className={`card-lift shadow-sm flex flex-col gap-3 ${
        isElderly ? 'p-6' : 'p-5'
      }`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span
          aria-hidden
          className={`shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold border border-primary/20 overflow-hidden ${
            isElderly ? 'w-14 h-14 text-base' : 'w-11 h-11 text-sm'
          }`}
        >
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            // text-primary on a primary/10 tint is 2.9:1 for TEXT, but initials
            // inside a labelled card are decorative — the name is right beside
            // them and carries the meaning. aria-hidden says so.
            (name || '').substring(0, 2).toUpperCase() || '··'
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className={`font-bold text-foreground ${isElderly ? 'text-xl break-words' : 'text-[15px] truncate'}`}>
            {name}
          </h3>
          {/* 11px was below the caption floor and this is the line that says how
              you know the person. */}
          <p className={`text-muted-foreground font-semibold mt-0.5 ${isElderly ? 'text-base' : 'text-xs'}`}>
            {roleLabel}
          </p>
          <div className="mt-2">
            <Badge tone={state.tone}>{state.label}</Badge>
          </div>
        </div>
      </div>

      {/* Controls are a caregiver-side concern. See the elderly note above. */}
      {!isElderly && (manageHref || actions) && (
        <div className="flex items-center justify-end gap-2 pt-1">
          {manageHref && (
            <Link
              href={manageHref}
              className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl text-xs font-bold text-foreground border border-border hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Settings className="w-4 h-4 shrink-0" aria-hidden />
              What they can see
            </Link>
          )}
          {actions}
        </div>
      )}

      {footer}
    </div>
  );
}
