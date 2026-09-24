import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import type { courseImportInput } from "~/lib/course-import";
import { courseName } from "~/lib/course-catalogue";
import { saveCourseGroup } from "~/server/course-catalogue";
import { lockCatalogue } from "~/server/qualifications";
import type { TransactionDb } from "~/server/transactions";

/** Add complete groups atomically. Conflicts require explicit editing, never inferred merging. */
export async function importCourseGroups(
  tx: TransactionDb,
  input: z.infer<typeof courseImportInput>,
) {
  await lockCatalogue(tx);
  const levels = await tx.subjectLevel.findMany();
  const existing = await tx.courseGroup.findMany({
    include: { subjects: true },
  });
  const usedNames = new Set(
    (await tx.subject.findMany({ select: { name: true } })).map((s) => s.name),
  );
  let created = 0;
  let skipped = 0;
  for (const group of input.groups) {
    const offerings = group.offerings.map((offer) => {
      const matches =
        offer.level === null
          ? []
          : levels.filter(
              (level) =>
                level.name.toLowerCase() === offer.level!.toLowerCase(),
            );
      if (offer.level !== null && (matches.length !== 1 || !matches[0]!.active))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${group.name}: unknown, inactive or ambiguous level: ${offer.level}`,
        });
      return {
        baseName: offer.baseName,
        levelId: matches[0]?.id ?? null,
        name: courseName(offer.baseName, matches[0]?.prefix ?? ""),
      };
    });
    const matches = existing.filter(
      (row) => row.name.toLowerCase() === group.name.toLowerCase(),
    );
    // An exact repeat is a no-op, including IDs, archived records and ordering.
    if (
      matches.length === 1 &&
      matches[0]!.subjects.length === offerings.length &&
      offerings.every((offer) =>
        matches[0]!.subjects.some(
          (s) =>
            s.active &&
            s.baseName === offer.baseName &&
            s.levelId === offer.levelId &&
            s.name === offer.name,
        ),
      )
    ) {
      skipped++;
      continue;
    }
    if (matches.length)
      throw new TRPCError({
        code: "CONFLICT",
        message: `Group "${group.name}" already exists with different offerings. Edit it in Subjects & Levels.`,
      });
    for (const offer of offerings) {
      if (usedNames.has(offer.name))
        throw new TRPCError({
          code: "CONFLICT",
          message: `Subject "${offer.name}" already exists or appears twice in this file. Edit existing groups to consolidate variants.`,
        });
      usedNames.add(offer.name);
    }
    await saveCourseGroup(tx, { name: group.name, offerings });
    created++;
  }
  return { created, skipped, received: input.groups.length };
}
