/**
 * THE NAVIGATION MODEL — tabs replace, sub-pages push, back pops, root minimizes.
 *
 * The app is a webview wearing a native app's clothes, and until now it navigated
 * like a website: every tab tap pushed a history entry, so pressing Android back
 * after Dashboard → Medications → Settings → Dashboard walked backwards through the
 * whole chain. Nobody expects that from a tab bar. Worse, back from a root page with
 * no history exits the app outright, which for an elderly user reads as "the app
 * disappeared".
 *
 * ROOT PAGES are the five tab destinations. Switching between them REPLACES the
 * current entry, so the stack never accumulates tab taps and back from any of them
 * means "leave the app", not "undo a tab".
 *
 * SUB-PAGES push normally — notifications, a medication's detail, the legal pages.
 * Back pops exactly one level and lands on whatever opened it.
 *
 * Keep this list in sync with `getNavItems()` in dashboard-main-layout.tsx. It is
 * duplicated deliberately rather than imported from there: that module is a heavy
 * client component, and the back handler needs the answer without pulling the whole
 * nav in. Five strings that change roughly never.
 */

export const ROOT_PATHS = [
  '/dashboard',
  '/care-circle',
  '/medications',
  '/health-vault',
  '/settings',
] as const;

/**
 * Is this a tab destination (back = leave the app) or a sub-page (back = pop)?
 *
 * EXACT match, not `startsWith`. `/medications` is a root; `/medications/42` and
 * `/medications/new` are sub-pages you must be able to back out of. A prefix test
 * would trap someone on a medication detail page behind an exit dialog.
 */
export function isRootPath(pathname: string): boolean {
  return (ROOT_PATHS as readonly string[]).includes(pathname);
}
