import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isHistoricalTutor } from "~/lib/historical-academics";
import { isHistoricalTutee } from "~/lib/tutee-history";
import {
  personGraph,
  personSource,
  assignParticipantPerson,
} from "./person-identity";
import { inTransaction, lockEntity, type DomainDb } from "./transactions";
import { lockUsernameNamespace } from "./auth/username";
import { verifyPasswordConfirmation } from "./auth/password-confirmation";
import { previewCombine } from "./combine-accounts";
import { linkTutorHistory, previewTutorHistory } from "./tutor-history";
import { linkTuteeHistory, previewHistoryLink } from "./tutee-history";

export const personCombineSelection = z.object({
  sources: z
    .array(personSource)
    .min(2)
    .max(20)
    .refine(
      (rows) =>
        new Set(rows.map((r) => `${r.kind}:${r.id}`)).size === rows.length,
      "Choose distinct records.",
    ),
  retainedUserId: z.string().min(1).max(128).optional(),
  retireDuplicateLogins: z.boolean().default(false),
});
export const personCombineInput = personCombineSelection.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(10).max(1000),
  acknowledged: z.literal(true),
  operationId: z.string().uuid(),
  confirmPassword: z.string().max(1024).optional(),
});
type Selection = z.input<typeof personCombineSelection>;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
// These legacy blockers protect its profile-mirror rewrite. This engine never
// copies a tutor username/email, so every original identifier stays reserved.
const legacyMirrorRewriteConflicts = new Set([
  "The linked tutor handle differs from its account handle. Reconcile the username in Edit profile before combining so no login identifier is silently released.",
  "The surviving username conflicts with another tutor profile.",
  "The surviving email conflicts with another tutor profile.",
]);

/** A review covers the whole explicit identity group, but access remains attached
 * to individual accounts. Neither equal names nor equal emails create an edge. */
async function plan(db: DomainDb, raw: Selection) {
  const input = personCombineSelection.parse(raw);
  const graph = await personGraph(db, input.sources);
  const term = await db.term.findFirst({
    where: { active: true },
    select: { id: true },
  });
  const live = graph.users.filter((r) => !r.mergedIntoId);
  const retainedUserId =
    input.retainedUserId ?? (live.length === 1 ? live[0]!.id : null);
  const retained = live.find((r) => r.id === retainedUserId);
  if (retainedUserId && !retained)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a current login from these records.",
    });
  const ready = (row: (typeof live)[number]) =>
    !!row.passwordHash &&
    !!row.emailVerifiedAt &&
    !row.mustChangePassword &&
    !row.suspendedAt;
  const historicalTutee = (row: (typeof graph.tutees)[number]) =>
    isHistoricalTutee(row, term?.id ?? null);
  const activeUnowned =
    graph.tutors.some((r) => !r.user && !isHistoricalTutor(r)) ||
    graph.tutees.some((r) => !r.user && !historicalTutee(r));
  const restricted = live.some(
    (r) => r.suspendedAt !== null || r.schoolDeparture !== null,
  );
  const conflicts: string[] = [];
  const retirementReviews = [];
  const pendingTutorRequests = await db.tutorStatusRequest.findMany({
    where: { tutorId: { in: graph.tutors.map((r) => r.id) }, state: "PENDING" },
    orderBy: { id: "asc" },
  });
  const openIntakes = await db.studentSurvey.findMany({
    where: {
      email: {
        in: live.flatMap((r) => [
          r.email,
          ...r.emails.map((address) => address.email),
        ]),
      },
      state: "OPEN",
      confirmedAt: null,
    },
    select: { id: true, email: true },
    orderBy: { id: "asc" },
  });
  // An archived label alone is insufficient if a recurring assignment still
  // depends on that login. Old-period assignments remain immutable evidence.
  const currentAssignments = await db.pairing.findMany({
    where: {
      term: { active: true },
      OR: [
        { tutorId: { in: graph.tutors.map((r) => r.id) } },
        {
          tutees: { some: { tuteeId: { in: graph.tutees.map((r) => r.id) } } },
        },
      ],
    },
    select: {
      id: true,
      termId: true,
      tutorId: true,
      tutees: { select: { tuteeId: true }, orderBy: { tuteeId: "asc" } },
    },
    orderBy: { id: "asc" },
  });
  const unownedAssignment = currentAssignments.some(
    (assignment) =>
      graph.tutors.some((row) => row.id === assignment.tutorId && !row.user) ||
      assignment.tutees.some((member) =>
        graph.tutees.some((row) => row.id === member.tuteeId && !row.user),
      ),
  );
  const requiresHead =
    live.length > 1 || activeUnowned || unownedAssignment || restricted;
  if (live.length > 1) {
    if (!retained)
      conflicts.push(
        "Choose the login to retain before retiring duplicate logins.",
      );
    else {
      for (const duplicate of live.filter((r) => r.id !== retained.id)) {
        const duplicateTutor = graph.tutors.find(
          (r) => r.id === duplicate.tutorId,
        );
        const duplicateTutee = graph.tutees.find(
          (r) => r.id === duplicate.studentId,
        );
        const duplicateTutorIds = new Set(
          graph.tutors
            .filter(
              (r) =>
                r.user?.id === duplicate.id ||
                r.retainedOwner?.userId === duplicate.id,
            )
            .map((r) => r.id),
        );
        const duplicateTuteeIds = new Set([
          ...(duplicate.studentId ? [duplicate.studentId] : []),
          ...graph.ownership
            .filter((r) => r.userId === duplicate.id)
            .map((r) => r.tuteeId),
        ]);
        const hasCurrentAssignment = currentAssignments.some(
          (assignment) =>
            duplicateTutorIds.has(assignment.tutorId) ||
            assignment.tutees.some((row) => duplicateTuteeIds.has(row.tuteeId)),
        );
        if (hasCurrentAssignment)
          conflicts.push(
            "Resolve the duplicate account's current-period assignments before retiring its login.",
          );
        if (
          pendingTutorRequests.some(
            (request) =>
              request.tutorId === duplicate.tutorId ||
              graph.tutors.some(
                (row) =>
                  row.id === request.tutorId &&
                  row.retainedOwner?.userId === duplicate.id,
              ),
          )
        )
          conflicts.push(
            "Resolve the duplicate account's pending tutor requests before retiring its login.",
          );
        if (
          openIntakes.some((survey) =>
            [
              duplicate.email,
              ...duplicate.emails.map((address) => address.email),
            ].includes(survey.email),
          )
        )
          conflicts.push(
            "Complete or withdraw the duplicate account's unconfirmed student intake before retiring its login.",
          );
        const review = await previewCombine(db, {
          survivorId: retained.id,
          duplicateId: duplicate.id,
        });
        retirementReviews.push(review);
        conflicts.push(
          ...review.conflicts.filter((text) => {
            if (
              text.includes("already holds combined history") ||
              legacyMirrorRewriteConflicts.has(text)
            )
              return false;
            // The survivor's current pointer is never replaced. Historical direct
            // profiles become retained read ownership after the login is retired.
            if (
              !hasCurrentAssignment &&
              duplicateTutor &&
              isHistoricalTutor(duplicateTutor) &&
              text ===
                "Both accounts have different tutor profiles. Resolve these links first; no tutor history will be discarded."
            )
              return false;
            if (
              !hasCurrentAssignment &&
              duplicateTutee &&
              historicalTutee(duplicateTutee) &&
              text ===
                "Both accounts have different current tutee profiles. Resolve these links first."
            )
              return false;
            return true;
          }),
        );
        // The legacy flow can union memberships. This flow requires an explicit
        // resolution first, keeping the surviving account's authority unchanged.
        for (const field of [
          "role",
          "tuteeMember",
          "canTranslate",
          "crewStatus",
          "tutorAccessRevoked",
        ] as const) {
          if (retained[field] !== duplicate[field])
            conflicts.push(
              `Resolve differing ${field} decisions before retiring logins.`,
            );
        }
        if (
          duplicate.tutorId &&
          !isHistoricalTutor(
            graph.tutors.find((r) => r.id === duplicate.tutorId)!,
          )
        )
          conflicts.push(
            "A duplicate login still owns a current tutor profile.",
          );
        if (
          duplicate.studentId &&
          !historicalTutee(
            graph.tutees.find((r) => r.id === duplicate.studentId)!,
          )
        )
          conflicts.push(
            "A duplicate login still owns a current tutee enrollment.",
          );
        const academic = (r: typeof retained) =>
          r.academicProfile
            ? {
                status: r.academicProfile.status,
                gradeLevel: r.academicProfile.gradeLevel,
                rawGrade: r.academicProfile.rawGrade,
                schoolYear: r.academicProfile.schoolYear,
                reconfirmRequired: r.academicProfile.reconfirmRequired,
              }
            : null;
        if (
          JSON.stringify(academic(retained)) !==
          JSON.stringify(academic(duplicate))
        )
          conflicts.push(
            "Resolve canonical academic profiles before retiring logins.",
          );
      }
    }
  }
  const canRetireLogins =
    live.length > 1 && !!retained && conflicts.length === 0;
  const outcome =
    activeUnowned ||
    unownedAssignment ||
    restricted ||
    (retained && !ready(retained)) ||
    (live.length > 1 && !(input.retireDuplicateLogins && canRetireLogins))
      ? ("REVIEW_REQUIRED" as const)
      : ("GROUPED" as const);
  const expandedSources = [
    ...graph.users.map((r) => ({ kind: "USER" as const, id: r.id })),
    ...graph.tutors.map((r) => ({ kind: "TUTOR" as const, id: r.id })),
    ...graph.tutees.map((r) => ({ kind: "TUTEE" as const, id: r.id })),
  ];
  const sourceRows = expandedSources.map((ref) => {
    if (ref.kind === "USER") {
      const r = graph.users.find((row) => row.id === ref.id)!;
      return {
        ref,
        name: r.name ?? r.username ?? r.email,
        email: r.email,
        status: r.mergedIntoId ? "RETIRED" : r.role,
        personId: r.personId,
        hasLogin: !r.mergedIntoId,
      };
    }
    if (ref.kind === "TUTOR") {
      const r = graph.tutors.find((row) => row.id === ref.id)!;
      return {
        ref,
        name: r.englishName,
        email: r.email,
        status: r.status,
        personId: r.personId,
        hasLogin: !!r.user || !!r.retainedOwner,
      };
    }
    const r = graph.tutees.find((row) => row.id === ref.id)!;
    return {
      ref,
      name: r.englishName,
      email: r.email,
      status: r.status,
      personId: r.personId,
      hasLogin: !!r.user || graph.ownership.some((o) => o.tuteeId === r.id),
    };
  });
  const personIds = new Set(sourceRows.map((r) => r.personId));
  const preview = {
    fingerprint: hash({
      input: { ...input, retainedUserId },
      graph,
      term,
      retirementReviews,
      pendingTutorRequests,
      openIntakes,
      currentAssignments,
    }),
    sources: sourceRows,
    accounts: live.map((r) => ({
      id: r.id,
      name: r.name ?? r.username ?? r.email,
      email: r.email,
      ready: ready(r),
    })),
    retainedUserId,
    requiresHead,
    alreadyTogether: personIds.size === 1 && !personIds.has(null),
    conflicts: [...new Set(conflicts)],
    warnings:
      outcome === "REVIEW_REQUIRED"
        ? [
            "Operational resolution remains required. Existing logins and their private access stay separate.",
          ]
        : [],
    canRetireLogins,
    retireDuplicateLogins: input.retireDuplicateLogins,
    outcome,
    counts: {
      users: graph.users.length,
      tutors: graph.tutors.length,
      tutees: graph.tutees.length,
    },
    authoritySummary: requiresHead
      ? "Head approval and current password are required."
      : "Admin or Head may confirm these unowned historical records.",
  };
  return { input, graph, live, retained, ready, historicalTutee, preview };
}

export async function previewPersonCombine(db: DomainDb, input: Selection) {
  return (await plan(db, input)).preview;
}

export function personCombineReceiptResult(receipt: {
  id: string;
  personId: string;
  outcome: "GROUPED" | "REVIEW_REQUIRED";
  retiredUserIds: string[];
}) {
  return {
    ok: true as const,
    personId: receipt.personId,
    receiptId: receipt.id,
    outcome: receipt.outcome,
    retiredUserIds: receipt.retiredUserIds,
  };
}

/** One transaction records grouping, any independently safe read grants, explicit
 * retirement and its durable receipt. Retrying an accepted intent is read-only. */
export async function combinePersonRecords(
  db: DomainDb,
  actorId: string,
  raw: z.input<typeof personCombineInput>,
) {
  const input = personCombineInput.parse(raw);
  const { confirmPassword: _password, ...intent } = input;
  void _password;
  const inputHash = hash(intent);
  return inTransaction(db, async (tx) => {
    // Pairing writers hold period before Tutor rows and planned-schedule writes.
    // Join that fence before namespace/account/table locks so our Pairing fence
    // cannot wait on a Tutor row whose writer is waiting for our table lock.
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockEntity(tx, "program:leadership");
    // Receipt lookup precedes source resolution: a completed intent remains
    // recoverable even if a later authorized workflow changes its source rows.
    const saved = await tx.personCombineReceipt.findUnique({
      where: { id: input.operationId },
    });
    if (saved) {
      const reviewer = await tx.user.findUnique({ where: { id: actorId } });
      if (
        !reviewer ||
        !["ADMIN", "HEAD"].includes(reviewer.role) ||
        reviewer.mergedIntoId ||
        reviewer.suspendedAt
      )
        throw new TRPCError({ code: "FORBIDDEN" });
      if (saved.actorId !== actorId || saved.inputHash !== inputHash)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This operation reference belongs to another reviewed intent.",
        });
      return personCombineReceiptResult(saved);
    }
    const initial = await personGraph(tx, input.sources);
    for (const id of [
      ...new Set([actorId, ...initial.users.map((r) => r.id)]),
    ].sort())
      await lockEntity(tx, `account-profile:${id}`);
    // Match the existing account-combine lock order; fence independent roster,
    // authority and ownership writers before validating the review snapshot.
    await tx.$executeRaw`LOCK TABLE "User", "Tutor", "Tutee", "Person", "AcademicProfile", "AccountEmail", "MessagePermission", "MessageRestriction", "StudentProfileOwnership", "TutorProfileOwnership", "PolicyAcceptance", "ApprovalRequest", "CrewStatusRequest", "StudentRequestReview", "StudentSurvey", "TutorStatusRequest", "Term", "SchoolDeparture", "Pairing", "PairingTutee" IN SHARE ROW EXCLUSIVE MODE`;
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (
      !actor ||
      !["ADMIN", "HEAD"].includes(actor.role) ||
      actor.mergedIntoId ||
      actor.suspendedAt
    )
      throw new TRPCError({ code: "FORBIDDEN" });
    const { graph, live, retained, ready, historicalTutee, preview } =
      await plan(tx, input);
    if (preview.requiresHead) {
      if (actor.role !== "HEAD")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Head review is required.",
        });
      if (
        !input.confirmPassword ||
        !verifyPasswordConfirmation(
          actorId,
          input.confirmPassword,
          actor.passwordHash,
        )
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Password is incorrect.",
        });
    }
    if (preview.fingerprint !== input.fingerprint)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Records changed. Reload and review the combination again.",
      });
    if (input.retireDuplicateLogins && !preview.canRetireLogins)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          preview.conflicts.join(" ") ||
          "These records do not have safely retireable duplicate logins.",
      });
    const canonical =
      graph.persons.find(
        (r) => r.id === retained?.personId && !r.mergedIntoId,
      ) ?? graph.persons.find((r) => !r.mergedIntoId);
    const person = canonical ?? (await tx.person.create({ data: {} }));
    const otherPersonIds = graph.persons
      .filter((r) => r.id !== person.id)
      .map((r) => r.id);
    await tx.person.updateMany({
      where: { id: { in: otherPersonIds } },
      data: {
        primaryUserId: null,
        mergedIntoId: person.id,
        revision: { increment: 1 },
      },
    });
    await tx.user.updateMany({
      where: { id: { in: graph.users.map((r) => r.id) } },
      data: { personId: person.id },
    });
    await assignParticipantPerson(
      tx,
      "TUTOR",
      graph.tutors.map((r) => r.id),
      person.id,
    );
    await assignParticipantPerson(
      tx,
      "TUTEE",
      graph.tutees.map((r) => r.id),
      person.id,
    );
    await tx.person.update({
      where: { id: person.id },
      data: {
        primaryUserId: retained?.id ?? null,
        resolutionState: preview.outcome,
        revision: { increment: 1 },
      },
    });
    const retiredUserIds: string[] = [];
    if (input.retireDuplicateLogins && retained) {
      for (const duplicate of live.filter((r) => r.id !== retained.id)) {
        // Release direct links before changing retained ownership. Immutable
        // historical actors and original login identifiers are left untouched.
        await tx.user.update({
          where: { id: duplicate.id },
          data: {
            mergedIntoId: retained.id,
            tutorId: null,
            studentId: null,
            passwordHash: null,
            sessionVersion: { increment: 1 },
            twoFactorEnabled: false,
          },
        });
        await tx.tutorProfileOwnership.updateMany({
          where: { userId: duplicate.id },
          data: { userId: retained.id, revision: { increment: 1 } },
        });
        await tx.studentProfileOwnership.updateMany({
          where: { userId: duplicate.id },
          data: { userId: retained.id, revision: { increment: 1 } },
        });
        if (duplicate.tutorId)
          await tx.tutorProfileOwnership.upsert({
            where: { tutorId: duplicate.tutorId },
            create: { tutorId: duplicate.tutorId, userId: retained.id },
            update: {},
          });
        if (duplicate.studentId)
          await tx.studentProfileOwnership.upsert({
            where: { tuteeId: duplicate.studentId },
            create: { tuteeId: duplicate.studentId, userId: retained.id },
            update: {},
          });
        await tx.studentQuarterBlock.updateMany({
          where: { userId: duplicate.id },
          data: { userId: retained.id },
        });
        await tx.notification.updateMany({
          where: { userId: duplicate.id },
          data: { userId: retained.id },
        });
        await tx.passwordResetToken.deleteMany({
          where: { userId: duplicate.id },
        });
        await tx.emailVerificationCode.deleteMany({
          where: { userId: duplicate.id },
        });
        await tx.studentActionConfirmation.deleteMany({
          where: { userId: duplicate.id },
        });
        await tx.emailDelivery.updateMany({
          where: { userId: duplicate.id, status: "PENDING" },
          data: { status: "CANCELLED", completedAt: new Date() },
        });
        retiredUserIds.push(duplicate.id);
      }
    }
    // Grant only after explicit safe retirement has established the final sole
    // principal. Identity-only groups with multiple live logins grant nothing.
    // Initial unowned sources exclude direct profiles already retained above.
    if (
      live.length - retiredUserIds.length === 1 &&
      retained &&
      ready(retained) &&
      !retained.schoolDeparture
    ) {
      for (const row of graph.tutors.filter(
        (r) => !r.user && !r.retainedOwner && isHistoricalTutor(r),
      )) {
        const review = await previewTutorHistory(tx, {
          tutorId: row.id,
          userId: retained.id,
        });
        await linkTutorHistory(tx, actorId, {
          tutorId: row.id,
          userId: retained.id,
          fingerprint: review.fingerprint,
          reason: input.reason,
          acknowledged: true,
        });
      }
      for (const row of graph.tutees.filter(
        (r) =>
          !r.user &&
          !graph.ownership.some((o) => o.tuteeId === r.id) &&
          historicalTutee(r),
      )) {
        const review = await previewHistoryLink(tx, {
          tuteeId: row.id,
          userId: retained.id,
        });
        await linkTuteeHistory(tx, actorId, {
          tuteeId: row.id,
          userId: retained.id,
          fingerprint: review.fingerprint,
          reason: input.reason,
          acknowledged: true,
        });
      }
    }
    await tx.auditLog.create({
      data: {
        userId: actorId,
        userName: actor.name ?? actor.username,
        entity: "Person",
        entityId: person.id,
        operation: "personCombine.combine",
        action: "Combined person records",
        details: {
          sources: input.sources,
          reason: input.reason,
          fingerprint: input.fingerprint,
          outcome: preview.outcome,
          retainedUserId: retained?.id ?? null,
          retiredUserIds,
        },
      },
    });
    const receipt = await tx.personCombineReceipt.create({
      data: {
        id: input.operationId,
        actorId,
        inputHash,
        personId: person.id,
        outcome: preview.outcome,
        retiredUserIds,
      },
    });
    return personCombineReceiptResult(receipt);
  });
}
