import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { courseName } from "~/lib/course-catalogue";
import { lockCatalogue } from "~/server/qualifications";
import type { TransactionDb } from "~/server/transactions";

export const courseGroupInput = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  offerings: z
    .array(
      z.object({
        subjectId: z.string().min(1).optional(),
        levelId: z.string().min(1).nullable(),
        baseName: z.string().trim().min(1).max(160),
      }),
    )
    .min(1)
    .max(100),
});

/** Names in legacy pairings are synchronized in the same transaction as the variant. */
export async function writeVariant(
  tx: TransactionDb,
  input: {
    id?: string;
    groupId?: string;
    baseName: string;
    levelId: string | null;
    active: boolean;
  },
) {
  const before = input.id
    ? await tx.subject.findUniqueOrThrow({ where: { id: input.id } })
    : null;
  const level = input.levelId
    ? await tx.subjectLevel.findUniqueOrThrow({ where: { id: input.levelId } })
    : null;
  if (
    before &&
    before.levelId !== input.levelId &&
    (await tx.qualificationGrant.count({ where: { subjectId: before.id } }))
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This variant has recorded grants. Add a new level variant instead.",
    });
  const name = courseName(input.baseName, level?.prefix ?? "");
  if (before && before.name !== name)
    await tx.pairing.updateMany({
      where: { subject: before.name },
      data: { subject: name },
    });
  const data = {
    name,
    baseName: input.baseName,
    levelId: input.levelId,
    active: input.active,
    ...(input.groupId ? { groupId: input.groupId } : {}),
  };
  return before
    ? tx.subject.update({ where: { id: before.id }, data })
    : tx.subject.create({ data });
}

export async function saveCourseGroup(
  tx: TransactionDb,
  input: z.infer<typeof courseGroupInput>,
) {
  await lockCatalogue(tx);
  if (
    new Set(input.offerings.map((o) => o.levelId)).size !==
      input.offerings.length ||
    new Set(input.offerings.flatMap((o) => (o.subjectId ? [o.subjectId] : [])))
      .size !== input.offerings.filter((o) => o.subjectId).length
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose each level and existing variant only once.",
    });
  const maxRank =
    (await tx.courseGroup.aggregate({ _max: { rank: true } }))._max.rank ?? -1;
  const group = input.id
    ? await tx.courseGroup.update({
        where: { id: input.id },
        data: { name: input.name },
      })
    : await tx.courseGroup.create({
        data: { name: input.name, rank: maxRank + 1 },
      });
  const previous = await tx.subject.findMany({ where: { groupId: group.id } });
  const retained: string[] = [];
  for (const offering of input.offerings) {
    // Re-enable an archived level in place, retaining every reference and grant ID.
    const existing =
      offering.subjectId ??
      previous.find((s) => s.levelId === offering.levelId)?.id;
    const variant = await writeVariant(tx, {
      id: existing,
      groupId: group.id,
      baseName: offering.baseName,
      levelId: offering.levelId,
      active: true,
    });
    retained.push(variant.id);
  }
  await tx.subject.updateMany({
    where: { groupId: group.id, id: { notIn: retained } },
    data: { active: false },
  });
  return group;
}

export async function reorderCatalogue(
  tx: TransactionDb,
  kind: "levels" | "groups",
  ids: string[],
) {
  await lockCatalogue(tx);
  const rows =
    kind === "levels"
      ? await tx.subjectLevel.findMany()
      : await tx.courseGroup.findMany();
  if (
    ids.length !== rows.length ||
    new Set(ids).size !== rows.length ||
    rows.some((row) => !ids.includes(row.id))
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "The catalogue changed. Refresh before reordering.",
    });
  for (const [rank, id] of ids.entries()) {
    if (kind === "levels")
      await tx.subjectLevel.update({ where: { id }, data: { rank } });
    else await tx.courseGroup.update({ where: { id }, data: { rank } });
  }
  return { ok: true };
}
