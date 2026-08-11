'use client';

// Shared state for the dashboard banner and the Settings setup guide.
//
// One hook rather than two copies, so the two surfaces can never disagree about
// whether a setting is satisfied — a banner insisting something is broken while
// the guide shows a green tick would destroy trust in both.

import { useCallback, useEffect, useState } from 'react';
import { getReliabilityStatus, type ReliabilityStatus, type ReliabilityTarget } from '@/lib/native/schedule-bridge';
import {
  isItemSatisfied,
  readManualDone,
  setupItems,
  writeManualDone,
  type SetupItem,
} from '@/lib/native/setup-guide';

export interface ReliabilityView {
  /** Null outside the Android app, or on an APK older than this bridge method. */
  status: ReliabilityStatus | null;
  items: SetupItem[];
  satisfied: (item: SetupItem) => boolean;
  outstanding: SetupItem[];
  markDone: (id: ReliabilityTarget) => void;
  undoDone: (id: ReliabilityTarget) => void;
}

export function useReliability(refreshKey?: string): ReliabilityView {
  const [status, setStatus] = useState<ReliabilityStatus | null>(null);
  const [manualDone, setManualDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    // State lands in a promise callback rather than synchronously in the effect
    // body: the bridge is an external system, and this avoids a cascading render
    // on every navigation.
    const refresh = () => {
      getReliabilityStatus()
        .then((next) => {
          if (cancelled) return;
          setStatus(next);
          setManualDone(readManualDone());
        })
        .catch(() => {
          // Older APK without the method, or a native error. Showing nothing is
          // correct — this must never become the problem it warns about.
          if (!cancelled) setStatus(null);
        });
    };

    refresh();

    // Re-check when the user comes back from the settings screen we sent them
    // to. A warning that survives being fixed teaches people to ignore warnings.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshKey]);

  const satisfied = useCallback(
    (item: SetupItem) => {
      if (!status) return false;
      // Auto-detected items ignore the manual mark entirely: if Android can tell
      // us, Android wins. Otherwise a user could tick "done" and hide a genuinely
      // broken setting from themselves.
      return item.autoDetected ? isItemSatisfied(item.id, status) : manualDone[item.id] === true;
    },
    [status, manualDone],
  );

  const setDone = useCallback((id: ReliabilityTarget, value: boolean) => {
    setManualDone((prev) => {
      const next = { ...prev, [id]: value };
      writeManualDone(next);
      return next;
    });
  }, []);

  const items = setupItems(status);

  return {
    status,
    items,
    satisfied,
    outstanding: items.filter((item) => !satisfied(item)),
    markDone: (id) => setDone(id, true),
    undoDone: (id) => setDone(id, false),
  };
}
