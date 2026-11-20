import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  notificationCategories,
  notificationLockCategories,
} from "~/lib/notification-categories";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
} from "~/server/transactions";

const categoryLocks = z
  .array(
    z.object({
      category: z.enum(notificationCategories),
      badgeLocked: z.boolean(),
      emailLocked: z.boolean(),
    }),
  )
  .length(notificationCategories.length)
  .refine(
    (rows) =>
      new Set(rows.map((row) => row.category)).size ===
      notificationCategories.length,
    "Include each notification category exactly once.",
  )
  .refine(
    (rows) =>
      !rows.some((row) => row.category === "reminders" && row.badgeLocked),
    "Upcoming reminders are email-only.",
  );

export const notificationLocksInput = z
  .object({ categories: categoryLocks, expectedCategories: categoryLocks })
  .strict();

function lockRecord(rows: z.infer<typeof categoryLocks>) {
  return Object.fromEntries(
    notificationCategories.map((category) => {
      const row = rows.find((row) => row.category === category)!;
      return [
        category,
        { badgeLocked: row.badgeLocked, emailLocked: row.emailLocked },
      ];
    }),
  );
}

/** One setting lock serializes personal writes, unsubscribe and policy changes. */
export async function saveNotificationLocks(
  client: DomainDb,
  input: z.infer<typeof notificationLocksInput>,
  actor: { id: string; name?: string | null },
) {
  return inTransaction(client, async (tx) => {
    await lockEntity(tx, "email-notifications-setting");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
    const currentActor = await tx.user.findUnique({
      where: { id: actor.id },
      select: { role: true, suspendedAt: true, mergedIntoId: true },
    });
    if (
      !currentActor ||
      currentActor.suspendedAt ||
      currentActor.mergedIntoId ||
      !["ADMIN", "HEAD"].includes(currentActor.role)
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Administrator access required.",
      });
    const settings = await tx.programSettings.findUnique({
      where: { id: "program" },
    });
    const before = notificationLockCategories(settings?.notificationLocks);
    if (
      JSON.stringify(lockRecord(before)) !==
      JSON.stringify(lockRecord(input.expectedCategories))
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Notification requirements changed. Reload settings and try again.",
      });
    const notificationLocks = lockRecord(input.categories);
    await tx.programSettings.upsert({
      where: { id: "program" },
      create: { id: "program", notificationLocks },
      update: { notificationLocks },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        userName: actor.name,
        entity: "ProgramSettings",
        entityId: "program",
        operation: "program.setNotificationLocks",
        action: "Changed required notifications",
        details: {
          before,
          after: input.categories,
          personalChoicesPreserved: true,
        },
      },
    });
    return { ok: true };
  });
}
