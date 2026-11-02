import { afterAll, beforeEach, expect, it } from "vitest";
import type { Prisma } from "../../../generated/prisma";
import { db } from "~/server/db";
import { approvalScope } from "~/server/db-scope";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { runAuditedMutation } from "./evidence";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

const actor = {
  id: "compound-audit-head",
  name: "Synthetic head",
  role: "HEAD",
};
const operation = "admin.updateSubjects";
type Snapshot = Record<string, unknown>;
type Change = {
  entity: string;
  write: string;
  before: Snapshot[];
  after: Snapshot[];
  affectedCount: number;
};

beforeEach(async () => {
  // The isolated suite resets all fixtures because recovery evidence is immutable;
  // never disable its retention triggers to clean up individual synthetic writes.
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
});

afterAll(() => db.$disconnect());

async function evidence() {
  const audits = await db.auditLog.findMany({ where: { operation } });
  expect(audits).toHaveLength(1);
  const audit = audits[0]!;
  const details = audit.details as Prisma.JsonObject;
  return { audit, details, changes: details.changes as unknown as Change[] };
}

async function willingnessFixture(count = 1) {
  const tutors = ["compound-tutor-a", "compound-tutor-b"];
  await db.tutor.createMany({
    data: tutors.map((id) => ({ id, englishName: "Synthetic tutor" })),
  });
  const subjects = Array.from({ length: count }, (_, index) => ({
    id: `compound-subject-${index}`,
    name: `Synthetic compound subject ${index}`,
  }));
  await db.subject.createMany({ data: subjects });
  const selected = subjects.map(({ id }, index) => ({
    tutorId: tutors[index % 2]!,
    subjectId: id,
    willing: true,
  }));
  // Each decoy shares its subject with a selected row and its tutor with other
  // selected rows. Independent IN lists would incorrectly capture these tuples.
  const decoys = subjects.map(({ id }, index) => ({
    tutorId: tutors[(index + 1) % 2]!,
    subjectId: id,
    willing: false,
  }));
  await db.tutorSubjectWillingness.createMany({
    data: [...selected, ...decoys],
  });
  return { selected, decoys };
}

function willingnessRows(rows: Snapshot[]) {
  return rows
    .map(({ tutorId, subjectId, willing }) => ({ tutorId, subjectId, willing }))
    .sort((left, right) =>
      `${String(left.tutorId)}:${String(left.subjectId)}`.localeCompare(
        `${String(right.tutorId)}:${String(right.subjectId)}`,
      ),
    );
}

it("captures all 75 changed compound tuples after their original predicate stops matching", async () => {
  const { selected, decoys } = await willingnessFixture(75);
  await approvalScope.run("synthetic-compound-approval", () =>
    runAuditedMutation(db, actor, operation, async (tx) => {
      const result = await tx.tutorSubjectWillingness.updateMany({
        where: { willing: true },
        data: { willing: false },
      });
      expect(result.count).toBe(75);
      return { ok: true };
    }),
  );

  const { audit, details, changes } = await evidence();
  expect(audit).toMatchObject({
    userId: actor.id,
    userName: actor.name,
    approvalId: "synthetic-compound-approval",
  });
  expect(details).toMatchObject({ actorRole: "HEAD", outcome: "APPLIED" });
  expect(changes).toHaveLength(1);
  const change = changes[0]!;
  expect(change).toMatchObject({
    entity: "TutorSubjectWillingness",
    write: "updateMany",
    affectedCount: 75,
  });
  expect(willingnessRows(change.before)).toEqual(willingnessRows(selected));
  expect(willingnessRows(change.after)).toEqual(
    willingnessRows(selected.map((row) => ({ ...row, willing: false }))),
  );
  expect(
    willingnessRows(
      await db.tutorSubjectWillingness.findMany({
        where: {
          OR: decoys.map(({ tutorId, subjectId }) => ({ tutorId, subjectId })),
        },
      }),
    ),
  ).toEqual(willingnessRows(decoys));
});

it("uses private compound identities for lookup without disclosing them in evidence", async () => {
  const selected = [
    { senderId: "PRIVATE_SENDER_A", clientKey: "PRIVATE_KEY_A", count: 1 },
    { senderId: "PRIVATE_SENDER_B", clientKey: "PRIVATE_KEY_B", count: 1 },
  ];
  const decoys = [
    { senderId: "PRIVATE_SENDER_A", clientKey: "PRIVATE_KEY_B", count: 9 },
    { senderId: "PRIVATE_SENDER_B", clientKey: "PRIVATE_KEY_A", count: 9 },
  ];
  await db.messageBatch.createMany({
    data: [...selected, ...decoys].map((row) => ({
      ...row,
      payloadHash: "PRIVATE_PAYLOAD_HASH",
    })),
  });
  await runAuditedMutation(db, actor, operation, async (tx) => {
    await tx.messageBatch.updateMany({
      where: { count: 1 },
      data: { count: 2 },
    });
    return { ok: true };
  });
  const { audit, changes } = await evidence();
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({
    entity: "MessageBatch",
    affectedCount: 2,
  });
  expect(changes[0]!.before.map((row) => row.count)).toEqual([1, 1]);
  expect(changes[0]!.after.map((row) => row.count)).toEqual([2, 2]);
  for (const row of [...changes[0]!.before, ...changes[0]!.after])
    expect(Object.keys(row).sort()).toEqual(["count", "createdAt"]);
  expect(JSON.stringify(audit)).not.toMatch(
    /PRIVATE_|senderId|clientKey|payloadHash/,
  );
  expect(await db.messageBatch.count({ where: { count: 9 } })).toBe(2);
});

it("rereads a private non-id primary key without publishing credential fields", async () => {
  await db.captchaGrant.createMany({
    data: [1, 2].map((version) => ({
      tokenHash: `PRIVATE_TOKEN_${version}`,
      identityHash: "PRIVATE_IDENTITY",
      action: "PRIVATE_ACTION",
      scene: "PRIVATE_SCENE",
      version,
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    })),
  });
  await runAuditedMutation(db, actor, operation, async (tx) => {
    await tx.captchaGrant.updateMany({
      where: { version: 1 },
      data: { version: 3 },
    });
    return { ok: true };
  });
  const { audit, changes } = await evidence();
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({
    entity: "CaptchaGrant",
    affectedCount: 1,
    before: [{ version: 1 }],
    after: [{ version: 3 }],
  });
  expect(changes[0]!.before).toHaveLength(1);
  expect(changes[0]!.after).toHaveLength(1);
  expect(JSON.stringify(audit)).not.toMatch(/PRIVATE_|tokenHash|identityHash/);
});

it("keeps zero-match bulk evidence empty and compound deletions before-only", async () => {
  const { selected, decoys } = await willingnessFixture();
  await runAuditedMutation(db, actor, operation, async (tx) => {
    await tx.tutorSubjectWillingness.updateMany({
      where: { subjectId: "missing-synthetic-subject" },
      data: { willing: false },
    });
    await tx.tutorSubjectWillingness.deleteMany({ where: { willing: true } });
    return { ok: true };
  });
  const { changes } = await evidence();
  expect(changes).toHaveLength(2);
  expect(changes[0]).toMatchObject({
    write: "updateMany",
    affectedCount: 0,
    before: [],
    after: [],
  });
  expect(changes[1]).toMatchObject({
    write: "deleteMany",
    affectedCount: 1,
    after: [],
  });
  expect(willingnessRows(changes[1]!.before)).toEqual(
    willingnessRows(selected),
  );
  expect(willingnessRows(await db.tutorSubjectWillingness.findMany())).toEqual(
    willingnessRows(decoys),
  );
});

it.each(["rejected", "thrown"] as const)(
  "rolls back compound writes and applied evidence after a %s failure",
  async (failure) => {
    const { selected, decoys } = await willingnessFixture();
    const error = { code: "FORBIDDEN", message: "PRIVATE_REJECTION" };
    const result = runAuditedMutation(db, actor, operation, async (tx) => {
      await tx.tutorSubjectWillingness.updateMany({
        where: { willing: true },
        data: { willing: false },
      });
      if (failure === "thrown") throw new Error("PRIVATE_LATE_FAILURE");
      return { ok: false, error };
    });
    if (failure === "thrown")
      await expect(result).rejects.toThrow("PRIVATE_LATE_FAILURE");
    else expect(await result).toEqual({ ok: false, error });

    expect(
      willingnessRows(await db.tutorSubjectWillingness.findMany()),
    ).toEqual(willingnessRows([...selected, ...decoys]));
    const { audit, details } = await evidence();
    expect(audit).toMatchObject({ kind: "ATTEMPT", userId: actor.id });
    expect(details).toMatchObject({
      actorRole: "HEAD",
      outcome: failure === "rejected" ? "DENIED" : "FAILED",
      errorCode: failure === "rejected" ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
      applied: false,
    });
    expect(details).not.toHaveProperty("changes");
    expect(JSON.stringify(audit)).not.toContain("PRIVATE_");
  },
);
