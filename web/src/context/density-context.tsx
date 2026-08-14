'use client';

/**
 * WHICH OF THE THREE DENSITIES THIS SCREEN IS. See lib/design/density.ts for the
 * system itself — this file only resolves it and hands it out.
 *
 * Sits INSIDE UiModeProvider because elderly outranks everything else, and
 * elderly is that provider's to know.
 *
 * THE FIRST-PAINT PROBLEM, and why there is a script in app/layout.tsx.
 * `Capacitor.isNativePlatform()` is a browser-side fact, and the server renders
 * every page long before any of it runs. So the streamed HTML is always the
 * browser density, and on the app it would visibly collapse to the app density
 * once React caught up — a full-page reflow of the home screen, six times a day.
 * `useLayoutEffect` cannot help: the server HTML is painted before hydration
 * begins, not after it. The pre-paint script stamps `data-density` on <html>
 * from a remembered flag, and one CSS rule hides `.browser-only` while the
 * attribute says `app`. This provider then re-stamps the attribute with the
 * TRUTH, so a wrong guess is corrected within the first commit.
 *
 * That makes two mechanisms for one decision, which is a smell — accepted for
 * the same reason the theme script in the same <head> is accepted, and kept
 * honest by the rule that the attribute is only ever an approximation and React
 * is always the authority.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useUiMode } from '@/context/ui-mode-context';
import { isNativeApp } from '@/lib/native/schedule-bridge';
import {
  DENSITY_LAYOUT,
  DENSITY_OVERRIDE_KEY,
  DENSITY_PARAM,
  NATIVE_MEMO_KEY,
  parseDensityOverride,
  resolveDensity,
  type Density,
  type DensityLayout,
  type DensityOverride,
} from '@/lib/design/density';

interface DensityContextType {
  density: Density;
  /** What this density renders. Prefer this over comparing `density` by hand. */
  layout: DensityLayout;
  isApp: boolean;
  isBrowser: boolean;
  /** Non-null while `?preview=` is forcing a density, so the badge can say so. */
  override: DensityOverride;
  clearOverride: () => void;
}

const DensityContext = createContext<DensityContextType | undefined>(undefined);

export function DensityProvider({ children }: { children: React.ReactNode }) {
  const { isElderly } = useUiMode();
  const [isNative, setIsNative] = useState(false);
  const [override, setOverride] = useState<DensityOverride>(null);

  useEffect(() => {
    const native = isNativeApp();
    setIsNative(native);
    // The memo the pre-paint script reads on the NEXT load. Only ever written
    // true→remembered; a browser tab on the same origin has its own storage, so
    // it can never inherit the app's answer.
    try {
      if (native) localStorage.setItem(NATIVE_MEMO_KEY, '1');
      else localStorage.removeItem(NATIVE_MEMO_KEY);
    } catch { /* private mode */ }

    // The URL sets it; sessionStorage keeps it for the rest of the session so the
    // preview survives navigation. Reading location directly rather than
    // useSearchParams keeps this provider usable at the root layout, where a
    // Suspense boundary for a dev switch would be an odd thing to owe.
    let next: DensityOverride = null;
    try {
      const fromUrl = parseDensityOverride(
        new URLSearchParams(window.location.search).get(DENSITY_PARAM),
      );
      if (fromUrl) sessionStorage.setItem(DENSITY_OVERRIDE_KEY, fromUrl);
      next = fromUrl ?? parseDensityOverride(sessionStorage.getItem(DENSITY_OVERRIDE_KEY));
    } catch { /* private mode */ }
    setOverride(next);
  }, []);

  const density = resolveDensity({ isElderly, isNative, override });

  // Re-stamp with the truth. The script's guess is corrected here, and elderly —
  // which the script cannot know — arrives here for the first time.
  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

  const clearOverride = () => {
    try { sessionStorage.removeItem(DENSITY_OVERRIDE_KEY); } catch { /* ignore */ }
    setOverride(null);
  };

  return (
    <DensityContext.Provider
      value={{
        density,
        layout: DENSITY_LAYOUT[density],
        isApp: density === 'app',
        isBrowser: density === 'browser',
        override,
        clearOverride,
      }}
    >
      {children}
    </DensityContext.Provider>
  );
}

export function useDensity() {
  const context = useContext(DensityContext);
  if (!context) {
    throw new Error('useDensity must be used within a DensityProvider');
  }
  return context;
}
