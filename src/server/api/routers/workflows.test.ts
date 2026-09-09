import { beforeEach, afterAll, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import pg from "pg";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { currentPolicy } from "~/server/policy-acceptance";
import { reconcileApplication } from "~/server/tutors/application-status";
import { hashPassword } from "~/server/auth/password";
import { syncSessionFlag } from "~/server/crew/flags";
import * as flags from "~/server/crew/flags";
import { completeRegistration } from "~/server/auth/registration";
import { initializeProgram } from "~/server/program/bootstrap";
import { confirmEmailChange } from "~/server/auth/email-change";
import { hashCode } from "~/server/auth/registration";
import * as audit from "~/server/audit/log";

const password = "ReviewPassword123!";

it("upgrades legacy meeting deductions across semesters without changing manual adjustments", async () => {
  await db.term.createMany({
    data: [
      { id: "migration-q2", schoolYear: "26-27", quarter: "Q2", name: "Q2" },
      { id: "migration-q3", schoolYear: "26-27", quarter: "Q3", name: "Q3" },
    ],
  });
  // Three Q1 absences exhaust the allowance. The fourth in Q2 costs 0.25.
  // The first in Q3 and an excused meeting must cost nothing after deployment.
  for (let i = 0; i < 6; i++) {
    const id = `migration-meeting-${i}`;
    await db.tutorMeeting.create({
      data: {
        id,
        title: id,
        date: new Date(`2026-09-${String(i + 1).padStart(2, "0")}T23:30:00Z`),
        termId:
          i < 3 ? "review-term" : i === 3 ? "migration-q2" : "migration-q3",
        attendances: {
          create: {
            tutorId: "review-tutor",
            status: i === 5 ? "EXCUSED_ABSENT" : "UNEXCUSED_ABSENT",
          },
        },
      },
    });
    await db.serviceHourAdjustment.create({
      data: {
        id: `mtgabs_${id}_review-tutor`,
        tutorId: "review-tutor",
        month: "2026-09",
        schoolYear: "26-27",
        quarter: "Q1",
        type: "PUNISHMENT",
        amount: 0.125,
      },
    });
  }
  await db.serviceHourAdjustment.create({
    data: {
      id: "manual-adjustment",
      tutorId: "review-tutor",
      month: "2026-09",
      schoolYear: "26-27",
      quarter: "Q1",
      type: "EXTRA",
      amount: 2,
    },
  });
  const sql = readFileSync(
    "prisma/migrations/20260909030000_reconcile_meeting_deductions/migration.sql",
    "utf8",
  );
  // Execute the actual migration including its transaction, like an existing-install upgrade.
  const connection = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  await connection.connect();
  try {
    await connection.query(sql);
  } finally {
    await connection.end();
  }
  expect(
    await db.serviceHourAdjustment.findMany({
      where: { id: { startsWith: "mtgabs_" } },
      select: { id: true, amount: true, quarter: true, month: true },
    }),
  ).toEqual([
    {
      id: "mtgabs_migration-meeting-3_review-tutor",
      amount: 0.25,
      quarter: "Q2",
      month: "2026-09",
    },
  ]);
  expect(
    (
      await db.serviceHourAdjustment.findUniqueOrThrow({
        where: { id: "manual-adjustment" },
      })
    ).amount,
  ).toBe(2);
});
const roomId = "clreviewroom000000000000001";
const sessionFor = (
  role: Session["role"] = "HEAD",
  userId = "review-head",
  tutorId: string | null = null,
): Session => ({
  user: { id: userId, name: "Review Actor", email: `${userId}@example.test` },
  role,
  tutorId,
  expires: "2099-01-01T00:00:00Z",
});
const caller = (
  role: Session["role"] = "HEAD",
  userId = "review-head",
  tutorId: string | null = null,
) =>
  createCaller({
    db,
    session: sessionFor(role, userId, tutorId),
    headers: new Headers(),
  });
const tutor = () => caller("TUTOR", "review-user", "review-tutor");
const attendance = () => ({
  pairingId: "review-pairing",
  date: new Date("2026-09-07"),
  tutorStatus: "PRESENT" as const,
  tutees: [{ tuteeId: "review-tutee", status: "PRESENT" as const }],
  comments: "Isolated review attendance",
  ratingPreparedness: 4,
  ratingParticipation: 4,
  ratingUnderstanding: 4,
  ratingBehavior: 4,
  ratingProgress: 4,
});

beforeEach(async () => {
  // Refuse destructive fixture cleanup anywhere except the explicitly created local review DB.
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !(
      url.pathname === "/shbs_functional_review" ||
      url.pathname.endsWith("_test")
    )
  )
    throw Error(
      "Workflow tests require an explicitly named local test database",
    );
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
  await db.term.create({
    data: {
      id: "review-term",
      schoolYear: "26-27",
      quarter: "Q1",
      name: "Review Q1",
      active: true,
    },
  });
  await db.tutor.create({
    data: {
      id: "review-tutor",
      firstName: "Review",
      lastName: "Tutor",
      englishName: "Review Tutor",
      username: "reviewtutor",
      email: "review-user@example.test",
      status: "ACTIVE",
      gradeLevel: 10,
    },
  });
  await db.user.createMany({
    data: [
      {
        id: "review-head",
        name: "Review Head",
        email: "review-head@example.test",
        username: "reviewhead",
        role: "HEAD",
        passwordHash: hashPassword(password),
        emailVerifiedAt: new Date(),
      },
      {
        id: "review-user",
        name: "Review Tutor",
        email: "review-user@example.test",
        username: "reviewtutor",
        role: "TUTOR",
        tutorId: "review-tutor",
        passwordHash: hashPassword(password),
        emailVerifiedAt: new Date(),
      },
      {
        id: "review-viewer",
        name: "Review Viewer",
        email: "review-viewer@example.test",
        role: "VIEWER",
        emailVerifiedAt: new Date(),
      },
    ],
  });
  await db.subject.create({
    data: { id: "review-subject", name: "Review Math" },
  });
  await db.timeSlot.create({
    data: {
      id: "review-slot",
      label: "Monday afternoon",
      dayOfWeek: 1,
      startMin: 930,
      endMin: 990,
      active: true,
    },
  });
  await db.room.create({ data: { id: roomId, name: "Review Room" } });
  await db.tutee.create({
    data: {
      id: "review-tutee",
      englishName: "Review Student",
      firstChoiceId: "review-subject",
      status: "ACTIVE",
      preferredContact: "Contact the review guardian",
      notes: "Private staff note",
    },
  });
  await db.pairing.create({
    data: {
      id: "review-pairing",
      tutorId: "review-tutor",
      termId: "review-term",
      subject: "Review Math",
      dayOfWeek: 1,
      startMin: 930,
      endMin: 990,
      timeSlotId: "review-slot",
      roomId,
      tutees: { create: { tuteeId: "review-tutee" } },
    },
  });
  for (const slug of ["tutor-policy", "tutee-policy"]) {
    await db.policyDocument.create({
      data: {
        slug,
        locale: "en",
        title: "Test policy",
        body: "Test consent",
        version: "1",
      },
    });
    const policy = await currentPolicy(db, slug);
    for (const userId of ["review-user", "review-head"])
      await db.policyAcceptance.create({
        data: {
          userId,
          slug,
          revision: policy.revision,
          snapshot: policy.documents,
          signature: "Review Actor",
        },
      });
  }
});
afterAll(async () => {
  await db.$disconnect();
});

async function correction(id: string) {
  const rows = await caller().corrections.attendance({ id });
  const s = rows.find((r) => !r.mergeGroupId || r.mergeGroupId === r.id)!;
  return {
    id: s.id,
    expectedUpdatedAt: s.updatedAt,
    reason: "Corrected against the original classroom record",
    date: s.date,
    startMin: s.startMin,
    endMin: s.endMin,
    tutorStatus: s.tutorStatus,
    tutorAbsentReason: s.tutorAbsentReason,
    comments: s.comments,
    online: s.online,
    actualRoomId: s.actualRoomId,
    ratingPreparedness: 4,
    ratingParticipation: 4,
    ratingUnderstanding: 4,
    ratingBehavior: 4,
    ratingProgress: 4,
    tutees: [
      ...new Map(
        rows
          .flatMap((r) => r.tutees)
          .map((t) => [
            t.tuteeId,
            {
              tuteeId: t.tuteeId,
              status: t.status,
              absenceReason: t.absenceReason,
            },
          ]),
      ).values(),
    ],
  };
}

it("metadata corrections preserve reviewed cards and crew penalties", async () => {
  const result = await tutor().tutor.submitAttendance({
    ...attendance(),
    tutees: [{ tuteeId: "review-tutee", status: "UNEXCUSED_ABSENT" }],
  });
  const card = await db.disciplinaryCard.findFirstOrThrow();
  await caller().admin.reviewCard({
    id: card.id,
    expectedUpdatedAt: card.updatedAt,
    reviewStatus: "INVALID",
    reviewNote: "Absence evidence dismissed",
  });
  const flag = await db.sessionFlag.create({
    data: {
      sessionId: result.id,
      tutorId: "review-tutor",
      expected: 1,
      observed: 0,
    },
  });
  await caller().admin.decideSessionFlag({
    flagId: flag.id,
    action: "PENALIZE",
  });
  await caller().corrections.correctAttendance({
    ...(await correction(result.id)),
    comments: "Spelling corrected only",
  });
  expect(await db.disciplinaryCard.count()).toBe(1);
  expect(
    (await db.disciplinaryCard.findUniqueOrThrow({ where: { id: card.id } }))
      .reviewStatus,
  ).toBe("INVALID");
  expect(await db.serviceHourAdjustment.count()).toBe(1);
  expect(
    (await db.sessionFlag.findUniqueOrThrow({ where: { id: flag.id } })).state,
  ).toBe("PENALIZED");
});

it("attendance correction reverses automatic removal, restores current pairing and recomputes hours", async () => {
  await db.disciplinaryCard.create({
    data: {
      tuteeId: "review-tutee",
      color: "RED",
      source: "TUTOR",
      reason: "Existing valid card",
      reviewStatus: "VALID",
    },
  });
  const created = await tutor().tutor.submitAttendance({
    ...attendance(),
    tutees: [{ tuteeId: "review-tutee", status: "UNEXCUSED_ABSENT" }],
  });
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: "review-tutee" } }))
      .status,
  ).toBe("INACTIVE");
  const input = await correction(created.id);
  input.tutees[0]!.status = "PRESENT";
  await caller().corrections.correctAttendance(input);
  expect(
    (await db.session.findUniqueOrThrow({ where: { id: created.id } })).shCount,
  ).toBe(2);
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: "review-tutee" } }))
      .status,
  ).toBe("ACTIVE");
  expect(await db.pairingTutee.count()).toBe(1);
  expect(
    await db.disciplinaryCard.count({
      where: { source: "AUTO", reviewStatus: "INVALID" },
    }),
  ).toBe(1);
  expect(
    (await db.auditLog.findFirstOrThrow({ where: { entityId: created.id } }))
      .details,
  ).toBeTruthy();
  await expect(
    caller().corrections.correctAttendance(input),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("a merged attendance correction credits the combined block exactly once", async () => {
  await db.pairing.create({
    data: {
      id: "merge-pairing",
      tutorId: "review-tutor",
      termId: "review-term",
      subject: "Second subject",
      dayOfWeek: 1,
      startMin: 930,
      endMin: 990,
      tutees: { create: { tuteeId: "review-tutee" } },
    },
  });
  const result = await tutor().tutor.submitAttendance({
    ...attendance(),
    mergePairingIds: ["merge-pairing"],
  });
  await caller().corrections.correctAttendance({
    ...(await correction(result.id)),
    endMin: 1050,
  });
  const sessions = await db.session.findMany();
  expect(sessions).toHaveLength(2);
  expect(sessions.reduce((sum, s) => sum + s.shCount, 0)).toBe(4);
  expect(sessions.filter((s) => s.shCount > 0)).toHaveLength(1);
});

it("patrol retry credits once and reconciles the actual observation date", async () => {
  const result = await tutor().tutor.submitAttendance({
    ...attendance(),
    date: new Date("2026-08-03"),
  });
  const input = {
    submissionKey: crypto.randomUUID(),
    observations: [
      {
        roomId,
        headcount: "ZERO" as const,
        observedAt: new Date("2026-08-03T16:00:00+08:00"),
      },
    ],
  };
  const [a, b] = await Promise.all([
    caller().crew.submitPatrol(input),
    caller().crew.submitPatrol(input),
  ]);
  expect(a.id).toBe(b.id);
  expect(await db.patrol.count()).toBe(1);
  expect(await db.sessionFlag.count({ where: { sessionId: result.id } })).toBe(
    1,
  );
  await expect(
    caller().crew.submitPatrol({ ...input, note: "Changed payload" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("correcting patrol evidence withdraws its flag and linked penalty", async () => {
  await tutor().tutor.submitAttendance(attendance());
  const result = await caller().crew.submitPatrol({
    submissionKey: crypto.randomUUID(),
    observations: [
      {
        roomId,
        headcount: "ZERO",
        observedAt: new Date("2026-09-07T16:00:00+08:00"),
      },
    ],
  });
  const flag = await db.sessionFlag.findFirstOrThrow();
  await caller().admin.decideSessionFlag({
    flagId: flag.id,
    action: "PENALIZE",
  });
  const row = await db.patrol.findUniqueOrThrow({
    where: { id: result.id },
    include: { observations: true },
  });
  await caller().corrections.correctPatrol({
    id: row.id,
    expectedUpdatedAt: row.updatedAt,
    reason: "Observed one student; entry was mistaken",
    note: null,
    observations: row.observations.map((o) => ({ ...o, headcount: "ONE" })),
  });
  expect(await db.serviceHourAdjustment.count()).toBe(0);
  expect(await db.sessionFlag.count()).toBe(0);
});

it("patrol reconciliation failure rolls back patrol hours and observations", async () => {
  await tutor().tutor.submitAttendance(attendance());
  const spy = vi
    .spyOn(flags, "syncSessionFlag")
    .mockRejectedValueOnce(Error("Injected reconciliation failure"));
  try {
    await expect(
      caller().crew.submitPatrol({
        submissionKey: crypto.randomUUID(),
        observations: [
          {
            roomId,
            headcount: "ZERO",
            observedAt: new Date("2026-09-07T16:00:00+08:00"),
          },
        ],
      }),
    ).rejects.toThrow();
  } finally {
    spy.mockRestore();
  }
  expect(await db.patrol.count()).toBe(0);
  expect(await db.patrolObservation.count()).toBe(0);
});

it("revoking an application accepted for an existing account revokes its tutor grant", async () => {
  const app = await db.tutorApplication.create({
    data: { name: "Existing Viewer", email: "review-viewer@example.test" },
  });
  await db.tutorApplication.update({
    where: { id: app.id },
    data: { status: "ACCEPTED" },
  });
  await db.$transaction((tx) => reconcileApplication(tx, app.id));
  const updated = await db.tutorApplication.findUniqueOrThrow({
    where: { id: app.id },
  });
  expect(updated.promotedTutorId).toBeTruthy();
  expect(
    await db.registrationCode.count({ where: { applicationId: app.id } }),
  ).toBe(0);
  await caller().admin.setApplicationStatus({
    id: app.id,
    expectedUpdatedAt: updated.updatedAt,
    status: "REJECTED",
  });
  expect(
    (
      await db.tutor.findUniqueOrThrow({
        where: { id: updated.promotedTutorId! },
      })
    ).status,
  ).toBe("ARCHIVED");
});

it("concurrent period refresh advances exactly one quarter and rejects a stale retry", async () => {
  const input = { confirm: "REFRESH", expectedTermId: "review-term" };
  const outcomes = await Promise.allSettled([
    caller().admin.refresh(input),
    caller().admin.refresh(input),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.term.count({ where: { active: true } })).toBe(1);
  expect(
    (await db.term.findFirstOrThrow({ where: { active: true } })).quarter,
  ).toBe("Q2");
});

it("subject rename keeps paired subject labels consistent", async () => {
  await caller().admin.updateSubject({
    id: "review-subject",
    name: "Renamed Math",
    active: true,
  });
  expect(
    (await db.pairing.findUniqueOrThrow({ where: { id: "review-pairing" } }))
      .subject,
  ).toBe("Renamed Math");
});

it("a viewer cannot correct attendance or read correction snapshots", async () => {
  const result = await tutor().tutor.submitAttendance(attendance());
  const input = await correction(result.id);
  await expect(
    caller("VIEWER", "review-viewer").corrections.correctAttendance(input),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller().corrections.correctAttendance(input);
  expect(
    JSON.stringify(await caller("VIEWER", "review-viewer").admin.auditLog()),
  ).not.toContain("ratingPreparedness");
});

it("stale audit undo cannot overwrite a later card review", async () => {
  let card = await db.disciplinaryCard.create({
    data: {
      tuteeId: "review-tutee",
      color: "YELLOW",
      source: "TUTOR",
      reason: "Review correction",
      reviewStatus: "PENDING",
    },
  });
  await caller().admin.reviewCard({
    id: card.id,
    expectedUpdatedAt: card.updatedAt,
    reviewStatus: "VALID",
  });
  const original = await db.auditLog.findFirstOrThrow({
    where: { entityId: card.id },
  });
  card = await db.disciplinaryCard.findUniqueOrThrow({
    where: { id: card.id },
  });
  await caller().admin.reviewCard({
    id: card.id,
    expectedUpdatedAt: card.updatedAt,
    reviewStatus: "INVALID",
    reviewNote: "Later evidence",
  });
  await expect(
    caller().admin.undoAudit({ id: original.id }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (await db.disciplinaryCard.findUniqueOrThrow({ where: { id: card.id } }))
      .reviewNote,
  ).toBe("Later evidence");
});

it("inactive crew can still view their own patrol history", async () => {
  await db.user.update({
    where: { id: "review-viewer" },
    data: { crewStatus: "INACTIVE" },
  });
  await db.patrol.create({ data: { crewUserId: "review-viewer", hours: 0.5 } });
  expect(await caller("VIEWER", "review-viewer").crew.myPatrols()).toHaveLength(
    1,
  );
});

it("image deletion rejects references until website content releases them", async () => {
  const img = await db.homeImage.create({
    data: {
      mimeType: "image/png",
      data: Buffer.from("test"),
      byteSize: 4,
      alt: "Old",
    },
  });
  await db.homeContent.create({
    data: { key: "heroImage", locale: "en", value: img.id },
  });
  await expect(caller().home.deleteImage({ id: img.id })).rejects.toMatchObject(
    { code: "CONFLICT" },
  );
  await caller().home.setImageAlt({ id: img.id, alt: "Corrected description" });
  expect(
    (await db.homeImage.findUniqueOrThrow({ where: { id: img.id } })).alt,
  ).toBe("Corrected description");
  await db.homeContent.deleteMany();
  await caller().home.deleteImage({ id: img.id });
  expect(await db.homeImage.count()).toBe(0);
});

it("translation editor rejects malformed ICU before it can break a page", async () => {
  await expect(
    caller().localization.setString({
      locale: "en",
      key: "common.save",
      value: "{count, plural, one {Incomplete}",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.messageOverride.count()).toBe(0);
  await caller().localization.setString({
    locale: "en",
    key: "common.save",
    value: "Save Changes",
  });
  expect(await db.messageOverride.count()).toBe(1);
});

it("PASS: attendance persists expected service hours and roster", async () => {
  const result = await tutor().tutor.submitAttendance(attendance());
  const row = await db.session.findUniqueOrThrow({
    where: { id: result.id },
    include: { tutees: true },
  });
  expect(row.shCount).toBe(2);
  expect(row.tutees).toHaveLength(1);
  expect(row.month).toBe("2026-09");
});
it("attendance rejects future school dates", async () => {
  const schoolTomorrow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  schoolTomorrow.setUTCDate(schoolTomorrow.getUTCDate() + 1);
  await expect(
    tutor().tutor.submitAttendance({
      ...attendance(),
      date: new Date(schoolTomorrow.toISOString().slice(0, 10)),
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.session.count()).toBe(0);
});
it("attendance requires the complete merged roster exactly once", async () => {
  await db.tutee.create({
    data: { id: "second-tutee", englishName: "Second Tutee" },
  });
  await db.pairing.create({
    data: {
      id: "second-pairing",
      tutorId: "review-tutor",
      termId: "review-term",
      subject: "Second subject",
      dayOfWeek: 1,
      startMin: 930,
      endMin: 990,
      tutees: { create: { tuteeId: "second-tutee" } },
    },
  });
  const complete = {
    ...attendance(),
    mergePairingIds: ["second-pairing"],
    tutees: [
      { tuteeId: "review-tutee", status: "PRESENT" as const },
      { tuteeId: "second-tutee", status: "PRESENT" as const },
    ],
  };
  await expect(
    tutor().tutor.submitAttendance({
      ...complete,
      tutees: complete.tutees.slice(0, 1),
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    tutor().tutor.submitAttendance({
      ...complete,
      tutees: [complete.tutees[0]!, complete.tutees[0]!],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });

  await tutor().tutor.submitAttendance(complete);
  const sessions = await db.session.findMany({
    orderBy: { pairingId: "asc" },
    include: { tutees: true },
  });
  expect(sessions).toHaveLength(2);
  expect(
    sessions
      .flatMap((session) => session.tutees.map((row) => row.tuteeId))
      .sort(),
  ).toEqual(["review-tutee", "second-tutee"].sort());
});
it("PASS: viewer cannot mutate the subject catalog", async () => {
  await expect(
    caller("VIEWER", "review-viewer").admin.createSubject({
      name: "Forbidden",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("PASS: another tutor cannot submit against this pairing", async () => {
  await db.tutor.create({
    data: { id: "other-tutor", englishName: "Other Tutor", status: "ACTIVE" },
  });
  await db.user.create({
    data: {
      id: "review-other-user",
      email: "other@example.test",
      role: "TUTOR",
      tutorId: "other-tutor",
    },
  });
  await expect(
    caller("TUTOR", "review-other-user", "other-tutor").tutor.submitAttendance(
      attendance(),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("F01: inactive tutors must not be allowed to submit attendance", async () => {
  await db.tutor.update({
    where: { id: "review-tutor" },
    data: { status: "ARCHIVED" },
  });
  await expect(
    tutor().tutor.submitAttendance(attendance()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("F02: retrying an identical attendance submission must not double credit", async () => {
  await tutor().tutor.submitAttendance(attendance());
  try {
    await tutor().tutor.submitAttendance(attendance());
  } catch {}
  expect(await db.session.count()).toBe(1);
});
it("F03: the website tutee update must detach a newly inactive student", async () => {
  await caller().admin.updateTutee({
    id: "review-tutee",
    expectedUpdatedAt: (
      await db.tutee.findUniqueOrThrow({ where: { id: "review-tutee" } })
    ).updatedAt,
    englishName: "Review Student",
    status: "INACTIVE",
    firstChoiceId: "review-subject",
  });
  expect(
    await db.pairingTutee.count({ where: { tuteeId: "review-tutee" } }),
  ).toBe(0);
});
it("F04: historical pairings must not fulfill a new term signup", async () => {
  await db.term.update({
    where: { id: "review-term" },
    data: { active: false },
  });
  const next = await db.term.create({
    data: {
      schoolYear: "26-27",
      quarter: "Q2",
      name: "Review Q2",
      active: true,
    },
  });
  const row = await db.tutee.update({
    where: { id: "review-tutee" },
    data: { status: "PENDING" },
  });
  await caller().admin.assignSignup({
    tuteeId: row.id,
    expectedUpdatedAt: row.updatedAt,
    assignments: [{ subject: "Review Math", tutorId: "review-tutor" }],
  });
  expect(
    await db.pairingTutee.count({
      where: { tuteeId: row.id, pairing: { termId: next.id } },
    }),
  ).toBe(1);
});
it("F05: saving a linked tutor without changing the username should preserve it", async () => {
  await caller().admin.updateTutor({
    id: "review-tutor",
    firstName: "Review",
    lastName: "Tutor",
    username: "reviewtutor",
    email: "review-user@example.test",
    status: "ACTIVE",
    gradeLevel: 10,
  });
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: "review-tutor" } }))
      .username,
  ).toBe("reviewtutor");
});
it("F06: a tutor must not claim another roster tutor email without verification", async () => {
  await db.tutor.create({
    data: {
      id: "review-other",
      englishName: "Other Tutor",
      email: "unlinked@example.test",
      status: "ACTIVE",
    },
  });
  await expect(
    tutor().tutor.updateProfile({ email: "unlinked@example.test" }),
  ).rejects.toBeDefined();
});
it("F07: a Shanghai afternoon patrol should detect an afternoon discrepancy", async () => {
  const result = await tutor().tutor.submitAttendance(attendance());
  await db.patrol.create({
    data: {
      crewUserId: "review-head",
      hours: 0.5,
      termId: "review-term",
      observations: {
        create: {
          roomId,
          headcount: "ZERO",
          observedAt: new Date("2026-09-07T16:00:00+08:00"),
        },
      },
    },
  });
  expect((await syncSessionFlag(db, result.id)).flagged).toBe(true);
});
it("F08: a FOUR_PLUS bucket cannot prove an undercount against five students", async () => {
  for (let n = 2; n <= 5; n++) {
    await db.tutee.create({
      data: { id: `review-tutee-${n}`, englishName: `Review ${n}` },
    });
    await db.pairingTutee.create({
      data: { pairingId: "review-pairing", tuteeId: `review-tutee-${n}` },
    });
  }
  const input = attendance();
  for (let n = 2; n <= 5; n++)
    input.tutees.push({ tuteeId: `review-tutee-${n}`, status: "PRESENT" });
  const result = await tutor().tutor.submitAttendance(input);
  await db.patrol.create({
    data: {
      crewUserId: "review-head",
      hours: 0.5,
      observations: {
        create: {
          roomId,
          headcount: "FOUR_PLUS",
          observedAt: new Date("2026-09-07T16:00:00+08:00"),
        },
      },
    },
  });
  expect((await syncSessionFlag(db, result.id)).flagged).toBe(false);
});
it("F09: undoing a card review must reconcile the resulting removal", async () => {
  await db.disciplinaryCard.create({
    data: {
      tuteeId: "review-tutee",
      color: "RED",
      source: "TUTOR",
      reason: "Review 1",
      reviewStatus: "VALID",
    },
  });
  const second = await db.disciplinaryCard.create({
    data: {
      tuteeId: "review-tutee",
      color: "RED",
      source: "TUTOR",
      reason: "Review 2",
      reviewStatus: "PENDING",
    },
  });
  await caller().admin.reviewCard({
    id: second.id,
    reviewStatus: "VALID",
    reviewNote: "Reviewed",
    expectedUpdatedAt: second.updatedAt,
  });
  const log = await db.auditLog.findFirstOrThrow({
    where: { entityId: second.id },
  });
  await caller().admin.undoAudit({ id: log.id });
  const removed = await db.tutee.findUniqueOrThrow({
    where: { id: "review-tutee" },
  });
  expect(removed.status).toBe("ACTIVE");
});
it("F10: rejecting an accepted applicant must not leave their invite usable", async () => {
  let app = await db.tutorApplication.create({
    data: { name: "New Tutor", email: "new@example.test" },
  });
  await db.tutorApplication.update({
    where: { id: app.id },
    data: { status: "ACCEPTED" },
  });
  await db.$transaction((tx) => reconcileApplication(tx, app.id));
  app = await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } });
  await caller().admin.setApplicationStatus({
    id: app.id,
    status: "REJECTED",
    expectedUpdatedAt: app.updatedAt,
  });
  expect(
    await db.registrationCode.count({
      where: {
        applicationId: app.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    }),
  ).toBe(0);
});
it("PASS: simultaneous signup assignment rejects one stale editor", async () => {
  await db.pairingTutee.deleteMany();
  const row = await db.tutee.update({
    where: { id: "review-tutee" },
    data: { status: "PENDING" },
  });
  const input = {
    tuteeId: row.id,
    expectedUpdatedAt: row.updatedAt,
    assignments: [{ subject: "Review Math", tutorId: "review-tutor" }],
  };
  const result = await Promise.allSettled([
    caller().admin.assignSignup(input),
    caller().admin.assignSignup(input),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.pairingTutee.count({ where: { tuteeId: row.id } })).toBe(1);
});
it("PASS: meeting attendance corrections remove their derived deduction", async () => {
  const meeting = await caller().admin.createMeeting({
    title: "Review meeting",
    date: new Date("2026-09-07"),
  });
  await caller().admin.recordMeetingAttendance({
    meetingId: meeting.id,
    entries: [{ tutorId: "review-tutor", status: "UNEXCUSED_ABSENT" }],
  });
  await caller().admin.recordMeetingAttendance({
    meetingId: meeting.id,
    entries: [{ tutorId: "review-tutor", status: "PRESENT" }],
  });
  expect(await db.serviceHourAdjustment.count()).toBe(0);
});
it("F11: two administrators deciding one flag must create only one penalty", async () => {
  const result = await tutor().tutor.submitAttendance(attendance());
  const flag = await db.sessionFlag.create({
    data: {
      sessionId: result.id,
      tutorId: "review-tutor",
      expected: 1,
      observed: 0,
    },
  });
  const outcomes = await Promise.allSettled([
    caller().admin.decideSessionFlag({ flagId: flag.id, action: "PENALIZE" }),
    caller().admin.decideSessionFlag({ flagId: flag.id, action: "PENALIZE" }),
  ]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  expect(await db.serviceHourAdjustment.count()).toBe(1);
});
it("F12: a suspended assigned translator must not retain publishing rights", async () => {
  await db.user.update({
    where: { id: "review-viewer" },
    data: { canTranslate: true, suspendedAt: new Date() },
  });
  await expect(
    caller("VIEWER", "review-viewer").home.createNews({
      title: "Suspended publisher",
      body: "This must not be published",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("F13: viewer audit responses must not expose staff notes inside undo payloads", async () => {
  await db.auditLog.create({
    data: {
      action: "Card reviewed",
      entity: "DisciplinaryCard",
      undoData: {
        kind: "card.review",
        payload: {
          id: "review-card",
          reviewStatus: "VALID",
          reviewNote: "PRIVATE STAFF REASON",
        },
      },
    },
  });
  const response = await caller("VIEWER", "review-viewer").admin.auditLog();
  expect(JSON.stringify(response)).not.toContain("PRIVATE STAFF REASON");
});
it("F14: an existing tutor account can add crew membership using a CREW invite", async () => {
  const row = await db.registrationCode.create({
    data: {
      code: "R2V3W",
      kind: "CREW",
      email: "review-user@example.test",
      pendingEmail: "review-user@example.test",
      emailVerifiedAt: new Date(),
      expiresAt: new Date("2099-01-01"),
    },
  });
  expect(
    (
      await completeRegistration(row, {
        firstName: "Review",
        lastName: "Tutor",
        password,
      })
    ).ok,
  ).toBe(true);
});
it("F15: an unchanged completed registration must not be executable twice", async () => {
  const row = await db.registrationCode.create({
    data: {
      code: "R2V3W",
      kind: "TUTOR",
      tutorId: "review-tutor",
      email: "review-user@example.test",
      pendingEmail: "review-user@example.test",
      emailVerifiedAt: new Date(),
      expiresAt: new Date("2099-01-01"),
    },
  });
  // Two HTTP requests can resolve the same usable row before either consumes it.
  await completeRegistration(row, {
    firstName: "Review",
    lastName: "Tutor",
    password,
  });
  let second;
  try {
    second = await completeRegistration(row, {
      firstName: "Changed",
      lastName: "Again",
      password: "DifferentReviewPassword!",
    });
  } catch {}
  expect(second?.ok).not.toBe(true);
});
it("PASS: signup gate rejects submissions before the configured opening", async () => {
  await db.term.update({
    where: { id: "review-term" },
    data: { signupOpensAt: new Date("2099-01-01") },
  });
  await expect(
    createCaller({
      db,
      session: null,
      headers: new Headers(),
    }).tutee.requestSignup({
      englishName: "New Student",
      email: "new-student@example.test",
      policyRevision: "test-revision",
      preferredContact: "Review",
      firstChoiceId: "review-subject",
      slotIds: ["review-slot"],
      signatureName: "New Student",
      agreed: true,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});

it("F16: monthly reports include that month’s meetings and patrols", async () => {
  await caller().admin.createMeeting({
    title: "September meeting",
    date: new Date("2026-09-07"),
    termId: "review-term",
  });
  await db.patrol.create({
    data: {
      crewUserId: "review-head",
      termId: "review-term",
      hours: 0.5,
      createdAt: new Date("2026-09-07"),
    },
  });
  const report = await caller().admin.periodReport({
    month: "2026-09",
    depth: "detailed",
  });
  expect.soft(report.meetings).toHaveLength(1);
  expect.soft(report.crewStats).toHaveLength(1);
});
it("F17: a previous HEAD session cannot transfer leadership a second time", async () => {
  const a = await db.user.create({
    data: { email: "next-head@example.test", role: "ADMIN" },
  });
  const b = await db.user.create({
    data: { email: "third-head@example.test", role: "ADMIN" },
  });
  await caller().admin.transferHead({
    userId: a.id,
    confirmPassword: password,
  });
  try {
    await caller().admin.transferHead({
      userId: b.id,
      confirmPassword: password,
    });
  } catch {}
  expect(await db.user.count({ where: { role: "HEAD" } })).toBe(1);
});
it("F18: attendance must not return an error after silently committing the session", async () => {
  // Simulate an unavailable downstream flag query after the attendance transaction commits.
  const spy = vi
    .spyOn(flags, "syncSessionFlag")
    .mockRejectedValueOnce(new Error("Simulated downstream database outage"));
  let failed = false;
  try {
    await tutor().tutor.submitAttendance(attendance());
  } catch {
    failed = true;
  } finally {
    spy.mockRestore();
  }
  expect({ failed, committed: await db.session.count() }).toEqual({
    failed: true,
    committed: 0,
  });
});
it("F19: announcement deletion undo must retain existing acknowledgements", async () => {
  const a = await db.announcement.create({
    data: {
      title: "Review notice",
      body: "Read me",
      createdById: "review-head",
      acks: { create: { userId: "review-user" } },
    },
  });
  await caller().admin.deleteAnnouncement({ id: a.id });
  const log = await db.auditLog.findFirstOrThrow({ where: { entityId: a.id } });
  await caller().admin.undoAudit({ id: log.id });
  expect(
    await db.announcementAck.count({ where: { announcementId: a.id } }),
  ).toBe(1);
});
it("F20: suspended viewer cannot read the admin area", async () => {
  await db.user.update({
    where: { id: "review-viewer" },
    data: { suspendedAt: new Date() },
  });
  await expect(
    caller("VIEWER", "review-viewer").admin.subjects(),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("F21: meetings created with the website form must belong to the current term", async () => {
  // The actual website sends only title and date, with no termId.
  const meeting = await caller().admin.createMeeting({
    title: "Website-created meeting",
    date: new Date("2026-09-07"),
  });
  expect(meeting.termId).toBe("review-term");
});

it("parallel attendance retries persist one block and one set of cards", async () => {
  const input = {
    ...attendance(),
    tutees: [{ tuteeId: "review-tutee", status: "UNEXCUSED_ABSENT" as const }],
  };
  const results = await Promise.all([
    tutor().tutor.submitAttendance(input),
    tutor().tutor.submitAttendance(input),
  ]);
  expect(results[0]?.id).toBe(results[1]?.id);
  expect(await db.session.count()).toBe(1);
  expect(await db.disciplinaryCard.count()).toBe(1);
});
it("a changed payload for an existing teaching block must use correction instead of duplicate submission", async () => {
  await tutor().tutor.submitAttendance(attendance());
  await expect(
    tutor().tutor.submitAttendance({
      ...attendance(),
      comments: "Changed after submission",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("stale profile edits do not reactivate a removed tutee", async () => {
  const before = await db.tutee.findUniqueOrThrow({
    where: { id: "review-tutee" },
  });
  await caller().admin.updateTutee({
    id: before.id,
    expectedUpdatedAt: before.updatedAt,
    englishName: before.englishName,
    status: "INACTIVE",
  });
  await expect(
    caller().admin.updateTutee({
      id: before.id,
      expectedUpdatedAt: before.updatedAt,
      englishName: "Corrected name",
      status: "ACTIVE",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: before.id } })).status,
  ).toBe("INACTIVE");
});
it("deleted accounts cannot use an old session", async () => {
  await db.user.delete({ where: { id: "review-viewer" } });
  await expect(
    caller("VIEWER", "review-viewer").admin.subjects(),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
it("verified email change updates the linked identity once", async () => {
  await db.emailVerificationCode.create({
    data: {
      userId: "review-user",
      purpose: "EMAIL_CHANGE",
      targetEmail: "verified-new@example.test",
      codeHash: hashCode("R2V3W"),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  expect(await confirmEmailChange("review-user", "WRONG")).toBe(false);
  expect(await confirmEmailChange("review-user", "R2V3W")).toBe(true);
  expect(await confirmEmailChange("review-user", "R2V3W")).toBe(false);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: "review-user" } })).email,
  ).toBe("verified-new@example.test");
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: "review-tutor" } })).email,
  ).toBe("verified-new@example.test");
});
it("verified email change still rejects another roster identity", async () => {
  await db.tutor.create({
    data: { englishName: "Different person", email: "claimed@example.test" },
  });
  await db.emailVerificationCode.create({
    data: {
      userId: "review-user",
      purpose: "EMAIL_CHANGE",
      targetEmail: "claimed@example.test",
      codeHash: hashCode("R2V3W"),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await expect(
    confirmEmailChange("review-user", "R2V3W"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: "review-user" } })).email,
  ).toBe("review-user@example.test");
});
it("fresh configuration initialization is idempotent under concurrent requests", async () => {
  await db.pairingTutee.deleteMany();
  await db.pairing.deleteMany();
  await db.term.deleteMany();
  await Promise.all([
    db.$transaction((tx) => initializeProgram(tx, "26-27", "Q1")),
    db.$transaction((tx) => initializeProgram(tx, "26-27", "Q1")),
  ]);
  expect(await db.term.count({ where: { active: true } })).toBe(1);
  expect(await db.term.count()).toBe(1);
});

// Product-policy integration scenarios run against the same explicitly isolated database.
async function studentAccount(
  id = "student-one",
  studentId: string | null = "review-tutee",
) {
  await db.user.create({
    data: {
      id,
      email: `${id}@example.test`,
      name: id,
      role: "STUDENT",
      studentId,
      emailVerifiedAt: new Date(),
      passwordHash: hashPassword(password),
    },
  });
  return caller("STUDENT", id);
}
it("students see only their own attendance and cannot edit management records", async () => {
  const a = await studentAccount();
  const b = await studentAccount("student-two", null);
  await tutor().tutor.submitAttendance(attendance());
  expect((await a.student.me({ page: 0 })).sessions).toHaveLength(1);
  expect((await b.student.me({ page: 0 })).sessions).toHaveLength(0);
  await expect(a.admin.tutees()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    a.corrections.attendance({ id: "unknown" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("policy updates require renewed consent while preserving the accepted snapshot", async () => {
  const before = await tutor().student.policy({ slug: "tutor-policy" });
  await caller().admin.upsertPolicy({
    slug: "tutor-policy",
    locale: "en",
    title: "Changed",
    body: "New policy",
    version: "2",
  });
  expect(
    (await tutor().student.policy({ slug: "tutor-policy" })).accepted,
  ).toBe(false);
  await expect(
    tutor().tutor.submitAttendance(attendance()),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    tutor().student.acceptPolicy({
      slug: "tutor-policy",
      revision: before.revision,
      signature: "Test",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.policyAcceptance.count({ where: { userId: "review-user" } }),
  ).toBe(2);
  const current = await tutor().student.policy({ slug: "tutor-policy" });
  await tutor().student.acceptPolicy({
    slug: "tutor-policy",
    revision: current.revision,
    signature: "Test",
  });
  await tutor().tutor.submitAttendance(attendance());
});
it("private feedback is scoped to the student and staff; sharing can be revoked", async () => {
  const a = await studentAccount();
  const b = await studentAccount("student-two", null);
  const session = await tutor().tutor.submitAttendance(attendance());
  await expect(
    b.student.feedback({ sessionId: session.id, rating: 3, body: "Not mine" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await a.student.feedback({
    sessionId: session.id,
    rating: 3,
    body: "Please slow down",
  });
  await expect(tutor().student.feedbackList({ page: 0 })).rejects.toMatchObject(
    { code: "FORBIDDEN" },
  );
  expect(await caller().student.feedbackList({ page: 0 })).toHaveLength(1);
  await caller().student.setFeedbackSettings({ share: true });
  expect(await tutor().student.feedbackList({ page: 0 })).toHaveLength(1);
  await caller().student.setFeedbackSettings({ share: false });
  await expect(tutor().student.feedbackList({ page: 0 })).rejects.toMatchObject(
    { code: "FORBIDDEN" },
  );
});
it("messages remain participant-only and retries do not duplicate messages or notifications", async () => {
  const a = await studentAccount();
  const b = await studentAccount("student-two", null);
  const msg = {
    recipientId: "student-one",
    body: "Let's discuss your concern",
    clientKey: crypto.randomUUID(),
  };
  await Promise.all([
    caller().messaging.send(msg),
    caller().messaging.send(msg),
  ]);
  expect(await db.directMessage.count()).toBe(1);
  expect(
    await db.notification.count({ where: { userId: "student-one" } }),
  ).toBe(1);
  expect(await a.messaging.inbox({ page: 0 })).toHaveLength(1);
  expect(await b.messaging.inbox({ page: 0 })).toHaveLength(0);
  await expect(
    b.messaging.send({
      recipientId: "student-one",
      body: "Hello",
      clientKey: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const row = await db.directMessage.findFirstOrThrow();
  await b.messaging.markRead({ id: row.id });
  expect(
    (await db.directMessage.findUniqueOrThrow({ where: { id: row.id } }))
      .readAt,
  ).toBeNull();
  await a.messaging.markRead({ id: row.id });
  expect(
    (await db.directMessage.findUniqueOrThrow({ where: { id: row.id } }))
      .readAt,
  ).not.toBeNull();
});
it("suspended senders and recipients cannot exchange new messages", async () => {
  const a = await studentAccount();
  await db.user.update({
    where: { id: "student-one" },
    data: { suspendedAt: new Date() },
  });
  await expect(
    a.messaging.send({
      recipientId: "review-head",
      body: "Hello",
      clientKey: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller().messaging.send({
      recipientId: "student-one",
      body: "Hello",
      clientKey: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("student appeals only affect their own card and cannot be reviewed twice", async () => {
  const a = await studentAccount();
  const b = await studentAccount("student-two", null);
  const card = await db.disciplinaryCard.create({
    data: {
      tuteeId: "review-tutee",
      color: "RED",
      reviewStatus: "VALID",
      reason: "Test card",
    },
  });
  await expect(
    b.student.appeal({ cardId: card.id, body: "Wrong" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await a.student.appeal({ cardId: card.id, body: "I attended" });
  const row = await db.studentAppeal.findFirstOrThrow();
  const decision = {
    id: row.id,
    expectedUpdatedAt: row.updatedAt,
    overturn: true,
    reason: "Verified original record",
  };
  await caller().student.decideAppeal(decision);
  expect(
    (await db.disciplinaryCard.findUniqueOrThrow({ where: { id: card.id } }))
      .reviewStatus,
  ).toBe("INVALID");
  await expect(caller().student.decideAppeal(decision)).rejects.toMatchObject({
    code: "CONFLICT",
  });
});
it("student support separates pending and resolved appeals with exact totals", async () => {
  await studentAccount();
  await db.studentAppeal.createMany({
    data: [
      ...Array.from({ length: 21 }, (_, i) => ({
        id: `pending-appeal-${i}`,
        studentId: "review-tutee",
        cardId: `pending-card-${i}`,
        body: "Pending appeal",
        state: "PENDING",
      })),
      {
        id: "upheld-appeal",
        studentId: "review-tutee",
        cardId: "upheld-card",
        body: "Upheld appeal",
        state: "UPHELD",
      },
      {
        id: "rejected-appeal",
        studentId: "review-tutee",
        cardId: "rejected-card",
        body: "Rejected appeal",
        state: "REJECTED",
      },
    ],
  });

  const pendingFirst = await caller().student.appeals({
    page: 0,
    state: "PENDING",
  });
  expect(pendingFirst.total).toBe(21);
  expect(pendingFirst.rows).toHaveLength(20);
  expect(pendingFirst.rows.every((row) => row.state === "PENDING")).toBe(true);

  const pendingSecond = await caller().student.appeals({
    page: 1,
    state: "PENDING",
  });
  expect(pendingSecond.total).toBe(21);
  expect(pendingSecond.rows).toHaveLength(1);

  const resolved = await caller().student.appeals({
    page: 0,
    state: "RESOLVED",
  });
  expect(resolved.total).toBe(2);
  expect(resolved.rows).toHaveLength(2);
  expect(resolved.rows.map((row) => row.state).sort()).toEqual([
    "REJECTED",
    "UPHELD",
  ]);
});
it("expired disciplinary appeals are rejected", async () => {
  const a = await studentAccount();
  const card = await db.disciplinaryCard.create({
    data: {
      tuteeId: "review-tutee",
      color: "RED",
      createdAt: new Date("2025-01-01"),
    },
  });
  await expect(
    a.student.appeal({ cardId: card.id, body: "Late" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
it("translator edits stay unpublished until staff approve them", async () => {
  await db.user.update({
    where: { id: "review-user" },
    data: { canTranslate: true },
  });
  const key = "workflows.messages";
  await tutor().localization.setString({
    locale: "en",
    key,
    value: "Private Draft Label",
  });
  expect(await db.messageOverride.count({ where: { key } })).toBe(0);
  const draft = await db.translationDraft.findFirstOrThrow();
  await expect(
    tutor().translationReview.decide({
      id: draft.id,
      approve: true,
      expectedUpdatedAt: draft.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller().translationReview.decide({
    id: draft.id,
    approve: true,
    expectedUpdatedAt: draft.updatedAt,
  });
  expect(
    (
      await db.messageOverride.findUniqueOrThrow({
        where: { locale_key: { locale: "en", key } },
      })
    ).value,
  ).toBe("Private Draft Label");
  await expect(
    caller().translationReview.decide({
      id: draft.id,
      approve: true,
      expectedUpdatedAt: draft.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("translators cannot publish or delete landing structures", async () => {
  await db.user.update({
    where: { id: "review-user" },
    data: { canTranslate: true },
  });
  await expect(
    tutor().home.deleteNews({ id: "anything" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await tutor().home.setContent({
    locale: "en",
    key: "heroTitle",
    value: "Draft title",
  });
  expect(await db.homeContent.count()).toBe(0);
  expect(await db.translationDraft.count()).toBe(1);
});
it("management attendance corrections notify HEAD", async () => {
  const session = await tutor().tutor.submitAttendance(attendance());
  const input = await correction(session.id);
  await caller().corrections.correctAttendance(input);
  expect(
    await db.notification.count({
      where: { userId: "review-head", title: "Management corrected a record" },
    }),
  ).toBe(1);
});
it("room overlaps are blocked at the database boundary, including concurrent bookings", async () => {
  const data = {
    tutorId: "review-tutor",
    termId: "review-term",
    roomId,
    subject: "Other",
    dayOfWeek: 1,
    startMin: 950,
    endMin: 1000,
  };
  await expect(db.pairing.create({ data })).rejects.toThrow(
    "Room already allocated",
  );
  const concurrent = await Promise.allSettled([
    db.pairing.create({ data: { ...data, startMin: 1000, endMin: 1060 } }),
    db.pairing.create({ data: { ...data, startMin: 1030, endMin: 1090 } }),
  ]);
  expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("room boundaries and separate terms permit non-overlapping allocations", async () => {
  await db.pairing.create({
    data: {
      tutorId: "review-tutor",
      termId: "review-term",
      roomId,
      subject: "Next",
      dayOfWeek: 1,
      startMin: 990,
      endMin: 1050,
    },
  });
  await db.term.create({
    data: {
      id: "next-term",
      schoolYear: "26-27",
      quarter: "Q2",
      name: "Q2",
      active: false,
    },
  });
  await db.pairing.create({
    data: {
      tutorId: "review-tutor",
      termId: "next-term",
      roomId,
      subject: "Next",
      dayOfWeek: 1,
      startMin: 930,
      endMin: 990,
    },
  });
});
it("room blackout edits cannot invalidate existing active allocations", async () => {
  await expect(
    db.roomUnavailability.create({
      data: { roomId, dayOfWeek: 1, startMin: 960, endMin: 1020 },
    }),
  ).rejects.toThrow("Room already allocated");
});
it("meeting allowance counts unexcused absences across Q1/Q2 and corrects the threshold", async () => {
  const person = await db.tutor.create({
    data: { englishName: "Meeting Tutor" },
  });
  await db.term.create({
    data: {
      id: "q2-test",
      name: "Q2",
      schoolYear: "26-27",
      quarter: "Q2",
      active: false,
    },
  });
  const meetings = [];
  for (let i = 0; i < 5; i++)
    meetings.push(
      await db.tutorMeeting.create({
        data: {
          title: `Meeting ${i}`,
          date: new Date(`2026-09-${10 + i}T04:00:00Z`),
          termId: i < 3 ? "review-term" : "q2-test",
        },
      }),
    );
  for (const m of meetings)
    await caller().admin.recordMeetingAttendance({
      meetingId: m.id,
      entries: [{ tutorId: person.id, status: "UNEXCUSED_ABSENT" }],
    });
  expect(
    (
      await db.serviceHourAdjustment.aggregate({
        where: { tutorId: person.id },
        _sum: { amount: true },
      })
    )._sum.amount,
  ).toBe(0.5);
  await caller().admin.recordMeetingAttendance({
    meetingId: meetings[0]!.id,
    entries: [{ tutorId: person.id, status: "EXCUSED_ABSENT" }],
  });
  expect(
    (
      await db.serviceHourAdjustment.aggregate({
        where: { tutorId: person.id },
        _sum: { amount: true },
      })
    )._sum.amount,
  ).toBe(0.25);
  await caller().admin.deleteMeeting({ id: meetings[1]!.id });
  expect(
    await db.serviceHourAdjustment.count({ where: { tutorId: person.id } }),
  ).toBe(0);
});
it("meeting excuses close 60 minutes before the meeting", async () => {
  const m = await db.tutorMeeting.create({
    data: {
      title: "Soon",
      date: new Date(Date.now() + 45 * 60000),
      termId: "review-term",
    },
  });
  await expect(
    tutor().tutor.excuseMeeting({ meetingId: m.id, reason: "Class" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await db.tutorMeeting.update({
    where: { id: m.id },
    data: { date: new Date(Date.now() + 61 * 60000) },
  });
  await tutor().tutor.excuseMeeting({ meetingId: m.id, reason: "Class" });
});
async function interviewFixture() {
  const panel = [];
  for (let i = 0; i < 3; i++) {
    const person = await db.tutor.create({
      data: { englishName: `Panel ${i}`, status: "ACTIVE" },
    });
    panel.push(person);
    await db.user.create({
      data: {
        id: `panel-user-${i}`,
        email: `panel${i}@example.test`,
        role: i === 0 ? "ADMIN" : "TUTOR",
        tutorId: person.id,
      },
    });
  }
  const app = await db.tutorApplication.create({
    data: {
      name: "Candidate",
      email: "candidate@example.test",
      subjectIntents: { create: { subjectId: "review-subject" } },
    },
  });
  await caller().interviewManagement.qualify({
    tutorId: panel[1]!.id,
    subjectId: "review-subject",
    qualified: true,
  });
  await caller().admin.assignInterviewers({
    applicationId: app.id,
    tutorIds: panel.map((p) => p.id),
    headTutorId: panel[0]!.id,
    expectedUpdatedAt: app.updatedAt,
  });
  return { app, panel };
}
it("interview acceptance cannot bypass a valid panel or missing votes", async () => {
  const { app, panel } = await interviewFixture();
  let current = await db.tutorApplication.findUniqueOrThrow({
    where: { id: app.id },
  });
  await expect(
    caller().admin.setApplicationStatus({
      id: app.id,
      status: "ACCEPTED",
      expectedUpdatedAt: current.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  for (let i = 0; i < 3; i++)
    await caller(
      i === 0 ? "ADMIN" : "TUTOR",
      `panel-user-${i}`,
      panel[i]!.id,
    ).tutor.castInterviewVote({ applicationId: app.id, accept: i !== 2 });
  current = await db.tutorApplication.findUniqueOrThrow({
    where: { id: app.id },
  });
  const chair = caller("ADMIN", "panel-user-0", panel[0]!.id);
  await expect(
    chair.tutor.decideInterview({
      applicationId: app.id,
      accept: false,
      comment: "Override",
      expectedUpdatedAt: current.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await chair.tutor.decideInterview({
    applicationId: app.id,
    accept: true,
    comment: "Majority accepts",
    expectedUpdatedAt: current.updatedAt,
  });
  await expect(
    caller("TUTOR", "panel-user-1", panel[1]!.id).tutor.castInterviewVote({
      applicationId: app.id,
      accept: false,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("interview completion awards only attendees, and a correction replaces credits", async () => {
  const { app, panel } = await interviewFixture();
  const input = {
    applicationId: app.id,
    durationMin: 30,
    completedAt: new Date(),
    attendedTutorIds: panel.map((p) => p.id),
    reason: "Verified attendance",
  };
  await caller().interviewManagement.complete(input);
  await caller().interviewManagement.complete(input);
  expect(await db.serviceHourAdjustment.count()).toBe(3);
  await caller().interviewManagement.complete({
    ...input,
    durationMin: 45,
    attendedTutorIds: [panel[0]!.id],
  });
  const rows = await db.serviceHourAdjustment.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0]!.amount).toBe(0.75);
});

it("panel assignment rejects missing qualification and a lower-ranking chair", async () => {
  const { app, panel } = await interviewFixture();
  let current = await db.tutorApplication.findUniqueOrThrow({
    where: { id: app.id },
  });
  await db.tutorQualification.deleteMany();
  await expect(
    caller().admin.assignInterviewers({
      applicationId: app.id,
      tutorIds: panel.map((p) => p.id),
      headTutorId: panel[0]!.id,
      expectedUpdatedAt: current.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await caller().interviewManagement.qualify({
    tutorId: panel[1]!.id,
    subjectId: "review-subject",
    qualified: true,
  });
  await db.user.update({
    where: { id: "panel-user-0" },
    data: { role: "COORDINATOR" },
  });
  await db.user.update({
    where: { id: "panel-user-1" },
    data: { role: "ADMIN" },
  });
  current = await db.tutorApplication.findUniqueOrThrow({
    where: { id: app.id },
  });
  await expect(
    caller().admin.assignInterviewers({
      applicationId: app.id,
      tutorIds: panel.map((p) => p.id),
      headTutorId: panel[0]!.id,
      expectedUpdatedAt: current.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
it("only the highest-ranking staff chair can break an interview tie", async () => {
  const { app, panel } = await interviewFixture();
  const fourth = await db.tutor.create({
    data: { englishName: "Fourth", status: "ACTIVE" },
  });
  panel.push(fourth);
  await db.user.create({
    data: {
      id: "panel-user-3",
      email: "fourth@example.test",
      role: "TUTOR",
      tutorId: fourth.id,
    },
  });
  let current = await db.tutorApplication.findUniqueOrThrow({
    where: { id: app.id },
  });
  await caller().admin.assignInterviewers({
    applicationId: app.id,
    tutorIds: panel.map((p) => p.id),
    headTutorId: panel[0]!.id,
    expectedUpdatedAt: current.updatedAt,
  });
  for (let i = 0; i < 4; i++)
    await caller(
      i === 0 ? "ADMIN" : "TUTOR",
      `panel-user-${i}`,
      panel[i]!.id,
    ).tutor.castInterviewVote({ applicationId: app.id, accept: i < 2 });
  current = await db.tutorApplication.findUniqueOrThrow({
    where: { id: app.id },
  });
  await expect(
    caller().admin.setApplicationStatus({
      id: app.id,
      status: "ACCEPTED",
      expectedUpdatedAt: current.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller("ADMIN", "panel-user-0", panel[0]!.id).tutor.decideInterview({
    applicationId: app.id,
    accept: true,
    comment: "Chair tie-break",
    expectedUpdatedAt: current.updatedAt,
  });
  expect(
    (await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } }))
      .status,
  ).toBe("ACCEPTED");
});
it("Q3 starts a fresh meeting allowance, and excused meetings never consume it", async () => {
  const person = await db.tutor.create({
    data: { englishName: "Semester Tester" },
  });
  await db.term.create({
    data: {
      id: "q3-test",
      name: "Q3",
      schoolYear: "26-27",
      quarter: "Q3",
      active: false,
    },
  });
  for (const termId of ["review-term", "q3-test"]) {
    for (let i = 0; i < 4; i++) {
      const m = await db.tutorMeeting.create({
        data: {
          title: "Count",
          termId,
          date: new Date(`2026-09-${11 + i}T04:00:00Z`),
        },
      });
      await caller().admin.recordMeetingAttendance({
        meetingId: m.id,
        entries: [
          {
            tutorId: person.id,
            status: i === 0 ? "EXCUSED_ABSENT" : "UNEXCUSED_ABSENT",
          },
        ],
      });
    }
  }
  expect(
    await db.serviceHourAdjustment.count({ where: { tutorId: person.id } }),
  ).toBe(0);
});
it("school calendar overrides extend appeal deadlines and permit make-up school days", async () => {
  const { appealDeadline } = await import("./student");
  const start = new Date("2026-09-04T03:00:00Z");
  expect(appealDeadline(start).toISOString()).toBe("2026-09-11T15:59:59.999Z");
  expect(
    appealDeadline(start, [
      { date: "2026-09-07", isSchoolDay: false },
    ]).toISOString(),
  ).toBe("2026-09-14T15:59:59.999Z");
  expect(
    appealDeadline(start, [
      { date: "2026-09-05", isSchoolDay: true },
    ]).toISOString(),
  ).toBe("2026-09-10T15:59:59.999Z");
  await caller().student.setCalendarDay({
    date: "2026-09-07",
    isSchoolDay: false,
    note: "Holiday",
  });
  expect(await caller().student.calendar()).toHaveLength(1);
  await expect(
    tutor().student.setCalendarDay({
      date: "2026-09-08",
      isSchoolDay: false,
      note: "Not authorized",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("verified student email changes synchronize their tutee profile", async () => {
  await studentAccount();
  await db.emailVerificationCode.create({
    data: {
      userId: "student-one",
      purpose: "EMAIL_CHANGE",
      targetEmail: "changed-student@example.test",
      codeHash: hashCode("ABCDE"),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  expect(await confirmEmailChange("student-one", "ABCDE")).toBe(true);
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: "review-tutee" } })).email,
  ).toBe("changed-student@example.test");
});
it("rejected translation drafts never become public, and students cannot inspect drafts", async () => {
  await db.user.update({
    where: { id: "review-user" },
    data: { canTranslate: true },
  });
  await tutor().localization.setString({
    locale: "en",
    key: "workflows.messages",
    value: "Do not publish",
  });
  const draft = await db.translationDraft.findFirstOrThrow();
  await caller().translationReview.decide({
    id: draft.id,
    approve: false,
    expectedUpdatedAt: draft.updatedAt,
  });
  expect(await db.messageOverride.count()).toBe(0);
  const student = await studentAccount();
  await expect(
    student.translationReview.list({ page: 0 }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

// Exercise the real API/transactions: simultaneous actions must leave one coherent decision.
for (const kind of ["tutor", "crew"] as const) {
  const request = () =>
    kind === "tutor"
      ? tutor().tutor.requestOptOut({ reason: "Membership regression" })
      : tutor().crew.requestOptOut({ reason: "Membership regression" });
  const findRequests = () =>
    kind === "tutor"
      ? db.tutorStatusRequest.findMany({ where: { tutorId: "review-tutor" } })
      : db.crewStatusRequest.findMany({ where: { userId: "review-user" } });
  const decide = (id: string, approve = true) =>
    kind === "tutor"
      ? caller().admin.decideTutorRequest({ requestId: id, approve })
      : caller().admin.decideCrewRequest({
          requestId: id,
          action: approve ? "APPROVE" : "DENY",
        });
  const recall = (id: string) =>
    kind === "tutor"
      ? tutor().tutor.recallStatusRequest({ requestId: id })
      : tutor().crew.recallOptOut();
  const prepare = async () => {
    await db.user.update({
      where: { id: "review-user" },
      data: { crewStatus: "ACTIVE" },
    });
    await request();
    const row = (await findRequests())[0]!;
    const eligibleAt = new Date(Date.now() - 86_400_000);
    if (kind === "tutor")
      await db.tutorStatusRequest.update({
        where: { id: row.id },
        data: { eligibleAt },
      });
    else
      await db.crewStatusRequest.update({
        where: { id: row.id },
        data: { eligibleAt },
      });
    return row.id;
  };
  const status = async () =>
    kind === "tutor"
      ? (await db.tutor.findUniqueOrThrow({ where: { id: "review-tutor" } }))
          .status
      : (await db.user.findUniqueOrThrow({ where: { id: "review-user" } }))
          .crewStatus;

  it(
    kind + " membership: concurrent submissions reserve one pending request",
    async () => {
      await db.user.update({
        where: { id: "review-user" },
        data: { crewStatus: "ACTIVE" },
      });
      const results = await Promise.allSettled([
        request(),
        request(),
        request(),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await findRequests()).toHaveLength(1);
    },
  );

  it(
    kind +
      " membership: concurrent reentry is single and approval restores access",
    async () => {
      if (kind === "tutor")
        await db.tutor.update({
          where: { id: "review-tutor" },
          data: { status: "OPTED_OUT" },
        });
      else
        await db.user.update({
          where: { id: "review-user" },
          data: { crewStatus: "OPTED_OUT" },
        });
      const reenter = () =>
        kind === "tutor"
          ? tutor().tutor.requestReentry({ reason: "Ready to return" })
          : tutor().crew.requestReentry();
      const results = await Promise.allSettled([reenter(), reenter()]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rows = await findRequests();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.eligibleAt).toBeNull();
      await decide(rows[0]!.id);
      expect(await status()).toBe("ACTIVE");
    },
  );

  it(
    kind +
      " membership: legacy duplicate evidence survives and cannot repeat approval",
    async () => {
      const id = await prepare();
      const data = {
        kind: "OPT_OUT" as const,
        eligibleAt: new Date(Date.now() - 86_400_000),
        reason: "Legacy duplicate",
      };
      const duplicate =
        kind === "tutor"
          ? await db.tutorStatusRequest.create({
              data: { tutorId: "review-tutor", ...data },
            })
          : await db.crewStatusRequest.create({
              data: { userId: "review-user", ...data },
            });
      await decide(id);
      await expect(decide(duplicate.id)).rejects.toThrow("Membership changed");
      await decide(duplicate.id, false);
      expect(await findRequests()).toHaveLength(2);
      expect((await findRequests()).map((row) => row.state).sort()).toEqual([
        "APPROVED",
        "DENIED",
      ]);
      expect(await status()).toBe("OPTED_OUT");
    },
  );

  it(
    kind + " membership: recall and approval cannot overwrite each other",
    async () => {
      const id = await prepare();
      const results = await Promise.allSettled([recall(id), decide(id)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const row = (await findRequests())[0]!;
      expect(["APPROVED", "RECALLED"]).toContain(row.state);
      expect(await status()).toBe(
        row.state === "APPROVED" ? "OPTED_OUT" : "ACTIVE",
      );
      expect(await db.auditLog.count({ where: { entityId: id } })).toBe(
        row.state === "APPROVED" ? 1 : 0,
      );
    },
  );

  it(
    kind + " membership: competing reviewers commit only one decision",
    async () => {
      const id = await prepare();
      const results = await Promise.allSettled([decide(id), decide(id, false)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const row = (await findRequests())[0]!;
      expect(await status()).toBe(
        row.state === "APPROVED" ? "OPTED_OUT" : "ACTIVE",
      );
      expect(await db.auditLog.count({ where: { entityId: id } })).toBe(1);
    },
  );

  it(
    kind +
      " membership: an audit failure rolls back decision, status and notification",
    async () => {
      const id = await prepare();
      const before = await db.notification.count();
      const failure = vi
        .spyOn(audit, "recordAudit")
        .mockRejectedValueOnce(new Error("membership audit unavailable"));
      try {
        await expect(decide(id)).rejects.toThrow(
          "membership audit unavailable",
        );
      } finally {
        failure.mockRestore();
      }
      expect((await findRequests())[0]!.state).toBe("PENDING");
      expect(await status()).toBe("ACTIVE");
      expect(await db.notification.count()).toBe(before);
      await expect(decide(id)).resolves.toEqual({ ok: true });
    },
  );

  it(
    kind +
      " membership: old requests cannot reactivate or opt out a manually archived member",
    async () => {
      const id = await prepare();
      if (kind === "tutor")
        await db.tutor.update({
          where: { id: "review-tutor" },
          data: { status: "ARCHIVED" },
        });
      else
        await db.user.update({
          where: { id: "review-user" },
          data: { crewStatus: "INACTIVE" },
        });
      await expect(decide(id)).rejects.toThrow("Membership changed");
      expect((await findRequests())[0]!.state).toBe("PENDING");
      await expect(decide(id, false)).resolves.toEqual({ ok: true });
      expect(await status()).toBe(kind === "tutor" ? "ARCHIVED" : "INACTIVE");
    },
  );
}
