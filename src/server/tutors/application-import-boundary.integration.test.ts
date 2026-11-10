import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { databaseScope } from "~/server/db-scope";
import { createCaller } from "~/server/api/root";
import { applyRecords } from "~/server/record-transfer";
import { recordCsv } from "~/lib/record-transfer";
import { lockUsernameNamespace } from "~/server/auth/username-namespace";
import { promoteApplicantToTutor } from "./promote";
import type { TransactionDb } from "~/server/transactions";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());
const id = () => `c${randomUUID().replaceAll("-", "")}`;
async function fixture(
  run: (tx: TransactionDb, actorId: string) => Promise<void>,
) {
  const rollback = new Error("Rollback synthetic archived admission fixtures");
  try {
    await db.$transaction(
      async (tx) =>
        databaseScope.run(tx as unknown as typeof db, async () => {
          const actorId = id();
          await tx.user.create({
            data: {
              id: actorId,
              role: "HEAD",
              email: `${actorId}@example.test`,
            },
          });
          await lockUsernameNamespace(tx);
          await run(tx, actorId);
          throw rollback;
        }),
      { timeout: 30_000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
async function importAccepted(tx: TransactionDb, email: string) {
  const application = {
    id: id(),
    name: "Synthetic archived accepted applicant",
    email,
    status: "ACCEPTED",
    updatedAt: "2026-09-01T06:00:00.000Z",
  };
  await applyRecords(tx, [
    {
      name: "TutorApplication.csv",
      text: recordCsv(Object.keys(application), [application]),
    },
  ]);
  return tx.tutorApplication.findUniqueOrThrow({
    where: { id: application.id },
  });
}
function caller(tx: TransactionDb, actorId: string) {
  return createCaller({
    db: tx as unknown as typeof db,
    headers: new Headers(),
    session: {
      user: { id: actorId },
      role: "HEAD",
      tutorId: null,
      expires: "2099-01-01",
    },
  });
}

it("refuses to turn an imported accepted status retry into new tutor membership or a registration grant", async () =>
  fixture(async (tx, actorId) => {
    const email = `${id()}@example.test`;
    const application = await importAccepted(tx, email);
    const beforeCodes = await tx.registrationCode.count();
    await expect(
      caller(tx, actorId).admin.setApplicationStatus({
        id: application.id,
        status: "ACCEPTED",
        expectedUpdatedAt: application.updatedAt,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining(
        "imported historical evidence",
      ) as unknown,
    });
    await expect(
      promoteApplicantToTutor(application.id, tx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await tx.tutor.count({ where: { email } })).toBe(0);
    expect(await tx.registrationCode.count()).toBe(beforeCodes);
    expect(
      await tx.tutorApplication.findUniqueOrThrow({
        where: { id: application.id },
      }),
    ).toMatchObject({ status: "ACCEPTED", promotedTutorId: null });
  }));

it.each(["imported", "native"] as const)(
  "treats only a native independent accepted application as current grant authority (%s sibling)",
  async (origin) =>
    fixture(async (tx, actorId) => {
      const email = `${id()}@example.test`;
      const tutor = await tx.tutor.create({
        data: {
          englishName: "Synthetic current tutor",
          email,
          status: "ACTIVE",
        },
      });
      const application = await tx.tutorApplication.create({
        data: {
          name: "Synthetic native admission",
          email,
          status: "ACCEPTED",
          promotedTutorId: tutor.id,
        },
      });
      if (origin === "imported") await importAccepted(tx, email);
      else
        await tx.tutorApplication.create({
          data: {
            name: "Synthetic independent native admission",
            email,
            status: "ACCEPTED",
          },
        });
      await caller(tx, actorId).admin.setApplicationStatus({
        id: application.id,
        status: "REJECTED",
        expectedUpdatedAt: application.updatedAt,
      });
      expect(
        await tx.tutor.findUniqueOrThrow({ where: { id: tutor.id } }),
      ).toMatchObject({ status: origin === "native" ? "ACTIVE" : "ARCHIVED" });
    }),
);
