import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { surveyInput } from "~/lib/student-signup";
import type { StudentSurvey, Prisma } from "../../generated/prisma";
import type { TransactionDb } from "./transactions";
import {
  currentStudentSignupPayload,
  studentSignupLocalAnswers,
  studentSignupIntentDigest,
} from "./student-signup-answers";

/** Every writer of overlapping request answers must share this version fence. The caller
 * already owns the request row/catalogue boundary; this is not an authorization helper. */
export async function synchronizeStudentSignupAnswers(
  tx: TransactionDb,
  row: StudentSurvey,
  actorUserId: string,
  changes: Record<string, unknown>,
) {
  if (row.state !== "OPEN") return;
  const previous = studentSignupLocalAnswers(currentStudentSignupPayload(row));
  const proposed = { ...currentStudentSignupPayload(row), ...changes };
  const parsed = surveyInput.safeParse(proposed);
  if (
    !parsed.success ||
    (parsed.data.secondChoiceId &&
      parsed.data.secondChoiceId === parsed.data.firstChoiceId)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Keep a required first subject and distinct subject choices on the open signup.",
    });
  const answers = JSON.parse(
    JSON.stringify(studentSignupLocalAnswers({ ...previous, ...changes })),
  ) as Prisma.InputJsonObject;
  if (
    studentSignupIntentDigest(previous) === studentSignupIntentDigest(answers)
  )
    return;
  const version = row.currentVersion + 1;
  await tx.studentSignupRevision.create({
    data: {
      surveyId: row.id,
      expectedVersion: row.currentVersion,
      version,
      actorUserId,
      clientKey: randomUUID(),
      inputHash: studentSignupIntentDigest({
        operation: "synchronize",
        surveyId: row.id,
        expectedVersion: row.currentVersion,
        answers,
      }),
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
}
