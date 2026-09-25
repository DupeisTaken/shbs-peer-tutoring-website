import { retryUsernameSnapshot } from "./username-snapshot";
import { beforeEach, afterAll, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn() },
  isEmailDeliveryAvailable: () => true,
  isEmailConfigured: () => true,
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import {
  ensureUniqueUsername,
  ensureUserUsername,
  backfillStudentUsernames,
  lockUsernameNamespace,
} from "./username";
import { updateAccountUsername } from "~/server/account-username";
import { issueTutorSetupLink } from "./password-reset";
import { promoteApplicantToTutor } from "~/server/tutors/promote";

beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/shbs_shipping_test"
  )
    throw Error("Isolated test database required");
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.user.create({
    data: {
      id: "identity-head",
      email: "head@example.test",
      role: "HEAD",
      username: "head",
    },
  });
});
afterAll(() => db.$disconnect());
const head = () =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: "identity-head", email: "head@example.test", name: "Head" },
      role: "HEAD",
      tutorId: null,
      expires: "2099-01-01",
    },
  });
const user = (id: string, username: string | null = null) =>
  db.user.create({
    data: {
      id,
      name: "John Smith",
      email: `${id}@example.test`,
      role: "STUDENT",
      username,
      emailVerifiedAt: new Date(),
    },
  });
const tutor = (id: string, username: string | null = null) =>
  db.tutor.create({
    data: {
      id,
      englishName: "John Smith",
      email: `${id}@example.test`,
      username,
      status: "ACTIVE",
    },
  });

it.each([false, true])(
  "serializes same-name creation across tables=%s",
  async (crossTable) => {
    const allocate = (id: string, roster: boolean) =>
      db.$transaction(async (tx) => {
        const username = await ensureUniqueUsername("jsmith28", {}, tx);
        // Leave a real overlap after selection; the lock must survive until the write commits.
        await tx.$executeRaw`SELECT pg_sleep(0.04)`;
        if (roster)
          await tx.tutor.create({ data: { englishName: id, username } });
        else
          await tx.user.create({
            data: { email: `${id}@example.test`, username },
          });
        return username;
      });
    const names = await Promise.all([
      allocate("one", false),
      allocate("two", crossTable),
      allocate("three", crossTable),
    ]);
    expect(new Set(names)).toEqual(
      new Set(["jsmith28", "jsmith28b", "jsmith28c"]),
    );
  },
);

it("releases a failed reservation at rollback", async () => {
  await expect(
    db.$transaction(async (tx) => {
      const username = await ensureUniqueUsername("rollback", {}, tx);
      await tx.user.create({
        data: { email: "rollback@example.test", username },
      });
      throw new Error("cancel allocation");
    }),
  ).rejects.toThrow("cancel allocation");
  expect(
    await db.$transaction((tx) => ensureUniqueUsername("rollback", {}, tx)),
  ).toBe("rollback");
  expect(
    await db.user.findUnique({ where: { username: "rollback" } }),
  ).toBeNull();
});

it("serializes rename against allocation in the shared namespace", async () => {
  await user("rename", "oldname");
  const created = db.$transaction(async (tx) => {
    await lockUsernameNamespace(tx);
    const username = await ensureUniqueUsername("desired", {}, tx);
    await tx.$executeRaw`SELECT pg_sleep(0.05)`;
    return tx.tutor.create({ data: { englishName: "Other", username } });
  });
  const renamed = updateAccountUsername(db, "identity-head", {
    userId: "rename",
    username: "desired",
    expectedProfileVersion: 0,
  });
  const outcomes = await Promise.allSettled([created, renamed]);
  expect(outcomes[0]?.status).toBe("fulfilled");
  const account = await db.user.findUniqueOrThrow({ where: { id: "rename" } });
  const roster = await db.tutor.findFirstOrThrow();
  expect(account.username).not.toBe(roster.username);
  if (outcomes[1]?.status === "rejected")
    expect(outcomes[1].reason).toMatchObject({ code: "CONFLICT" });
});

it("serializes simultaneous backfill and keeps student reads and viewers separate", async () => {
  await user("student");
  expect(await ensureUserUsername("student")).toBe("");
  const names = await Promise.all(
    Array.from({ length: 4 }, () =>
      ensureUserUsername("student", db, { verifiedStudent: true }),
    ),
  );
  expect(names).toEqual(["jsmith", "jsmith", "jsmith", "jsmith"]);
  await db.user.create({
    data: {
      id: "viewer",
      role: "VIEWER",
      email: "viewer@example.test",
      emailVerifiedAt: new Date(),
    },
  });
  expect(
    await ensureUserUsername("viewer", db, { verifiedStudent: true }),
  ).toBe("");
});

it("bounds and audits verified-student backfill without touching existing handles", async () => {
  await user("student");
  await user("custom", "customhandle");
  await expect(
    backfillStudentUsernames(db, "student", ["student"]),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    backfillStudentUsernames(
      db,
      "identity-head",
      Array.from({ length: 101 }, (_, n) => String(n)),
    ),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    await backfillStudentUsernames(db, "identity-head", ["student", "custom"]),
  ).toEqual([
    { id: "student", username: "jsmith" },
    { id: "custom", username: "customhandle" },
  ]);
  expect(
    await db.auditLog.count({
      where: { operation: "admin.backfillStudentUsernames" },
    }),
  ).toBe(1);
  await db.user.update({
    where: { id: "student" },
    data: { emailVerifiedAt: null },
  });
  await expect(
    backfillStudentUsernames(db, "identity-head", ["student"]),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("preserves the roster handle on first setup and repeated setup", async () => {
  await tutor("roster", "jsmith28");
  await issueTutorSetupLink("roster", "identity-head");
  await issueTutorSetupLink("roster", "identity-head");
  expect(
    await db.user.findUnique({ where: { tutorId: "roster" } }),
  ).toMatchObject({ username: "jsmith28" });
  expect(await db.tutor.findUnique({ where: { id: "roster" } })).toMatchObject({
    username: "jsmith28",
  });
  expect(await db.user.count({ where: { tutorId: "roster" } })).toBe(1);
});

it("preserves an existing account handle when setup links a roster tutor", async () => {
  await tutor("existing", "provisional");
  await user("existing", "customhandle");
  await issueTutorSetupLink("existing", "identity-head");
  expect(
    await db.tutor.findUnique({ where: { id: "existing" } }),
  ).toMatchObject({ username: "customhandle" });
  expect(await db.user.findUnique({ where: { id: "existing" } })).toMatchObject(
    { username: "customhandle", tutorId: "existing" },
  );
});

it("rolls back setup when an unrelated identity owns a legacy roster handle", async () => {
  await tutor("roster", "taken");
  await user("other", "taken");
  await expect(
    issueTutorSetupLink("roster", "identity-head"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.user.findUnique({ where: { email: "roster@example.test" } }),
  ).toBeNull();
});

it("reconciles old linked divergence to the account and records its old mirror", async () => {
  await tutor("roster", "oldmirror");
  await user("account", "customhandle");
  await db.user.update({
    where: { id: "account" },
    data: { tutorId: "roster" },
  });
  expect(await ensureUserUsername("account")).toBe("customhandle");
  expect(await db.tutor.findUnique({ where: { id: "roster" } })).toMatchObject({
    username: "customhandle",
  });
  expect(
    await db.auditLog.findFirst({
      where: { operation: "identity.reconcileUsername" },
    }),
  ).toMatchObject({
    details: { oldTutorUsername: "oldmirror", username: "customhandle" },
  });
});

it.each([null, "customhandle"])(
  "enables and repeats tutor participation with existing handle %s",
  async (handle) => {
    await user("participant", handle);
    await head().admin.setUserCanTutor({
      userId: "participant",
      canTutor: true,
    });
    const first = await db.user.findUniqueOrThrow({
      where: { id: "participant" },
      include: { tutor: true },
    });
    expect(first.username).toBe(handle ?? "jsmith");
    expect(first.tutor?.username).toBe(first.username);
    await head().admin.setUserCanTutor({
      userId: "participant",
      canTutor: false,
    });
    await head().admin.setUserCanTutor({
      userId: "participant",
      canTutor: true,
    });
    const after = await db.user.findUniqueOrThrow({
      where: { id: "participant" },
      include: { tutor: true },
    });
    expect(after.tutorId).toBe(first.tutorId);
    expect(after.tutor?.username).toBe(first.username);
  },
);

it("accepted applications adopt a verified account's stable custom handle", async () => {
  await user("applicant", "customhandle");
  const app = await db.tutorApplication.create({
    data: {
      name: "Changed Name",
      email: "applicant@example.test",
      type: "INITIAL",
    },
  });
  await promoteApplicantToTutor(app.id);
  await promoteApplicantToTutor(app.id);
  const account = await db.user.findUniqueOrThrow({
    where: { id: "applicant" },
    include: { tutor: true },
  });
  expect(account.username).toBe("customhandle");
  expect(account.tutor?.username).toBe("customhandle");
  expect(await db.tutor.count()).toBe(1);
});

it("rejects allocation on a root client before the reservation can escape its transaction", async () => {
  await expect(ensureUniqueUsername("unsafe", {}, db)).rejects.toThrow(
    "requires an active transaction",
  );
});
it("invalidates stale rename versions when a missing student handle is assigned", async () => {
  await user("student");
  await backfillStudentUsernames(db, "identity-head", ["student"]);
  await expect(
    updateAccountUsername(db, "identity-head", {
      userId: "student",
      username: "stalerename",
      expectedProfileVersion: 0,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.user.findUnique({ where: { id: "student" } })).toMatchObject({
    username: "jsmith",
    profileVersion: 1,
  });
});

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "keeps stale Serializable snapshots unique against cross-table normal writes (serial tutor=%s, existing guard=%s)",
  async (serialTutor, existingGuard) => {
    if (existingGuard) await db.$transaction((tx) => lockUsernameNamespace(tx));
    let snapshotReady!: () => void;
    let releaseSnapshot!: () => void;
    const ready = new Promise<void>((resolve) => {
      snapshotReady = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    let attempts = 0;
    const stale = retryUsernameSnapshot(() =>
      db.$transaction(
        async (tx) => {
          attempts++;
          await tx.user.count(); // Pin the Serializable snapshot before another allocator commits.
          snapshotReady();
          await proceed;
          const username = await ensureUniqueUsername("snapshot", {}, tx);
          if (serialTutor)
            await tx.tutor.create({
              data: { englishName: "Serializable", username },
            });
          else
            await tx.user.create({
              data: { email: "serial@example.test", username },
            });
          return username;
        },
        { isolationLevel: "Serializable" },
      ),
    );
    await ready;
    const fresh = await db.$transaction(async (tx) => {
      const username = await ensureUniqueUsername("snapshot", {}, tx);
      if (serialTutor)
        await tx.user.create({
          data: { email: "normal@example.test", username },
        });
      else await tx.tutor.create({ data: { englishName: "Normal", username } });
      return username;
    });
    releaseSnapshot();
    expect(new Set([await stale, fresh]).size).toBe(2);
    expect(attempts).toBe(2);
  },
);

it("retries a real Serializable approval before replay and creates exactly one distinct tutor", async () => {
  await db.user.create({
    data: {
      id: "coordinator",
      email: "coordinator@example.test",
      role: "COORDINATOR",
    },
  });
  const coordinator = createCaller({
    db,
    headers: new Headers(),
    session: {
      user: {
        id: "coordinator",
        email: "coordinator@example.test",
        name: "Coordinator",
      },
      role: "COORDINATOR",
      tutorId: null,
      expires: "2099-01-01",
    },
  });
  await expect(
    coordinator.admin.createTutor({
      firstName: "John",
      lastName: "Smith",
      status: "ACTIVE",
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const request = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "admin.createTutor" },
  });
  let writerReady!: () => void;
  let releaseWriter!: () => void;
  const ready = new Promise<void>((resolve) => {
    writerReady = resolve;
  });
  const proceed = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });
  const writer = db.$transaction(async (tx) => {
    const username = await ensureUniqueUsername("jsmith", {}, tx);
    await tx.user.create({ data: { email: "normal@example.test", username } });
    writerReady();
    await proceed;
  });
  await ready;
  const approval = head().approval.decide({
    id: request.id,
    approve: true,
    note: "Approve synthetic tutor",
  });
  // Observe the real lock wait, rather than assuming a timer pins the replay's snapshot.
  let waiting = false;
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      const rows = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event = 'advisory' AND pid <> pg_backend_pid()`;
      if (Number(rows[0]?.count) > 0) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    releaseWriter();
  }
  await writer;
  await expect(approval).resolves.toMatchObject({ state: "APPROVED" });
  expect(waiting).toBe(true);
  expect(await db.tutor.count()).toBe(1);
  expect(await db.tutor.findFirst()).toMatchObject({ username: "jsmithb" });
  expect(
    await db.user.findUnique({ where: { email: "normal@example.test" } }),
  ).toMatchObject({ username: "jsmith" });
  expect(
    await db.auditLog.count({
      where: { operation: "admin.createTutor", kind: "DECISION" },
    }),
  ).toBe(1);
});
