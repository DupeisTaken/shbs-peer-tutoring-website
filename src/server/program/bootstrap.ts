import type { Prisma } from "../../../generated/prisma";

/** Production bootstrap creates configuration only, never demonstration people or attendance. */
export async function initializeProgram(
  tx: Prisma.TransactionClient,
  schoolYear: string,
  quarter: "Q1" | "Q2" | "Q3" | "Q4",
) {
  if (
    !/^\d{2}-\d{2}$/.test(schoolYear) ||
    (Number(schoolYear.slice(0, 2)) + 1) % 100 !== Number(schoolYear.slice(3))
  )
    throw new Error(
      "School year must be consecutive years, for example 26-27.",
    );
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('program:period', 0))`;
  const active = await tx.term.findFirst({ where: { active: true } });
  if (active) return active;
  return tx.term.upsert({
    where: { schoolYear_quarter: { schoolYear, quarter } },
    update: { active: true },
    create: {
      schoolYear,
      quarter,
      name: `${schoolYear} ${quarter}`,
      active: true,
    },
  });
}
