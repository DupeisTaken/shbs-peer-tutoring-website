import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { surveyInput } from "~/lib/student-signup";
import { validateChoices } from "./student-signup-validation";
import {
  currentStudentSignupPayload,
  studentSignupIntentDigest,
} from "./student-signup-answers";
import { ownedStudentIds } from "./student-ownership";
import { lockStudentRequestReview } from "./request-invalidity";
import { lockAccountProfile } from "./account-profile";
import { lockUsernameNamespace } from "./auth/username";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";
import { getSignupSettings } from "./program/signup-fields";
import { normalizeTuteeFields, missingTuteeFields } from "~/lib/signup-fields";
import {
  configuredNewNames,
  configuredLegacyIntakeName,
  configuredProfileNames,
} from "./program/name-fields";
import {
  assertOfferedGrade,
  assertPrimaryName,
} from "./program/profile-policy";
import { fullPersonName } from "~/lib/person-name";
import { normalizeGrade } from "~/lib/academics";
import { requireSchoolParticipation } from "./school-departure";
import { requirePolicy } from "./policy-acceptance";
import { recordDomainAudit } from "./audit/evidence";
import { staleConflict } from "./concurrency";
import { lockCatalogue } from "./qualifications";
import { consumeStudentAction } from "./student-workflow";

// Identity email, original signature and policy evidence are deliberately absent from edits.
export const studentSignupAnswersInput = surveyInput.omit({
  email: true,
  preferredLatinName: true,
  signatureName: true,
  agreed: true,
  policyRevision: true,
});
export const studentSignupEditInput = z
  .object({
    id: z.string().min(1).max(128),
    expectedVersion: z.number().int().nonnegative(),
    clientKey: z.string().uuid(),
    answers: studentSignupAnswersInput,
  })
  .strict();

async function lockedOwnedSignup(
  tx: TransactionDb,
  userId: string,
  id: string,
  management = false,
) {
  await lockEntity(tx, "program:period");
  await lockUsernameNamespace(tx);
  // Assignment takes the catalogue before the source row; edits must share that order.
  await lockCatalogue(tx);
  const initial = await tx.studentSurvey.findUnique({ where: { id } });
  if (!initial) throw new TRPCError({ code: "NOT_FOUND" });
  await lockStudentRequestReview(tx, initial);
  await lockAccountProfile(tx, userId);
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const row = await tx.studentSurvey.findUniqueOrThrow({ where: { id } });
  if (
    user.suspendedAt ||
    user.mergedIntoId ||
    (management
      ? !["HEAD", "ADMIN", "COORDINATOR"].includes(user.role)
      : !row.tuteeId ||
        !(await ownedStudentIds(tx, userId)).includes(row.tuteeId))
  )
    throw new TRPCError({ code: "FORBIDDEN" });
  return { row, user };
}

/** Intake closing stops new submissions; only the explicit active-period rollover closes edits. */
export async function assertSignupEditPeriod(
  tx: TransactionDb,
  row: {
    state: string;
    intakeTermId: string;
    confirmedAt: Date | null;
    verificationDueAt: Date | null;
  },
) {
  const term = await tx.term.findUnique({
    where: { id: row.intakeTermId },
    select: { active: true },
  });
  if (
    row.state !== "OPEN" ||
    !term?.active ||
    (!row.confirmedAt &&
      row.verificationDueAt &&
      row.verificationDueAt <= new Date())
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "SIGNUP_EDIT_CLOSED",
    });
}

export async function assignedSignupSubjects(
  tx: TransactionDb,
  tuteeId: string,
  termId: string,
) {
  const pairings = await tx.pairingTutee.findMany({
    where: { tuteeId, pairing: { termId } },
    select: { pairing: { select: { subject: true } } },
  });
  // Pairing preserves a catalogue label rather than an ID. Include inactive catalogue rows;
  // an unresolved legacy label requires Head resolution instead of silently losing its lock.
  const subjects = await tx.subject.findMany({
    select: { id: true, name: true },
  });
  return {
    subjectIds: [
      ...new Set(
        pairings.flatMap(({ pairing }) => {
          const subject = subjects.find(
            (candidate) => candidate.name === pairing.subject,
          );
          return subject ? [subject.id] : [];
        }),
      ),
    ],
    unresolved: pairings.some(
      ({ pairing }) =>
        !subjects.some((subject) => subject.name === pairing.subject),
    ),
  };
}

/** Validate the complete current snapshot under today's field/catalog policy. Original
 * consent stays read-only, so a tightened signature requirement cannot rewrite its evidence. */
export async function normalizeStudentSignupAnswers(
  tx: TransactionDb,
  posted: z.infer<typeof studentSignupAnswersInput>,
  retainedSubjectIds: string[] = [],
  previous?: z.infer<typeof studentSignupAnswersInput>,
) {
  await lockEntity(tx, "signup-fields");
  const fields = (await getSignupSettings(tx)).tutee;
  // The shared normalizer needs a signature shape, then the editor schema strips it
  // before any current-answer/revision write. This placeholder is never consent.
  let answers = studentSignupAnswersInput.parse(
    normalizeTuteeFields({ ...posted, signatureName: "" }, fields),
  );
  const unchangedName =
    !!previous &&
    (posted.firstName ?? "") === (previous.firstName ?? "") &&
    (posted.lastName ?? "") === (previous.lastName ?? "") &&
    (posted.preferredName ?? "") === (previous.preferredName ?? "") &&
    posted.englishName === previous.englishName;
  if (
    previous &&
    (posted.firstName ?? "") === (previous.firstName ?? "") &&
    (posted.lastName ?? "") === (previous.lastName ?? "") &&
    (posted.preferredName ?? "") === (previous.preferredName ?? "") &&
    posted.englishName === previous.englishName
  ) {
    const previousNames = { ...previous, legacyName: previous.englishName };
    const names = await configuredProfileNames(
      tx,
      posted,
      previousNames,
      "STUDENT",
    );
    answers = {
      ...answers,
      ...names,
      preferredName: names.preferredName ?? undefined,
      alternativeNames: names.alternativeNames ?? undefined,
      englishName: fullPersonName(names) || previous.englishName,
    };
    // Keep the absence of structured parts on an unchanged historical unsplit name.
    // Writing empty strings here would remove its grandfather marker on the next save.
    if (
      previous.firstName == null &&
      previous.lastName == null &&
      previous.preferredName == null &&
      previous.englishName.trim()
    ) {
      delete answers.firstName;
      delete answers.lastName;
      delete answers.preferredName;
      answers.englishName = previous.englishName;
    }
  }
  if (
    posted.secondChoiceId &&
    retainedSubjectIds.includes(posted.secondChoiceId)
  )
    answers.secondChoiceId = posted.secondChoiceId;
  if (
    !unchangedName &&
    (answers.firstName !== undefined ||
      answers.lastName !== undefined ||
      answers.preferredName !== undefined)
  ) {
    const names = await configuredNewNames(tx, answers, "STUDENT");
    answers = {
      ...answers,
      ...names,
      preferredName: names.preferredName ?? undefined,
      alternativeNames: names.alternativeNames ?? undefined,
      englishName: fullPersonName(names),
    };
  } else if (!unchangedName)
    answers = {
      ...answers,
      englishName: await configuredLegacyIntakeName(
        tx,
        answers.englishName,
        "STUDENT",
      ),
    };
  await assertPrimaryName(tx, answers.englishName, previous?.englishName);
  await assertOfferedGrade(tx, normalizeGrade(answers.gradeLevel).gradeLevel);
  const missing = missingTuteeFields(
    { ...answers, signatureName: "" },
    fields,
  ).filter((key) => key !== "signatureName");
  if (missing.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Complete required fields: ${missing.join(", ")}.`,
    });
  const choices = {
    ...answers,
    email: "validation@example.test",
    signatureName: "",
    agreed: true as const,
    policyRevision: "validation",
  };
  if (!(await validateChoices(tx, choices, retainedSubjectIds)))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose distinct active subjects and available time slots.",
    });
  // JSON removes undefined optional answers; current projection treats omission as clearing.
  return JSON.parse(
    JSON.stringify({ ...answers, slotIds: [...new Set(answers.slotIds)] }),
  ) as z.infer<typeof studentSignupAnswersInput>;
}

export async function inspectOwnedStudentSignup(
  db: DomainDb,
  userId: string,
  id: string,
  management = false,
) {
  return inTransaction(db, async (tx) => {
    const { row } = await lockedOwnedSignup(tx, userId, id, management);
    const term = await tx.term.findUnique({
      where: { id: row.intakeTermId },
      select: { active: true },
    });
    const assigned = row.tuteeId
      ? await assignedSignupSubjects(tx, row.tuteeId, row.intakeTermId)
      : { subjectIds: [], unresolved: false };
    const payload = currentStudentSignupPayload(row);
    const subjectIds = [payload.firstChoiceId, payload.secondChoiceId].filter(
      (value): value is string => typeof value === "string" && !!value,
    );
    const persistedSubjects = await tx.subject.findMany({
      where: { id: { in: subjectIds } },
      select: { id: true, name: true, active: true },
    });
    const persistedSlots = await tx.timeSlot.findMany({
      where: {
        id: {
          in: Array.isArray(payload.slotIds)
            ? (payload.slotIds as string[])
            : [],
        },
      },
      select: {
        id: true,
        label: true,
        dayOfWeek: true,
        startMin: true,
        endMin: true,
        active: true,
      },
    });
    const appeal = await tx.studentSignupAppeal.findFirst({
      where: {
        surveyId: row.id,
        ...(row.invalidatedAt
          ? { invalidityVersion: row.invalidityVersion }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, reason: true, state: true, createdAt: true },
    });
    return {
      id: row.id,
      version: row.currentVersion,
      editable:
        row.state === "OPEN" &&
        !!term?.active &&
        !(
          !row.confirmedAt &&
          row.verificationDueAt &&
          row.verificationDueAt <= new Date()
        ),
      email: row.email,
      state: row.state,
      submittedAt: row.submittedAt,
      answers: studentSignupAnswersInput.parse(
        currentStudentSignupPayload(row),
      ),
      originalSignature: surveyInput.parse(row.payload).signatureName,
      originalPolicyRevision: row.policyRevision,
      assignedSubjectIds: assigned.subjectIds,
      assignmentsUnresolved: assigned.unresolved,
      subjectEditingBlocked: assigned.unresolved,
      persistedSubjects,
      persistedSlots,
      isInvalid: !!row.invalidatedAt,
      invalidityVersion: row.invalidityVersion,
      canAppeal:
        row.state === "OPEN" &&
        !!term?.active &&
        !!row.invalidatedAt &&
        !appeal &&
        !(
          !row.confirmedAt &&
          row.verificationDueAt &&
          row.verificationDueAt <= new Date()
        ),
      appeal,
    };
  });
}

/** Accepted write and immutable receipt commit together. Retry rechecks explicit ownership,
 * but returns its original receipt even after a later edit/rollover; it never applies twice. */
export async function editOwnedStudentSignup(
  db: DomainDb,
  userId: string,
  input: z.infer<typeof studentSignupEditInput>,
  management?: { signedTicket: string; releaseChangedAssignments: true },
) {
  return inTransaction(db, async (tx) => {
    const { row, user } = await lockedOwnedSignup(
      tx,
      userId,
      input.id,
      !!management,
    );
    if (management && !["ADMIN", "HEAD"].includes(user.role))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only Admin or Head can change assigned signup subjects.",
      });
    const inputHash = studentSignupIntentDigest(
      JSON.parse(
        JSON.stringify({
          id: input.id,
          expectedVersion: input.expectedVersion,
          answers: input.answers,
          operation: management ? "headEditSignup" : "editSignup",
        }),
      ),
    );
    const receipt = await tx.studentSignupRevision.findUnique({
      where: {
        surveyId_actorUserId_clientKey: {
          surveyId: row.id,
          actorUserId: userId,
          clientKey: input.clientKey,
        },
      },
    });
    if (receipt) {
      if (receipt.inputHash !== inputHash)
        throw new TRPCError({
          code: "CONFLICT",
          message: "SIGNUP_RETRY_CHANGED",
        });
      return { ok: true, version: receipt.version };
    }
    await assertSignupEditPeriod(tx, row);
    if (!management) {
      await requireSchoolParticipation(tx, userId);
      await requirePolicy(tx, userId, "tutee-policy");
    }
    if (row.currentVersion !== input.expectedVersion) staleConflict();
    const assigned = row.tuteeId
      ? await assignedSignupSubjects(tx, row.tuteeId, row.intakeTermId)
      : { subjectIds: [], unresolved: false };
    const previous = studentSignupAnswersInput.parse(
      currentStudentSignupPayload(row),
    );
    if (
      assigned.unresolved &&
      (input.answers.firstChoiceId !== previous.firstChoiceId ||
        input.answers.secondChoiceId !== previous.secondChoiceId)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "SIGNUP_ASSIGNMENT_UNKNOWN",
      });
    const answers = await normalizeStudentSignupAnswers(
      tx,
      input.answers,
      assigned.unresolved
        ? [
            previous.firstChoiceId,
            ...(previous.secondChoiceId ? [previous.secondChoiceId] : []),
          ]
        : assigned.subjectIds,
      previous,
    );
    const selected = [answers.firstChoiceId, answers.secondChoiceId].filter(
      Boolean,
    );
    if (
      !management &&
      assigned.subjectIds.some((subjectId) => !selected.includes(subjectId))
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "SIGNUP_ASSIGNED_SUBJECT_LOCKED",
      });
    const removedPairingIds: string[] = [];
    if (management) {
      await consumeStudentAction(
        tx,
        management.signedTicket,
        userId,
        "SIGNUP_EDIT",
        row.id,
      );
      if (row.tuteeId) {
        const discarded = assigned.subjectIds.filter(
          (subjectId) => !selected.includes(subjectId),
        );
        const subjects = await tx.subject.findMany({
          where: { id: { in: discarded } },
          select: { name: true },
        });
        const links = await tx.pairingTutee.findMany({
          where: {
            tuteeId: row.tuteeId,
            pairing: {
              termId: row.intakeTermId,
              subject: { in: subjects.map(({ name }) => name) },
            },
          },
          select: { pairingId: true },
        });
        removedPairingIds.push(...links.map(({ pairingId }) => pairingId));
        await tx.pairingTutee.deleteMany({
          where: { tuteeId: row.tuteeId, pairingId: { in: removedPairingIds } },
        });
        if (removedPairingIds.length) {
          if (
            !(await tx.pairingTutee.count({
              where: {
                tuteeId: row.tuteeId,
                pairing: { termId: row.intakeTermId },
              },
            }))
          )
            await tx.tutee.update({
              where: { id: row.tuteeId },
              data: { status: "PENDING" },
            });
          await tx.studentRequestReview.updateMany({
            where: {
              surveyId: row.id,
              pairingId: { in: removedPairingIds },
              kind: "SCHEDULE_CONFLICT",
              state: "PENDING",
            },
            data: {
              state: "DENIED",
              resolvedAt: new Date(),
              resolvedByUserId: userId,
            },
          });
        }
      }
    }
    const version = row.currentVersion + 1;
    await tx.studentSignupRevision.create({
      data: {
        surveyId: row.id,
        expectedVersion: row.currentVersion,
        version,
        actorUserId: userId,
        actorUserName: user.name,
        clientKey: input.clientKey,
        inputHash,
        answers,
      },
    });
    await tx.studentSurvey.update({
      where: { id: row.id },
      data: {
        currentPayload: answers,
        currentVersion: version,
        editedAt: new Date(),
      },
    });
    if (row.tuteeId)
      await tx.tutee.update({
        where: { id: row.tuteeId },
        data: {
          // Request-local answers never mirror over canonical account names or academics.
          phone: answers.phone ?? null,
          preferredContact: answers.preferredContact,
          firstChoiceId: answers.firstChoiceId,
          secondChoiceId: answers.secondChoiceId ?? null,
        },
      });
    if (row.tuteeId)
      await tx.tuteeAvailability.deleteMany({
        where: { tuteeId: row.tuteeId },
      });
    if (row.tuteeId)
      await tx.tuteeAvailability.createMany({
        data: answers.slotIds.map((slotId) => ({
          tuteeId: row.tuteeId!,
          slotId,
        })),
      });
    await recordDomainAudit(tx, {
      operation: management
        ? "studentWorkflow.headEditSignup"
        : "studentWorkflow.editSignup",
      entity: "StudentSurvey",
      entityId: row.id,
      action: "Edited own signup answers",
      before: { currentVersion: row.currentVersion },
      after: { currentVersion: version },
      effects: {
        originalEvidencePreserved: true,
        assignmentsPreserved: !removedPairingIds.length,
        removedPairingIds,
      },
    });
    return { ok: true, version };
  });
}
