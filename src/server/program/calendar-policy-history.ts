import { isRegularTutoringPaused, type TutoringPolicyRevision } from "~/lib/tutoring-policy";
import type { DomainDb } from "~/server/transactions";
import { TRPCError } from "@trpc/server";

export async function assertCalendarPolicyHistoryIntegrity(db: DomainDb) {
  const [state] = await db.$queryRaw<{ valid: boolean }[]>`SELECT public.tutoring_policy_history_integrity() AS valid`;
  if (!state?.valid)
    throw new TRPCError({ code: "CONFLICT", message: "Tutoring policy history is unavailable. Ask management to inspect its integrity." });
}

/** The database captures semantic effective times; never infer them from editor timestamps. */
export async function readRegularTutoringPausedAt(db: DomainDb, date: string, startsAt: Date) {
  await assertCalendarPolicyHistoryIntegrity(db);
  const revisions = await db.$queryRaw<TutoringPolicyRevision[]>`
    SELECT DISTINCT ON (date) id,date,"endDate","schedulingEffect",active,"effectiveAt"
    FROM "ProgramCalendarPolicyRevision"
    WHERE date<=${date} AND "effectiveAt"<${startsAt}
    ORDER BY date,"effectiveAt" DESC,id DESC`;
  return isRegularTutoringPaused(date, revisions);
}
