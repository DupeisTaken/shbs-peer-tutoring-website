import { settleRefreshes } from "./settle-refreshes";
import {
  invalidateAndReport,
  type InvalidationTarget,
} from "./invalidate-refresh";

/** A changed enrollment affects roster rows, ownership labels, attendance summaries and
 * pairing membership together. Keep these invalidations shared across decision screens. */
type RefreshOptions = { reportErrors?: boolean };
type Invalidator = InvalidationTarget;
export function invalidateTuteeViews(
  utils: {
    admin: {
      tutees: Invalidator;
      tuteeStats: Invalidator;
      pairings: Invalidator;
      accounts: Invalidator;
    };
    tuteeHistory: Invalidator;
  },
  options?: RefreshOptions,
) {
  // Optional reporting preserves React Query's wait for every matching read.
  return settleRefreshes(
    [
      utils.admin.tutees,
      utils.admin.tuteeStats,
      utils.admin.pairings,
      utils.admin.accounts,
      utils.tuteeHistory,
    ].map(
      (view) => () =>
        options?.reportErrors ? invalidateAndReport(view) : view.invalidate(),
    ),
  );
}
