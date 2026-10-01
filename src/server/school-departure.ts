import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import type { departureChange } from "~/lib/school-departure";
import { lockAccountProfile } from "./account-profile";
import { inTransaction, lockEntity, type DomainDb } from "./transactions";
import { ownedStudentIds } from "./student-ownership";
import { recordAudit } from "./audit/log";

/** Shared by intake, restoration and assignment paths, including approval replay. */
export async function requireSchoolParticipation(db: DomainDb, userId: string) {
  const departure = await db.schoolDeparture.findUnique({ where: { userId } });
  if (departure?.reason)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "School departure is confirmed. Ask Head to review your return before participating.",
    });
}

/** Historical ownership is explicit and may contain more than the current student pointer. */
export async function requireStudentSchoolParticipation(
  db: DomainDb,
  tuteeId: string,
) {
  const ownership = await db.studentProfileOwnership.findUnique({
    where: { tuteeId },
  });
  const owners = await db.user.findMany({
    where: {
      OR: [
        { studentId: tuteeId },
        ...(ownership ? [{ id: ownership.userId }] : []),
      ],
    },
    select: { id: true },
  });
  for (const owner of owners) await requireSchoolParticipation(db, owner.id);
}

/** One transaction changes access, live enrollment, evidence and notifications.
 * Historical pairings/attendance are never deleted. Other account capabilities are independent. */
export async function changeSchoolDeparture(
  db: DomainDb,
  input: z.infer<typeof departureChange>,
  actorId: string | null,
  source = "HEAD",
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockAccountProfile(tx, input.userId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: input.userId },
      include: { schoolDeparture: true, tutor: true },
    });
    const previous = user.schoolDeparture;
    if (user.mergedIntoId)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This login was combined into another account. Review the surviving account.",
      });
    if ((previous?.revision ?? 0) !== input.expectedRevision)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Departure changed. Reload and review the current record.",
      });
    const leaving =
      input.action === "GRADUATED" || input.action === "TRANSFERRED";
    if (!leaving && !previous?.reason)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "There is no confirmed departure to change.",
      });
    if (leaving && user.role === "VIEWER")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A standalone Viewer already has observer access.",
      });
    const revision = (previous?.revision ?? 0) + 1;
    const now = new Date();
    const reason = leaving
      ? input.action
      : input.action === "RETURN"
        ? null
        : previous!.reason;
    const data = {
      reason,
      revision,
      confirmedAt: now,
      confirmedById: actorId,
      source,
      effectiveAt: leaving ? now : previous?.effectiveAt,
      tutorDerived: previous?.tutorDerived ?? !!user.tutorId,
      // Changing the factual departure never silently restores revoked observation.
      observerRevoked:
        input.action === "REVOKE"
          ? true
          : input.action === "RESTORE"
            ? false
            : (previous?.observerRevoked ?? false),
    };
    await tx.schoolDeparture.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    if (leaving) {
      if (user.tutorId) {
        await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id = ${user.tutorId} FOR UPDATE`;
        await tx.tutor.update({
          where: { id: user.tutorId },
          data: { status: input.action as "GRADUATED" | "TRANSFERRED" },
        });
        const links = await tx.pairingTutee.findMany({
          where: { pairing: { tutorId: user.tutorId, term: { active: true } } },
          select: { tuteeId: true },
        });
        await tx.pairingTutee.deleteMany({
          where: { pairing: { tutorId: user.tutorId, term: { active: true } } },
        });
        await tx.tutee.updateMany({
          where: { id: { in: links.map((l) => l.tuteeId) }, status: "ACTIVE" },
          data: { status: "PENDING" },
        });
        await tx.tutorStatusRequest.updateMany({
          where: { tutorId: user.tutorId, state: "PENDING" },
          data: {
            state: "DENIED",
            resolvedAt: now,
            resolvedById: actorId,
            resolvedByName: "School departure",
          },
        });
      }
      const ids = await ownedStudentIds(tx, user.id);
      // Only current-term membership changes. Old pairing rows remain usable as history.
      await tx.pairingTutee.deleteMany({
        where: { tuteeId: { in: ids }, pairing: { term: { active: true } } },
      });
      await tx.tutee.updateMany({
        where: { id: { in: ids }, status: { in: ["ACTIVE", "PENDING"] } },
        data: { status: "INACTIVE" },
      });
      const surveys = await tx.studentSurvey.findMany({
        where: {
          state: "OPEN",
          OR: [{ tuteeId: { in: ids } }, { email: user.email }],
        },
        select: { id: true },
      });
      await tx.studentSurvey.updateMany({
        where: { id: { in: surveys.map((s) => s.id) } },
        data: { state: "ABORTED", resolvedAt: now },
      });
      await tx.studentRequestReview.updateMany({
        where: {
          state: "PENDING",
          OR: [
            { surveyId: { in: surveys.map((s) => s.id) } },
            { legacyTuteeId: { in: ids } },
          ],
        },
        data: { state: "DENIED", resolvedAt: now },
      });
    } else if (
      input.action === "RETURN" &&
      user.tutorId &&
      !user.tutorAccessRevoked &&
      ["GRADUATED", "TRANSFERRED"].includes(user.tutor?.status ?? "")
    ) {
      // Return grants no assignments or active participation. The normal activation gate remains.
      await tx.tutor.update({
        where: { id: user.tutorId },
        data: { status: "PENDING" },
      });
    }
    await tx.schoolDepartureEvent.create({
      data: {
        userId: user.id,
        action: input.action,
        actorId,
        source,
        explanation: input.explanation,
        revision,
      },
    });
    await recordAudit(
      {
        userId: actorId,
        action: "School departure: " + input.action,
        entity: "User",
        entityId: user.id,
      },
      tx,
    );
    await tx.notification.create({
      data: {
        userId: user.id,
        title: "School departure updated / 离校状态已更新",
        body: input.action,
        link:
          user.tutorId && !user.tutorAccessRevoked
            ? "/settings"
            : "/student?view=account",
      },
    });
    return { ok: true, revision };
  });
}
