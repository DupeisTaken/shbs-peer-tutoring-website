import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
const mail = vi.hoisted(() => ({
  send: vi.fn(),
  available: vi.fn(() => true),
}));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mail.send },
  isEmailDeliveryAvailable: mail.available,
}));
import { createCaller } from "../root";
import { db } from "~/server/db";
import { hashPassword } from "~/server/auth/password";
import { recordCsv } from "~/lib/record-transfer";
const password = "Synthetic-Head-Password-2026!";
const caller = (id = "admin", role: Session["role"] = "ADMIN") =>
  createCaller({
    db,
    headers: new Headers(),
    session: { user: { id }, role, tutorId: null, expires: "2099-01-01" },
  });
const pair = { tuteeId: "past", userId: "student" };
const reason = "School archive and verified identity checked by staff";
const file = (name: string, rows: Record<string, unknown>[]) => ({
  name: `${name}.csv`,
  text: recordCsv(Object.keys(rows[0]!), rows),
});
const files = () => [
  file("Term", [
    {
      id: "old",
      schoolYear: "24-25",
      quarter: "Q1",
      name: "2024 Autumn",
      active: false,
    },
  ]),
  file("Tutor", [
    { id: "tutor", englishName: "Historical Tutor", status: "GRADUATED" },
  ]),
  file("Tutee", [
    {
      id: "past",
      englishName: "Historical Learner",
      gradeLevel: "9",
      status: "INACTIVE",
      intakeTermId: "old",
      updatedAt: "2024-10-01T00:00:00Z",
    },
  ]),
  file("Pairing", [
    {
      id: "pair",
      tutorId: "tutor",
      termId: "old",
      subject: "Mathematics",
      dayOfWeek: 2,
      startMin: 600,
      endMin: 630,
    },
  ]),
  file("Session", [
    {
      id: "session",
      date: "2024-10-01T00:00:00Z",
      startMin: 600,
      endMin: 630,
      durationMin: 30,
      shCount: 2,
      shFactor: 2,
      month: "2024-10",
      schoolYear: "24-25",
      quarter: "Q1",
      pairingId: "pair",
      tutorId: "tutor",
      updatedAt: "2024-10-01T00:00:00Z",
    },
  ]),
  file("SessionTutee", [
    { sessionId: "session", tuteeId: "past", status: "PRESENT" },
  ]),
  file("TutorMeeting", [
    {
      id: "meeting",
      title: "Archive meeting",
      date: "2024-10-01T00:00:00Z",
      termId: "old",
    },
  ]),
  file("MeetingAttendance", [
    {
      id: "attendance",
      meetingId: "meeting",
      tutorId: "tutor",
      status: "PRESENT",
    },
  ]),
  file("ServiceHourAdjustment", [
    {
      id: "extra",
      tutorId: "tutor",
      month: "2024-10",
      schoolYear: "24-25",
      quarter: "Q1",
      type: "EXTRA",
      amount: 0.5,
      reason: "Documented amendment",
    },
  ]),
];
beforeEach(async () => {
  // Invitations require an origin even when delivery is mocked. Never rely on a
  // developer's .env: CI intentionally starts without an application origin.
  vi.stubEnv("AUTH_URL", "https://history.example.test");
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
  mail.send.mockReset().mockResolvedValue(undefined);
  mail.available.mockReturnValue(true);
  await db.user.createMany({
    data: (
      [
        ["head", "HEAD"],
        ["admin", "ADMIN"],
        ["student", "STUDENT"],
        ["other", "STUDENT"],
        ["coord", "COORDINATOR"],
        ["viewer", "VIEWER"],
      ] as const
    ).map(([id, role]) => ({
      id,
      role,
      email: `${id}@example.test`,
      name: id,
      username: id,
      emailVerifiedAt: new Date(),
      passwordHash: hashPassword(password),
    })),
  });
  await db.term.create({
    data: {
      id: "now",
      name: "2026 Autumn",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  const input = files();
  const preview = await caller("head", "HEAD").recordTransfer.preview({
    files: input,
  });
  await caller("head", "HEAD").recordTransfer.import({
    files: input,
    ticket: preview.ticket,
  });
});
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllEnvs());
const link = async (id = "admin", userId = "student") => {
  const input = { tuteeId: "past", userId };
  const preview = await caller(id).tuteeHistory.preview(input);
  return caller(id).tuteeHistory.link({
    ...input,
    fingerprint: preview.fingerprint,
    reason,
  });
};
const events = async () => ({
  sessions: await db.session.findMany(),
  attendance: await db.sessionTutee.findMany(),
  meetings: await db.tutorMeeting.findMany(),
  meetingAttendance: await db.meetingAttendance.findMany(),
  adjustments: await db.serviceHourAdjustment.findMany(),
});
const invite = async (email = "student@example.test") => {
  const record = await db.tutee.findUniqueOrThrow({ where: { id: "past" } });
  await caller().tuteeHistory.invite({
    tuteeId: "past",
    email,
    expectedUpdatedAt: record.updatedAt,
    reason,
  });
  const message = mail.send.mock.lastCall![0] as { text: string };
  const text = message.text;
  return /token=([a-f0-9]{64})/.exec(text)![1]!;
};
it("imports all historical record families without participant logins and preserves them through linking and reimport", async () => {
  expect(await db.user.count()).toBe(6);
  expect(
    await db.tutor.findUnique({
      where: { id: "tutor" },
      include: { user: true },
    }),
  ).toMatchObject({ user: null });
  const before = await events();
  const account = await db.user.findUnique({ where: { id: "student" } });
  const preview = await caller().tuteeHistory.preview(pair);
  expect(preview.record.sessions).toBe(1);
  expect(await db.studentProfileOwnership.count()).toBe(0);
  await caller().tuteeHistory.link({
    ...pair,
    fingerprint: preview.fingerprint,
    reason,
  });
  expect(await events()).toEqual(before);
  expect(await db.user.findUnique({ where: { id: "student" } })).toEqual(
    account,
  );
  expect(
    await db.studentProfileOwnership.findUnique({ where: { tuteeId: "past" } }),
  ).toMatchObject({ userId: "student" });
  expect(
    await caller("student", "STUDENT").tuteeHistory.myRecords(),
  ).toHaveLength(1);
  expect(
    await caller("student", "STUDENT").tuteeHistory.myDetails({
      tuteeId: "past",
    }),
  ).toMatchObject({ record: { gradeLevel: "9" }, count: 1 });
  const input = files();
  const repeat = await caller("head", "HEAD").recordTransfer.preview({
    files: input,
  });
  await caller("head", "HEAD").recordTransfer.import({
    files: input,
    ticket: repeat.ticket,
  });
  expect(await events()).toEqual(before);
  expect(await db.user.count()).toBe(6);
  const roster = await caller().admin.tutees();
  expect(roster.find((row) => row.id === "past")).toMatchObject({
    id: "past",
    historical: true,
    enrollmentPeriod: { schoolYear: "24-25", quarter: "Q1" },
    user: null,
    owner: { id: "student" },
  });
});
it("rejects stale previews, active enrollment, unverified and suspended targets", async () => {
  const preview = await caller().tuteeHistory.preview(pair);
  await db.tutee.update({
    where: { id: "past" },
    data: { englishName: "Corrected name" },
  });
  await expect(
    caller().tuteeHistory.link({
      ...pair,
      fingerprint: preview.fingerprint,
      reason,
    }),
  ).rejects.toThrow("HISTORY_STALE");
  await db.tutee.update({
    where: { id: "past" },
    data: { status: "ACTIVE", intakeTermId: "now" },
  });
  await expect(caller().tuteeHistory.preview(pair)).rejects.toThrow(
    "HISTORY_NOT_HISTORICAL",
  );
  await db.tutee.update({
    where: { id: "past" },
    data: { status: "INACTIVE" },
  });
  for (const data of [
    { emailVerifiedAt: null },
    { emailVerifiedAt: new Date(), suspendedAt: new Date() },
    { suspendedAt: null, mustChangePassword: true },
  ]) {
    await db.user.update({ where: { id: "student" }, data });
    await expect(caller().tuteeHistory.preview(pair)).rejects.toThrow(
      "HISTORY_ACCOUNT_NOT_READY",
    );
  }
  expect(await db.studentProfileOwnership.count()).toBe(0);
});
it("requires Head password for retained ownership conflicts and routes current account conflicts to Merge", async () => {
  await link();
  const input = { tuteeId: "past", userId: "other" };
  const preview = await caller().tuteeHistory.preview(input);
  await expect(
    caller().tuteeHistory.link({
      ...input,
      fingerprint: preview.fingerprint,
      reason,
    }),
  ).rejects.toThrow("HISTORY_HEAD_REQUIRED");
  await expect(
    caller("head", "HEAD").tuteeHistory.link({
      ...input,
      fingerprint: preview.fingerprint,
      reason,
      confirmPassword: "wrong",
    }),
  ).rejects.toThrow("password");
  await caller("head", "HEAD").tuteeHistory.link({
    ...input,
    fingerprint: preview.fingerprint,
    reason,
    confirmPassword: password,
  });
  expect(
    await caller("student", "STUDENT").tuteeHistory.myRecords(),
  ).toHaveLength(0);
  await db.user.update({ where: { id: "other" }, data: { studentId: "past" } });
  const current = await caller().tuteeHistory.preview(pair);
  await expect(
    caller("head", "HEAD").tuteeHistory.link({
      ...pair,
      fingerprint: current.fingerprint,
      reason,
      confirmPassword: password,
    }),
  ).rejects.toThrow("HISTORY_USE_MERGE");
});
it.each([
  ["coord", "COORDINATOR"],
  ["viewer", "VIEWER"],
  ["student", "STUDENT"],
] as const)("denies ownership writes to %s", async (id, role) => {
  await expect(
    caller(id, role).tuteeHistory.preview(pair),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller(id, role).tuteeHistory.link({
      ...pair,
      fingerprint: "0".repeat(64),
      reason,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("scopes personal history to its owner and rechecks demoted managers", async () => {
  await link();
  await expect(
    caller("other", "STUDENT").tuteeHistory.myDetails({ tuteeId: "past" }),
  ).rejects.toThrow("HISTORY_NOT_FOUND");
  await expect(
    caller("viewer", "VIEWER").tuteeHistory.details({ tuteeId: "past" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.user.update({ where: { id: "admin" }, data: { role: "STUDENT" } });
  await expect(caller().tuteeHistory.preview(pair)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("makes invitation inspection read-only, binds verified email, consumes once and excludes secrets from exports", async () => {
  const token = await invite();
  expect(await db.user.count()).toBe(6);
  expect(
    await caller("student", "STUDENT").tuteeHistory.inspectClaim({ token }),
  ).toMatchObject({ name: "Historical Learner", sessions: 1 });
  expect(await db.studentProfileOwnership.count()).toBe(0);
  await expect(
    caller("other", "STUDENT").tuteeHistory.claim({ token }),
  ).rejects.toThrow("HISTORY_EMAIL_MISMATCH");
  const exported = await caller("head", "HEAD").recordTransfer.export({});
  const row = await db.tuteeHistoryInvitation.findUniqueOrThrow({
    where: { tuteeId: "past" },
  });
  expect(JSON.stringify(exported)).not.toContain(row.tokenHash);
  const before = await events();
  await caller("student", "STUDENT").tuteeHistory.claim({ token });
  expect(await events()).toEqual(before);
  await expect(
    caller("student", "STUDENT").tuteeHistory.claim({ token }),
  ).rejects.toThrow("HISTORY_INVITATION_INVALID");
});
it("keeps the old invitation usable if replacement delivery fails", async () => {
  const token = await invite();
  mail.send.mockRejectedValueOnce(new Error("SMTP offline"));
  await expect(invite()).rejects.toThrow("SMTP offline");
  await expect(
    caller("student", "STUDENT").tuteeHistory.inspectClaim({ token }),
  ).resolves.toMatchObject({ name: "Historical Learner" });
});
it("rejects missing email configuration without issuing an invitation", async () => {
  vi.stubEnv("AUTH_URL", "");
  await expect(invite()).rejects.toThrow("HISTORY_EMAIL_UNAVAILABLE");
  vi.stubEnv("AUTH_URL", "https://history.example.test");
  mail.available.mockReturnValue(false);
  await expect(invite()).rejects.toThrow("HISTORY_EMAIL_UNAVAILABLE");
  expect(await db.tuteeHistoryInvitation.count()).toBe(0);
  expect(mail.send).not.toHaveBeenCalled();
});
it("revokes changed, expired and demoted-issuer invitations", async () => {
  const token = await invite();
  await db.tuteeHistoryInvitation.update({
    where: { tuteeId: "past" },
    data: { expiresAt: new Date(0) },
  });
  await expect(
    caller("student", "STUDENT").tuteeHistory.claim({ token }),
  ).rejects.toThrow("HISTORY_INVITATION_INVALID");
  const fresh = await invite();
  await db.tutee.update({
    where: { id: "past" },
    data: { englishName: "Changed record" },
  });
  await expect(
    caller("student", "STUDENT").tuteeHistory.claim({ token: fresh }),
  ).rejects.toThrow("HISTORY_STALE");
  const latest = await invite();
  await db.user.update({ where: { id: "admin" }, data: { role: "STUDENT" } });
  await expect(
    caller("student", "STUDENT").tuteeHistory.claim({ token: latest }),
  ).rejects.toThrow("HISTORY_MANAGER_REQUIRED");
});
it("accepts verified secondary email but never an unverified address", async () => {
  const token = await invite("secondary@example.test");
  await db.accountEmail.create({
    data: { userId: "student", email: "secondary@example.test" },
  });
  await expect(
    caller("student", "STUDENT").tuteeHistory.claim({ token }),
  ).rejects.toThrow("HISTORY_EMAIL_MISMATCH");
  await db.accountEmail.update({
    where: { email: "secondary@example.test" },
    data: { verifiedAt: new Date() },
  });
  await caller("student", "STUDENT").tuteeHistory.claim({ token });
  expect(await db.studentProfileOwnership.count()).toBe(1);
});

// Linking retained evidence must remain possible for departed people without
// restoring current participation or independently revoked observer access.
it.each(["GRADUATED", "TRANSFERRED"])(
  "preserves %s restrictions through staff linking and personal reading",
  async (departureReason) => {
    const departure = await db.schoolDeparture.create({
      data: {
        userId: "student",
        reason: departureReason,
        source: "HEAD",
        observerRevoked: true,
        effectiveAt: new Date("2025-06-01"),
      },
    });
    const before = await events();
    const account = await db.user.findUniqueOrThrow({
      where: { id: "student" },
    });
    await link();
    expect(
      await db.schoolDeparture.findUnique({ where: { userId: "student" } }),
    ).toEqual(departure);
    expect(
      await db.user.findUniqueOrThrow({ where: { id: "student" } }),
    ).toEqual(account);
    expect(await events()).toEqual(before);
    expect(
      await caller("student", "STUDENT").tuteeHistory.myDetails({
        tuteeId: "past",
      }),
    ).toMatchObject({ count: 1 });
    await expect(caller("student", "STUDENT").admin.tutees()).rejects.toThrow(
      "Admin access required",
    );
  },
);

it("allows a departed participant to claim their invitation without restoring observer access", async () => {
  const departure = await db.schoolDeparture.create({
    data: {
      userId: "student",
      reason: "TRANSFERRED",
      source: "HEAD",
      observerRevoked: true,
    },
  });
  const token = await invite();
  await caller("student", "STUDENT").tuteeHistory.claim({ token });
  expect(
    await db.schoolDeparture.findUnique({ where: { userId: "student" } }),
  ).toEqual(departure);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: "student" } }),
  ).toMatchObject({ studentId: null, tuteeMember: false });
  expect(
    await caller("student", "STUDENT").tuteeHistory.myRecords(),
  ).toHaveLength(1);
});
