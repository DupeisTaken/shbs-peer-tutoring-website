import { expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../generated/prisma";
import { notificationCategories } from "~/lib/notification-categories";
import { runAuditedMutation, safeAuditSnapshot } from "./evidence";

it("projects only canonical category locks in program policy evidence", () => {
  const notificationLocks = {
    messages: { badgeLocked: true, emailLocked: true, token: "PRIVATE_TOKEN" },
    reviews: { badgeLocked: "true", emailLocked: 1 },
    reminders: { badgeLocked: true, emailLocked: true },
    unknown: { body: "PRIVATE_BODY" },
  };
  const snapshot = safeAuditSnapshot({ notificationLocks }, "ProgramSettings");
  expect(snapshot).toEqual({
    notificationLocks: Object.fromEntries(
      notificationCategories.map((category) => [
        category,
        {
          badgeLocked: category === "messages",
          emailLocked: category === "messages" || category === "reminders",
        },
      ]),
    ),
  });
  expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_");
  expect(safeAuditSnapshot({ notificationLocks }, "User")).toEqual({});
});

it("rereads notification requirements for before-and-after automatic audit evidence", async () => {
  let notificationLocks = {};
  const audits: unknown[] = [];
  const findUnique = vi.fn(
    async (_args: { where: unknown; select: Record<string, boolean> }) => ({
      id: "program",
      notificationLocks,
    }),
  );
  const tx = {
    programSettings: {
      findUnique,
      update: async ({ data }: { data: { notificationLocks: object } }) => {
        notificationLocks = data.notificationLocks;
        return { id: "program" };
      },
    },
    auditLog: {
      create: async ({ data }: { data: unknown }) => {
        audits.push(data);
        return {};
      },
    },
  };
  const client = {
    ...tx,
    $transaction: async (work: (tx: object) => Promise<unknown>) => work(tx),
  } as unknown as PrismaClient;
  await runAuditedMutation(
    client,
    { id: "synthetic-head", name: null, role: "HEAD" },
    "program.setNotificationLocks",
    async (db) => {
      await db.programSettings.update({
        where: { id: "program" },
        data: { notificationLocks: { messages: { emailLocked: true } } },
      });
      return { ok: true };
    },
  );
  expect(findUnique).toHaveBeenCalledTimes(2);
  expect(findUnique.mock.calls[0]?.[0]).toMatchObject({
    select: { notificationLocks: true },
  });
  expect(audits).toMatchObject([
    {
      details: {
        changes: [
          {
            entity: "ProgramSettings",
            before: [
              {
                notificationLocks: {
                  messages: { badgeLocked: false, emailLocked: false },
                },
              },
            ],
            after: [
              {
                notificationLocks: {
                  messages: { badgeLocked: false, emailLocked: true },
                },
              },
            ],
          },
        ],
      },
    },
  ]);
});
