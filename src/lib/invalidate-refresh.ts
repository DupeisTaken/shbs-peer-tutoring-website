import type {
  InvalidateOptions,
  Query,
  QueryFilters,
} from "@tanstack/react-query";

export type InvalidationTarget = {
  invalidate: (
    input?: undefined,
    filters?: Pick<QueryFilters, "predicate">,
    options?: Pick<InvalidateOptions, "throwOnError">,
  ) => Promise<void>;
};

/** Throwing invalidation can reject before another matching read settles.
 * Keep React Query's all-read waiting, then report new errors from this scoped
 * refresh. Inactive cached errors must not be mistaken for new failures. */
export async function invalidateAndReport(
  target: InvalidationTarget,
): Promise<void> {
  const reads = new Map<Query, number>();
  await target.invalidate(
    undefined,
    {
      predicate(query) {
        if (!reads.has(query)) reads.set(query, query.state.errorUpdateCount);
        return true;
      },
    },
    { throwOnError: false },
  );
  for (const [query, previousErrors] of reads) {
    if (query.state.errorUpdateCount > previousErrors)
      throw query.state.error ?? new Error("A requested refresh failed.");
  }
}
