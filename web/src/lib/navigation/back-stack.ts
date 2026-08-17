/**
 * WHO GETS THE BACK PRESS — a registry, because routes are not the only thing a
 * user means by "back".
 *
 * `AndroidBack` used to reason purely from `pathname`, so anything that opens
 * WITHOUT changing the URL was invisible to it: the vault's full-screen document
 * viewer, the folder drilldown, the upload wizard, every confirm dialog. On those
 * surfaces the hardware back either did nothing or — worse — navigated the webview
 * out from under an open overlay, which on a full-screen viewer with no close
 * button is a trap.
 *
 * The fix is not more pathname special-cases. Any component that owns dismissible
 * state registers a handler while that state is open; the hardware back runs the
 * MOST RECENTLY REGISTERED one and stops there. Last-in-first-out is exactly right
 * for nesting: a dialog opened on top of a viewer opened inside a folder unwinds in
 * the order it was built.
 *
 * Deliberately a plain module, not a context. It is read from an event handler
 * outside React's tree (Capacitor's `backButton`), and a context would mean
 * threading a provider through every overlay that needs it. There is no state here
 * that React needs to re-render on.
 */

type BackHandler = () => void;

const handlers: BackHandler[] = [];

/** Register while an overlay is open. Returns the unregister function. */
export function pushBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    // lastIndexOf, not indexOf: if the same function is somehow registered twice,
    // remove the most recent, matching the LIFO order the stack is read in.
    const i = handlers.lastIndexOf(handler);
    if (i !== -1) handlers.splice(i, 1);
  };
}

/**
 * Run the topmost handler. Returns true if something consumed the press, so the
 * caller knows not to also navigate — the bug this whole module exists to stop.
 */
export function consumeBack(): boolean {
  const handler = handlers[handlers.length - 1];
  if (!handler) return false;
  handler();
  return true;
}

/** Test seam. Not for app code. */
export function _backHandlerCount(): number {
  return handlers.length;
}
