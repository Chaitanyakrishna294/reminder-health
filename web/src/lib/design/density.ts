/**
 * THE THREE DENSITIES, AS ONE SYSTEM.
 *
 * The same routes, the same data and the same derivations render at three
 * densities. They are ONE system with a table of differences, never three
 * implementations — the elderly path already taught this lesson the expensive
 * way (the old elderly dashboard re-derived its own next-dose pick and resolve
 * handler, so a year of fixes landed in normal mode and reached none of it).
 *
 *   browser — the full view. Keeps the side column the redesign spec calls the
 *             analytics column: compliance ring, care circle, inventory.
 *   app     — the Capacitor webview. A calm today-view: the dose you owe,
 *             nothing to interpret. Everything the side column carries is one
 *             tap away in the five-icon nav, so dropping it removes duplication,
 *             not capability.
 *   elderly — the minimal presentation. FEWER elements, not bigger ones; a
 *             one-question screen. Already built (`ElderlyToday`).
 *
 * Density is PRESENTATION ONLY. Nothing here may gate a derivation, a query, a
 * write path or a safety check — if a density ever needs its own copy of dose
 * logic, the split is in the wrong place.
 */

export type Density = 'browser' | 'app' | 'elderly';

/** A dev override, held for the session. See DENSITY_PARAM. */
export type DensityOverride = 'app' | 'browser' | null;

/** `?preview=app` / `?preview=browser`. */
export const DENSITY_PARAM = 'preview';

/**
 * sessionStorage, not localStorage, and STICKY for the session on purpose.
 *
 * A preview switch you have to re-append to every URL cannot be used to walk the
 * app, which is the entire point of having one. Session scope means it dies with
 * the tab rather than following someone into next week wondering why their
 * browser lost its analytics — and while it is set, a badge says so.
 */
export const DENSITY_OVERRIDE_KEY = 'previewDensity';

/**
 * Remembers whether this origin's last load was inside the Capacitor app, so the
 * pre-paint script in app/layout.tsx can stamp the right density before React
 * exists. Written by DensityProvider. See the flash note there.
 */
export const NATIVE_MEMO_KEY = 'isNativeApp';

/**
 * What each density renders. A table, so changing a density is a data edit and
 * the whole difference between the three is readable in one place.
 */
export interface DensityLayout {
  /**
   * The right-hand column — compliance ring, care circle, inventory. The spec's
   * "analytics column". Off in the app: every card in it duplicates a nav tab
   * (Care circle, Medications) or a strip that is already on the page.
   */
  sideColumn: boolean;
  /**
   * The "Enable Browser Notifications" prompt. Meaningless inside the app, where
   * reminders are native AlarmManager registrations and the notification
   * permission is handled by ReliabilityCheck. Belt-and-braces rather than an
   * observed bug: Android's WebView does not implement the Push API, so the
   * banner's own feature detection already declines to fire there.
   */
  webPushBanner: boolean;
}

export const DENSITY_LAYOUT: Record<Density, DensityLayout> = {
  browser: { sideColumn: true, webPushBanner: true },
  app: { sideColumn: false, webPushBanner: false },
  // Elderly returns an entirely different tree (ElderlyToday), so these are the
  // answers for anything outside it that asks.
  elderly: { sideColumn: false, webPushBanner: false },
};

/**
 * The one resolution rule, pure so it can be reasoned about and tested.
 *
 * ELDERLY OUTRANKS THE OVERRIDE. `?preview=` is a developer's convenience; the
 * elderly presentation is somebody's ability to read the screen, and a URL
 * nobody typed on purpose must not be able to take it away.
 */
export function resolveDensity(input: {
  isElderly: boolean;
  isNative: boolean;
  override: DensityOverride;
}): Density {
  if (input.isElderly) return 'elderly';
  if (input.override) return input.override;
  return input.isNative ? 'app' : 'browser';
}

/** Narrow an untrusted string (query param, storage) to an override. */
export function parseDensityOverride(value: string | null | undefined): DensityOverride {
  return value === 'app' || value === 'browser' ? value : null;
}
