'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useTheme } from '@/context/theme-context';
import { createClient } from '@/lib/supabase/client';

type UiMode = 'normal' | 'elderly';
type ViewMode = 'PATIENT_SELF' | 'PATIENT_MONITOR';

interface UiModeContextType {
  mode: UiMode;
  isElderly: boolean;
  toggleMode: () => void;
  setMode: (mode: UiMode) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  /**
   * The elderly view lock. When true, NO mode control renders anywhere outside
   * Settings, and `setMode`/`toggleMode` refuse — belt and braces, so a control
   * added later cannot flip the view just by forgetting to check.
   *
   * ANTI-JAIL INVARIANT: the lock must never lock out Settings. It is cleared from
   * Settings and nowhere else, so Settings has to stay reachable in every mode —
   * see the elderly nav in dashboard-main-layout, which keeps its icon deliberately.
   */
  uiModeLocked: boolean;
  /** Settings only. Persists to the profile so it survives a reinstall. */
  setUiModeLocked: (locked: boolean) => Promise<void>;
}

const UiModeContext = createContext<UiModeContextType | undefined>(undefined);

export function UiModeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const [mode, setModeState] = useState<UiMode>('normal');
  const [locked, setLockedState] = useState(false);
  // Read by setMode, which must see the CURRENT lock rather than the value captured
  // when the closure was created.
  const lockedRef = useRef(false);
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
    
    // Lock: localStorage first so the UI is correct on the first frame, then the
    // profile, which is the copy that survives a reinstall. If they disagree the
    // profile wins — it is the caregiver's decision, made on purpose, and a cleared
    // browser must not quietly unlock the phone.
    try {
      const cached = localStorage.getItem('ui-mode-locked') === '1';
      lockedRef.current = cached;
      setLockedState(cached);
    } catch { /* private mode */ }

    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase
          .from('profiles')
          .select('ui_mode_locked')
          .eq('id', user.id)
          .maybeSingle();
        if (error || !data) return; // column not migrated yet — keep the local value
        const remote = !!data.ui_mode_locked;
        lockedRef.current = remote;
        setLockedState(remote);
        try { localStorage.setItem('ui-mode-locked', remote ? '1' : '0'); } catch { /* ignore */ }
      } catch { /* signed out, offline — the cached value stands */ }
    })();

    setMounted(true);
  }, []);

  const setMode = (newMode: UiMode) => {
    // The lock is enforced here, not only by hiding controls. Hiding is a promise
    // about today's UI; this is a promise about every UI.
    if (lockedRef.current) return;
    setModeState(newMode);
    localStorage.setItem('ui-mode', newMode);
  };

  const toggleMode = () => {
    setMode(mode === 'normal' ? 'elderly' : 'normal');
  };

  /**
   * Set the lock. Settings is the only caller.
   *
   * localStorage first and the profile second, deliberately: the switch has to feel
   * instant on a slow phone, and the lock must still hold if the write fails or the
   * device is offline. The profile copy is what survives a reinstall or a new phone
   * — the exact moments when the person least able to re-find this setting is the
   * one holding the device.
   */
  const setUiModeLocked = async (locked: boolean) => {
    lockedRef.current = locked;
    setLockedState(locked);
    try { localStorage.setItem('ui-mode-locked', locked ? '1' : '0'); } catch { /* private mode */ }
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from('profiles')
        .update({ ui_mode_locked: locked })
        .eq('id', user.id);
      // A missing column means migration_ui_mode_lock_2026_08_13.sql has not been
      // applied yet. The lock still works on this device from localStorage; it just
      // will not follow the user to a new one. Logged rather than surfaced, because
      // the person toggling it can do nothing about a pending migration.
      if (error) console.warn('[ui-mode] lock not persisted to profile:', error.message);
    } catch (err) {
      console.warn('[ui-mode] lock not persisted to profile:', err);
    }
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
      setViewMode,
      uiModeLocked: mounted && locked,
      setUiModeLocked,
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
