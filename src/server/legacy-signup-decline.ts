import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  legacySignupDeclineSnapshotSchema,
  legacySignupDeclineView,
} from "~/lib/legacy-signup-decline";
import { isCurrentManualSignup } from "~/lib/signup-request-groups";
import { recordDomainAudit } from "./audit/evidence";
import { expectedUpdatedAt, staleConflict } from "./concurrency";
import { lockUsernameNamespace } from "./auth/username";
import { lockCatalogue } from "./qualifications";
import { lockSessionPlanning } from "./session-planning";
import { assertNoPublishedTuteeDeletion } from "./session-planning/deletion-guards";
import {
  assertTuteeInvalidityCleared,
  lockLegacySignupReview,
} from "./request-review";
import { assertHeadDiscretionarySignupChange } from "./student-signup-management";
import { inTransaction, lockEntity, type DomainDb } from "./transactions";

export const legacySignupDeclineInput = z
  .object({
    id: z.string().min(1).max(128),
    expectedUpdatedAt,
    clientKey: z.string().uuid(),
  })
  .strict();

/** Close one exact legacy intake. A later fresh request owns a new source;
 * neither a matching mailbox nor a retained owner reopens this source profile. */
export async function declineLegacySignup(
  db: DomainDb,
  actorId: string,
  input: z.infer<typeof legacySignupDeclineInput>,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockCatalogue(tx);
    await lockSessionPlanning(tx);
    await lockLegacySignupReview(tx, input.id);
    // Approval replay executes as its reviewer. An older Admin admission must
    // not become direct Coordinator authority after waiting for these fences.
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (
      !(["HEAD", "ADMIN"] as string[]).includes(actor.role) ||
      actor.suspendedAt ||
      actor.mergedIntoId ||
      actor.recoveryVoidedAt
    )
      throw new TRPCError({ code: "FORBIDDEN" });
    const inputHash = createHash("sha256")
      .update(
        JSON.stringify({
          id: input.id,
          expectedUpdatedAt: input.expectedUpdatedAt.toISOString(),
        }),
      )
      .digest("hex");
    const prior = await tx.legacySignupDecline.findUnique({
      where: { tuteeId: input.id },
    });
    if (prior) {
      if (prior.clientKey !== input.clientKey || prior.inputHash !== inputHash)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This signup already has a retained decline decision. Reload its history.",
        });
      return { ok: true as const, decline: legacySignupDeclineView(prior) };
    }
    await assertHeadDiscretionarySignupChange(
      tx,
      actorId,
      "admin.declineSignup",
      input,
    );
    await assertTuteeInvalidityCleared(tx, input.id);
    const [row, term] = await Promise.all([
      tx.tutee.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          firstChoice: { select: { id: true, name: true } },
          secondChoice: { select: { id: true, name: true } },
          availabilities: {
            include: { slot: true },
            orderBy: { slotId: "asc" },
          },
          user: { select: { id: true } },
          pairings: {
            include: {
              pairing: {
                include: { tutor: { select: { englishName: true } } },
              },
            },
            orderBy: { pairingId: "asc" },
          },
        },
      }),
      tx.term.findFirst({
        where: { active: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (row.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
      staleConflict();
    if (
      !term ||
      !isCurrentManualSignup(
        row,
        term.id,
        row.pairings.some(({ pairing }) => pairing.termId === term.id),
        false,
      )
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Only a current legacy signup request can be declined.",
      });
    if (await tx.studentSurvey.count({ where: { tuteeId: row.id } }))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Use the original public signup request's decision controls.",
      });
    if (
      await tx.participantConsolidation.count({
        where: {
          kind: "TUTEE",
          active: true,
          OR: [{ sourceId: row.id }, { targetId: row.id }],
        },
      })
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This profile has transferred participation. Review its original requests instead.",
      });
    if (
      (await tx.studentRequestReview.count({
        where: { legacyTuteeId: row.id, state: "PENDING" },
      })) ||
      (await tx.tuteeRemovalRequest.count({
        where: { tuteeId: row.id, state: "PENDING" },
      }))
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Resolve the pending participation review before declining this signup.",
      });
    // Retain the same evidence guards as the old delete-based Decline. A retained
    // decision does not authorize removing already published or attended work.
    await assertNoPublishedTuteeDeletion(tx, row.id, "declineSignup");
    if (await tx.sessionTutee.count({ where: { tuteeId: row.id } }))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Cannot decline a signup with attendance history. Use its participation controls instead.",
      });
    const owner = await tx.studentProfileOwnership.findUnique({
      where: { tuteeId: row.id },
    });
    const snapshot = legacySignupDeclineSnapshotSchema.parse({
      schemaVersion: 1,
      source: {
        id: row.id,
        englishName: row.englishName,
        firstName: row.firstName,
        lastName: row.lastName,
        preferredName: row.preferredName,
        legacyName: row.legacyName,
        alternativeNames: row.alternativeNames,
        email: row.email,
        phone: row.phone,
        preferredContact: row.preferredContact,
        notes: row.notes,
        gradeLevel: row.gradeLevel,
        academicallyGraduated: row.academicallyGraduated,
        signupSource: row.signupSource,
        intakeTermId: row.intakeTermId,
        signupSubmittedAt: row.signupSubmittedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        status: row.status,
        firstChoice: row.firstChoice,
        secondChoice: row.secondChoice,
        signedRulebook: row.signedRulebook,
        signatureName: row.signatureName,
        signedAt: row.signedAt?.toISOString() ?? null,
      },
      decisionPeriod: {
        id: term.id,
        name: term.name,
        schoolYear: term.schoolYear,
        quarter: term.quarter,
      },
      availability: row.availabilities.map(({ slot }) => ({
        id: slot.id,
        label: slot.label,
        dayOfWeek: slot.dayOfWeek,
        startMin: slot.startMin,
        endMin: slot.endMin,
      })),
      ownership: {
        userId: row.user?.id ?? null,
        retainedOwnerId: owner?.userId ?? null,
        personId: row.personId,
        historyIdentityRevision: row.historyIdentityRevision,
      },
      pairings: row.pairings.map(({ pairing }) => ({
        id: pairing.id,
        termId: pairing.termId,
        subject: pairing.subject,
        tutorId: pairing.tutorId,
        tutorName: pairing.tutor.englishName,
        dayOfWeek: pairing.dayOfWeek,
        startMin: pairing.startMin,
        endMin: pairing.endMin,
        scheduleConfirmed: pairing.scheduleConfirmed,
        removed: pairing.termId === term.id,
      })),
    });
    const updated = await tx.tutee.updateMany({
      where: { id: row.id, updatedAt: input.expectedUpdatedAt },
      data: { status: "INACTIVE" },
    });
    if (!updated.count) staleConflict();
    await tx.pairingTutee.deleteMany({
      where: { tuteeId: row.id, pairing: { termId: term.id } },
    });
    const decision = await tx.legacySignupDecline.create({
      data: {
        tuteeId: row.id,
        termId: term.id,
        resolvedById: actor.id,
        resolvedByName: actor.name ?? actor.username,
        expectedUpdatedAt: input.expectedUpdatedAt,
        clientKey: input.clientKey,
        inputHash,
        intakeSnapshot: snapshot,
      },
    });
    await recordDomainAudit(tx, {
      operation: "admin.declineSignup",
      entity: "LegacySignupDecline",
      entityId: row.id,
      action: "Declined legacy signup with retained intake history",
      before: { tuteeId: row.id, status: row.status },
      after: {
        tuteeId: row.id,
        state: "DECLINED",
        resolvedAt: decision.resolvedAt,
        termId: term.id,
      },
      effects: {
        removedPairingIds: snapshot.pairings
          .filter((pairing) => pairing.removed)
          .map((pairing) => pairing.id),
        retainedPairingIds: snapshot.pairings
          .filter((pairing) => !pairing.removed)
          .map((pairing) => pairing.id),
        intakePreserved: true,
        ownershipPreserved: true,
      },
    });
    return { ok: true as const, decline: legacySignupDeclineView(decision) };
  });
}
