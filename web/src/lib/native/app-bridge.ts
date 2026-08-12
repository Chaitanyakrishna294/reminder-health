/**
 * Thin wrapper around Capacitor's `App` plugin — the Android hardware back button
 * and minimize-to-background.
 *
 * Same shape and same reason as schedule-bridge.ts: no `@capacitor/core` dependency
 * is added to the web build, because this bundle also runs in a plain browser where
 * `window.Capacitor` simply does not exist. Everything here degrades to a no-op off
 * the app, which is correct — intercepting the back button of a browser tab would be
 * user-hostile, and a web page cannot minimize itself.
 *
 * REQUIRES `@capacitor/app` IN THE ANDROID PROJECT. It was not installed when this
 * was written (only @capacitor/core and @capacitor/android were), so
 * `window.Capacitor.Plugins.App` is undefined on any APK built before that lands.
 * `supportsBackButton()` reports the truth so callers can behave sanely on an older
 * build rather than silently doing nothing — and per CLAUDE.md's server.url note,
 * this needs BOTH a fresh APK and a web deploy before it can be tested on a device.
 */

/**
 * The `App` plugin's shape is declared alongside ScheduleBridge in
 * schedule-bridge.ts, not here. `declare global` blocks MERGE, and two of them
 * describing `window.Capacitor` with different `Plugins` shapes is a type conflict,
 * not a union — so the whole bridge surface has exactly one declaration.
 */
import { isNativeApp, type BackButtonEvent, type PluginListenerHandle } from './schedule-bridge';

/** True when this APK actually carries @capacitor/app. */
export function supportsBackButton(): boolean {
  return isNativeApp() && !!window.Capacitor?.Plugins?.App?.addListener;
}

/**
 * Subscribe to the Android hardware back button.
 *
 * @returns an unsubscribe function — always safe to call, even when nothing was
 *   subscribed, so callers need no branching in their effect cleanup.
 */
export function onBackButton(handler: (event: BackButtonEvent) => void): () => void {
  if (!supportsBackButton()) return () => {};

  let handle: PluginListenerHandle | null = null;
  let cancelled = false;

  try {
    const result = window.Capacitor!.Plugins!.App!.addListener('backButton', handler);
    // Capacitor 7 returns a Promise; older shapes return the handle directly. The
    // cancelled flag covers an unmount that happens before the promise settles —
    // otherwise the listener outlives the component and fires into a dead handler.
    Promise.resolve(result).then((h) => {
      if (cancelled) void h?.remove();
      else handle = h;
    }).catch((err) => console.error('[app-bridge] backButton listener failed:', err));
  } catch (err) {
    console.error('[app-bridge] backButton listener threw:', err);
    return () => {};
  }

  return () => {
    cancelled = true;
    void handle?.remove();
  };
}

/**
 * Send the app to the background.
 *
 * `minimizeApp`, never `exitApp`: minimize is what Android's own back gesture does
 * from a launcher activity, and it leaves the process alive. Killing the app would
 * be a louder goodbye than the user asked for — though it is worth saying plainly
 * that neither one stops reminders. Alarms are registered with AlarmManager by the
 * native core and fire whether this webview exists or not.
 *
 * @returns false when there is nothing native to call, so the caller can decide.
 */
export async function minimizeApp(): Promise<boolean> {
  const app = window.Capacitor?.Plugins?.App;
  if (!isNativeApp() || !app?.minimizeApp) return false;
  try {
    await app.minimizeApp();
    return true;
  } catch (err) {
    console.error('[app-bridge] minimizeApp failed:', err);
    return false;
  }
}
