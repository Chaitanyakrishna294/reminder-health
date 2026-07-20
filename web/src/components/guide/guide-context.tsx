'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface GuideContextValue {
  activeTour: string | null;
  /** Index of the current step within the active tour. Exposed so a page can sync its
   *  own UI (e.g. the Add Medication wizard jumps to the step a field lives on). */
  stepIndex: number;
  startTour: (id: string) => void;
  stopTour: () => void;
  setStepIndex: React.Dispatch<React.SetStateAction<number>>;
}

const GuideContext = createContext<GuideContextValue | null>(null);

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const [activeTour, setActiveTour] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const startTour = useCallback((id: string) => {
    setStepIndex(0);
    setActiveTour(id);
  }, []);
  const stopTour = useCallback(() => setActiveTour(null), []);
  return (
    <GuideContext.Provider value={{ activeTour, stepIndex, startTour, stopTour, setStepIndex }}>
      {children}
    </GuideContext.Provider>
  );
}

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) {
    // Safe no-op outside a provider so a stray GuideButton never crashes.
    return { activeTour: null, stepIndex: 0, startTour: () => {}, stopTour: () => {}, setStepIndex: () => {} };
  }
  return ctx;
}
