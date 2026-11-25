import type { QueryKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";

const resolveQueryKey = getQueryKey as (
  procedure: unknown,
  input?: unknown,
  type?: "query" | "infinite" | "any",
) => QueryKey;

/** Build a tRPC v11 query key using real `getQueryKey`, falling back to the
 * canonical tuple shape when unit tests mock `api` with plain objects without
 * mocking `@trpc/react-query`. */
export function trpcQueryKey(
  procedure: unknown,
  fallbackPath: readonly string[],
  input?: unknown,
): QueryKey {
  try {
    const key = resolveQueryKey(procedure, input, "query");
    if (Array.isArray(key) && key.length > 0) return key;
  } catch {
    // Plain object test mocks lack tRPC's `_def` metadata.
  }
  return input === undefined
    ? [fallbackPath, { type: "query" }]
    : [fallbackPath, { input, type: "query" }];
}

/** Build a tRPC v11 procedure prefix key for broad cache eviction (`exact: false`). */
export function trpcProcedureKey(
  procedure: unknown,
  fallbackPath: readonly string[],
): QueryKey {
  try {
    const key = resolveQueryKey(procedure);
    if (Array.isArray(key) && key.length > 0) return key;
  } catch {
    // Plain object test mocks lack tRPC's `_def` metadata.
  }
  return [fallbackPath];
}
