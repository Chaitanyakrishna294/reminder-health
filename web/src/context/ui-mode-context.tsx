'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type UiMode = 'normal' | 'elderly';
type ViewMode = 'PATIENT_SELF' | 'PATIENT_MONITOR';

interface UiModeContextType {
  mode: UiMode;
  isElderly: boolean;
  toggleMode: () => void;
  setMode: (mode: UiMode) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

const UiModeContext = createContext<UiModeContextType | undefined>(undefined);

export function UiModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<UiMode>('normal');
  const [viewMode, setViewModeState] = useState<ViewMode>('PATIENT_SELF');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('ui-mode') as UiMode;
    if (saved === 'normal' || saved === 'elderly') {
      setModeState(saved);
    }
    
    // Cookie synchronization as the single source of truth for viewMode
    const getCookie = (name: string) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop()?.split(';').shift();
      return undefined;
    };
    
    const savedViewMode = getCookie('view-mode') as ViewMode;
    if (savedViewMode === 'PATIENT_SELF' || savedViewMode === 'PATIENT_MONITOR') {
      setViewModeState(savedViewMode);
    }
    
    setMounted(true);
  }, []);

  const setMode = (newMode: UiMode) => {
    setModeState(newMode);
    localStorage.setItem('ui-mode', newMode);
  };

  const toggleMode = () => {
    setMode(mode === 'normal' ? 'elderly' : 'normal');
  };

  const setViewMode = (newMode: ViewMode) => {
    setViewModeState(newMode);
    document.cookie = `view-mode=${newMode}; path=/; max-age=31536000; SameSite=Lax`;
  };

  // Only apply elderly changes after mounting on client to prevent hydration mismatch
  const isElderly = mounted && mode === 'elderly';

  return (
    <UiModeContext.Provider value={{ 
      mode: mounted ? mode : 'normal', 
      isElderly, 
      toggleMode, 
      setMode,
      viewMode,
      setViewMode
    }}>
      {children}
    </UiModeContext.Provider>
  );
}

export function useUiMode() {
  const context = useContext(UiModeContext);
  if (!context) {
    throw new Error('useUiMode must be used within a UiModeProvider');
  }
  return context;
}
