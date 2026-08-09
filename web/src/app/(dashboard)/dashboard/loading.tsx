import DashboardSkeleton from '@/components/dashboard/dashboard-skeleton';

/**
 * The dashboard is the one route with a skeleton instead of the shared brand mark:
 * its layout is fixed and dense enough that showing the SHAPE of what is arriving is
 * more useful than a spinner. Every other route still uses `RouteLoading`, because a
 * skeleton whose shape depends on data would be a promise the page cannot keep.
 */
export default function Loading() {
  return <DashboardSkeleton />;
}
