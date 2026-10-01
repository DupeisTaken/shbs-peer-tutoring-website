import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
const mail = vi.hoisted(() => ({
  send: vi.fn(),
  available: vi.fn(() => true),
}));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mail.send },
  isEmailDeliveryAvailable: mail.available,
}));
import { db } from "./db";
import { createCaller } from "./api/root";
import {
  startHistoryAccount,
  verifyHistoryAccount,
  completeHistoryAccount,
} from "./history-account-setup";
import { hashPassword, verifyPassword } from "./auth/password";
import { resolveTutorLink } from "./auth/tutor-link";

const email = "alumni@example.test";
const password = "History-test-password-206!";
const token = "b".repeat(64);
let actorId: string;
let sequence = 0;
const anonymous = () =>
  createCaller({ db, headers: new Headers(), session: null });
const userCaller = (id: string) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id },
      role: "STUDENT",
      tutorId: null,
      expires: "2099-01-01",
    },
  });
const staff = () =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: actorId },
      role: "ADMIN",
      tutorId: null,
      expires: "2099-01-01",
    },
  });
beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/shbs_shipping_test"
  )
    throw new Error("Requires isolated shbs_shipping_test");
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((t) => '"' + t.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  actorId = `history-manager-${sequence++}`;
  vi.stubEnv("AUTH_URL", "https://history.example.test");
  mail.send.mockReset().mockResolvedValue(undefined);
  mail.available.mockReturnValue(true);
  await db.user.create({
    data: {
      id: actorId,
      email: `${actorId}@example.test`,
      role: "ADMIN",
      name: "Manager",
      emailVerifiedAt: new Date(),
      passwordHash: hashPassword(password),
    },
  });
  await db.term.create({
    data: {
      id: "old",
      name: "Archive",
      schoolYear: "24-25",
      quarter: "Q1",
      active: false,
    },
  });
  await db.tutor.create({
    data: {
      id: "tutor",
      englishName: "Retained Tutor",
      status: "GRADUATED",
      email,
      gradeLevel: 12,
      gradeSchoolYear: "24-25",
    },
  });
  await db.pairing.create({
    data: {
      id: "pair",
      tutorId: "tutor",
      termId: "old",
      subject: "Mathematics",
      dayOfWeek: 2,
      startMin: 600,
      endMin: 630,
    },
  });
  const record = await db.tutee.create({
    data: {
      id: "past",
      englishName: "Retained Learner",
      status: "INACTIVE",
      gradeLevel: "9",
      intakeTermId: "old",
    },
  });
  await db.session.create({
    data: {
      id: "session",
      tutorId: "tutor",
      pairingId: "pair",
      date: new Date("2024-10-01"),
      startMin: 600,
      endMin: 630,
      durationMin: 30,
      shCount: 2,
      shFactor: 2,
      month: "2024-10",
      schoolYear: "24-25",
      quarter: "Q1",
      tutees: { create: { tuteeId: "past", status: "PRESENT" } },
    },
  });
  await db.tutorMeeting.create({
    data: {
      id: "meeting",
      title: "Archive meeting",
      date: new Date("2024-10-01"),
      termId: "old",
    },
  });
  await db.meetingAttendance.create({
    data: {
      id: "attendance",
      meetingId: "meeting",
      tutorId: "tutor",
      status: "PRESENT",
    },
  });
  await db.serviceHourAdjustment.create({
    data: {
      id: "extra",
      tutorId: "tutor",
      month: "2024-10",
      schoolYear: "24-25",
      quarter: "Q1",
      type: "EXTRA",
      amount: 0.5,
      reason: "Archive amendment",
    },
  });
  await db.tuteeHistoryInvitation.create({
    data: {
      tuteeId: "past",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      email,
      expectedUpdatedAt: record.updatedAt,
      issuedById: actorId,
      reason: "Reviewed school archive and identity evidence",
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => db.$disconnect());
async function evidence() {
  return {
    tutor: await db.tutor.findMany(),
    tutee: await db.tutee.findMany(),
    sessions: await db.session.findMany(),
    attendance: await db.sessionTutee.findMany(),
    meetings: await db.tutorMeeting.findMany(),
    meetingAttendance: await db.meetingAttendance.findMany(),
    adjustments: await db.serviceHourAdjustment.findMany(),
  };
}
async function verifiedSetup() {
  await startHistoryAccount(db, { token, email });
  const message = mail.send.mock.lastCall![0] as {
    presentation: { code: string };
  };
  const code = message.presentation.code;
  const { completionProof } = await verifyHistoryAccount(db, {
    token,
    email,
    code,
  });
  return { token, email, code, completionProof, password };
}

it("creates a verified neutral login then explicitly claims unchanged owned history without consent or participation", async () => {
  const before = await evidence();
  await anonymous().tuteeHistory.startAccount({ token, email });
  const code = (
    mail.send.mock.lastCall![0] as { presentation: { code: string } }
  ).presentation.code;
  const proof = await anonymous().tuteeHistory.verifyAccount({
    token,
    email,
    code,
  });
  await anonymous().tuteeHistory.completeAccount({
    token,
    email,
    password,
    ...proof,
  });
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user).toMatchObject({
    role: "STUDENT",
    tuteeMember: false,
    studentId: null,
    tutorId: null,
    tutorAccessRevoked: true,
    crewStatus: null,
    canTranslate: false,
    gradeLevel: null,
  });
  expect(user.emailVerifiedAt).toBeTruthy();
  expect(verifyPassword(password, user.passwordHash!)).toBe(true);
  expect(await db.accountEmail.findUnique({ where: { email } })).toMatchObject({
    userId: user.id,
    verifiedAt: user.emailVerifiedAt,
  });
  expect(await db.policyAcceptance.count()).toBe(0);
  expect(await db.academicProfile.count()).toBe(0);
  expect(await db.studentProfileOwnership.count()).toBe(0);
  expect(await resolveTutorLink(db, user.id, email)).toBeNull();
  const alumni = userCaller(user.id);
  await alumni.tuteeHistory.claim({ token });
  expect(
    await alumni.tuteeHistory.myDetails({ tuteeId: "past" }),
  ).toMatchObject({ count: 1, record: { gradeLevel: "9" } });
  await expect(alumni.admin.tutees()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(alumni.student.me()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(alumni.tutor.mySessions()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    alumni.tuteeHistory.myDetails({ tuteeId: "someone-else" }),
  ).rejects.toThrow("HISTORY_NOT_FOUND");
  expect(await evidence()).toEqual(before);
});

it("does not expose a name or create any account for a wrong recipient or invalid token", async () => {
  await expect(
    anonymous().tuteeHistory.startAccount({
      token,
      email: "wrong@example.test",
    }),
  ).rejects.toThrow("HISTORY_EMAIL_MISMATCH");
  await expect(
    startHistoryAccount(db, { token: "a".repeat(64), email }),
  ).rejects.toThrow("HISTORY_INVITATION_INVALID");
  expect(mail.send).not.toHaveBeenCalled();
  expect(await db.user.count()).toBe(1);
});

it.each(["primary", "secondary", "retired"])(
  "rejects existing %s email ownership without resetting credentials",
  async (kind) => {
    const user = await db.user.create({
      data: {
        email: kind === "secondary" ? "primary@example.test" : email,
        passwordHash: hashPassword(password),
        role: "STUDENT",
      },
    });
    if (kind === "secondary")
      await db.accountEmail.create({
        data: { email, userId: user.id, verifiedAt: new Date() },
      });
    if (kind === "retired")
      await db.user.update({
        where: { id: user.id },
        data: { mergedIntoId: actorId },
      });
    const before = await db.user.findMany();
    await expect(startHistoryAccount(db, { token, email })).rejects.toThrow(
      "HISTORY_EMAIL_TAKEN",
    );
    expect(await db.user.findMany()).toEqual(before);
  },
);

it("rechecks a competing email claim at completion and leaves the invite retryable", async () => {
  const input = await verifiedSetup();
  await db.user.create({ data: { email, role: "STUDENT" } });
  await expect(completeHistoryAccount(db, input)).rejects.toThrow(
    "HISTORY_EMAIL_TAKEN",
  );
  expect(await db.user.count()).toBe(2);
  expect(await db.studentProfileOwnership.count()).toBe(0);
});

it("serializes concurrent completions and retries without replacing the first password", async () => {
  const input = await verifiedSetup();
  await Promise.all([
    completeHistoryAccount(db, input),
    completeHistoryAccount(db, input),
  ]);
  await completeHistoryAccount(db, {
    ...input,
    password: "Different-password-206!",
  });
  expect(await db.user.count()).toBe(2);
  expect(
    await db.auditLog.count({
      where: { operation: "tuteeHistory.completeAccount" },
    }),
  ).toBe(1);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(verifyPassword(password, user.passwordHash!)).toBe(true);
});

it("lets the shared database email registry arbitrate a competing account writer", async () => {
  const input = await verifiedSetup();
  const results = await Promise.allSettled([
    completeHistoryAccount(db, input),
    db.user.create({
      data: { email, role: "STUDENT", name: "Competing account" },
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(await db.user.count({ where: { email } })).toBe(1);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(await db.accountEmail.findUnique({ where: { email } })).toMatchObject({
    userId: user.id,
  });
  expect(await db.studentProfileOwnership.count()).toBe(0);
});

it("persists wrong-code attempts and requires a fresh challenge after six failures", async () => {
  await startHistoryAccount(db, { token, email });
  const code = (
    mail.send.mock.lastCall![0] as { presentation: { code: string } }
  ).presentation.code;
  for (let n = 0; n < 6; n++)
    await expect(
      verifyHistoryAccount(db, { token, email, code: "WRONG" }),
    ).rejects.toThrow("HISTORY_CODE_MISMATCH");
  await expect(
    verifyHistoryAccount(db, { token, email, code }),
  ).rejects.toThrow("HISTORY_CODE_ATTEMPTS");
  expect(
    (
      await db.tuteeHistoryInvitation.findUniqueOrThrow({
        where: { tuteeId: "past" },
      })
    ).setupAttempts,
  ).toBe(6);
});

it("cancels outstanding claims after setup without deleting credentials, and permits an idempotent cancellation retry", async () => {
  const input = await verifiedSetup();
  await completeHistoryAccount(db, input);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const status = await staff().tuteeHistory.invitationStatus({
    tuteeId: "past",
  });
  const cancellation = { tuteeId: "past", revision: status!.revision };
  expect(await staff().tuteeHistory.cancelInvitation(cancellation)).toEqual({
    cancelled: true,
  });
  expect(await staff().tuteeHistory.cancelInvitation(cancellation)).toEqual({
    cancelled: false,
  });
  await expect(
    userCaller(user.id).tuteeHistory.claim({ token }),
  ).rejects.toThrow("HISTORY_INVITATION_INVALID");
  expect(await db.user.findUnique({ where: { id: user.id } })).toEqual(user);
  expect(await db.studentProfileOwnership.count()).toBe(0);
});

it.each([
  "expiry",
  "codeExpiry",
  "cancel",
  "demotion",
  "ownership",
  "recordEdit",
])("fails closed at completion after %s", async (change) => {
  const input = await verifiedSetup();
  if (change === "expiry")
    await db.tuteeHistoryInvitation.update({
      where: { tuteeId: "past" },
      data: { expiresAt: new Date(0) },
    });
  if (change === "codeExpiry")
    await db.tuteeHistoryInvitation.update({
      where: { tuteeId: "past" },
      data: { setupCodeExpiresAt: new Date(0) },
    });
  if (change === "cancel") {
    const status = await staff().tuteeHistory.invitationStatus({
      tuteeId: "past",
    });
    await staff().tuteeHistory.cancelInvitation({
      tuteeId: "past",
      revision: status!.revision,
    });
  }
  if (change === "demotion")
    await db.user.update({ where: { id: actorId }, data: { role: "STUDENT" } });
  if (change === "ownership")
    await db.studentProfileOwnership.create({
      data: { tuteeId: "past", userId: actorId },
    });
  if (change === "recordEdit")
    await db.tutee.update({
      where: { id: "past" },
      data: { englishName: "Corrected archive label" },
    });
  await expect(completeHistoryAccount(db, input)).rejects.toThrow();
  expect(await db.user.count()).toBe(1);
});

it("rejects forged proofs, protects replacement invitations from stale cancellation, and limits cancellation to staff", async () => {
  const input = await verifiedSetup();
  await expect(
    completeHistoryAccount(db, { ...input, completionProof: "0".repeat(64) }),
  ).rejects.toThrow("HISTORY_CODE_EXPIRED");
  const status = await staff().tuteeHistory.invitationStatus({
    tuteeId: "past",
  });
  await db.tuteeHistoryInvitation.update({
    where: { tuteeId: "past" },
    data: { tokenHash: "c".repeat(64) },
  });
  await expect(
    staff().tuteeHistory.cancelInvitation({
      tuteeId: "past",
      revision: status!.revision,
    }),
  ).rejects.toThrow("HISTORY_STALE");
  await expect(
    userCaller("missing").tuteeHistory.cancelInvitation({
      tuteeId: "past",
      revision: status!.revision,
    }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(await db.tuteeHistoryInvitation.count()).toBe(1);
});

it("preserves a previous challenge after failed mail, and invalidates old proofs on successful resend", async () => {
  const input = await verifiedSetup();
  await expect(startHistoryAccount(db, input)).rejects.toThrow(
    "HISTORY_RATE_LIMIT",
  );
  await db.tuteeHistoryInvitation.update({
    where: { tuteeId: "past" },
    data: { setupCodeExpiresAt: new Date(Date.now() + 13 * 60000) },
  });
  mail.send.mockRejectedValueOnce(new Error("SMTP unavailable"));
  await expect(startHistoryAccount(db, input)).rejects.toThrow(
    "SMTP unavailable",
  );
  expect((await verifyHistoryAccount(db, input)).completionProof).toBe(
    input.completionProof,
  );
  await startHistoryAccount(db, input);
  await expect(completeHistoryAccount(db, input)).rejects.toThrow(
    "HISTORY_CODE_EXPIRED",
  );
});

it("reads retained tutor evidence with revoked participation while preserving departure and event rows", async () => {
  const user = await db.user.create({
    data: {
      email: "owner@example.test",
      role: "STUDENT",
      tutorId: "tutor",
      tutorAccessRevoked: true,
    },
  });
  const departure = await db.schoolDeparture.create({
    data: {
      userId: user.id,
      reason: "TRANSFERRED",
      source: "HEAD",
      observerRevoked: true,
    },
  });
  const before = await evidence();
  const alumni = userCaller(user.id);
  expect(await alumni.tuteeHistory.myTutorRecords()).toHaveLength(1);
  const details = await alumni.tuteeHistory.myTutorDetails({
    tutorId: "tutor",
  });
  expect(details.sessions[0]?.shCount).toBe(2);
  expect(details.meetings).toHaveLength(1);
  expect(details.amendments[0]?.amount).toBe(0.5);
  await expect(
    userCaller(actorId).tuteeHistory.myTutorDetails({ tutorId: "tutor" }),
  ).rejects.toThrow("HISTORY_NOT_FOUND");
  await expect(alumni.admin.tutees()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(
    await db.schoolDeparture.findUnique({ where: { userId: user.id } }),
  ).toEqual(departure);
  expect(await evidence()).toEqual(before);
});

it("rolls back credentials and email ownership when the audit write fails, leaving the proof retryable", async () => {
  const input = await verifiedSetup();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_history206_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation = 'tuteeHistory.completeAccount' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER fail_history206_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_history206_audit()',
  );
  try {
    await expect(completeHistoryAccount(db, input)).rejects.toThrow();
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    expect(await db.accountEmail.findUnique({ where: { email } })).toBeNull();
    expect(
      (
        await db.tuteeHistoryInvitation.findUniqueOrThrow({
          where: { tuteeId: "past" },
        })
      ).setupUserId,
    ).toBeNull();
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER fail_history206_audit ON "AuditLog"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION fail_history206_audit()");
  }
  await expect(completeHistoryAccount(db, input)).resolves.toEqual({
    ok: true,
  });
});
