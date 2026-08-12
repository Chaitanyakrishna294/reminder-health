import RouteLoading from '@/components/ui/route-loading';

/**
 * The catch-all loading state for the whole dashboard group.
 *
 * Ten routes had their own `loading.tsx` and the rest had none — so tapping
 * Notifications, or Save account, or anything added later, sat on the previous page
 * in total silence until the server finished. On a phone that reads as a dead tap,
 * and the reflex is to tap again.
 *
 * Next uses the CLOSEST boundary, so the routes with their own specific wording keep
 * it and this only fills the gaps — including gaps that do not exist yet, which is
 * the point. Same reasoning as the back arrow living in the layout: a rule that
 * needs a new file per page is a rule that lapses on the page someone forgets.
 *
 * The 300ms delay lives inside RouteLoading, so a fast navigation still paints as
 * instant rather than flashing a spinner. Immediate acknowledgement of the tap is a
 * different job, done by the nav's own pending state (dashboard-main-layout.tsx).
 */
export default function Loading() {
  return <RouteLoading label="Loading…" />;
}
