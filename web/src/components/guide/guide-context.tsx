'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface GuideContextValue {
  activeTour: string | null;
  startTour: (id: string) => void;
  stopTour: () => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const [activeTour, setActiveTour] = useState<string | null>(null);
  const startTour = useCallback((id: string) => setActiveTour(id), []);
  const stopTour = useCallback(() => setActiveTour(null), []);
  return (
    <GuideContext.Provider value={{ activeTour, startTour, stopTour }}>
      {children}
    </GuideContext.Provider>
  );
}

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) {
    // Safe no-op outside a provider so a stray GuideButton never crashes.
    return { activeTour: null, startTour: () => {}, stopTour: () => {} };
  }
  return ctx;
}
