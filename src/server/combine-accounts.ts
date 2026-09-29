import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  type DomainDb,
  type TransactionDb,
  inTransaction,
  lockEntity,
} from "./transactions";
import { lockAccountProfile, updateAccountProfile } from "./account-profile";
import { lockUsernameNamespace } from "./auth/username";
import { verifyPassword } from "./auth/password";
import { effectiveMessagePermission } from "./messaging-permissions";
import { rateLimit } from "./rate-limit";

export const combineInput = z.object({
  survivorId: z.string().min(1).max(128),
  duplicateId: z.string().min(1).max(128),
});
type Pair = z.infer<typeof combineInput>;
const identity = {
  id: true,
  name: true,
  email: true,
  username: true,
  role: true,
  tutorId: true,
  studentId: true,
} as const;

/** A preview is a read-only explanation; execution re-reads and compares every decision input.
 * Identifiers always stay with their original accounts: no unproved email becomes a recovery route. */
export async function previewCombine(db: DomainDb, input: Pair) {
  if (input.survivorId === input.duplicateId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose two different accounts.",
    });
  const [survivor, duplicate] = await Promise.all(
    [input.survivorId, input.duplicateId].map((id) =>
      db.user.findUnique({
        where: { id },
        include: {
          academicProfile: true,
          schoolDeparture: true,
          emails: { orderBy: { email: "asc" } },
        },
      }),
    ),
  );
  if (!survivor || !duplicate)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "An account no longer exists.",
    });
  const conflicts: string[] = [];
  if (survivor.mergedIntoId || duplicate.mergedIntoId)
    conflicts.push("A selected login is already retired.");
  if (
    await db.user.count({
      where: { mergedIntoId: { in: [survivor.id, duplicate.id] } },
    })
  )
    conflicts.push(
      "A selected account already holds combined history. Further combines require a reviewed data migration.",
    );
  if (duplicate.role === "HEAD")
    conflicts.push(
      "Transfer leadership before retiring the current Head account.",
    );
  if (survivor.suspendedAt || duplicate.suspendedAt)
    conflicts.push("Resolve account suspensions before combining accounts.");
  // The generic combine has no reviewed choice for departure grants/revocations or their
  // event history. Keep both identities until an explicit migration preserves that evidence.
  if (survivor.schoolDeparture || duplicate.schoolDeparture)
    conflicts.push(
      "Accounts with school-departure history require a reviewed data migration before combining; preserve their departure decisions and observer access.",
    );
  if (
    await db.studentSurvey.count({
      where: {
        email: { in: duplicate.emails.map((address) => address.email) },
        state: "OPEN",
        confirmedAt: null,
      },
    })
  )
    conflicts.push(
      "Complete or withdraw the duplicate account's unconfirmed student intake before combining; its email-bound confirmation link will be retired.",
    );
  if (
    !survivor.passwordHash ||
    !survivor.emailVerifiedAt ||
    survivor.mustChangePassword
  )
    conflicts.push(
      "Complete password setup and email verification on the login to keep first.",
    );
  const pending = await db.approvalRequest.findMany({
    where: { state: "PENDING" },
    select: { requesterId: true, payload: true },
  });
  if (
    pending.some((request) =>
      [survivor.id, duplicate.id].some(
        (id) =>
          request.requesterId === id ||
          JSON.stringify(request.payload).includes(id),
      ),
    )
  )
    conflicts.push(
      "Resolve pending approval requests involving these accounts before combining.",
    );
  if (
    (await db.crewStatusRequest.count({
      where: { userId: { in: [survivor.id, duplicate.id] }, state: "PENDING" },
    })) ||
    (await db.studentRequestReview.count({
      where: {
        requestedByUserId: { in: [survivor.id, duplicate.id] },
        state: "PENDING",
      },
    }))
  )
    conflicts.push(
      "Resolve pending crew or student requests before combining.",
    );
  if (
    survivor.tutorId &&
    duplicate.tutorId &&
    survivor.tutorId !== duplicate.tutorId
  )
    conflicts.push(
      "Both accounts have different tutor profiles. Resolve these links first; no tutor history will be discarded.",
    );
  if (
    survivor.studentId &&
    duplicate.studentId &&
    survivor.studentId !== duplicate.studentId
  )
    conflicts.push(
      "Both accounts have different current tutee profiles. Resolve these links first.",
    );
  const participant = ["STUDENT", "TUTOR", "CREW"];
  let role = survivor.role;
  if (survivor.role !== duplicate.role) {
    if (
      participant.includes(survivor.role) &&
      participant.includes(duplicate.role)
    )
      role = [survivor.role, duplicate.role].includes("TUTOR")
        ? "TUTOR"
        : "CREW";
    else
      conflicts.push(
        "Management or Viewer ranks differ. Resolve roles explicitly before combining; ranks are never automatically elevated.",
      );
  }
  if (
    survivor.crewStatus &&
    duplicate.crewStatus &&
    survivor.crewStatus !== duplicate.crewStatus
  )
    conflicts.push(
      "Crew membership states conflict. Resolve them before combining.",
    );
  const academicValue = (profile: typeof survivor.academicProfile) =>
    profile
      ? {
          status: profile.status,
          gradeLevel: profile.gradeLevel,
          rawGrade: profile.rawGrade,
          schoolYear: profile.schoolYear,
          reconfirmRequired: profile.reconfirmRequired,
        }
      : null;
  if (
    survivor.academicProfile &&
    duplicate.academicProfile &&
    JSON.stringify(academicValue(survivor.academicProfile)) !==
      JSON.stringify(academicValue(duplicate.academicProfile))
  )
    conflicts.push(
      "Academic profiles conflict. Review and reconcile the current academic details first; original confirmations remain unchanged.",
    );
  const [survivorPermission, duplicatePermission, owners, counts, tutor] =
    await Promise.all([
      effectiveMessagePermission(db, survivor.id),
      effectiveMessagePermission(db, duplicate.id),
      db.studentProfileOwnership.findMany({
        where: { userId: { in: [survivor.id, duplicate.id] } },
        orderBy: { tuteeId: "asc" },
      }),
      Promise.all([
        db.directMessage.count({
          where: {
            OR: [{ senderId: duplicate.id }, { recipientId: duplicate.id }],
          },
        }),
        db.policyAcceptance.count({ where: { userId: duplicate.id } }),
        db.notification.count({ where: { userId: duplicate.id } }),
        db.patrol.count({ where: { crewUserId: duplicate.id } }),
        db.academicConfirmation.count({ where: { userId: duplicate.id } }),
      ]),
      db.tutor.findUnique({
        where: { id: survivor.tutorId ?? duplicate.tutorId ?? "__none__" },
        select: { id: true, email: true, username: true, englishName: true },
      }),
    ]);
  // Per-user messaging overrides are security decisions. Never silently broaden an override.
  const permissionValue = (permission: typeof survivorPermission) => ({
    groups: [...permission.groups].sort(),
    restricted: permission.restricted,
  });
  const tutorOwner = survivor.tutorId ? survivor : duplicate;
  if (tutor?.username && tutor.username !== tutorOwner.username)
    conflicts.push(
      "The linked tutor handle differs from its account handle. Reconcile the username in Edit profile before combining so no login identifier is silently released.",
    );
  if (
    JSON.stringify(permissionValue(survivorPermission)) !==
    JSON.stringify(permissionValue(duplicatePermission))
  )
    conflicts.push(
      "Messaging permissions or restrictions differ. Resolve them explicitly before combining.",
    );
  if (
    tutor &&
    survivor.username &&
    (await db.tutor.count({
      where: {
        id: { not: tutor.id },
        username: { equals: survivor.username, mode: "insensitive" },
      },
    }))
  )
    conflicts.push(
      "The surviving username conflicts with another tutor profile.",
    );
  if (
    tutor &&
    (await db.tutor.count({
      where: {
        id: { not: tutor.id },
        email: { equals: survivor.email, mode: "insensitive" },
      },
    }))
  )
    conflicts.push("The surviving email conflicts with another tutor profile.");
  const result = {
    role,
    tutorId: survivor.tutorId ?? duplicate.tutorId,
    studentId: survivor.studentId ?? duplicate.studentId,
    tuteeMember: survivor.tuteeMember || duplicate.tuteeMember,
    canTranslate: survivor.canTranslate || duplicate.canTranslate,
    crewStatus: survivor.crewStatus ?? duplicate.crewStatus,
    tutorAccessRevoked: survivor.tutorId
      ? survivor.tutorAccessRevoked
      : duplicate.tutorId
        ? duplicate.tutorAccessRevoked
        : survivor.tutorAccessRevoked,
  };
  const student = result.studentId
    ? await db.tutee.findUnique({
        where: { id: result.studentId },
        select: { englishName: true },
      })
    : null;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        survivor,
        duplicate,
        result,
        owners,
        counts,
        tutor,
        student,
        permissions: [
          permissionValue(survivorPermission),
          permissionValue(duplicatePermission),
        ],
        conflicts,
      }),
    )
    .digest("hex");
  const project = (row: typeof survivor) =>
    Object.fromEntries(
      Object.keys(identity).map((key) => [
        key,
        row[key as keyof typeof identity],
      ]),
    ) as Pick<typeof survivor, keyof typeof identity>;
  return {
    survivor: project(survivor),
    duplicate: project(duplicate),
    result,
    linkedProfiles: {
      tutor: tutor?.englishName ?? null,
      student: student?.englishName ?? null,
    },
    conflicts,
    fingerprint,
    counts: {
      messages: counts[0],
      policies: counts[1],
      notifications: counts[2],
      patrols: counts[3],
      academicConfirmations: counts[4],
      tuteeProfiles: owners.filter((o) => o.userId === duplicate.id).length,
    },
    retiredEmails: duplicate.emails.map((address) => address.email),
  };
}

/** One lock ordering matches leadership, username and profile writers. Table locks fence
 * concurrent policy/profile/permission changes between preview validation and final writes.
 * Historical actors, messages, signatures and confirmations are never rewritten or deleted. */
export async function combineAccounts(
  db: DomainDb,
  actorId: string,
  input: Pair & { fingerprint: string; confirmPassword: string },
) {
  if (!rateLimit(`combine:${actorId}`, { max: 10, windowMs: 15 * 60_000 }).ok)
    throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
  return inTransaction(db, async (tx: TransactionDb) => {
    await lockEntity(tx, "program:leadership");
    await lockUsernameNamespace(tx);
    const accountIds = [
      ...new Set([actorId, input.survivorId, input.duplicateId]),
    ].sort();
    // Profile writers own this advisory lock before requesting row/table write locks.
    // Acquire the advisory locks first, without User row locks, to avoid both inversion cases.
    for (const id of accountIds) await lockEntity(tx, `account-profile:${id}`);
    // Take table locks before User row locks so another writer cannot hold a table write
    // lock while waiting for one of our rows (which would create a lock-upgrade deadlock).
    await tx.$executeRaw`LOCK TABLE "User", "Tutor", "Tutee", "AcademicProfile", "AccountEmail", "MessagePermission", "MessageRestriction", "StudentProfileOwnership", "PolicyAcceptance", "ApprovalRequest", "CrewStatusRequest", "StudentRequestReview", "StudentSurvey" IN SHARE ROW EXCLUSIVE MODE`;
    for (const id of accountIds) await lockAccountProfile(tx, id);
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (actor?.role !== "HEAD" || actor.suspendedAt || actor.mergedIntoId)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the current active Head can combine accounts.",
      });
    if (
      !actor.passwordHash ||
      !verifyPassword(input.confirmPassword, actor.passwordHash)
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Password is incorrect.",
      });
    const preview = await previewCombine(tx, input);
    if (preview.conflicts.length)
      throw new TRPCError({
        code: "CONFLICT",
        message: preview.conflicts.join(" "),
      });
    if (preview.fingerprint !== input.fingerprint)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Account details changed. Preview the combine again before confirming.",
      });
    const { survivorId, duplicateId } = input;
    const duplicate = await tx.user.findUniqueOrThrow({
      where: { id: duplicateId },
      include: { academicProfile: true },
    });
    // Release unique links before attaching them. No original login identifier is reassigned.
    await tx.user.update({
      where: { id: duplicateId },
      data: {
        mergedIntoId: survivorId,
        tutorId: null,
        studentId: null,
        passwordHash: null,
        sessionVersion: { increment: 1 },
        twoFactorEnabled: false,
      },
    });
    await tx.user.update({
      where: { id: survivorId },
      data: preview.result,
    });
    // The surviving current profile remains canonical; immutable intake/signature evidence
    // stays on its original rows while the linked live roster mirrors that profile.
    await updateAccountProfile(tx, survivorId);
    if (preview.result.tutorId)
      await tx.tutor.update({
        where: { id: preview.result.tutorId },
        data: {
          username: preview.survivor.username,
          email: preview.survivor.email,
        },
      });
    if (
      duplicate.academicProfile &&
      !(await tx.academicProfile.findUnique({ where: { userId: survivorId } }))
    ) {
      const { userId: oldId, ...profile } = duplicate.academicProfile;
      void oldId;
      await tx.academicProfile.create({
        data: { ...profile, userId: survivorId },
      });
      await tx.user.update({
        where: { id: survivorId },
        data: { gradeLevel: profile.gradeLevel },
      });
    }
    // These are current ownership/delivery pointers, not the historical actor/evidence fields.
    await tx.studentProfileOwnership.updateMany({
      where: { userId: duplicateId },
      data: { userId: survivorId },
    });
    await tx.studentQuarterBlock.updateMany({
      where: { userId: duplicateId },
      data: { userId: survivorId },
    });
    await tx.notification.updateMany({
      where: { userId: duplicateId },
      data: { userId: survivorId },
    });
    await tx.passwordResetToken.deleteMany({ where: { userId: duplicateId } });
    await tx.emailVerificationCode.deleteMany({
      where: { userId: duplicateId },
    });
    await tx.studentActionConfirmation.deleteMany({
      where: { userId: duplicateId },
    });
    await tx.emailDelivery.updateMany({
      where: { userId: duplicateId, status: "PENDING" },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    // Preserve the reviewed messaging scope even if a participant rank changes.
    const permission = await effectiveMessagePermission(tx, duplicateId);
    await tx.messagePermission.upsert({
      where: { scope: `USER:${survivorId}` },
      create: { scope: `USER:${survivorId}`, groups: permission.groups },
      update: { groups: permission.groups },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        userName: actor.name ?? actor.username,
        entity: "User",
        entityId: survivorId,
        operation: "accountCombine.combine",
        action: "Combined duplicate accounts",
        details: {
          survivor: preview.survivor,
          duplicate: preview.duplicate,
          result: preview.result,
          counts: preview.counts,
          retiredEmails: preview.retiredEmails,
        },
      },
    });
    return { ok: true, survivorId };
  });
}
