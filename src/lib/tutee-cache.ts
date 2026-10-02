import { settleRefreshes } from "./settle-refreshes";

/** A changed enrollment affects roster rows, ownership labels, attendance summaries and
 * pairing membership together. Keep these invalidations shared across decision screens. */
type Invalidator = { invalidate: () => Promise<void> };
export function invalidateTuteeViews(utils: {
  admin: {
    tutees: Invalidator;
    tuteeStats: Invalidator;
    pairings: Invalidator;
    accounts: Invalidator;
  };
  tuteeHistory: Invalidator;
}) {
  // Keep this nested group pending through all reads before forwarding any failure.
  return settleRefreshes([
    () => utils.admin.tutees.invalidate(),
    () => utils.admin.tuteeStats.invalidate(),
    () => utils.admin.pairings.invalidate(),
    () => utils.admin.accounts.invalidate(),
    () => utils.tuteeHistory.invalidate(),
  ]);
}
