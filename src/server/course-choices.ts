import type { Prisma } from "../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";
import { sortCourseChoices } from "~/lib/course-catalogue";

/** Read the complete level scale even for a restricted picker so unlevelled
 * offerings keep the same tier when no regular offering is eligible. */
export async function courseChoices(
  db: TransactionDb,
  where?: Prisma.SubjectWhereInput,
) {
  const [subjects, levels] = await Promise.all([
    db.subject.findMany({ where, include: { level: true, group: true } }),
    db.subjectLevel.findMany({
      select: { id: true, rank: true, prefix: true },
    }),
  ]);
  return sortCourseChoices(subjects, levels);
}
