import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "./db";
import { createCaller } from "./api/root";
import { hashPassword } from "./auth/password";
import { previewTutorHistory, linkTutorHistory } from "./tutor-history";
import { previewPersonCombine } from "./person-combine";
import { reviewedLoginRetirement } from "~/test/person-combine-fixture";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const password = "Historical-tutor-review-265!";
const hash = hashPassword(password);
const reason =
  "Staff checked original archive and verified the participant identity";
const pair = { tutorId: "archive", userId: "owner" };
const caller = (id = "head", role: Session["role"] = "HEAD") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id },
      role,
      tutorId: null,
      expires: new Date(Date.now() + 60000).toISOString(),
    },
  });
const input = async (userId = "owner", tutorId = "archive") => ({
  userId,
  tutorId,
  fingerprint: (await previewTutorHistory(db, { userId, tutorId })).fingerprint,
  reason,
  acknowledged: true as const,
});
beforeEach(async () => {
  // This suite owns only the disposable test database, never a running demo.
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
  await db.user.createMany({
    data: (
      [
        ["head", "HEAD"],
        ["admin", "ADMIN"],
        ["coord", "COORDINATOR"],
        ["viewer", "VIEWER"],
        ["owner", "STUDENT"],
        ["other", "STUDENT"],
      ] as const
    ).map(([id, role]) => ({
      id,
      role,
      name: id,
      email: `${id}@example.test`,
      username: id,
      passwordHash: hash,
      emailVerifiedAt: new Date(),
    })),
  });
  await db.tutor.createMany({
    data: [
      {
        id: "archive",
        englishName: "Original Archive Name",
        status: "ARCHIVED",
        gradeLevel: 9,
      },
      {
        id: "past",
        englishName: "Other Historical Identity",
        status: "GRADUATED",
      },
      { id: "current", englishName: "Current Tutor", status: "ACTIVE" },
    ],
  });
  await db.term.create({
    data: {
      id: "old",
      name: "Old term",
      schoolYear: "24-25",
      quarter: "Q1",
      active: false,
    },
  });
  await db.pairing.create({
    data: {
      id: "pair",
      tutorId: "archive",
      termId: "old",
      subject: "Mathematics",
      dayOfWeek: 2,
      startMin: 600,
      endMin: 630,
    },
  });
  await db.session.create({
    data: {
      id: "session",
      tutorId: "archive",
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
    },
  });
  await db.tutorMeeting.create({
    data: {
      id: "meeting",
      title: "Archive Meeting",
      date: new Date("2024-10-01"),
      termId: "old",
    },
  });
  await db.meetingAttendance.create({
    data: {
      id: "attendance",
      tutorId: "archive",
      meetingId: "meeting",
      status: "PRESENT",
    },
  });
  await db.serviceHourAdjustment.create({
    data: {
      id: "extra",
      tutorId: "archive",
      month: "2024-10",
      schoolYear: "24-25",
      quarter: "Q1",
      type: "EXTRA",
      amount: 0.5,
      reason: "Original amendment",
    },
  });
});
afterAll(() => db.$disconnect());
const evidence = async () => ({
  tutor: await db.tutor.findUnique({ where: { id: "archive" } }),
  session: await db.session.findMany(),
  meeting: await db.meetingAttendance.findMany(),
  amendment: await db.serviceHourAdjustment.findMany(),
});

it("summarizes original stored tutoring evidence once per owned record, even with overlapping ownership paths", async () => {
  await caller().tutorHistory.link(await input());
  await db.user.update({
    where: { id: "owner" },
    data: { tutorId: "archive" },
  });
  await db.tutor.update({
    where: { id: "past" },
    data: { englishName: "Original Archive Name" },
  });
  await caller().tutorHistory.link(await input("owner", "past"));
  const before = await evidence();
  const rows = await caller("owner", "STUDENT").tuteeHistory.myTutorRecords();
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.id === "archive")).toMatchObject({
    sessionCount: 1,
    meetingCount: 1,
    amendmentCount: 1,
    storedSessionHours: 2,
    periods: ["24-25 Q1"],
    firstSessionDate: new Date("2024-10-01"),
    lastSessionDate: new Date("2024-10-01"),
  });
  expect(rows.find((row) => row.id === "past")).toMatchObject({
    sessionCount: 0,
    meetingCount: 0,
    amendmentCount: 0,
    storedSessionHours: 0,
    periods: [],
    firstSessionDate: null,
    lastSessionDate: null,
  });
  // Stored credit is two hours despite a thirty-minute duration; reads preserve it.
  expect(await evidence()).toEqual(before);
});

it("pages sessions independently without skipping meeting or adjustment evidence", async () => {
  await caller().tutorHistory.link(await input());
  await db.session.createMany({
    data: Array.from({ length: 50 }, (_, index) => {
      const date = new Date(Date.UTC(2024, 9, index + 2));
      return {
        id: `extra-session-${index}`,
        tutorId: "archive",
        pairingId: "pair",
        date,
        startMin: 600,
        endMin: 630,
        durationMin: 30,
        shCount: 0,
        shFactor: 0,
        month: date.toISOString().slice(0, 7),
        schoolYear: "24-25",
        quarter: "Q1" as const,
      };
    }),
  });
  const result = await caller("owner", "STUDENT").tuteeHistory.myTutorDetails({
    tutorId: "archive",
    page: 1,
    meetingPage: 0,
    amendmentPage: 0,
  });
  expect(result.record).toEqual({
    id: "archive",
    englishName: "Original Archive Name",
  });
  expect(result.counts).toEqual({ sessions: 51, meetings: 1, amendments: 1 });
  expect(result.periods).toEqual(["24-25 Q1"]);
  expect(result.firstSessionDate).toEqual(new Date("2024-10-01"));
  expect(result.lastSessionDate).toEqual(new Date("2024-11-20"));
  expect(result.sessions).toHaveLength(1);
  expect(result.meetings).toHaveLength(1);
  expect(result.amendments).toHaveLength(1);
  expect(result.sessionMore || result.meetingMore || result.amendmentMore).toBe(
    false,
  );
});

it("links multiple histories beside a current tutor without changing identity, membership, departure or evidence", async () => {
  await db.user.update({
    where: { id: "owner" },
    data: { tutorId: "current", tutorAccessRevoked: true },
  });
  await db.schoolDeparture.create({
    data: {
      userId: "owner",
      reason: "TRANSFERRED",
      source: "TEST",
      observerRevoked: true,
    },
  });
  const before = await evidence();
  const account = await db.user.findUnique({ where: { id: "owner" } });
  const departure = await db.schoolDeparture.findUnique({
    where: { userId: "owner" },
  });
  await caller("admin", "ADMIN").tutorHistory.link(await input());
  await caller().tutorHistory.link(await input("owner", "past"));
  const after = await evidence();
  const linkedAccount = await db.user.findUniqueOrThrow({
    where: { id: "owner" },
  });
  // Directory metadata is allowed to change; every original field and edit
  // version remains evidence and must still match the pre-link snapshot.
  expect(linkedAccount.personId).toEqual(expect.any(String));
  expect(after.tutor?.personId).toBe(linkedAccount.personId);
  expect(after.tutor!.historyIdentityRevision).toBeGreaterThan(before.tutor!.historyIdentityRevision);
  expect({
    ...after,
    tutor: { ...after.tutor, personId: before.tutor?.personId, historyIdentityRevision: before.tutor?.historyIdentityRevision },
  }).toEqual(before);
  expect({ ...linkedAccount, personId: account?.personId }).toEqual(account);
  expect(
    await db.schoolDeparture.findUnique({ where: { userId: "owner" } }),
  ).toEqual(departure);
  expect(
    (await caller("owner", "STUDENT").tuteeHistory.myTutorRecords()).map(
      (r) => r.id,
    ),
  ).toEqual(["archive", "current", "past"]);
  const history = await caller("owner", "STUDENT").tuteeHistory.myTutorDetails({
    tutorId: "archive",
  });
  expect(history.sessions[0]?.shCount).toBe(2);
  expect(history.meetings).toHaveLength(1);
  expect(history.amendments[0]?.amount).toBe(0.5);
  expect(
    await db.auditLog.count({ where: { operation: "tutorHistory.link" } }),
  ).toBe(2);
  expect(
    await caller("other", "STUDENT").tuteeHistory.myTutorRecords(),
  ).toEqual([]);
  await expect(
    caller("other", "STUDENT").tuteeHistory.myTutorDetails({
      tutorId: "archive",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it.each(["coord", "viewer", "owner"])(
  "denies %s even with a forged Head session",
  async (id) => {
    await expect(caller(id).tutorHistory.preview(pair)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller(id).tutorHistory.link(await input()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(id).tutorHistory.candidates({ search: "owner" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);

it.each(["ACTIVE", "PENDING", "OPTED_OUT"] as const)(
  "does not treat %s as an archive",
  async (status) => {
    await db.tutor.update({ where: { id: "archive" }, data: { status } });
    await expect(caller().tutorHistory.preview(pair)).rejects.toMatchObject({
      message: "HISTORY_NOT_HISTORICAL",
    });
  },
);

it.each([
  { emailVerifiedAt: null },
  { passwordHash: null },
  { mustChangePassword: true },
  { suspendedAt: new Date() },
])("rejects an ineligible target %j", async (data) => {
  await db.user.update({ where: { id: "owner" }, data });
  await expect(caller().tutorHistory.preview(pair)).rejects.toMatchObject({
    message: "HISTORY_ACCOUNT_NOT_READY",
  });
  expect(await caller().tutorHistory.candidates({ search: "owner" })).toEqual(
    [],
  );
});

it("does not replace another account's current tutor link", async () => {
  await db.user.update({
    where: { id: "other" },
    data: { tutorId: "archive" },
  });
  expect((await caller().tutorHistory.preview(pair)).currentConflict).toBe(
    true,
  );
  await expect(
    caller().tutorHistory.link({
      ...(await input()),
      confirmPassword: password,
    }),
  ).rejects.toMatchObject({ message: "HISTORY_USE_MERGE" });
  expect(await db.tutorProfileOwnership.count()).toBe(0);
});

it("requires Head password for a retained-owner correction and revokes the previous reader", async () => {
  await caller().tutorHistory.link(await input());
  const change = await input("other");
  await expect(
    caller("admin", "ADMIN").tutorHistory.link(change),
  ).rejects.toMatchObject({ message: "HISTORY_HEAD_REQUIRED" });
  await expect(
    caller().tutorHistory.link({ ...change, confirmPassword: "wrong" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await caller().tutorHistory.link({ ...change, confirmPassword: password });
  expect(
    await caller("owner", "STUDENT").tuteeHistory.myTutorRecords(),
  ).toEqual([]);
  expect(
    (await caller("other", "STUDENT").tuteeHistory.myTutorRecords()).map(
      (r) => r.id,
    ),
  ).toEqual(["archive"]);
});

it("rejects stale previews and an ownership change back to the original owner", async () => {
  const stale = await input();
  await db.tutor.update({
    where: { id: "archive" },
    data: { englishName: "Corrected archival name" },
  });
  await expect(caller().tutorHistory.link(stale)).rejects.toMatchObject({
    message: "HISTORY_STALE",
  });
  await caller().tutorHistory.link(await input());
  const oldCorrection = await input("other");
  await caller().tutorHistory.link({
    ...oldCorrection,
    confirmPassword: password,
  });
  await caller().tutorHistory.link({
    ...(await input()),
    confirmPassword: password,
  });
  await expect(
    caller().tutorHistory.link({ ...oldCorrection, confirmPassword: password }),
  ).rejects.toMatchObject({ message: "HISTORY_STALE" });
});

it("serializes competing claims so only one preview writes ownership", async () => {
  const first = await input();
  const second = await input("other");
  const results = await Promise.allSettled([
    linkTutorHistory(db, "admin", first),
    linkTutorHistory(db, "head", second),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await db.auditLog.count({ where: { operation: "tutorHistory.link" } }),
  ).toBe(1);
});

it("rolls back ownership when its evidence audit fails", async () => {
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_tutor_link_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation = 'tutorHistory.link' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER fail_tutor_link_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_tutor_link_audit()',
  );
  try {
    await expect(caller().tutorHistory.link(await input())).rejects.toThrow();
    expect(await db.tutorProfileOwnership.count()).toBe(0);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER fail_tutor_link_audit ON "AuditLog"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION fail_tutor_link_audit()");
  }
});

it("database guards prevent alternate login assignment and deletion of owned archives", async () => {
  await caller().tutorHistory.link(await input());
  await expect(
    db.user.update({ where: { id: "other" }, data: { tutorId: "archive" } }),
  ).rejects.toThrow();
  await expect(db.user.delete({ where: { id: "owner" } })).rejects.toThrow();
  await expect(db.tutor.delete({ where: { id: "archive" } })).rejects.toThrow();
  await db.user.update({
    where: { id: "owner" },
    data: { tutorId: "archive" },
  });
  await expect(
    db.tutorProfileOwnership.update({
      where: { tutorId: "archive" },
      data: { userId: "other" },
    }),
  ).rejects.toThrow();
});

it("reviewed login retirement preserves retained archives without adding current tutor membership", async () => {
  await caller().tutorHistory.link(await input());
  await db.user.update({
    where: { id: "owner" },
    data: { tutorId: "archive" },
  });
  const merge = { survivorId: "other", duplicateId: "owner" };
  const combineInput = await reviewedLoginRetirement(db, merge, password);
  const preview = await previewPersonCombine(db, combineInput);
  expect(preview.conflicts).toEqual([]);
  expect(preview.counts.tutors).toBe(1);
  await caller().personCombine.combine(combineInput);
  expect(await db.user.findUnique({ where: { id: "other" } })).toMatchObject({ tutorId: null, role: "STUDENT" });
  expect(
    await db.tutorProfileOwnership.findUnique({
      where: { tutorId: "archive" },
    }),
  ).toMatchObject({ userId: "other", revision: 2 });
  expect(
    (await caller("other", "STUDENT").tuteeHistory.myTutorRecords()).map(
      (r) => r.id,
    ),
  ).toEqual(["archive"]);
  await expect(
    caller("owner", "STUDENT").tuteeHistory.myTutorRecords(),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("requires an explicit identity acknowledgment through the API", async () => {
  await expect(
    caller().tutorHistory.link({
      ...(await input()),
      acknowledged: false as true,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.tutorProfileOwnership.count()).toBe(0);
});
