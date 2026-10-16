import type { z } from "zod";
import type { surveyInput } from "~/lib/student-signup";
import type { TransactionDb } from "./transactions";
import { lockCatalogue } from "./qualifications";

export async function validateChoices(
  tx: TransactionDb,
  input: z.infer<typeof surveyInput>,
  retainedSubjectIds: string[] = [],
) {
  await lockCatalogue(tx);
  // Prevent deletion/deactivation between validation and creating the related records.
  await tx.$queryRaw`SELECT id FROM "Subject" WHERE id = ${input.firstChoiceId} OR id = ${input.secondChoiceId ?? ""} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "TimeSlot" WHERE id = ANY(${input.slotIds}::text[]) ORDER BY id FOR SHARE`;
  const ids = [
    input.firstChoiceId,
    ...(input.secondChoiceId ? [input.secondChoiceId] : []),
  ];
  return (
    new Set(ids).size === ids.length &&
    (await tx.subject.count({
      where: {
        id: { in: ids },
        OR: [{ active: true }, { id: { in: retainedSubjectIds } }],
      },
    })) === ids.length &&
    (await tx.timeSlot.count({
      where: { id: { in: input.slotIds }, active: true },
    })) === new Set(input.slotIds).size
  );
}
