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
  return Promise.all([
    utils.admin.tutees.invalidate(),
    utils.admin.tuteeStats.invalidate(),
    utils.admin.pairings.invalidate(),
    utils.admin.accounts.invalidate(),
    utils.tuteeHistory.invalidate(),
  ]);
}
