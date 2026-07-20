'use client';

// Fires a named guided tour once, the first time a user reaches a page. The "seen"
// flag lives in localStorage keyed per tour, so each tour auto-plays exactly once and
// then only reopens via the ? GuideButton. Renders nothing.

import { useEffect } from 'react';
import { useGuide } from './guide-context';

export default function GuideAutoStart({ tour, delayMs = 700 }: { tour: string; delayMs?: number }) {
  const { startTour } = useGuide();

  useEffect(() => {
    const key = `guide-seen-${tour}`;
    let seen = true;
    try {
      seen = localStorage.getItem(key) === '1';
    } catch {
      // localStorage unavailable — skip auto-start rather than replay every load.
      return;
    }
    if (seen) return;

    try {
      localStorage.setItem(key, '1');
    } catch {
      /* ignore */
    }
    // Small delay so the page's tour targets have rendered before the spotlight measures them.
    const t = setTimeout(() => startTour(tour), delayMs);
    return () => clearTimeout(t);
  }, [tour, delayMs, startTour]);

  return null;
}
