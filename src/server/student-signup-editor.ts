import type { z } from "zod";
import { surveyInput } from "~/lib/student-signup";
import { currentStudentSignupPayload } from "./student-signup-answers";
import { inTransaction, type DomainDb } from "./transactions";
import { consumeStudentAction } from "./student-workflow";
import {
  assignedSignupSubjects,
  editStudentSignupAnswers,
  lockedOwnedSignup,
  studentSignupAnswersInput,
  type studentSignupEditInput,
} from "./student-signup-state";
export {
  assertSignupEditPeriod,
  assignedSignupSubjects,
  normalizeStudentSignupAnswers,
  restoreStudentSignupAnswers,
  studentSignupAnswersInput,
  studentSignupEditInput,
} from "./student-signup-state";

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

/** Keep ordinary management proof consumption in the web workflow boundary. */
export function editOwnedStudentSignup(
  db: DomainDb,
  userId: string,
  input: z.infer<typeof studentSignupEditInput>,
  management?: { signedTicket: string; releaseChangedAssignments: true; recoveryActionId?: string },
) {
  return editStudentSignupAnswers(db, userId, input, management, consumeStudentAction);
}
