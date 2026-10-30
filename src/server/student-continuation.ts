import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma";
import { surveyInput } from "~/lib/student-signup";
import { missingTuteeFields, normalizeTuteeFields } from "~/lib/signup-fields";
import { recruitmentStatus, recruitmentWindow } from "~/lib/recruitment";
import { periodLabel } from "~/lib/period";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";
import { lockUsernameNamespace } from "./auth/username";
import { lockCatalogue } from "./qualifications";
import { lockAccountProfile, updateAccountProfile } from "./account-profile";
import { ownedStudentIds, retainStudentOwnership } from "./student-ownership";
import { requireSchoolParticipation } from "./school-departure";
import { assertIntakeEligibility } from "./student-survey";
import {
  lockStudentRequestReview,
  assertRequestProcessable,
} from "./request-invalidity";
import {
  currentStudentSignupPayload,
  studentSignupIntentDigest,
  studentSignupLocalAnswers,
} from "./student-signup-answers";
import { currentPolicy, publishedPolicy } from "./policy-acceptance";
import { getSignupSettings } from "./program/signup-fields";
import {
  assertPrimaryName,
  assertOfferedGrade,
} from "./program/profile-policy";
import { getFeatures } from "./program/features";
import { getProgramTimeZone } from "./program/time-zone";
import { settleContinuationOpening } from "./program/continuation-opening";
import { lockSessionPlanning } from "./session-planning";
import {
  attemptContinuationAssignment,
  getContinuationAssignmentReason,
} from "./student-continuation-assignment";
import { recordDomainAudit } from "./audit/evidence";

export const continuationInput = z
  .object({
    clientKey: z.string().uuid(),
    revision: z.string().length(64),
    sourcePairingIds: z.array(z.string().min(1).max(128)).min(1).max(30),
    policyRevision: z.string().min(1).max(128),
    agreed: z.literal(true),
    signatureName: z.string().trim().min(1).max(120),
  })
  .strict();
const resultSchema = z.object({
  sourcePairingId: z.string(),
  subject: z.string(),
  tutorName: z.string(),
  state: z.enum(["assigned", "queued", "released"]),
  reason: z.string().nullable(),
});
const receiptSchema = z.object({
  requestId: z.string(),
  version: z.number(),
  results: z.array(resultSchema),
});
const conflict = () =>
  new TRPCError({ code: "CONFLICT", message: "CONTINUATION_CHANGED" });
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;

/** These barriers are shared with availability and planning writers, before account/request rows. */
async function lockContinuation(tx: TransactionDb) {
  await lockEntity(tx, "program:period");
  await lockUsernameNamespace(tx);
  await lockCatalogue(tx);
  await lockSessionPlanning(tx);
}

async function currentActor(tx: TransactionDb, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: { academicProfile: true },
  });
  if (!user || user.suspendedAt || user.mergedIntoId || user.recoveryVoidedAt)
    throw new TRPCError({ code: "FORBIDDEN" });
  await requireSchoolParticipation(tx, userId);
  return user;
}

/** Status is an ownership-scoped read. Clock settlement records a past fact, never grants a new hour. */
async function continuationContext(
  tx: TransactionDb,
  userId: string,
  locale = "en",
  settleOpening = true,
) {
  const user = await currentActor(tx, userId);
  const active = await tx.term.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  const term =
    active && settleOpening
      ? await settleContinuationOpening(tx, active.id, now)
      : active;
  const features = await getFeatures(tx);
  const source = term?.continuationSourceTermId
    ? await tx.term.findUnique({ where: { id: term.continuationSourceTermId } })
    : null;
  const transition =
    !!term &&
    !!source &&
    term.continuationQuarterTransition &&
    features.QUARTER_SYSTEM &&
    source.schoolYear === term.schoolYear &&
    ((source.quarter === "Q1" && term.quarter === "Q2") ||
      (source.quarter === "Q3" && term.quarter === "Q4"));
  const owned = await ownedStudentIds(tx, userId);
  const links = transition
    ? await tx.pairingTutee.findMany({
        where: { tuteeId: { in: owned }, pairing: { termId: source.id } },
        include: {
          tutee: true,
          pairing: { include: { tutor: true, timeSlot: true } },
        },
        orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }],
      })
    : [];
  // Multiple retained profiles cannot create duplicate choices for the same historical lesson.
  const sources = [
    ...new Map(links.map((link) => [link.pairingId, link])).values(),
  ];
  const subjects = await tx.subject.findMany({
    where: { name: { in: sources.map((x) => x.pairing.subject) } },
  });
  const aliases = await tx.accountEmail.findMany({
    where: { userId, verifiedAt: { not: null } },
    select: { email: true },
  });
  const addresses = [user.email, ...aliases.map((x) => x.email)];
  // A confirmed public submission closes this shortcut for the whole destination
  // quarter, even after recall. Receipts distinguish continued/adopted requests
  // from ordinary confirmation without trusting mutable answers or email alone.
  const confirmedRequests = term
    ? await tx.studentSurvey.findMany({
        where: {
          intakeTermId: term.id,
          OR: [{ tuteeId: { in: owned } }, { email: { in: addresses } }],
          AND: [
            {
              OR: [
                { publicSignupEmailConfirmedAt: { not: null } },
                { confirmedAt: { not: null } },
              ],
            },
          ],
        },
        select: { id: true, publicSignupEmailConfirmedAt: true },
      })
    : [];
  const continuationReceipts = confirmedRequests.length
    ? await tx.studentContinuationReceipt.findMany({
        where: { surveyId: { in: confirmedRequests.map((row) => row.id) } },
        select: { surveyId: true },
      })
    : [];
  const continuedRequestIds = new Set(
    continuationReceipts.map((receipt) => receipt.surveyId),
  );
  const hasFreshRequest = confirmedRequests.some(
    (row) =>
      row.publicSignupEmailConfirmedAt !== null || !continuedRequestIds.has(row.id),
  );
  const requests = term
    ? await tx.studentSurvey.findMany({
        where: {
          intakeTermId: term.id,
          state: "OPEN",
          OR: [{ tuteeId: { in: owned } }, { email: { in: addresses } }],
        },
        orderBy: { submittedAt: "asc" },
        take: 2,
      })
    : [];
  const matchedRequest = requests.length === 1 ? requests[0]! : null;
  // A matching address does not authorize reading a profile now owned elsewhere.
  const foreignRequest =
    !!matchedRequest?.tuteeId && !owned.includes(matchedRequest.tuteeId);
  const request = foreignRequest ? null : matchedRequest;
  const choices = request
    ? await tx.studentContinuationAssignment.findMany({
        where: { surveyId: request.id },
      })
    : [];
  const policy = await publishedPolicy(tx, "tutee-policy");
  const localized =
    policy?.documents.find((x) => x.locale === locale && x.body.trim()) ??
    policy?.documents.find((x) => x.locale === "en");
  const block = term
    ? await tx.studentQuarterBlock.findFirst({
        where: {
          intakeTermId: term.id,
          OR: [{ userId }, { email: { in: addresses } }],
        },
      })
    : null;
  const prior = sources[0]?.tutee;
  const oldAnswers = request ? currentStudentSignupPayload(request) : null;
  const academic = user.academicProfile;
  const grade =
    academic?.status === "REPORTED" &&
    academic.schoolYear === term?.schoolYear &&
    !academic.reconfirmRequired
      ? (academic.rawGrade ??
        (academic.gradeLevel == null ? undefined : String(academic.gradeLevel)))
      : undefined;
  const fields = (await getSignupSettings(tx)).tutee;
  const basic = {
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
    preferredName: user.preferredName ?? undefined,
    alternativeNames: user.alternativeNames ?? undefined,
    englishName: user.name ?? prior?.englishName ?? "",
    email: user.email,
    phone:
      typeof oldAnswers?.phone === "string"
        ? oldAnswers.phone
        : (prior?.phone ?? undefined),
    preferredContact:
      typeof oldAnswers?.preferredContact === "string"
        ? oldAnswers.preferredContact
        : (prior?.preferredContact ?? ""),
    gradeLevel:
      typeof oldAnswers?.gradeLevel === "string"
        ? oldAnswers.gradeLevel
        : grade,
    slotIds: [
      ...new Set(
        sources.flatMap((x) =>
          x.pairing.timeSlotId ? [x.pairing.timeSlotId] : [],
        ),
      ),
    ],
    signatureName: "",
    secondChoiceId: undefined as string | undefined,
  };
  // An addition preserves the complete current answer snapshot, including cleared fields.
  const prerequisiteAnswers = oldAnswers
    ? {
        gradeLevel:
          typeof oldAnswers.gradeLevel === "string"
            ? oldAnswers.gradeLevel
            : undefined,
        phone:
          typeof oldAnswers.phone === "string" ? oldAnswers.phone : undefined,
        preferredContact:
          typeof oldAnswers.preferredContact === "string"
            ? oldAnswers.preferredContact
            : "",
        slotIds: Array.isArray(oldAnswers.slotIds)
          ? oldAnswers.slotIds.filter((x): x is string => typeof x === "string")
          : [],
        signatureName: "",
      }
    : basic;
  const fieldsRequired = missingTuteeFields(prerequisiteAnswers, fields).filter(
    (key) => !["signatureName", "secondSubject"].includes(key),
  );
  if (!user.emailVerifiedAt || !user.passwordHash || user.mustChangePassword)
    fieldsRequired.push("emailVerification");
  const requestName = oldAnswers
    ? typeof oldAnswers.englishName === "string"
      ? oldAnswers.englishName
      : ""
    : basic.englishName;
  if (!requestName.trim()) fieldsRequired.push("name");
  if (requests.length > 1 || foreignRequest)
    fieldsRequired.push("requestReview");
  if (request?.invalidatedAt) fieldsRequired.push("requestReview");
  if (
    request &&
    !request.confirmedAt &&
    request.verificationDueAt &&
    request.verificationDueAt <= now
  )
    fieldsRequired.push("requestReview");
  const openedAt = term?.signupFirstOpenedAt ?? null;
  const expiresAt = openedAt ? new Date(+openedAt + 3_600_000) : null;
  const recruitment = term
    ? recruitmentStatus(recruitmentWindow(term, "tutee"), +now)
    : "paused";
  let status: "eligible" | "scheduled" | "paused" | "expired" | "unavailable" =
    "unavailable";
  if (
    transition &&
    sources.length &&
    !hasFreshRequest &&
    !block &&
    policy &&
    term?.signupOpeningStateSince
  ) {
    if (expiresAt && now >= expiresAt) status = "expired";
    else if (recruitment === "paused") status = "paused";
    else if (recruitment === "scheduled") status = "scheduled";
    else if (recruitment === "ended") status = "expired";
    else if (openedAt && now >= openedAt) status = "eligible";
  }
  const candidates = await Promise.all(
    sources.map(async (link) => {
      const p = link.pairing;
      const subject = subjects.find((x) => x.name === p.subject);
      const choice = choices.find((x) => x.sourcePairingId === p.id);
      let reason = publicContinuationReason(
        await getContinuationAssignmentReason(tx, p),
      );
      if (choice) reason = publicContinuationReason(choice.reason);
      return {
        sourcePairingId: p.id,
        subjectId: subject?.id ?? "",
        subject: p.subject,
        tutorName: p.tutor.englishName,
        dayOfWeek: p.dayOfWeek,
        startMin: p.startMin,
        endMin: p.endMin,
        state:
          choice?.status === "ASSIGNED"
            ? ("joined" as const)
            : choice?.status === "RELEASED"
              ? ("released" as const)
              : choice || reason
                ? ("queued" as const)
                : ("available" as const),
        requested: !!choice,
        reason,
      };
    }),
  );
  const currentSubjects = oldAnswers
    ? [oldAnswers.firstChoiceId, oldAnswers.secondChoiceId].filter(
        (x): x is string => typeof x === "string" && !!x,
      )
    : [];
  // Availability is deliberately not a review fence: a late invalidation still files valid demand.
  const revision = studentSignupIntentDigest(
    json({
      termId: term?.id ?? null,
      sourceId: source?.id ?? null,
      openedAt,
      expiresAt,
      profileVersion: user.profileVersion,
      policyRevision: policy?.revision ?? null,
      fields,
      request: request ? [request.id, request.currentVersion] : null,
      source: sources.map(({ pairing: p, tuteeId }) => [
        p.id,
        tuteeId,
        p.tutorId,
        p.subject,
        p.dayOfWeek,
        p.startMin,
        p.endMin,
        p.timeSlotId,
        p.scheduleConfirmed,
      ]),
    }),
  );
  return {
    user,
    term,
    source,
    sources,
    subjects,
    request,
    basic,
    fields,
    choices,
    public: {
      status,
      hasFreshRequest,
      serverNow: now,
      targetTermId: term?.id ?? "",
      targetTermName: term ? periodLabel(term) : "",
      sourceTermId: source?.id ?? null,
      sourceTermName: source ? periodLabel(source) : null,
      timeZone: await getProgramTimeZone(tx),
      openedAt,
      expiresAt,
      revision,
      minimumSubjects: fields.secondSubject === "required" ? 2 : 1,
      currentRequest: request
        ? {
            id: request.id,
            version: request.currentVersion,
            subjectIds: currentSubjects,
          }
        : null,
      prerequisites: { fieldsRequired },
      policy:
        policy && localized
          ? {
              revision: policy.revision,
              title: localized.title,
              body: localized.body,
            }
          : null,
      candidates,
    },
  };
}

export function publicContinuationReason(reason: string | null): string | null {
  if (!reason) return null;
  const key = reason.toLowerCase();
  if (key.includes("qualif")) return "qualificationMissing";
  if (key.includes("willing")) return "willingnessMissing";
  if (key.includes("group")) return "groupUnavailable";
  if (key.includes("room")) return "roomUnavailable";
  if (key.includes("slot") || key.includes("availability"))
    return "slotUnavailable";
  if (key.includes("tutor")) return "tutorUnavailable";
  if (key.includes("subject")) return "subjectUnavailable";
  if (key.includes("conflict")) return "scheduleConflict";
  if (key.includes("confirm")) return "unconfirmedSchedule";
  if (key.includes("releas")) return "released";
  return "sourceChanged";
}

export async function continuationStatus(
  db: DomainDb,
  userId: string,
  locale?: string,
) {
  return inTransaction(db, async (tx) => {
    await lockContinuation(tx);
    return (await continuationContext(tx, userId, locale)).public;
  });
}

export async function continuationReceipt(
  db: DomainDb,
  userId: string,
  clientKey: string,
) {
  return inTransaction(db, async (tx) => {
    // Wait behind an in-flight submission before reporting that no receipt exists.
    await lockContinuation(tx);
    await lockEntity(tx, `student-continuation:${userId}:${clientKey}`);
    await currentActor(tx, userId);
    const row = await tx.studentContinuationReceipt.findUnique({
      where: { userId_clientKey: { userId, clientKey } },
    });
    return row ? receiptSchema.parse(row.result) : null;
  });
}

/** Explicit signed-in consent files request evidence before assignment attempts; no mailbox/account mutation. */
export async function joinContinuation(
  db: DomainDb,
  userId: string,
  input: z.infer<typeof continuationInput>,
) {
  return inTransaction(db, async (tx) => {
    await lockContinuation(tx);
    await lockEntity(tx, `student-continuation:${userId}:${input.clientKey}`);
    await currentActor(tx, userId);
    const inputHash = studentSignupIntentDigest(input);
    const receipt = await tx.studentContinuationReceipt.findUnique({
      where: { userId_clientKey: { userId, clientKey: input.clientKey } },
    });
    if (receipt) {
      if (receipt.inputHash !== inputHash) throw conflict();
      return receiptSchema.parse(receipt.result);
    }
    await lockEntity(tx, "policy:tutee-policy");
    await lockEntity(tx, "signup-fields");
    // Legacy request actions lock the request before sharing its term row. Discover
    // ownership first without a term write lock, then follow that same row order.
    let ctx = await continuationContext(tx, userId, "en", false);
    if (ctx.request) {
      await lockStudentRequestReview(tx, ctx.request);
    }
    await lockAccountProfile(tx, userId);
    ctx = await continuationContext(tx, userId);
    if (ctx.public.status !== "eligible" || !ctx.term || !ctx.source)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "CONTINUATION_WINDOW_CLOSED",
      });
    if (input.revision !== ctx.public.revision) throw conflict();
    if (ctx.public.prerequisites.fieldsRequired.length)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "CONTINUATION_DETAILS_REQUIRED",
      });
    const ids = [...new Set(input.sourcePairingIds)].sort();
    if (ids.length !== input.sourcePairingIds.length) throw conflict();
    const selected = ids.map((id) =>
      ctx.sources.find((x) => x.pairingId === id),
    );
    if (selected.some((x) => !x)) throw new TRPCError({ code: "FORBIDDEN" });
    if (ctx.choices.some((x) => ids.includes(x.sourcePairingId)))
      throw conflict();
    const sources = selected.filter((x): x is NonNullable<typeof x> => !!x);
    const old = ctx.request ? currentStudentSignupPayload(ctx.request) : null;
    const subjectIds = [
      ...new Set([
        ...(ctx.public.currentRequest?.subjectIds ?? []),
        ...sources.map(
          (x) =>
            ctx.subjects.find((s) => s.name === x.pairing.subject)?.id ?? "",
        ),
      ]),
    ];
    if (subjectIds.includes(""))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "CONTINUATION_SUBJECT_UNAVAILABLE",
      });
    if (subjectIds.length > 2)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "CONTINUATION_SUBJECT_LIMIT",
      });
    const slotIds = [
      ...new Set([
        ...(Array.isArray(old?.slotIds)
          ? old.slotIds.filter((x): x is string => typeof x === "string")
          : []),
        ...sources.flatMap((x) =>
          x.pairing.timeSlotId ? [x.pairing.timeSlotId] : [],
        ),
      ]),
    ];
    const policy = await currentPolicy(tx, "tutee-policy");
    if (policy.revision !== input.policyRevision) throw conflict();
    // Adding a choice does not authorize replacing existing request-local identity/contact/academic answers.
    const posted = surveyInput.parse({
      ...(old ? studentSignupLocalAnswers(old) : ctx.basic),
      email: ctx.request?.email ?? ctx.user.email,
      firstChoiceId: subjectIds[0],
      secondChoiceId: subjectIds[1],
      slotIds,
      signatureName: input.signatureName,
      agreed: true,
      policyRevision: policy.revision,
    });
    // Form visibility applies when creating answers, not to an addition's already-signed
    // local answers. Re-normalizing would silently erase phone/contact/grade values.
    const normalized = old ? posted : normalizeTuteeFields(posted, ctx.fields);
    // A continued, explicitly selected subject/slot is signed demand even when unavailable.
    // Hidden optional form controls cannot silently discard that selection.
    const answers = {
      ...normalized,
      firstChoiceId: subjectIds[0]!,
      secondChoiceId: subjectIds[1],
      slotIds,
      signatureName: input.signatureName,
    };
    if (missingTuteeFields(answers, ctx.fields).length)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "CONTINUATION_DETAILS_REQUIRED",
      });
    await assertPrimaryName(tx, answers.englishName, answers.englishName);
    await assertOfferedGrade(tx, ctx.user.academicProfile?.gradeLevel ?? null);
    await assertIntakeEligibility(
      tx,
      ctx.term.id,
      ctx.user.email,
      ctx.user,
      ctx.request?.id,
    );
    if (ctx.request) assertRequestProcessable(ctx.request);
    const now = new Date();
    // Match normal request processing even if the deadline crosses during this transaction.
    if (
      ctx.request &&
      !ctx.request.confirmedAt &&
      ctx.request.verificationDueAt &&
      ctx.request.verificationDueAt <= now
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "CONTINUATION_REQUEST_EXPIRED",
      });
    if (!ctx.public.expiresAt || now >= ctx.public.expiresAt)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "CONTINUATION_WINDOW_CLOSED",
      });
    const row =
      ctx.request ??
      (await tx.studentSurvey.create({
        data: {
          email: ctx.user.email,
          intakeTermId: ctx.term.id,
          payload: json({
            ...answers,
            academicAccountId: userId,
            academicProfileVersion: ctx.user.profileVersion,
            continuationAuthenticatedBy: userId,
            continuationEmailVerifiedAt: ctx.user.emailVerifiedAt,
          }),
          policyRevision: policy.revision,
          policySnapshot: json(policy.documents),
          submittedAt: now,
          tokenHash: randomBytes(32).toString("hex"),
          expiresAt: now,
          confirmedAt: now,
        },
      }));
    let student = row.tuteeId
      ? await tx.tutee.findUniqueOrThrow({ where: { id: row.tuteeId } })
      : null;
    if (!student) {
      student = await tx.tutee.create({
        data: {
          personId: (await tx.person.create({ data: {} })).id,
          firstName: answers.firstName,
          lastName: answers.lastName,
          preferredName: answers.preferredName,
          alternativeNames: answers.alternativeNames,
          englishName: answers.englishName,
          email: row.email,
          phone: answers.phone,
          preferredContact: answers.preferredContact,
          gradeLevel: answers.gradeLevel,
          firstChoiceId: answers.firstChoiceId,
          secondChoiceId: answers.secondChoiceId,
          status: "PENDING",
          signedRulebook: true,
          signatureName: input.signatureName,
          signedAt: now,
          signupSubmittedAt: row.submittedAt,
          signupSource: "SELF_SERVICE",
          intakeTermId: row.intakeTermId,
          availabilities: { create: slotIds.map((slotId) => ({ slotId })) },
        },
      });
      if (ctx.user.studentId)
        await retainStudentOwnership(tx, userId, ctx.user.studentId);
      await retainStudentOwnership(tx, userId, student.id);
      await tx.user.update({
        where: { id: userId },
        data: {
          studentId: student.id,
          tuteeMember: true,
          ...(ctx.user.role === "VIEWER" ? { role: "STUDENT" as const } : {}),
        },
      });
      await updateAccountProfile(tx, userId);
    } else {
      await tx.tutee.update({
        where: { id: student.id },
        data: {
          firstChoiceId: answers.firstChoiceId,
          secondChoiceId: answers.secondChoiceId,
        },
      });
      await tx.tuteeAvailability.createMany({
        data: slotIds.map((slotId) => ({ tuteeId: student!.id, slotId })),
        skipDuplicates: true,
      });
    }
    const version = row.currentVersion + 1;
    await tx.studentSignupRevision.create({
      data: {
        surveyId: row.id,
        expectedVersion: row.currentVersion,
        version,
        actorUserId: userId,
        actorUserName: ctx.user.name,
        clientKey: input.clientKey,
        inputHash,
        answers: json(studentSignupLocalAnswers(answers)),
        policyRevision: policy.revision,
        policySnapshot: json(policy.documents),
        signatureName: input.signatureName,
        policyAcceptedAt: now,
      },
    });
    await tx.studentSurvey.update({
      where: { id: row.id },
      data: {
        tuteeId: student.id,
        confirmedAt: row.confirmedAt ?? now,
        currentVersion: version,
        currentPayload: json(studentSignupLocalAnswers(answers)),
        editedAt: ctx.request ? now : null,
      },
    });
    await tx.policyAcceptance.upsert({
      where: {
        userId_slug_revision: {
          userId,
          slug: "tutee-policy",
          revision: policy.revision,
        },
      },
      update: {},
      create: {
        userId,
        slug: "tutee-policy",
        revision: policy.revision,
        snapshot: json(policy.documents),
        signature: input.signatureName,
        acceptedAt: now,
      },
    });
    const results: z.infer<typeof resultSchema>[] = [];
    for (const source of sources) {
      const result = await attemptContinuationAssignment(tx, {
        surveyId: row.id,
        tuteeId: student.id,
        sourcePairingId: source.pairingId,
        sourceTuteeId: source.tuteeId,
        targetTermId: ctx.term.id,
        now,
      });
      results.push({
        sourcePairingId: source.pairingId,
        subject: source.pairing.subject,
        tutorName: source.pairing.tutor.englishName,
        state:
          result.state === "ASSIGNED"
            ? "assigned"
            : result.state === "RELEASED"
              ? "released"
              : "queued",
        reason: publicContinuationReason(result.reason),
      });
    }
    // New dated plans are published by the existing worker/agenda catch-up after commit.
    // A failure publishing an unrelated lesson must never erase accepted signup demand.
    const result = { requestId: row.id, version, results };
    await tx.studentContinuationReceipt.create({
      data: {
        userId,
        clientKey: input.clientKey,
        inputHash,
        surveyId: row.id,
        result: json(result),
      },
    });
    await recordDomainAudit(tx, {
      operation: "studentWorkflow.joinContinuation",
      entity: "StudentSurvey",
      entityId: row.id,
      action: "Tutee continued selected prior-quarter pairings",
      before: { currentVersion: row.currentVersion },
      after: { currentVersion: version },
      effects: {
        sourceTermId: ctx.source.id,
        targetTermId: ctx.term.id,
        sourcePairingIds: ids,
        assigned: results.filter((x) => x.state === "assigned").length,
        priorityPreserved: !!ctx.request,
        historyPreserved: true,
      },
    });
    return result;
  });
}
