'use client';

// Fires a named guided tour once, the first time a user reaches a page. The "seen"
// flag lives in localStorage keyed per tour, so each tour auto-plays exactly once and
// then only reopens via the ? GuideButton. Renders nothing.
//
// NOT FOR AN ESTABLISHED ACCOUNT (2026-08-14). "Seen once per device" was the only
// gate, and localStorage is per-device: a returning user on a new phone, after a
// reinstall, or with cleared storage was treated as brand new and got a tour
// explaining how to add their first medicine — while looking at nineteen of them.
// Someone whose account already holds medications has demonstrably used the app,
// and interrupting them to explain it is the app talking over the person.
//
// The tours are all still there on the ? button. Nothing is removed, only
// un-volunteered.

import { useEffect } from 'react';
import { useGuide } from './guide-context';
import { autoStartDecision } from '@/lib/guide/auto-start';

/**
 * Set once the account is known to hold data, and checked by EVERY tour
 * afterwards.
 *
 * It exists because the signal and the need are on different pages: the
 * dashboard and the medications list know how many medications there are, and
 * the add-medication wizard does not. Rather than give the wizard its own query
 * for a fact two other pages already have, whichever of them renders first
 * records it and the wizard reads the answer.
 */
const ESTABLISHED_KEY = 'guide-established';

export default function GuideAutoStart({
  tour,
  delayMs = 700,
  /**
   * Whether this account already holds medications. Pass it wherever it is
   * known; omitting it means "cannot tell from here", which falls back to
   * [ESTABLISHED_KEY] rather than assuming the account is new.
   */
  accountHasData,
}: {
  tour: string;
  delayMs?: number;
  accountHasData?: boolean;
}) {
  const { startTour } = useGuide();

  useEffect(() => {
    const key = `guide-seen-${tour}`;

    let established = false;
    let seen = true;
    try {
      established = localStorage.getItem(ESTABLISHED_KEY) === '1';
      seen = localStorage.getItem(key) === '1';
    } catch {
      // localStorage unavailable — skip auto-start rather than replay every load.
      return;
    }

    const decision = autoStartDecision({ accountHasData, established, seen });
    if (decision === 'skip') return;

    if (decision === 'suppress') {
      try {
        localStorage.setItem(ESTABLISHED_KEY, '1');
        // Also mark THIS tour seen, so emptying the medication list later cannot
        // resurface a tour for an account that has been using the app for months.
        localStorage.setItem(key, '1');
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      localStorage.setItem(key, '1');
    } catch {
      /* ignore */
    }
    // Small delay so the page's tour targets have rendered before the spotlight measures them.
    const t = setTimeout(() => startTour(tour), delayMs);
    return () => clearTimeout(t);
  }, [tour, delayMs, accountHasData, startTour]);

  return null;
}
