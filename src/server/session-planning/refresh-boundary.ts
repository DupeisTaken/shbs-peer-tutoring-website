import type { TransactionDb } from "~/server/transactions";

export type SessionRefreshSchedule = {
  sourceTermId: string;
  state: string;
  executeAt: Date;
  version: number;
  updatedAt: Date;
};

/** The persisted authorization governs planning until its owner changes state.
 * Reads never execute a refresh or infer activation from the scheduled clock. */
export async function readSessionRefreshSchedules(tx: TransactionDb) {
  const rows = await tx.scheduledProgramRefresh.findMany({
    select: {
      sourceTermId: true,
      state: true,
      executeAt: true,
      version: true,
      updatedAt: true,
    },
  });
  return new Map(rows.map((row) => [row.sourceTermId, row]));
}

export function sessionExceedsRefresh(
  window: { endsAt: Date },
  schedule: SessionRefreshSchedule | undefined,
) {
  return schedule?.state === "SCHEDULED" && window.endsAt > schedule.executeAt;
}

/** A cutoff saved before the lesson remains effective on a late first read.
 * Saving/changing it at or after the start cannot retrospectively cancel work
 * that had already started. Recorded evidence is excluded by each caller. */
export function sessionRefreshSuppressed(
  window: { startsAt: Date; endsAt: Date },
  schedule: SessionRefreshSchedule | undefined,
  now: Date,
) {
  return (
    !!schedule &&
    sessionExceedsRefresh(window, schedule) &&
    (window.startsAt > now || schedule.updatedAt < window.startsAt)
  );
}

/** Requests have a captured cohort ID rather than a Prisma relation. Callers
 * first bound their request list, then resolve only those exact source rows. */
export async function readSessionRequestSources(
  tx: TransactionDb,
  requests: readonly { cohortId: string }[],
) {
  const ids = [...new Set(requests.map((row) => row.cohortId))];
  const rows = ids.length
    ? await tx.sessionPlanCohort.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          refreshSuppressed: true,
          plan: { select: { termId: true } },
        },
      })
    : [];
  return new Map(rows.map((row) => [row.id, row]));
}

export function sessionRequestSourceSuppressed(
  source:
    | {
        startsAt: Date;
        endsAt: Date;
        refreshSuppressed: boolean;
        plan: { termId: string };
      }
    | undefined,
  schedules: ReadonlyMap<string, SessionRefreshSchedule>,
  now: Date,
) {
  return (
    !!source &&
    (source.refreshSuppressed ||
      sessionRefreshSuppressed(source, schedules.get(source.plan.termId), now))
  );
}
