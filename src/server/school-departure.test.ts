import { beforeEach, afterAll, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "./db";
import { createCaller } from "./api/root";
import { changeSchoolDeparture } from "./school-departure";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const head = "c194000000000000000000001";
const person = "c194000000000000000000002";
const viewer = "c194000000000000000000003";
const admin = "c194000000000000000000004";
const tutorId = "c194000000000000000000005";
const studentId = "c194000000000000000000006";
const caller = (id = person) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, name: "Synthetic user" },
      role: "HEAD",
      tutorId,
      expires: "2099-01-01",
    },
  });
const change = (
  action: "GRADUATED" | "TRANSFERRED" | "RETURN" | "REVOKE" | "RESTORE",
  expectedRevision = 0,
) => ({
  userId: person,
  action,
  expectedRevision,
  explanation: "Synthetic departure review",
});

beforeEach(async () => {
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
  await db.tutor.create({
    data: {
      id: tutorId,
      englishName: "Departure Tutor",
      status: "ACTIVE",
      email: "private-tutor@example.test",
    },
  });
  await db.tutee.create({
    data: { id: studentId, englishName: "Departure Student", status: "ACTIVE" },
  });
  await db.user.createMany({
    data: [
      { id: head, role: "HEAD", email: "head194@example.test" },
      {
        id: person,
        role: "TUTOR",
        tutorId,
        studentId,
        tuteeMember: true,
        email: "participant194@example.test",
        emailVerifiedAt: new Date(),
      },
      { id: viewer, role: "VIEWER", email: "viewer194@example.test" },
      { id: admin, role: "ADMIN", email: "admin194@example.test" },
    ],
  });
  await db.term.create({
    data: { schoolYear: "26-27", quarter: "Q1", name: "Current", active: true },
  });
});
afterAll(() => db.$disconnect());

it("requires a reviewed return before reinstating a departed learner's older removal", async () => {
  const removal = await db.tuteeRemovalRequest.create({
    data: { tuteeId: studentId, state: "APPROVED" },
  });
  await caller(head).departure.setState(change("TRANSFERRED"));
  await expect(
    caller(head).admin.reinstateTutee({ requestId: removal.id }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: studentId } })).status,
  ).toBe("INACTIVE");
  expect(
    (
      await db.tuteeRemovalRequest.findUniqueOrThrow({
        where: { id: removal.id },
      })
    ).state,
  ).toBe("APPROVED");
  await caller(head).departure.setState(change("RETURN", 1));
  await caller(head).admin.reinstateTutee({ requestId: removal.id });
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: studentId } })).status,
  ).toBe("PENDING");
});

it.each(["GRADUATED", "TRANSFERRED"] as const)(
  "%s keeps history while granting viewer-equivalent responses",
  async (action) => {
    await caller(head).departure.setState(change(action));
    expect(await caller().tutor.me()).toMatchObject({ status: action });
    const observer = await caller().admin.tutors();
    expect(observer).toEqual(await caller(viewer).admin.tutors());
    expect(JSON.stringify(observer)).not.toContain(
      "private-tutor@example.test",
    );
    await expect(
      caller().tutor.setAvailability({ slotIds: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().admin.createSubject({ name: "Illegal" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await db.user.findUniqueOrThrow({ where: { id: person } }),
    ).toMatchObject({ role: "TUTOR", tutorId, studentId });
  },
);
it("uses the Head queue for self and Admin requests without granting access early", async () => {
  const input = {
    action: "TRANSFERRED" as const,
    expectedRevision: 0,
    explanation: "Synthetic departure review",
  };
  const proposal = await caller().departure.request(input);
  await expect(caller().admin.tutors()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    caller(admin).approval.decide({
      id: proposal.id,
      approve: true,
      note: "Review",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller(head).approval.decide({
    id: proposal.id,
    approve: true,
    note: "Confirmed school transfer",
  });
  expect((await caller().departure.state()).departure?.reason).toBe(
    "TRANSFERRED",
  );
});
it("supports tutee-only departure, revocation and return without inventing a tutor", async () => {
  await db.user.update({
    where: { id: person },
    data: { tutorId: null, role: "STUDENT", tutorAccessRevoked: true },
  });
  await caller(head).departure.setState(change("TRANSFERRED"));
  expect((await caller().departure.state()).access.canReadManagement).toBe(
    true,
  );
  await caller(head).departure.setState(change("REVOKE", 1));
  await expect(caller().admin.tutors()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    caller().departure.request({
      action: "RESTORE",
      expectedRevision: 2,
      explanation: "Bypass",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller(head).departure.setState(change("RESTORE", 2));
  expect((await caller().departure.state()).access.canReadManagement).toBe(
    true,
  );
  await caller(head).departure.setState(change("RETURN", 3));
  expect((await caller().departure.state()).access.canReadManagement).toBe(
    false,
  );
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: person } })).tutorId,
  ).toBeNull();
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: studentId } })).status,
  ).toBe("INACTIVE");
  expect(await db.schoolDepartureEvent.count()).toBe(4);
});
it("return requires activation and never restores revoked tutor permissions", async () => {
  await caller(head).departure.setState(change("GRADUATED"));
  await caller(head).departure.setState(change("RETURN", 1));
  expect((await caller().tutor.me()).status).toBe("PENDING");
  await caller(head).departure.setState(change("TRANSFERRED", 2));
  await db.user.update({
    where: { id: person },
    data: { tutorAccessRevoked: true },
  });
  await caller(head).departure.setState(change("RETURN", 3));
  await expect(caller().tutor.me()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("retains crew/translator and management grants independently", async () => {
  await db.user.update({
    where: { id: person },
    data: { role: "ADMIN", crewStatus: "ACTIVE", canTranslate: true },
  });
  await caller(head).departure.setState(change("TRANSFERRED"));
  expect(
    await db.user.findUniqueOrThrow({ where: { id: person } }),
  ).toMatchObject({ role: "ADMIN", crewStatus: "ACTIVE", canTranslate: true });
  expect((await caller().departure.state()).access).toMatchObject({
    canReadManagement: true,
    managementReadOnly: false,
  });
});
it("honors live suspension and revocation despite stale elevated session claims", async () => {
  await caller(head).departure.setState(change("GRADUATED"));
  await db.user.update({
    where: { id: person },
    data: { suspendedAt: new Date() },
  });
  await expect(caller().admin.tutors()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await db.user.update({
    where: { id: person },
    data: { suspendedAt: null, tutorAccessRevoked: true },
  });
  await expect(caller().admin.tutors()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("raw roster graduation and academic reports do not grant portal access", async () => {
  await db.tutor.update({
    where: { id: tutorId },
    data: { status: "GRADUATED", academicallyGraduated: true },
  });
  await db.academicProfile.create({
    data: { userId: person, status: "GRADUATED" },
  });
  await expect(caller().admin.tutors()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("serializes concurrent decisions and rolls back stale attempts", async () => {
  const outcomes = await Promise.allSettled([
    changeSchoolDeparture(db, change("GRADUATED"), head),
    changeSchoolDeparture(db, change("TRANSFERRED"), head),
  ]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  expect(await db.schoolDepartureEvent.count()).toBe(1);
});
it("masks private reasons and registration codes, including unmasked report requests", async () => {
  await db.serviceHourAdjustment.create({
    data: {
      tutorId,
      month: "2026-09",
      schoolYear: "26-27",
      quarter: "Q1",
      amount: 1,
      type: "EXTRA",
      reason: "PRIVATE_STAFF_NOTE",
    },
  });
  await db.registrationCode.create({
    data: {
      code: "PRIVATE_INVITATION_CODE",
      kind: "TUTOR",
      expiresAt: new Date("2099-01-01"),
      issuedById: head,
    },
  });
  await caller(head).departure.setState(change("GRADUATED"));
  for (const id of [person, viewer]) {
    expect(JSON.stringify(await caller(id).admin.adjustments())).not.toContain(
      "PRIVATE_STAFF_NOTE",
    );
    expect(
      JSON.stringify(await caller(id).admin.registrationCodes()),
    ).not.toContain("PRIVATE_INVITATION_CODE");
    const report = await caller(id).admin.periodReport({
      schoolYear: "26-27",
      depth: "full",
      maskPii: false,
    });
    expect(JSON.stringify(report)).not.toContain("PRIVATE_STAFF_NOTE");
    expect(JSON.stringify(report)).not.toContain("private-tutor@example.test");
  }
});
it("blocks roster shortcuts and preserves departure after a rejected stale proposal", async () => {
  await caller(head).departure.setState(change("TRANSFERRED"));
  const student = await db.tutee.findUniqueOrThrow({
    where: { id: studentId },
  });
  await expect(
    caller(head).admin.setTuteeStatus({
      id: studentId,
      status: "ACTIVE",
      expectedUpdatedAt: student.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller(head).admin.setUserCanTutor({ userId: person, canTutor: true }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller(head).departure.setState(change("RETURN", 0)),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await caller().departure.state()).departure?.reason).toBe(
    "TRANSFERRED",
  );
});
it("detaches current assignments across owned profiles but preserves past pairing history", async () => {
  const current = await db.term.findFirstOrThrow({ where: { active: true } });
  const past = await db.term.create({
    data: { schoolYear: "25-26", quarter: "Q4", name: "Past" },
  });
  const learner = await db.tutee.create({
    data: { englishName: "Affected learner", status: "ACTIVE" },
  });
  const second = await db.tutee.create({
    data: { englishName: "Owned prior profile", status: "ACTIVE" },
  });
  await db.studentProfileOwnership.create({
    data: { userId: person, tuteeId: second.id },
  });
  for (const termId of [current.id, past.id])
    await db.pairing.create({
      data: {
        tutorId,
        termId,
        subject: "History",
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
        tutees: {
          create: [learner.id, studentId, second.id].map((tuteeId) => ({
            tuteeId,
          })),
        },
      },
    });
  await caller(head).departure.setState(change("TRANSFERRED"));
  expect(
    await db.pairingTutee.count({ where: { pairing: { termId: current.id } } }),
  ).toBe(0);
  expect(
    await db.pairingTutee.count({ where: { pairing: { termId: past.id } } }),
  ).toBe(3);
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: learner.id } })).status,
  ).toBe("PENDING");
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: second.id } })).status,
  ).toBe("INACTIVE");
});
