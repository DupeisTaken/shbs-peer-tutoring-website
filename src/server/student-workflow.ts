import { approveLegacyStudentWithdrawal } from "./legacy-student-withdrawal";
import { TRPCError } from "@trpc/server";
import { approvalScope } from "./db-scope";
import { ownedStudentIds } from "./student-ownership";
import type { DomainDb, TransactionDb } from "./transactions";
import { inTransaction, lockEntity } from "./transactions";
import { currentPolicy, requirePolicy } from "./policy-acceptance";
import {
  materializeStudent,
  surveyInput,
  resendSurvey,
} from "./student-survey";
import {
  closeStudentRequest,
  expireStudentRequests,
  notifyRequest,
  stampStudentAssignment,
} from "./student-request-state";

function fail(message: string): never {
  throw new TRPCError({ code: "PRECONDITION_FAILED", message });
}
export const actionNames = [
  "RECALL",
  "ABORT",
  "SCHEDULE",
  "APPROVE",
  "DENY",
  "POLICY",
  "ASSIGN",
] as const;
export type StudentAction = (typeof actionNames)[number];

export async function prepareStudentAction(
  db: DomainDb,
  userId: string,
  action: StudentAction,
  target: string,
) {
  const now = Date.now();
  // Bound ticket storage and make every popup opening start a fresh deliberate delay.
  await db.studentActionConfirmation.deleteMany({
    where: { userId, expiresAt: { lt: new Date(now) } },
  });
  return db.studentActionConfirmation.create({
    data: {
      userId,
      action,
      target,
      readyAt: new Date(now + (action === "POLICY" ? 10000 : 5000)),
      expiresAt: new Date(now + 30 * 60_000),
    },
    select: { id: true, readyAt: true },
  });
}

export async function consumeStudentAction(
  tx: TransactionDb,
  id: string,
  userId: string,
  action: StudentAction,
  target: string,
) {
  const now = new Date();
  const claimed = await tx.studentActionConfirmation.updateMany({
    where: {
      id,
      userId,
      action,
      target,
      readyAt: { lte: now },
      expiresAt: { gt: now },
      usedAt: null,
    },
    data: { usedAt: now },
  });
  if (!claimed.count)
    fail(
      "Read the confirmation and wait for its timer before confirming. Reopen it if it expired.",
    );
}

async function lockedRequest(tx: TransactionDb, id: string) {
  const initial = await tx.studentSurvey.findUnique({ where: { id } });
  if (!initial) throw new TRPCError({ code: "NOT_FOUND" });
  await lockEntity(tx, `student-survey:${initial.email}`);
  await tx.$queryRaw`SELECT id FROM "Term" WHERE id = ${initial.intakeTermId} FOR SHARE`;
  const row = await tx.studentSurvey.findUniqueOrThrow({ where: { id } });
  const term = await tx.term.findUnique({ where: { id: row.intakeTermId } });
  if (!term?.active || row.state !== "OPEN")
    fail(
      "This request is processed or belongs to an ended quarter. It cannot be reactivated.",
    );
  if (
    !row.confirmedAt &&
    row.verificationDueAt &&
    row.verificationDueAt <= new Date()
  )
    fail("The verification deadline passed. Submit a new request.");
  return row;
}

async function ownedRequest(tx: TransactionDb, userId: string, id: string) {
  const row = await lockedRequest(tx, id);
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (
    !user ||
    user.suspendedAt ||
    !row.confirmedAt ||
    !row.tuteeId ||
    !(await ownedStudentIds(tx, userId)).includes(row.tuteeId)
  )
    throw new TRPCError({ code: "FORBIDDEN" });
  await requirePolicy(tx, userId, "tutee-policy");
  return row;
}

export async function acceptStudentPolicy(
  db: DomainDb,
  userId: string,
  revision: string,
  ticket: string,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "policy:tutee-policy");
    const policy = await currentPolicy(tx, "tutee-policy");
    if (policy.revision !== revision)
      fail("The policy changed again. Reload and read the latest version.");
    await consumeStudentAction(tx, ticket, userId, "POLICY", revision);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.studentId || user.suspendedAt)
      throw new TRPCError({ code: "FORBIDDEN" });
    await tx.policyAcceptance.upsert({
      where: { userId_slug_revision: { userId, slug: policy.slug, revision } },
      update: {},
      create: {
        userId,
        slug: policy.slug,
        revision,
        snapshot: policy.documents,
        signature: user.name ?? user.email,
        acceptedAt: new Date(),
      },
    });
    return { ok: true };
  });
}

export async function studentPolicyStatus(db: DomainDb, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { studentId: true, suspendedAt: true },
  });
  if (!user?.studentId || user.suspendedAt) return null;
  const policy = await currentPolicy(db, "tutee-policy");
  const acceptance = await db.policyAcceptance.findUnique({
    where: {
      userId_slug_revision: {
        userId,
        slug: policy.slug,
        revision: policy.revision,
      },
    },
  });
  return acceptance ? null : policy;
}

export async function assignStudentRequest(
  db: DomainDb,
  id: string,
  userId: string,
  ticket: string,
  subjectId: string,
  tutorId: string,
) {
  await expireStudentRequests(db);
  const result = await inTransaction(db, async (tx) => {
    const row = await lockedRequest(tx, id);
    await consumeStudentAction(tx, ticket, userId, "ASSIGN", id);
    const input = surveyInput.parse(row.payload);
    if (![input.firstChoiceId, input.secondChoiceId].includes(subjectId))
      fail("Choose a subject requested in this survey.");
    const subject = await tx.subject.findUnique({ where: { id: subjectId } });
    const tutor = await tx.tutor.findUnique({ where: { id: tutorId } });
    if (!subject?.active || tutor?.status !== "ACTIVE")
      fail("Choose an active subject and tutor.");
    const student = await materializeStudent(tx, row);
    const existing = await tx.pairingTutee.findFirst({
      where: {
        tuteeId: student.id,
        pairing: { termId: row.intakeTermId, subject: subject.name },
      },
    });
    if (existing) fail("This subject is already assigned. Refresh the page.");
    await tx.pairing.create({
      data: {
        tutorId,
        termId: row.intakeTermId,
        subject: subject.name,
        dayOfWeek: 1,
        startMin: 930,
        endMin: 990,
        tutees: { create: { tuteeId: student.id } },
      },
    });
    await tx.tutee.update({
      where: { id: student.id },
      data: { status: "ACTIVE" },
    });
    await stampStudentAssignment(tx, student.id);
    await notifyRequest(
      tx,
      { ...row, tuteeId: student.id },
      "Tutor assigned / 已分配导师",
    );
    return { email: row.email, needsVerification: !row.confirmedAt };
  });
  // The durable assignment/deadline survive SMTP failure. Management can retry explicitly.
  const emailSent = result.needsVerification
    ? approvalScope.getStore()
      ? null
      : await resendSurvey(db, result.email, false)
    : true;
  return { ok: true, emailSent };
}

export async function editStudentAvailability(
  db: DomainDb,
  userId: string,
  id: string,
  slotIds: string[],
) {
  await expireStudentRequests(db);
  return inTransaction(db, async (tx) => {
    const row = await ownedRequest(tx, userId, id);
    const ids = [...new Set(slotIds)];
    await tx.$queryRaw`SELECT id FROM "TimeSlot" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR SHARE`;
    if (
      !ids.length ||
      (await tx.timeSlot.count({
        where: { id: { in: ids }, active: true },
      })) !== ids.length
    )
      fail("Choose active availability slots.");
    const old = await tx.tuteeAvailability.findMany({
      where: { tuteeId: row.tuteeId! },
    });
    if (old.length === ids.length && old.every((s) => ids.includes(s.slotId)))
      return { ok: true };
    await tx.tuteeAvailability.deleteMany({ where: { tuteeId: row.tuteeId! } });
    await tx.tuteeAvailability.createMany({
      data: ids.map((slotId) => ({ tuteeId: row.tuteeId!, slotId })),
    });
    // Original survey evidence stays untouched; only the current availability and edit marker change.
    await tx.studentSurvey.update({
      where: { id },
      data: { editedAt: new Date() },
    });
    await notifyRequest(
      tx,
      row,
      "Tutee availability edited / 学生可用时间已修改",
    );
    return { ok: true };
  });
}

export async function recallStudentRequest(
  db: DomainDb,
  userId: string,
  id: string,
  ticket: string,
) {
  await expireStudentRequests(db);
  return inTransaction(db, async (tx) => {
    const row = await ownedRequest(tx, userId, id);
    await consumeStudentAction(tx, ticket, userId, "RECALL", id);
    if (
      await tx.pairingTutee.count({
        where: { tuteeId: row.tuteeId!, pairing: { termId: row.intakeTermId } },
      })
    )
      fail("You have a tutor assignment. Apply to leave this quarter instead.");
    await closeStudentRequest(tx, row, "RECALLED");
    return { ok: true };
  });
}

export async function applyStudentAbort(
  db: DomainDb,
  userId: string,
  id: string,
  reason: string,
  ticket: string,
) {
  await expireStudentRequests(db);
  return inTransaction(db, async (tx) => {
    const row = await ownedRequest(tx, userId, id);
    await consumeStudentAction(tx, ticket, userId, "ABORT", id);
    if (
      !(await tx.pairingTutee.count({
        where: { tuteeId: row.tuteeId!, pairing: { termId: row.intakeTermId } },
      }))
    )
      fail("This request is unassigned. Use recall instead.");
    if (
      await tx.studentRequestReview.count({
        where: { surveyId: id, kind: "STUDENT_ABORT", state: "PENDING" },
      })
    )
      fail("Your application is already awaiting review.");
    await tx.studentRequestReview.create({
      data: {
        surveyId: id,
        kind: "STUDENT_ABORT",
        requestedByUserId: userId,
        reason,
      },
    });
    await notifyRequest(
      tx,
      row,
      "Quarter withdrawal awaiting review / 本季度退出申请待审核",
    );
    return { ok: true };
  });
}

export async function applyScheduleRejection(
  db: DomainDb,
  userId: string,
  tutorId: string,
  tuteeId: string,
  pairingId: string,
  reason: string,
  ticket: string,
) {
  await expireStudentRequests(db);
  return inTransaction(db, async (tx) => {
    const survey = await tx.studentSurvey.findUnique({ where: { tuteeId } });
    if (!survey) {
      await lockEntity(tx, `legacy-student:${tuteeId}`);
      await consumeStudentAction(
        tx,
        ticket,
        userId,
        "SCHEDULE",
        `${pairingId}:${tuteeId}`,
      );
      const link = await tx.pairingTutee.findFirst({
        where: {
          pairingId,
          tuteeId,
          tutee: { status: { not: "INACTIVE" } },
          pairing: { tutorId, term: { active: true } },
        },
        select: { pairing: { select: { termId: true } } },
      });
      if (!link) throw new TRPCError({ code: "FORBIDDEN" });
      if (
        await tx.studentRequestReview.count({
          where: { legacyTuteeId: tuteeId, pairingId, state: "PENDING" },
        })
      )
        fail("A schedule review is already pending.");
      await tx.studentRequestReview.create({
        data: {
          legacyTuteeId: tuteeId,
          legacyIntakeTermId: link.pairing.termId,
          kind: "SCHEDULE_CONFLICT",
          requestedByUserId: userId,
          pairingId,
          reason,
        },
      });
      await notifyLegacySchedule(
        tx,
        tuteeId,
        userId,
        "Tutor schedule conflict awaiting review / 导师时间冲突待审核",
      );
      return { ok: true };
    }
    const row = await lockedRequest(tx, survey.id);
    await consumeStudentAction(
      tx,
      ticket,
      userId,
      "SCHEDULE",
      `${pairingId}:${tuteeId}`,
    );
    const pairing = await tx.pairingTutee.findFirst({
      where: {
        pairingId,
        tuteeId,
        pairing: { tutorId, termId: row.intakeTermId },
      },
    });
    if (!pairing) throw new TRPCError({ code: "FORBIDDEN" });
    if (
      await tx.studentRequestReview.count({
        where: {
          surveyId: row.id,
          pairingId,
          kind: "SCHEDULE_CONFLICT",
          state: "PENDING",
        },
      })
    )
      fail("A schedule review is already pending.");
    await tx.studentRequestReview.create({
      data: {
        surveyId: row.id,
        kind: "SCHEDULE_CONFLICT",
        pairingId,
        requestedByUserId: userId,
        reason,
      },
    });
    await notifyRequest(
      tx,
      row,
      "Tutor schedule conflict awaiting review / 导师时间冲突待审核",
    );
    return { ok: true };
  });
}

export async function resolveStudentReview(
  db: DomainDb,
  userId: string,
  id: string,
  approve: boolean,
  ticket: string,
) {
  await expireStudentRequests(db);
  return inTransaction(db, async (tx) => {
    const initial = await tx.studentRequestReview.findUniqueOrThrow({
      where: { id },
    });
    if (!initial.surveyId) {
      await lockEntity(tx, `legacy-student:${initial.legacyTuteeId!}`);
      const review = await tx.studentRequestReview.findUniqueOrThrow({
        where: { id },
      });
      if (review.state !== "PENDING")
        fail("This application has already been processed.");
      await consumeStudentAction(
        tx,
        ticket,
        userId,
        approve ? "APPROVE" : "DENY",
        id,
      );
      if (approve && review.kind === "STUDENT_ABORT") {
        await approveLegacyStudentWithdrawal(tx, review);
      } else if (approve) {
        const requester = await tx.user.findUnique({
          where: { id: review.requestedByUserId },
          select: { tutorId: true },
        });
        if (!requester?.tutorId)
          fail(
            "The tutor assignment changed. Decline this outdated application.",
          );
        const detached = await tx.pairingTutee.deleteMany({
          where: {
            pairingId: review.pairingId!,
            tuteeId: review.legacyTuteeId!,
            pairing: {
              tutorId: requester.tutorId,
              termId: review.legacyIntakeTermId!,
              term: { active: true },
            },
          },
        });
        if (!detached.count)
          fail(
            "The tutor assignment changed. Decline this outdated application.",
          );
        await tx.tutee.update({
          where: { id: review.legacyTuteeId! },
          data: { status: "PENDING" },
        });
      }
      await tx.studentRequestReview.update({
        where: { id },
        data: {
          state: approve ? "APPROVED" : "DENIED",
          resolvedAt: new Date(),
          resolvedByUserId: userId,
        },
      });
      await notifyLegacySchedule(
        tx,
        review.legacyTuteeId!,
        review.requestedByUserId,
        review.kind === "STUDENT_ABORT"
          ? approve
            ? "Quarter withdrawal approved / 本季度退出申请已批准"
            : "Withdrawal declined; participation continues / 退出申请未通过，继续参加"
          : approve
            ? "Schedule rejection approved; rematching needed / 时间冲突申请通过，待重新匹配"
            : "Schedule rejection declined / 时间冲突申请未通过",
      );
      return { ok: true };
    }
    const row = await lockedRequest(tx, initial.surveyId);
    const review = await tx.studentRequestReview.findUniqueOrThrow({
      where: { id },
    });
    if (review.state !== "PENDING")
      fail("This application has already been processed.");
    await consumeStudentAction(
      tx,
      ticket,
      userId,
      approve ? "APPROVE" : "DENY",
      id,
    );
    if (approve && review.kind === "STUDENT_ABORT") {
      const owner = row.tuteeId
        ? await tx.studentProfileOwnership.findUnique({
            where: { tuteeId: row.tuteeId },
          })
        : null;
      const linked = row.tuteeId
        ? await tx.user.findUnique({
            where: { studentId: row.tuteeId },
            select: { id: true },
          })
        : null;
      await tx.studentQuarterBlock.upsert({
        where: {
          email_intakeTermId: {
            email: row.email,
            intakeTermId: row.intakeTermId,
          },
        },
        update: {},
        create: {
          email: row.email,
          intakeTermId: row.intakeTermId,
          surveyId: row.id,
          userId: owner?.userId ?? linked?.id,
        },
      });
      await closeStudentRequest(tx, row, "ABORTED");
    } else if (approve) {
      const requester = await tx.user.findUnique({
        where: { id: review.requestedByUserId },
        select: { tutorId: true },
      });
      if (
        !requester?.tutorId ||
        !(await tx.pairingTutee.count({
          where: {
            pairingId: review.pairingId!,
            tuteeId: row.tuteeId!,
            pairing: { tutorId: requester.tutorId },
          },
        }))
      )
        fail(
          "This tutor assignment changed after the application was submitted. Decline this outdated application and review the current assignment.",
        );
      await notifyRequest(
        tx,
        row,
        "Schedule rejection approved; rematching needed / 时间冲突申请通过，待重新匹配",
      );
      await tx.pairingTutee.deleteMany({
        where: { pairingId: review.pairingId!, tuteeId: row.tuteeId! },
      });
      await tx.tutee.update({
        where: { id: row.tuteeId! },
        data: { status: "PENDING" },
      });
    } else
      await notifyRequest(
        tx,
        row,
        "Application declined; current assignment continues / 申请未通过，现有安排继续",
      );
    await tx.studentRequestReview.update({
      where: { id },
      data: {
        state: approve ? "APPROVED" : "DENIED",
        resolvedAt: new Date(),
        resolvedByUserId: userId,
      },
    });
    return { ok: true };
  });
}

async function notifyLegacySchedule(
  tx: TransactionDb,
  tuteeId: string,
  tutorUserId: string,
  title: string,
) {
  const users = await tx.user.findMany({
    where: {
      OR: [
        { role: { in: ["HEAD", "ADMIN", "COORDINATOR"] } },
        { id: tutorUserId },
        { studentId: tuteeId },
      ],
    },
    select: { id: true, role: true, tutorId: true },
  });
  await tx.notification.createMany({
    data: users.map((user) => ({
      userId: user.id,
      title,
      link: ["HEAD", "ADMIN", "COORDINATOR"].includes(user.role)
        ? "/admin/requests"
        : user.tutorId
          ? "/dashboard"
          : "/student",
    })),
  });
}

/** Whitelist workflow data; token hashes and policy snapshots never enter management/client lists. */
export async function studentRequestRows(
  db: DomainDb,
  email?: string,
  userId?: string,
) {
  await expireStudentRequests(db);
  const term = await db.term.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  if (!term) return [];
  const owned = userId ? await ownedStudentIds(db, userId) : null;
  const [rows, subjects, profiles] = await Promise.all([
    db.studentSurvey.findMany({
      where: {
        intakeTermId: term.id,
        ...(owned ? { tuteeId: { in: owned } } : email ? { email } : {}),
      },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      include: { reviews: { orderBy: { createdAt: "desc" } } },
    }),
    db.subject.findMany({ select: { id: true, name: true } }),
    db.tutee.findMany({
      where: {
        intakeTermId: term.id,
        ...(owned ? { id: { in: owned } } : email ? { email } : {}),
      },
      include: {
        availabilities: { include: { slot: true } },
        pairings: {
          where: { pairing: { termId: term.id } },
          include: {
            pairing: { include: { tutor: { select: { englishName: true } } } },
          },
        },
      },
    }),
  ]);
  const slots = await db.timeSlot.findMany({
    orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
  });
  const reviewPairings = await db.pairing.findMany({
    where: {
      id: {
        in: rows.flatMap((row) =>
          row.reviews.flatMap((r) => (r.pairingId ? [r.pairingId] : [])),
        ),
      },
    },
    select: {
      id: true,
      subject: true,
      tutor: { select: { englishName: true } },
    },
  });
  return rows.map((row) => {
    const input = surveyInput.parse(row.payload);
    const profile = profiles.find((p) => p.id === row.tuteeId);
    return {
      id: row.id,
      email: row.email,
      name: input.englishName,
      contact: input.preferredContact,
      tuteeId: row.tuteeId,
      submittedAt: row.submittedAt,
      state: row.state,
      confirmedAt: row.confirmedAt,
      editedAt: row.editedAt,
      firstAssignedAt: row.firstAssignedAt,
      verificationDueAt: row.verificationDueAt,
      lastLinkSentAt: row.lastLinkSentAt,
      subjects: [
        input.firstChoiceId,
        ...(input.secondChoiceId ? [input.secondChoiceId] : []),
      ].map(
        (id) =>
          subjects.find((s) => s.id === id) ?? {
            id,
            name: "Unavailable / 已停用",
          },
      ),
      slots: profile
        ? profile.availabilities.map((a) => a.slot)
        : slots.filter((s) => input.slotIds.includes(s.id)),
      pairings: profile?.pairings.map((p) => p.pairing) ?? [],
      reviews: row.reviews.map((r) => ({
        id: r.id,
        kind: r.kind,
        reason: r.reason,
        state: r.state,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        pairingId: r.pairingId,
        assignment: reviewPairings.find((p) => p.id === r.pairingId) ?? null,
      })),
    };
  });
}
