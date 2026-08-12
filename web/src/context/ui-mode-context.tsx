'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useTheme } from '@/context/theme-context';

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
  const { theme } = useTheme();
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

  /**
   * ELDERLY MODE IS ALWAYS LIGHT — enforced here, not merely intended.
   *
   * The policy has said this since the redesign, and nothing implemented it. Settings
   * disables the dark toggle WHILE in elderly, but that only stops you choosing dark
   * from inside elderly; a user already in dark who switched to elderly stayed dark,
   * with no control left to get out — the one place the rule matters most, since
   * elderly mode exists for contrast and legibility.
   *
   * This overrides the CLASS without touching the stored PREFERENCE, so leaving
   * elderly restores the dark they chose. ThemeProvider writes the class first (it is
   * the outer provider and cannot see ui-mode); this effect runs after and wins.
   * Two writers to one class is a smell, and the alternative — moving application
   * into a provider that knows both — costs a theme flash on first paint, which is
   * worse for exactly this audience.
   */
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    const dark = theme === 'dark' && !isElderly;
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
  }, [mounted, theme, isElderly]);

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
