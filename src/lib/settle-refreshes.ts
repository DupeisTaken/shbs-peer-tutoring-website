/** Start every refresh and retain ownership until all have settled, even after a failure.
 * Callbacks also isolate synchronous throws so later refreshes still start. Nested refresh
 * groups must use the same boundary; wrapping an inner fail-fast promise cannot extend it. */
export async function settleRefreshes<T>(
  refreshes: readonly (() => Promise<T>)[],
): Promise<T[]> {
  const results = await Promise.allSettled(
    refreshes.map(async (refresh) => refresh()),
  );
  // Preserve successful values and rejection semantics; report the first failed input only
  // after every sibling has settled. Callers still decide how to present that failure.
  return results.map((result) => {
    if (result.status === "rejected") throw result.reason as unknown;
    return result.value;
  });
}
