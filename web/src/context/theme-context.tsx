'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Theme that suits the current time of day: dark in the evening/night
// (7 PM – 7 AM), light through the day. Used as the default when the user
// hasn't explicitly chosen a theme.
function getTimeBasedTheme(): Theme {
  const hour = new Date().getHours();
  return hour >= 19 || hour < 7 ? 'dark' : 'light';
}

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
      // No saved choice → follow the time of day.
      const initialTheme = getTimeBasedTheme();
      setThemeState(initialTheme);
      applyTheme(initialTheme);
    }
    setMounted(true);

    // Keep the time-based theme live for users who haven't picked one manually,
    // so the app shifts to dark in the evening and back to light in the morning
    // without a reload. A manual toggle (saved in localStorage) disables this.
    const intervalId = setInterval(() => {
      if (localStorage.getItem('theme')) return; // manual choice in effect
      const next = getTimeBasedTheme();
      applyTheme(next);
      setThemeState(next); // no-op re-render if unchanged
    }, 60 * 1000);

    return () => clearInterval(intervalId);
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  return (
    <ThemeContext.Provider value={{ theme: mounted ? theme : 'light', toggleTheme, setTheme }}>
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
