import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assignedBlocks,
  effectivePreferredMaximum,
} from "~/lib/tutor-workload";
import { isAssignableTutor } from "~/lib/assignment-qualification";
import { portalAccess } from "~/lib/portal-access";
import { lockAccountProfile } from "~/server/account-profile";
import { staleConflict } from "~/server/concurrency";
import { recordDomainAudit } from "~/server/audit/evidence";
import { inTransaction, type DomainDb } from "~/server/transactions";

export const workloadPreferenceInput = z
  .object({
    preferredMaximum: z.number().int().min(0).max(4).nullable(),
    expectedVersion: z.number().int().nonnegative().max(2147483647),
  })
  .strict();

/** One authoritative scope serves staff selectors, pairing summaries and the tutor editor.
 * Pending tutees already reserve effort; empty or inactive-only rosters do not.
 * Inactive catalog slots do not remove a retained confirmed assignment. */
export async function tutorWorkloads(db: DomainDb, tutorId?: string) {
  // A quarter/status change cannot combine a new preference with old block identities.
  return inTransaction(
    db,
    async (tx) => {
      const [term, tutors, pairings] = await Promise.all([
        tx.term.findFirst({ where: { active: true }, select: { id: true } }),
        tx.tutor.findMany({
          where: tutorId ? { id: tutorId } : undefined,
          select: {
            id: true,
            status: true,
            preferredAssignedBlocks: true,
            workloadPreferenceVersion: true,
            user: { select: { tutorAccessRevoked: true } },
          },
        }),
        tx.pairing.findMany({
          where: {
            ...(tutorId ? { tutorId } : {}),
            term: { active: true },
            tutees: { some: { tutee: { status: { not: "INACTIVE" } } } },
          },
          select: {
            id: true,
            tutorId: true,
            termId: true,
            scheduleConfirmed: true,
            dayOfWeek: true,
            startMin: true,
            endMin: true,
          },
        }),
      ]);
      const byTutor = new Map<string, typeof pairings>();
      for (const pairing of pairings) {
        const rows = byTutor.get(pairing.tutorId) ?? [];
        rows.push(pairing);
        byTutor.set(pairing.tutorId, rows);
      }
      return {
        termId: term?.id ?? null,
        tutors: tutors.map((tutor) => {
          const blocks = assignedBlocks(
            isAssignableTutor(tutor) ? (byTutor.get(tutor.id) ?? []) : [],
          );
          return {
            id: tutor.id,
            status: tutor.status,
            count: blocks.length,
            blocks,
            preferredMaximum: effectivePreferredMaximum(
              tutor.status,
              tutor.preferredAssignedBlocks,
            ),
            version: tutor.workloadPreferenceVersion,
          };
        }),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

/** No target ID is accepted. Live ownership and eligibility are checked again after
 * the account lock, and an independent version prevents sibling/profile writes
 * or a stale browser from silently replacing this preference. */
export async function saveWorkloadPreference(
  db: DomainDb,
  userId: string,
  tutorId: string,
  input: z.infer<typeof workloadPreferenceInput>,
) {
  return inTransaction(db, async (tx) => {
    await lockAccountProfile(tx, userId);
    const account = await tx.user.findUnique({
      where: { id: userId },
      include: { schoolDeparture: true },
    });
    if (
      !account ||
      account.tutorId !== tutorId ||
      account.tutorAccessRevoked ||
      !portalAccess(account).canParticipate
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "An active linked tutor account is required.",
      });
    await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id = ${tutorId} FOR UPDATE`;
    const tutor = await tx.tutor.findUniqueOrThrow({
      where: { id: tutorId },
      select: {
        status: true,
        preferredAssignedBlocks: true,
        workloadPreferenceVersion: true,
      },
    });
    if (tutor.status !== "ACTIVE")
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Inactive tutors have a locked preferred maximum of zero.",
      });
    // Advisory saves deliberately leave Tutor.updatedAt untouched: they must not
    // invalidate sibling profile snapshots or an already reviewed assignment proposal.
    const saved =
      await tx.$executeRaw`UPDATE "Tutor" SET "preferredAssignedBlocks" = ${input.preferredMaximum}, "workloadPreferenceVersion" = "workloadPreferenceVersion" + 1 WHERE id = ${tutorId} AND status = 'ACTIVE' AND "workloadPreferenceVersion" = ${input.expectedVersion}`;
    if (!saved) staleConflict();
    await recordDomainAudit(tx, {
      operation: "tutor.setWorkloadPreference",
      entity: "Tutor",
      entityId: tutorId,
      action: "Updated advisory assigned-block preference",
      before: tutor,
      after: {
        ...tutor,
        preferredAssignedBlocks: input.preferredMaximum,
        workloadPreferenceVersion: input.expectedVersion + 1,
      },
    });
    return { ok: true };
  });
}
