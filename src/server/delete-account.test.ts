import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { EmailMessage } from "./email/sender";
import { createHash } from "node:crypto";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
const mail = vi.hoisted(() => ({
  send: vi.fn<(message: EmailMessage) => Promise<void>>(),
}));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mail.send },
  isEmailDeliveryAvailable: () => true,
  isEmailConfigured: () => true,
}));
import { db } from "./db";
import { deleteAccount, previewDeleteAccount } from "./delete-account";
import { createCaller } from "./api/root";
import { hashPassword } from "./auth/password";
import { isSessionCurrent } from "./auth/session-version";
import { verifySigninPassword } from "./auth/credentials";
import { lockUsernameNamespace } from "./auth/username";
import { lockEntity } from "./transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { verifiedStaffInvitation } from "~/test/account-invitation-fixture";
import {
  inspectAccountInvitation,
  consumeInvitationLogin,
} from "./auth/account-invitations";
import { resetPassword } from "./auth/password-reset";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const password = "Delete-account-375!";
let headId: string;
let targetId: string;
const caller = (id = headId, role: Session["role"] = "HEAD") =>
  createCaller({
    db,
    headers: new Headers(),
    session: { user: { id }, role, tutorId: null, expires: "2099-01-01" },
  });
const input = async (userId = targetId) => ({
  userId,
  confirmPassword: password,
  fingerprint: (await previewDeleteAccount(db, headId, userId)).fingerprint,
});

beforeEach(async () => {
  mail.send.mockReset().mockResolvedValue(undefined);
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((row) => '"' + row.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  headId = (
    await db.user.create({
      data: {
        email: "head375@example.test",
        role: "HEAD",
        passwordHash: hashPassword(password),
        emailVerifiedAt: new Date(),
        username: "head375",
      },
    })
  ).id;
  targetId = (
    await db.user.create({
      data: {
        name: "Casey Brook",
        email: "casey375@example.test",
        role: "STUDENT",
        username: "casey375",
        passwordHash: hashPassword(password),
        emailVerifiedAt: new Date(),
      },
    })
  ).id;
});
afterAll(() => db.$disconnect());

it.each([
  "ADMIN",
  "COORDINATOR",
  "STUDENT",
  "TUTOR",
  "CREW",
  "VIEWER",
] as const)(
  "denies %s preview and deletion even with a stale Head claim",
  async (role) => {
    await db.user.update({ where: { id: targetId }, data: { role } });
    await expect(
      caller(targetId).admin.previewDeleteUser({ userId: headId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(targetId).admin.deleteUser(await input()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await db.user.findUnique({ where: { id: targetId } }),
    ).not.toBeNull();
  },
);

it.each([false, true])(
  "deletes a zero-signup login with unfinished credentials=%s and invalidates credentials and action tickets",
  async (unfinished) => {
    if (unfinished)
      await db.user.update({
        where: { id: targetId },
        data: {
          passwordHash: null,
          emailVerifiedAt: null,
          mustChangePassword: true,
        },
      });
    const user = await db.user.findUniqueOrThrow({ where: { id: targetId } });
    await db.passwordResetToken.create({
      data: {
        userId: targetId,
        targetEmail: user.email,
        tokenHash: createHash("sha256").update("reset375").digest("hex"),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await db.emailVerificationCode.create({
      data: {
        userId: targetId,
        codeHash: "code375",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await db.studentActionConfirmation.create({
      data: {
        userId: targetId,
        action: "TEST",
        target: "TEST",
        readyAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const preview = await caller().admin.previewDeleteUser({
      userId: targetId,
    });
    expect(preview.blockers).toEqual([]);
    expect(preview.removed).toMatchObject({ credentials: 3, emails: 1 });
    expect(JSON.stringify(preview)).not.toContain("passwordHash");
    await caller().admin.deleteUser(await input());
    expect(await db.user.findUnique({ where: { id: targetId } })).toBeNull();
    expect(
      await isSessionCurrent(db, {
        sub: targetId,
        sessionVersion: user.sessionVersion,
      }),
    ).toBe(false);
    expect(
      await db.passwordResetToken.count({ where: { userId: targetId } }),
    ).toBe(0);
    expect(
      await db.emailVerificationCode.count({ where: { userId: targetId } }),
    ).toBe(0);
    expect(
      await db.studentActionConfirmation.count({ where: { userId: targetId } }),
    ).toBe(0);
    expect(await resetPassword("reset375", "Replacement375!")).toBeNull();
    expect(
      await verifySigninPassword(
        "casey375@example.test",
        password,
        "delete375",
      ),
    ).toMatchObject({ ok: false });
    expect(
      await db.auditLog.findFirst({
        where: { operation: "admin.deleteUser", entityId: targetId },
      }),
    ).toMatchObject({ userId: headId });
  },
);

it("rejects the previously verified invitation proof and login exchange after deletion", async () => {
  const invitation = await verifiedStaffInvitation(
    db,
    headId,
    "casey375@example.test",
    () => mail.send.mock.calls.at(-1)![0].presentation!.code!,
  );
  expect(await inspectAccountInvitation(db, invitation)).toBeTruthy();
  await caller().admin.deleteUser(await input());
  await expect(inspectAccountInvitation(db, invitation)).rejects.toThrow();
  await expect(
    consumeInvitationLogin(invitation.invitationId, invitation.proof),
  ).rejects.toThrow();
  expect(await db.user.findUnique({ where: { id: targetId } })).toBeNull();
});

it("names leadership, combined identity and explicit retained ownership blockers", async () => {
  expect((await previewDeleteAccount(db, headId, headId)).blockers).toEqual([
    "self",
    "head",
  ]);
  await expect(
    caller().admin.deleteUser(await input(headId)),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const tutor = await db.tutor.create({
    data: { englishName: "Retained Tutor", status: "ARCHIVED" },
  });
  const student = await db.tutee.create({
    data: { englishName: "Retained Tutee", status: "INACTIVE" },
  });
  await db.tutorProfileOwnership.create({
    data: { tutorId: tutor.id, userId: targetId },
  });
  await db.studentProfileOwnership.create({
    data: { tuteeId: student.id, userId: targetId },
  });
  const preview = await previewDeleteAccount(db, headId, targetId);
  expect(preview.blockers).toEqual(["tutorHistory", "studentHistory"]);
  await expect(caller().admin.deleteUser(await input())).rejects.toThrow(
    /Retained.*history|Retained.*ownership/,
  );
  expect(
    await db.studentProfileOwnership.findUnique({
      where: { tuteeId: student.id },
    }),
  ).toMatchObject({ userId: targetId });
  await db.tutorProfileOwnership.deleteMany();
  await db.studentProfileOwnership.deleteMany();
  await db.user.create({
    data: { email: "retired375@example.test", mergedIntoId: targetId },
  });
  expect((await previewDeleteAccount(db, headId, targetId)).blockers).toEqual([
    "combined",
  ]);
  await expect(caller().admin.deleteUser(await input())).rejects.toThrow(
    /Combined account history/,
  );
});

it("refuses retained tutee ownership without relying on an absent foreign key", async () => {
  const student = await db.tutee.create({
    data: { englishName: "Archived Tutee", status: "INACTIVE" },
  });
  await db.studentProfileOwnership.create({
    data: { tuteeId: student.id, userId: targetId },
  });
  await expect(caller().admin.deleteUser(await input())).rejects.toThrow(
    /Retained tutee ownership/,
  );
  expect(await db.user.findUnique({ where: { id: targetId } })).not.toBeNull();
});

it("preserves roster and scalar evidence, with explicit cascade consequences", async () => {
  const tutor = await db.tutor.create({
    data: { englishName: "Casey Brook", status: "ACTIVE" },
  });
  await db.user.update({
    where: { id: targetId },
    data: { tutorId: tutor.id, crewStatus: "ACTIVE" },
  });
  const message = await db.directMessage.create({
    data: {
      senderId: headId,
      recipientId: targetId,
      clientKey: "retained375",
      body: "Original evidence",
    },
  });
  const policy = await db.policyAcceptance.create({
    data: {
      userId: targetId,
      slug: "original",
      revision: "1",
      signature: "Original",
      snapshot: {},
    },
  });
  const audit = await db.auditLog.create({
    data: { userId: targetId, entity: "User", action: "Original actor" },
  });
  await db.notification.create({
    data: { userId: targetId, title: "Removed notice" },
  });
  await db.academicProfile.create({ data: { userId: targetId } });
  await db.academicConfirmation.create({
    data: { userId: targetId, status: "REPORTED", source: "SELF_SERVICE" },
  });
  await db.schoolDeparture.create({
    data: { userId: targetId, source: "TEST" },
  });
  await db.schoolDepartureEvent.create({
    data: {
      userId: targetId,
      action: "CONFIRM",
      source: "TEST",
      explanation: "Original",
      revision: 1,
    },
  });
  await db.patrol.create({ data: { crewUserId: targetId, hours: 0.5 } });
  const preview = await previewDeleteAccount(db, headId, targetId);
  expect(preview.removed).toMatchObject({
    notifications: 1,
    academicProfiles: 1,
    academics: 1,
    currentDepartures: 1,
    departures: 1,
    patrols: 1,
  });
  expect(preview.retained).toMatchObject({
    tutors: 1,
    messages: 1,
    policies: 1,
    audits: 1,
  });
  await caller().admin.deleteUser(await input());
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).not.toBeNull();
  expect(
    await db.directMessage.findUnique({ where: { id: message.id } }),
  ).toEqual(message);
  expect(
    await db.policyAcceptance.findUnique({ where: { id: policy.id } }),
  ).toEqual(policy);
  expect(await db.auditLog.findUnique({ where: { id: audit.id } })).toEqual(
    audit,
  );
  expect(await db.notification.count({ where: { userId: targetId } })).toBe(0);
  expect(
    await db.academicConfirmation.count({ where: { userId: targetId } }),
  ).toBe(0);
  expect(
    await db.schoolDepartureEvent.count({ where: { userId: targetId } }),
  ).toBe(0);
  expect(await db.patrol.count({ where: { crewUserId: targetId } })).toBe(0);
});

it.each(["identity", "credentials", "dependency", "signup"])(
  "rejects a reviewed snapshot changed by %s",
  async (change) => {
    const reviewed = await input();
    if (change === "identity")
      await db.user.update({
        where: { id: targetId },
        data: { name: "Drew Vale" },
      });
    if (change === "credentials")
      await db.user.update({
        where: { id: targetId },
        data: { passwordHash: hashPassword("New375!") },
      });
    if (change === "dependency")
      await db.notification.create({
        data: { userId: targetId, title: "New dependency" },
      });
    if (change === "signup") {
      const tutee = await db.tutee.create({
        data: { englishName: "Casey Brook" },
      });
      await db.user.update({
        where: { id: targetId },
        data: { studentId: tutee.id },
      });
    }
    await expect(caller().admin.deleteUser(reviewed)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      await db.user.findUnique({ where: { id: targetId } }),
    ).not.toBeNull();
  },
);

it("blocks unconfirmed email-bound intake without inventing historical ownership", async () => {
  await db.studentSurvey.create({
    data: {
      email: "casey375@example.test",
      intakeTermId: "intake",
      payload: {},
      policyRevision: "original",
      policySnapshot: {},
      tokenHash: "intake375",
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  expect((await previewDeleteAccount(db, headId, targetId)).blockers).toEqual([
    "intake",
  ]);
  await expect(caller().admin.deleteUser(await input())).rejects.toThrow(
    /unconfirmed tutee intake/,
  );
});

it("rolls back credential cleanup, detachment and deletion when the explicit audit fails", async () => {
  const tutor = await db.tutor.create({ data: { englishName: "Casey Brook" } });
  await db.user.update({
    where: { id: targetId },
    data: { tutorId: tutor.id },
  });
  const original = await db.user.findUniqueOrThrow({ where: { id: targetId } });
  const reset = await db.passwordResetToken.create({
    data: {
      userId: targetId,
      tokenHash: "rollback-reset375",
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const code = await db.emailVerificationCode.create({
    data: {
      userId: targetId,
      codeHash: "rollback-code375",
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const ticket = await db.studentActionConfirmation.create({
    data: {
      userId: targetId,
      action: "TEST",
      target: "TEST",
      readyAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_delete375_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation = 'admin.deleteUser' AND NEW.action LIKE 'Deleted account%' THEN RAISE EXCEPTION 'delete audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER fail_delete375_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_delete375_audit()`,
  );
  try {
    await expect(caller().admin.deleteUser(await input())).rejects.toThrow(
      /audit failure/,
    );
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER fail_delete375_audit ON "AuditLog"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION fail_delete375_audit()");
  }
  expect(await db.user.findUnique({ where: { id: targetId } })).toEqual(
    original,
  );
  expect(
    await db.passwordResetToken.findUnique({ where: { id: reset.id } }),
  ).toEqual(reset);
  expect(
    await db.emailVerificationCode.findUnique({ where: { id: code.id } }),
  ).toEqual(code);
  expect(
    await db.studentActionConfirmation.findUnique({ where: { id: ticket.id } }),
  ).toEqual(ticket);
});

it("rechecks the live actor and current password when the helper is called directly", async () => {
  const reviewed = await input();
  await expect(
    deleteAccount(db, headId, { ...reviewed, confirmPassword: "wrong" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.user.update({ where: { id: headId }, data: { role: "ADMIN" } });
  await expect(deleteAccount(db, headId, reviewed)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

it("waits for concurrent signup ownership before rejecting the old deletion preview", async () => {
  const reviewed = await input();
  let release!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const signup = db.$transaction(
    async (tx) => {
      await lockUsernameNamespace(tx);
      await lockEntity(tx, `account-profile:${targetId}`);
      locked();
      await gate;
      const student = await tx.tutee.create({
        data: { englishName: "Casey Brook" },
      });
      await tx.user.update({
        where: { id: targetId },
        data: { studentId: student.id },
      });
      await tx.studentProfileOwnership.create({
        data: { tuteeId: student.id, userId: targetId },
      });
    },
    { timeout: 10000 },
  );
  await entered;
  const deleting = deleteAccount(db, headId, reviewed).then(
    () => null,
    (error: unknown) => error,
  );
  let observed = false;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await db.$queryRaw<
        { waiting: boolean }[]
      >`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting`;
      if (rows[0]?.waiting) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    release();
  }
  await signup;
  expect(await deleting).toMatchObject({ code: "CONFLICT" });
  expect(observed).toBe(true);
  expect(
    await db.studentProfileOwnership.count({ where: { userId: targetId } }),
  ).toBe(1);
  expect(await db.user.findUnique({ where: { id: targetId } })).not.toBeNull();
});

it("admits one concurrent deletion and records one explicit successful audit", async () => {
  const reviewed = await input();
  const results = await Promise.allSettled([
    deleteAccount(db, headId, reviewed),
    deleteAccount(db, headId, reviewed),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    await db.auditLog.count({
      where: {
        operation: "admin.deleteUser",
        action: { startsWith: "Deleted account" },
      },
    }),
  ).toBe(1);
});
