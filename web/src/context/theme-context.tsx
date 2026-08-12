'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark';

/**
 * `setTheme` only — there is deliberately no `toggleTheme`.
 *
 * A one-call flip is what a one-tap control is built from, and this product's rule is
 * that light is the default and dark is a deliberate act (CLAUDE.md theme policy).
 * The toggle that used to live in the top bar was removed 2026-08-12; the single
 * control is now Settings → Layout Preference, which states what it is doing.
 * Requiring a caller to name the theme it wants keeps that structural rather than
 * conventional.
 */
interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Reflect the chosen theme onto <html> (class + color-scheme). Pure DOM, no React
// state, so it lives at module scope.
function applyTheme(newTheme: Theme) {
  const root = document.documentElement;
  if (newTheme === 'dark') {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('theme') as Theme | null;
    if (saved === 'light' || saved === 'dark') {
      // Explicit user choice always wins.
      setThemeState(saved);
      applyTheme(saved);
    } else {
      // No saved choice → default to light.
      setThemeState('light');
      applyTheme('light');
    }
    setMounted(true);
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme: mounted ? theme : 'light', setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
