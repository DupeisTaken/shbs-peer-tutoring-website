import { settleRefreshes } from "./settle-refreshes";

/** A changed enrollment affects roster rows, ownership labels, attendance summaries and
 * pairing membership together. Keep these invalidations shared across decision screens. */
type RefreshOptions = { throwOnError?: boolean };
type Invalidator = {
  invalidate: (
    input?: undefined,
    filters?: undefined,
    options?: RefreshOptions,
  ) => Promise<void>;
};
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
  // Callers that show a saved-but-refresh-failed state must opt into rejection:
  // React Query otherwise resolves invalidation even when refetching failed.
  return settleRefreshes(
    [
      utils.admin.tutees,
      utils.admin.tuteeStats,
      utils.admin.pairings,
      utils.admin.accounts,
      utils.tuteeHistory,
    ].map(
      (view) => () =>
        options
          ? view.invalidate(undefined, undefined, options)
          : view.invalidate(),
    ),
  );
}
