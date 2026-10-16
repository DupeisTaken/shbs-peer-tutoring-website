import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import {
  type programCalendarWrite,
  type programCalendarRemove,
} from "~/lib/program-calendar";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
} from "~/server/transactions";

/** A tombstone keeps the version monotonic: remove/recreate never revives a stale editor. */
export async function saveProgramCalendar(
  db: DomainDb,
  input: z.infer<typeof programCalendarWrite>,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, `program-calendar:${input.date}`);
    const current = await tx.programCalendarDay.findUnique({
      where: { date: input.date },
    });
    if ((current?.version ?? 0) !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message: "The tutoring notice changed. Reload before saving.",
      });
    return tx.programCalendarDay.upsert({
      where: { date: input.date },
      create: { date: input.date, reason: input.reason },
      update: { reason: input.reason, active: true, version: { increment: 1 } },
    });
  });
}
export async function removeProgramCalendar(
  db: DomainDb,
  input: z.infer<typeof programCalendarRemove>,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, `program-calendar:${input.date}`);
    const current = await tx.programCalendarDay.findUnique({
      where: { date: input.date },
    });
    if (!current?.active || current.version !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message: "The tutoring notice changed. Reload before removing it.",
      });
    return tx.programCalendarDay.update({
      where: { date: input.date },
      data: { active: false, version: { increment: 1 } },
    });
  });
}
