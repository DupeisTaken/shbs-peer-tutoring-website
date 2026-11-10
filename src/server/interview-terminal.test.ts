import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { approveQualification } from "~/server/qualifications";

// The same authorized chair may resolve either side of an open tie. Once an
// outcome is final, fresh optimistic tokens cannot authorize a second decision.
const caller = () =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: "terminal-chair", name: "Synthetic Chair" },
      role: "ADMIN" as Session["role"],
      tutorId: "terminal-chair-tutor",
      expires: "2099-01-01",
    },
  });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((row) => '"' + row.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.term.create({
    data: {
      id: "terminal-term",
      name: "Synthetic Q1",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  for (const [id, role] of [
    ["terminal-chair", "ADMIN"],
    ["terminal-head", "HEAD"],
    ["terminal-member-a", "TUTOR"],
    ["terminal-member-b", "TUTOR"],
  ] as const) {
    await db.tutor.create({
      data: {
        id: `${id}-tutor`,
        englishName: `Synthetic ${id}`,
        status: "ACTIVE",
      },
    });
    await db.user.create({
      data: {
        id,
        role,
        username: id,
        email: `${id}@example.test`,
        tutorId: `${id}-tutor`,
        emailVerifiedAt: new Date(),
      },
    });
  }
  await db.subject.create({
    data: { id: "terminal-subject", name: "Synthetic Terminal Mathematics" },
  });
  await db.$transaction((tx) =>
    approveQualification(
      tx,
      "terminal-member-a-tutor",
      "terminal-subject",
      "terminal-head",
    ),
  );
});
afterAll(() => db.$disconnect());

async function tiedPanel() {
  const panel = [
    "terminal-chair",
    "terminal-head",
    "terminal-member-a",
    "terminal-member-b",
  ];
  return db.tutorApplication.create({
    data: {
      name: "Synthetic Terminal Candidate",
      email: "terminal-candidate@example.test",
      status: "INTERVIEW",
      subjectIntents: { create: { subjectId: "terminal-subject" } },
      interviewers: {
        create: panel.map((id) => ({
          tutorId: `${id}-tutor`,
          isHead: id === "terminal-chair",
        })),
      },
      // A tie legitimately permits the chair to choose either outcome while OPEN;
      // it must not permit choosing a second outcome after the decision is final.
      votes: {
        create: panel.map((id, index) => ({
          tutorId: `${id}-tutor`,
          accept: index < 2,
        })),
      },
    },
  });
}

const completion = {
  completedAt: new Date("2026-09-15T04:00:00Z"),
  durationMin: 30,
  attendedTutorIds: ["terminal-chair-tutor", "terminal-member-a-tutor"],
};

// Failed attempts can create their own audit receipt, but may not mutate any
// persisted admission, service, panel, or recovery source evidence.
async function outcome(applicationId: string) {
  return {
    app: await db.tutorApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: {
        interviewers: { orderBy: { tutorId: "asc" } },
        votes: { orderBy: { tutorId: "asc" } },
      },
    }),
    tutors: await db.tutor.findMany({ orderBy: { id: "asc" } }),
    codes: await db.registrationCode.findMany({ orderBy: { id: "asc" } }),
    credits: await db.serviceHourAdjustment.findMany({
      orderBy: { id: "asc" },
    }),
    qualifications: await db.tutorQualification.findMany({
      orderBy: [{ tutorId: "asc" }, { subjectId: "asc" }],
    }),
    grants: await db.qualificationGrant.findMany({
      orderBy: [
        { tutorId: "asc" },
        { sourceSubjectId: "asc" },
        { subjectId: "asc" },
      ],
    }),
    pairings: await db.pairing.findMany({ orderBy: { id: "asc" } }),
    assignments: await db.pairingTutee.findMany({
      orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }],
    }),
    tutees: await db.tutee.findMany({ orderBy: { id: "asc" } }),
    notices: await db.notification.findMany({ orderBy: { id: "asc" } }),
    recovery: await db.recoveryAction.findMany({ orderBy: { id: "asc" } }),
  };
}

it.each(["fresh", "stale"] as const)(
  "preserves accepted admission when its chair submits a %s-token rejection",
  async (version) => {
    const app = await tiedPanel();
    await caller().tutor.decideInterview({
      applicationId: app.id,
      accept: true,
      comment: "Synthetic final admission",
      expectedUpdatedAt: app.updatedAt,
      completion,
    });
    const accepted = await db.tutorApplication.findUniqueOrThrow({
      where: { id: app.id },
    });
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.promotedTutorId).not.toBeNull();
    const tutorBefore = await db.tutor.findUniqueOrThrow({
      where: { id: accepted.promotedTutorId! },
    });
    const codesBefore = await db.registrationCode.findMany({
      where: { applicationId: app.id },
      orderBy: { id: "asc" },
    });
    expect(codesBefore).toHaveLength(1);
    const tutee = await db.tutee.create({
      data: { englishName: "Synthetic Assigned Student", status: "ACTIVE" },
    });
    await db.pairing.create({
      data: {
        tutorId: tutorBefore.id,
        termId: "terminal-term",
        subject: "Synthetic Terminal Mathematics",
        dayOfWeek: 1,
        startMin: 600,
        endMin: 630,
        roomMode: "NONE",
        tutees: { create: { tuteeId: tutee.id } },
      },
    });
    const before = await outcome(app.id);
    expect(before.credits).toHaveLength(2);
    const result = await caller()
      .tutor.decideInterview({
        applicationId: app.id,
        accept: false,
        comment: "Synthetic second opposite outcome",
        expectedUpdatedAt:
          version === "fresh" ? accepted.updatedAt : new Date(0),
      })
      .catch((error: unknown) => error);
    // Soft assertions retain all observed integrity effects in one failing receipt.
    expect.soft(result).toMatchObject({ code: "CONFLICT" });
    expect
      .soft(
        await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } }),
      )
      .toMatchObject({
        status: "ACCEPTED",
        decisionComment: accepted.decisionComment,
        decidedAt: accepted.decidedAt,
      });
    expect
      .soft(await db.tutor.findUniqueOrThrow({ where: { id: tutorBefore.id } }))
      .toMatchObject({ status: tutorBefore.status });
    expect
      .soft(
        await db.registrationCode.findMany({
          where: { applicationId: app.id },
          orderBy: { id: "asc" },
        }),
      )
      .toEqual(codesBefore);
    expect.soft(await outcome(app.id)).toEqual(before);
  },
);

it.each(["fresh", "stale"] as const)(
  "preserves an initial rejected decision note and time on repeated %s-token rejection",
  async (version) => {
    const app = await tiedPanel();
    await caller().tutor.decideInterview({
      applicationId: app.id,
      accept: false,
      comment: "Synthetic original final rejection",
      expectedUpdatedAt: app.updatedAt,
    });
    const rejected = await db.tutorApplication.findUniqueOrThrow({
      where: { id: app.id },
    });
    const before = await outcome(app.id);
    const result = await caller()
      .tutor.decideInterview({
        applicationId: app.id,
        accept: false,
        comment: "Synthetic replacement final note",
        expectedUpdatedAt:
          version === "fresh" ? rejected.updatedAt : new Date(0),
      })
      .catch((error: unknown) => error);
    expect.soft(result).toMatchObject({ code: "CONFLICT" });
    expect
      .soft(
        await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } }),
      )
      .toMatchObject({
        status: "REJECTED",
        decisionComment: rejected.decisionComment,
        decidedAt: rejected.decidedAt,
      });
    expect.soft(await outcome(app.id)).toEqual(before);
  },
);

it.each(["changed note", "changed completion"] as const)(
  "refuses %s on a fresh-token accepted retry",
  async (change) => {
    const app = await tiedPanel();
    const input = {
      applicationId: app.id,
      accept: true,
      comment: "Synthetic immutable admission",
      expectedUpdatedAt: app.updatedAt,
      completion,
    };
    await caller().tutor.decideInterview(input);
    const before = await outcome(app.id);
    const retry = {
      ...input,
      expectedUpdatedAt: before.app.updatedAt,
      ...(change === "changed note"
        ? { comment: "Synthetic replacement admission note" }
        : { completion: { ...completion, durationMin: 45 } }),
    };
    await expect(caller().tutor.decideInterview(retry)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await outcome(app.id)).toEqual(before);
  },
);

it("keeps an exact accepted retry read-only even with the original stale version", async () => {
  const app = await tiedPanel();
  const input = {
    applicationId: app.id,
    accept: true,
    comment: "Synthetic exact admission receipt",
    expectedUpdatedAt: app.updatedAt,
    completion,
  };
  await caller().tutor.decideInterview(input);
  const before = await outcome(app.id);
  await expect(caller().tutor.decideInterview(input)).resolves.toEqual({
    ok: true,
  });
  expect(await outcome(app.id)).toEqual(before);
});

it("does not reopen a rejected tie through a fresh-token acceptance", async () => {
  const app = await tiedPanel();
  await caller().tutor.decideInterview({
    applicationId: app.id,
    accept: false,
    comment: "Synthetic final rejection",
    expectedUpdatedAt: app.updatedAt,
  });
  const before = await outcome(app.id);
  await expect(
    caller().tutor.decideInterview({
      applicationId: app.id,
      accept: true,
      comment: "Synthetic opposite admission",
      expectedUpdatedAt: before.app.updatedAt,
      completion,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await outcome(app.id)).toEqual(before);
});

it("rejects a stale open-tie rejection without creating a final outcome", async () => {
  const app = await tiedPanel();
  const before = await outcome(app.id);
  await expect(
    caller().tutor.decideInterview({
      applicationId: app.id,
      accept: false,
      comment: "Synthetic stale rejection",
      expectedUpdatedAt: new Date(0),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await outcome(app.id)).toEqual(before);
});
