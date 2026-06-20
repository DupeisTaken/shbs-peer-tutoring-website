/**
 * Shared React Query tuning.
 *
 * Reference catalogs (courses, terms, rooms, time slots) change rarely and are admin-managed,
 * so we let them stay "fresh" for several minutes — this skips the redundant refetch every time
 * a page that lists them mounts. Edits still show up immediately: the mutations that change these
 * lists call `utils.admin.<x>.invalidate()`, and an invalidation refetches regardless of staleTime.
 */
export const REFERENCE_STALE_TIME = 5 * 60 * 1000; // 5 minutes
