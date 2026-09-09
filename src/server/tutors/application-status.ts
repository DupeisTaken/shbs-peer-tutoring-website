import {
  inTransaction,
  lockEntity,
  type DomainDb,
} from "~/server/transactions";
import { promoteApplicantToTutor } from "./promote";

/** Reconcile an application's grant and its inverse in the same transaction as its status. */
export async function reconcileApplication(
  db: DomainDb,
  applicationId: string,
): Promise<void> {
  await inTransaction(db, async (tx) => {
    await lockEntity(tx, `application:${applicationId}`);
    const app = await tx.tutorApplication.findUniqueOrThrow({
      where: { id: applicationId },
    });
    if (app.status === "ACCEPTED") {
      await promoteApplicantToTutor(applicationId, tx);
      return;
    }
    const grants = await tx.registrationCode.findMany({
      where: { applicationId },
      select: { tutorId: true },
    });
    await tx.registrationCode.updateMany({
      where: { applicationId, usedAt: null },
      data: { expiresAt: new Date(0), emailVerifiedAt: null },
    });
    // Only reverse tutors associated with this application's grant. An independently accepted
    // application is a separate authorization and must not be withdrawn by this reversal.
    if (
      await tx.tutorApplication.count({
        where: {
          email: app.email,
          status: "ACCEPTED",
          id: { not: applicationId },
        },
      })
    )
      return;
    for (const tutorId of new Set([
      ...grants.flatMap((g) => (g.tutorId ? [g.tutorId] : [])),
      ...(app.promotedTutorId ? [app.promotedTutorId] : []),
    ])) {
      await tx.tutor.update({
        where: { id: tutorId },
        data: { status: "ARCHIVED" },
      });
      const links = await tx.pairingTutee.findMany({
        where: { pairing: { tutorId, term: { active: true } } },
      });
      await tx.pairingTutee.deleteMany({
        where: { pairing: { tutorId, term: { active: true } } },
      });
      await tx.tutee.updateMany({
        where: { id: { in: links.map((l) => l.tuteeId) }, status: "ACTIVE" },
        data: { status: "PENDING" },
      });
    }
  });
}
