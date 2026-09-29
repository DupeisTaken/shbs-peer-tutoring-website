import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { combineAccounts, previewCombine } from "./combine-accounts";
import { hashPassword } from "./auth/password";
import { isSessionCurrent } from "./auth/session-version";
import { verifySigninPassword } from "./auth/credentials";
import { findAccountPolicy } from "./policy-acceptance";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { lockAccountProfile } from "./account-profile";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const password = "Combine-head-password-190!";
let headId: string;
let survivorId: string;
let duplicateId: string;
function caller(id: string, role: Session["role"] = "HEAD") {
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id },
      role,
      tutorId: null,
      expires: new Date(Date.now() + 60000).toISOString(),
    },
  });
}
const pair = () => ({ survivorId, duplicateId });
async function combine() {
  const preview = await previewCombine(db, pair());
  return caller(headId).accountCombine.combine({
    ...pair(),
    fingerprint: preview.fingerprint,
    confirmPassword: password,
  });
}
beforeEach(async () => {
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
  headId = (
    await db.user.create({
      data: {
        email: "head190@example.test",
        role: "HEAD",
        passwordHash: hashPassword(password),
        emailVerifiedAt: new Date(),
      },
    })
  ).id;
  survivorId = (
    await db.user.create({
      data: {
        email: "keep190@example.test",
        username: "keep190",
        role: "STUDENT",
        passwordHash: hashPassword(password),
        emailVerifiedAt: new Date(),
      },
    })
  ).id;
  duplicateId = (
    await db.user.create({
      data: {
        email: "retire190@example.test",
        username: "retire190",
        role: "STUDENT",
        passwordHash: hashPassword(password),
        emailVerifiedAt: new Date(),
      },
    })
  ).id;
});
afterAll(async () => {
  // Retired identity guards intentionally reject deletes; isolated fixture cleanup uses TRUNCATE.
  await db.$executeRawUnsafe('TRUNCATE "User" CASCADE');
  await db.$disconnect();
});

it("combines links and delivery ownership, preserves immutable evidence, and revokes the duplicate", async () => {
  const student = await db.tutee.create({
    data: { englishName: "Combined student", status: "ACTIVE" },
  });
  await db.user.update({
    where: { id: survivorId },
    data: { name: "Retained Person", alternativeNames: "保留姓名" },
  });
  await db.user.update({
    where: { id: duplicateId },
    data: { studentId: student.id, tuteeMember: true },
  });
  await db.studentProfileOwnership.create({
    data: { userId: duplicateId, tuteeId: student.id },
  });
  await db.studentQuarterBlock.create({
    data: {
      userId: duplicateId,
      email: "retire190@example.test",
      intakeTermId: "old-term",
      legacyTuteeId: student.id,
    },
  });
  const policy = await db.policyAcceptance.create({
    data: {
      userId: duplicateId,
      slug: "tutee-policy",
      revision: "original-revision",
      snapshot: { original: "policy text" },
      signature: "Original signature",
    },
  });
  const audit = await db.auditLog.create({
    data: { userId: duplicateId, entity: "User", action: "Original action" },
  });
  const message = await db.directMessage.create({
    data: {
      senderId: headId,
      recipientId: duplicateId,
      body: "Private preserved message",
      clientKey: "original-message",
    },
  });
  const outgoing = await db.directMessage.create({
    data: {
      senderId: duplicateId,
      recipientId: headId,
      body: "Original reply",
      clientKey: "original-reply",
    },
  });
  const notification = await db.notification.create({
    data: { userId: duplicateId, title: "Preserved notification" },
  });
  await db.passwordResetToken.create({
    data: {
      userId: duplicateId,
      tokenHash: "original-reset",
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await db.emailVerificationCode.create({
    data: {
      userId: duplicateId,
      purpose: "LOGIN_2FA",
      codeHash: "original-code",
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await db.accountEmail.create({
    data: {
      email: "old-alias@example.test",
      userId: duplicateId,
      verifiedAt: new Date(),
    },
  });
  const version = (
    await db.user.findUniqueOrThrow({ where: { id: duplicateId } })
  ).sessionVersion;
  expect((await previewCombine(db, pair())).conflicts).toEqual([]);
  await combine();
  expect(
    await db.user.findUniqueOrThrow({ where: { id: survivorId } }),
  ).toMatchObject({
    studentId: student.id,
    tuteeMember: true,
    username: "keep190",
    email: "keep190@example.test",
  });
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: student.id } }),
  ).toMatchObject({
    englishName: "Retained Person",
    alternativeNames: "保留姓名",
  });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: duplicateId } }),
  ).toMatchObject({
    mergedIntoId: survivorId,
    passwordHash: null,
    studentId: null,
  });
  expect(
    await db.policyAcceptance.findUnique({ where: { id: policy.id } }),
  ).toEqual(policy);
  expect(
    await findAccountPolicy(
      db,
      survivorId,
      "tutee-policy",
      "original-revision",
    ),
  ).toEqual(policy);
  expect(
    await findAccountPolicy(db, survivorId, "tutee-policy", "new-revision"),
  ).toBeNull();
  expect(await db.auditLog.findUnique({ where: { id: audit.id } })).toEqual(
    audit,
  );
  expect(
    await db.directMessage.findUnique({ where: { id: message.id } }),
  ).toEqual(message);
  expect(
    await db.directMessage.findUnique({ where: { id: outgoing.id } }),
  ).toEqual(outgoing);
  expect(
    await db.notification.findUnique({ where: { id: notification.id } }),
  ).toMatchObject({ userId: survivorId });
  expect(await db.studentQuarterBlock.findFirst()).toMatchObject({
    userId: survivorId,
  });
  expect(
    await db.passwordResetToken.count({ where: { userId: duplicateId } }),
  ).toBe(0);
  expect(
    await db.emailVerificationCode.count({ where: { userId: duplicateId } }),
  ).toBe(0);
  expect(
    await isSessionCurrent(db, { sub: duplicateId, sessionVersion: version }),
  ).toBe(false);
  expect(
    await verifySigninPassword(
      "old-alias@example.test",
      password,
      "combine-test",
    ),
  ).toEqual({ ok: false, reason: "invalid" });
  const inbox = await caller(survivorId, "STUDENT").messaging.inbox();
  expect(inbox.map((row) => row.id)).toEqual(
    expect.arrayContaining([message.id, outgoing.id]),
  );
  await caller(survivorId, "STUDENT").messaging.markRead({ id: message.id });
  expect(
    (await db.directMessage.findUniqueOrThrow({ where: { id: message.id } }))
      .readAt,
  ).not.toBeNull();
  expect(
    (await caller(headId).messaging.inbox()).find(
      (row) => row.id === outgoing.id,
    ),
  ).toMatchObject({ senderId: survivorId, canReply: true });
  await expect(
    caller(duplicateId, "STUDENT").messaging.inbox(),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(
    await db.auditLog.findFirst({
      where: { operation: "accountCombine.combine" },
    }),
  ).toMatchObject({ userId: headId, entityId: survivorId });
  expect(
    await db.accountEmail.findUnique({
      where: { email: "old-alias@example.test" },
    }),
  ).toMatchObject({ userId: duplicateId });
});

it.each([
  "ADMIN",
  "COORDINATOR",
  "TUTOR",
  "STUDENT",
  "VIEWER",
  "CREW",
] as const)(
  "denies %s both preview and mutation even with a stale Head session claim",
  async (role) => {
    await db.user.update({ where: { id: survivorId }, data: { role } });
    await expect(
      caller(survivorId).accountCombine.preview(pair()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(survivorId).accountCombine.combine({
        ...pair(),
        fingerprint: "a".repeat(64),
        confirmPassword: password,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);
it("rechecks the live Head and password inside the transaction", async () => {
  const preview = await previewCombine(db, pair());
  await expect(
    combineAccounts(db, headId, {
      ...pair(),
      fingerprint: preview.fingerprint,
      confirmPassword: "wrong",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.user.update({ where: { id: headId }, data: { role: "ADMIN" } });
  await expect(
    combineAccounts(db, headId, {
      ...pair(),
      fingerprint: preview.fingerprint,
      confirmPassword: password,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("blocks retiring Head, conflicting ranks and current profile links", async () => {
  expect(
    (
      await previewCombine(db, { survivorId, duplicateId: headId })
    ).conflicts.join(" "),
  ).toMatch(/Transfer leadership/);
  const a = await db.tutor.create({ data: { englishName: "Tutor A" } });
  const b = await db.tutor.create({ data: { englishName: "Tutor B" } });
  await db.user.update({ where: { id: survivorId }, data: { tutorId: a.id } });
  await db.user.update({
    where: { id: duplicateId },
    data: { tutorId: b.id, role: "ADMIN" },
  });
  const preview = await previewCombine(db, pair());
  expect(preview.conflicts.join(" ")).toMatch(/different tutor profiles/);
  expect(preview.conflicts.join(" ")).toMatch(/ranks differ/);
  await expect(combine()).rejects.toMatchObject({ code: "CONFLICT" });
});
it("blocks academic, crew, messaging and identifier conflicts without writes", async () => {
  await db.academicProfile.create({
    data: { userId: survivorId, status: "REPORTED", gradeLevel: 10 },
  });
  await db.academicProfile.create({
    data: { userId: duplicateId, status: "REPORTED", gradeLevel: 11 },
  });
  await db.messageRestriction.create({ data: { userId: duplicateId } });
  await db.user.update({
    where: { id: survivorId },
    data: { crewStatus: "ACTIVE" },
  });
  const tutor = await db.tutor.create({
    data: { englishName: "Linked", username: "unreconciledhandle" },
  });
  await db.tutor.create({
    data: { englishName: "Conflicting", email: "keep190@example.test" },
  });
  await db.user.update({
    where: { id: duplicateId },
    data: { crewStatus: "INACTIVE", tutorId: tutor.id },
  });
  const conflicts = (await previewCombine(db, pair())).conflicts.join(" ");
  expect(conflicts).toMatch(/Academic/);
  expect(conflicts).toMatch(/Crew/);
  expect(conflicts).toMatch(/Messaging/);
  expect(conflicts).toMatch(/email conflicts/);
  expect(conflicts).toMatch(/handle differs/);
});

it("blocks unconfirmed intake that would lose its email-bound confirmation route", async () => {
  await db.studentSurvey.create({
    data: {
      email: "retire190@example.test",
      intakeTermId: "intake",
      payload: {},
      policyRevision: "original",
      policySnapshot: {},
      tokenHash: "open-intake",
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  expect((await previewCombine(db, pair())).conflicts.join(" ")).toMatch(
    /unconfirmed student intake/,
  );
  await expect(combine()).rejects.toMatchObject({ code: "CONFLICT" });
});
it("rejects stale preview, self merge, reused merge families and credential revival", async () => {
  await expect(
    previewCombine(db, { survivorId, duplicateId: survivorId }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const preview = await previewCombine(db, pair());
  await db.user.update({
    where: { id: duplicateId },
    data: { canTranslate: true },
  });
  await expect(
    caller(headId).accountCombine.combine({
      ...pair(),
      fingerprint: preview.fingerprint,
      confirmPassword: password,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await combine();
  expect(
    (
      await previewCombine(db, { survivorId, duplicateId: headId })
    ).conflicts.join(" "),
  ).toMatch(/already holds combined history/);
  await expect(
    db.user.update({
      where: { id: duplicateId },
      data: { passwordHash: hashPassword(password) },
    }),
  ).rejects.toThrow();
  await expect(
    db.user.delete({ where: { id: duplicateId } }),
  ).rejects.toThrow();
  await expect(
    db.passwordResetToken.create({
      data: {
        userId: duplicateId,
        tokenHash: "late-reset",
        expiresAt: new Date(Date.now() + 60000),
      },
    }),
  ).rejects.toThrow();
  await expect(
    db.emailVerificationCode.create({
      data: {
        userId: duplicateId,
        purpose: "PASSWORD_CHANGE",
        codeHash: "late-step-up",
        expiresAt: new Date(Date.now() + 60000),
      },
    }),
  ).rejects.toThrow();
});
it("rolls back links, retirement and ownership when the final audit write fails", async () => {
  const original = await db.user.findUniqueOrThrow({
    where: { id: duplicateId },
  });
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_combine_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation = 'accountCombine.combine' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER fail_combine_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_combine_audit()`,
  );
  try {
    await expect(combine()).rejects.toThrow();
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_combine_audit ON "AuditLog"');
    await db.$executeRawUnsafe("DROP FUNCTION fail_combine_audit()");
  }
  expect(await db.user.findUnique({ where: { id: duplicateId } })).toEqual(
    original,
  );
  expect(
    await db.auditLog.count({ where: { operation: "accountCombine.combine" } }),
  ).toBe(0);
});

it("serializes two confirmations so the same preview executes exactly once", async () => {
  const preview = await previewCombine(db, pair());
  const input = {
    ...pair(),
    fingerprint: preview.fingerprint,
    confirmPassword: password,
  };
  const results = await Promise.allSettled([
    combineAccounts(db, headId, input),
    combineAccounts(db, headId, input),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    await db.auditLog.count({ where: { operation: "accountCombine.combine" } }),
  ).toBe(1);
});

it("waits for an in-flight profile writer without lock inversion and rejects its stale preview", async () => {
  const preview = await previewCombine(db, pair());
  let releaseWriter!: () => void;
  let signalLocked!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });
  const locked = new Promise<void>((resolve) => {
    signalLocked = resolve;
  });
  const writer = db.$transaction(
    async (tx) => {
      await lockAccountProfile(tx, duplicateId);
      signalLocked();
      await release;
      await tx.user.update({
        where: { id: duplicateId },
        data: { name: "Changed during review" },
      });
    },
    { timeout: 5000 },
  );
  await locked;
  const merging = combineAccounts(db, headId, {
    ...pair(),
    fingerprint: preview.fingerprint,
    confirmPassword: password,
  });
  // Observe the real database wait, rather than assume scheduling from a fixed sleep.
  let observed = false;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await db.$queryRaw<
        { waiting: boolean }[]
      >`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) AS waiting`;
      if (rows[0]?.waiting) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    releaseWriter();
  }
  await writer;
  await expect(merging).rejects.toMatchObject({ code: "CONFLICT" });
  expect(observed).toBe(true);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: duplicateId } }))
      .mergedIntoId,
  ).toBeNull();
});

it("retains academic evidence and exposes only the verified merge family's private history", async () => {
  await db.academicProfile.create({
    data: { userId: duplicateId, status: "REPORTED", gradeLevel: 10 },
  });
  const evidence = await db.academicConfirmation.create({
    data: {
      userId: duplicateId,
      status: "REPORTED",
      gradeLevel: 10,
      source: "SELF_SERVICE",
      actorId: duplicateId,
    },
  });
  const outsider = await db.user.create({
    data: { email: "outsider190@example.test", role: "STUDENT" },
  });
  const privateMessage = await db.directMessage.create({
    data: {
      senderId: headId,
      recipientId: duplicateId,
      body: "Private merge history",
      clientKey: "private",
    },
  });
  await combine();
  expect(
    await db.academicConfirmation.findUnique({ where: { id: evidence.id } }),
  ).toEqual(evidence);
  expect(await caller(survivorId, "STUDENT").account.academicHistory()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: evidence.id })]),
  );
  expect(await caller(outsider.id, "STUDENT").messaging.inbox()).toEqual([]);
  await caller(outsider.id, "STUDENT").messaging.markRead({
    id: privateMessage.id,
  });
  expect(
    (
      await db.directMessage.findUniqueOrThrow({
        where: { id: privateMessage.id },
      })
    ).readAt,
  ).toBeNull();
});
