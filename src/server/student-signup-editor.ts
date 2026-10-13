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
    !row.tuteeId ||
    !(await ownedStudentIds(tx, userId)).includes(row.tuteeId)
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
) {
  await lockEntity(tx, "signup-fields");
  const fields = (await getSignupSettings(tx)).tutee;
  let answers = normalizeTuteeFields(posted, fields);
  if (
    posted.secondChoiceId &&
    retainedSubjectIds.includes(posted.secondChoiceId)
  )
    answers.secondChoiceId = posted.secondChoiceId;
  if (
    answers.firstName !== undefined ||
    answers.lastName !== undefined ||
    answers.preferredName !== undefined
  ) {
    const names = await configuredNewNames(tx, answers, "STUDENT");
    answers = {
      ...answers,
      ...names,
      preferredName: names.preferredName ?? undefined,
      alternativeNames: names.alternativeNames ?? undefined,
      englishName: fullPersonName(names),
    };
  } else
    answers = {
      ...answers,
      englishName: await configuredLegacyIntakeName(
        tx,
        answers.englishName,
        "STUDENT",
      ),
    };
  await assertPrimaryName(tx, answers.englishName);
  await assertOfferedGrade(tx, normalizeGrade(answers.gradeLevel).gradeLevel);
  const missing = missingTuteeFields(answers, fields).filter(
    (key) => key !== "signatureName",
  );
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
) {
  return inTransaction(db, async (tx) => {
    const { row } = await lockedOwnedSignup(tx, userId, id);
    const term = await tx.term.findUnique({
      where: { id: row.intakeTermId },
      select: { active: true },
    });
    const assigned = await assignedSignupSubjects(
      tx,
      row.tuteeId!,
      row.intakeTermId,
    );
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
    };
  });
}

/** Accepted write and immutable receipt commit together. Retry rechecks explicit ownership,
 * but returns its original receipt even after a later edit/rollover; it never applies twice. */
export async function editOwnedStudentSignup(
  db: DomainDb,
  userId: string,
  input: z.infer<typeof studentSignupEditInput>,
) {
  return inTransaction(db, async (tx) => {
    const { row, user } = await lockedOwnedSignup(tx, userId, input.id);
    const inputHash = studentSignupIntentDigest(
      JSON.parse(JSON.stringify(input)),
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
    await requireSchoolParticipation(tx, userId);
    await requirePolicy(tx, userId, "tutee-policy");
    if (row.currentVersion !== input.expectedVersion) staleConflict();
    const assigned = await assignedSignupSubjects(
      tx,
      row.tuteeId!,
      row.intakeTermId,
    );
    if (assigned.unresolved)
      throw new TRPCError({
        code: "CONFLICT",
        message: "SIGNUP_ASSIGNMENT_UNKNOWN",
      });
    const answers = await normalizeStudentSignupAnswers(
      tx,
      input.answers,
      assigned.subjectIds,
    );
    const selected = [answers.firstChoiceId, answers.secondChoiceId].filter(
      Boolean,
    );
    if (assigned.subjectIds.some((subjectId) => !selected.includes(subjectId)))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "SIGNUP_ASSIGNED_SUBJECT_LOCKED",
      });
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
    await tx.tutee.update({
      where: { id: row.tuteeId! },
      data: {
        // Request-local answers never mirror over canonical account names or academics.
        phone: answers.phone ?? null,
        preferredContact: answers.preferredContact,
        firstChoiceId: answers.firstChoiceId,
        secondChoiceId: answers.secondChoiceId ?? null,
      },
    });
    await tx.tuteeAvailability.deleteMany({ where: { tuteeId: row.tuteeId! } });
    await tx.tuteeAvailability.createMany({
      data: answers.slotIds.map((slotId) => ({
        tuteeId: row.tuteeId!,
        slotId,
      })),
    });
    await recordDomainAudit(tx, {
      operation: "studentWorkflow.editSignup",
      entity: "StudentSurvey",
      entityId: row.id,
      action: "Edited own signup answers",
      before: { currentVersion: row.currentVersion },
      after: { currentVersion: version },
      effects: { originalEvidencePreserved: true, assignmentsPreserved: true },
    });
    return { ok: true, version };
  });
}
