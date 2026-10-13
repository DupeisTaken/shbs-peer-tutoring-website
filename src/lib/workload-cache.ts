import { settleRefreshes } from "./settle-refreshes";
import {
  invalidateAndReport,
  type InvalidationTarget,
} from "./invalidate-refresh";

/** Assignment/schedule/participation writes share read-only workload recovery.
 * Optional query families let role-scoped callers and older test adapters expose
 * only the readers they own; the actual tRPC utility includes both families. */
export function invalidateWorkloads(
  utils: {
    admin?: { assignmentWorkloads?: InvalidationTarget };
    tutor?: { workloadPreference?: InvalidationTarget };
  },
  reportErrors = false,
) {
  const readers = [
    utils.admin?.assignmentWorkloads,
    utils.tutor?.workloadPreference,
  ].filter((reader): reader is InvalidationTarget => !!reader);
  return settleRefreshes(
    readers.map(
      (reader) => () =>
        reportErrors ? invalidateAndReport(reader) : reader.invalidate(),
    ),
  );
}
