import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "../root";
import { db } from "~/server/db";
import {
  parseRecordCsv,
  recordCsv,
  type TransferFile,
} from "~/lib/record-transfer";
import { previewTicket } from "~/server/record-transfer";

const roles = [
  "HEAD",
  "ADMIN",
  "COORDINATOR",
  "VIEWER",
  "STUDENT",
  "TUTOR",
  "CREW",
] as const;
const caller = (role: Session["role"] = "HEAD", id = role) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, name: role, email: `${role}@example.test` },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
  });
const file = (name: string, rows: Record<string, unknown>[]): TransferFile => ({
  name: `${name}.csv`,
  text: recordCsv(Object.keys(rows[0]!), rows),
});
function fixtures() {
  // Deliberately shuffled: import resolves table dependencies, not upload order.
  return [
    file("SessionTutee", [
      { sessionId: "session", tuteeId: "tutee", status: "PRESENT" },
    ]),
    file("PairingTutee", [{ pairingId: "pair", tuteeId: "tutee" }]),
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
        updatedAt: "2024-10-01T10:00:00Z",
      },
    ]),
    file("Pairing", [
      {
        id: "pair",
        tutorId: "tutor",
        termId: "term",
        subject: "Math",
        dayOfWeek: 2,
        startMin: 600,
        endMin: 630,
      },
    ]),
    file("Tutor", [
      {
        id: "tutor",
        englishName: "历史伙伴",
        status: "GRADUATED",
        email: "historical-tutor@example.test",
      },
    ]),
    file("Tutee", [
      {
        id: "tutee",
        englishName: "Past Learner",
        status: "INACTIVE",
        updatedAt: "2024-10-01T10:00:00Z",
      },
    ]),
    file("Term", [
      {
        id: "term",
        schoolYear: "24-25",
        quarter: "Q1",
        name: "24-25 Q1",
        active: false,
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
      },
    ]),
  ];
}

beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/shbs_shipping_test"
  )
    throw new Error(
      "Record transfer tests require isolated shbs_shipping_test",
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
  await db.user.createMany({
    data: roles.map((role) => ({
      id: role,
      role,
      email: `${role}@example.test`,
      name: role,
      passwordHash: "never-export-this",
      sessionVersion: 7,
    })),
  });
});
afterAll(() => db.$disconnect());

it("blocks unauthenticated exports and forged direct imports without a preview", async () => {
  const anonymous = createCaller({ db, headers: new Headers(), session: null });
  await expect(anonymous.recordTransfer.export({})).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  await expect(
    caller().recordTransfer.import({ files: fixtures(), ticket: "forged" }),
  ).rejects.toThrow(/preview/);
  expect(await db.tutor.count()).toBe(0);
});

it("never accepts or exports operational continuation opening provenance", async () => {
  const row = {
    id: "opening-import",
    schoolYear: "26-27",
    quarter: "Q2",
    name: "Historical",
    active: false,
  };
  for (const field of [
    "signupOpeningStateSince",
    "signupFirstOpenedAt",
    "continuationSourceTermId",
    "continuationQuarterTransition",
  ]) {
    await expect(
      caller().recordTransfer.preview({
        files: [
          file("Term", [
            {
              ...row,
              [field]:
                field === "continuationQuarterTransition"
                  ? true
                  : "2026-11-01T00:00:00Z",
            },
          ]),
        ],
      }),
    ).rejects.toThrow();
  }
  await db.term.create({ data: { ...row, quarter: "Q2" } });
  const exported = await caller().recordTransfer.export({});
  const termFile = exported.files.find((item) => item.name === "Term.csv");
  expect(termFile).toBeDefined();
  expect(termFile!.text).not.toMatch(
    /signupOpeningStateSince|signupFirstOpenedAt|continuationSourceTermId|continuationQuarterTransition/,
  );
});

it("preserves the User/Tutor handle namespace and scalar ownership references", async () => {
  await db.user.update({ where: { id: "ADMIN" }, data: { username: "taken" } });
  await expect(
    caller().recordTransfer.preview({
      files: [
        file("Tutor", [
          { id: "new", englishName: "Old Tutor", username: "TAKEN" },
        ]),
      ],
    }),
  ).rejects.toThrow(/username belongs/);
  await expect(
    caller().recordTransfer.preview({
      files: [
        file("StudentProfileOwnership", [
          { tuteeId: "missing", userId: "HEAD" },
        ]),
      ],
    }),
  ).rejects.toThrow(/missing Tutee/);
  expect(await db.studentProfileOwnership.count()).toBe(0);
});

it("does not revive an exported survey verification token", async () => {
  const survey = file("StudentSurvey", [
    {
      id: "survey",
      email: "historic@example.test",
      intakeTermId: "term",
      payload: {},
      policyRevision: "v1",
      policySnapshot: {},
      expiresAt: "2024-10-01T00:00:00Z",
      state: "RECALLED",
    },
  ]);
  const files = [...fixtures(), survey];
  const preview = await caller().recordTransfer.preview({ files });
  await caller().recordTransfer.import({ files, ticket: preview.ticket });
  const stored = await db.studentSurvey.findUniqueOrThrow({
    where: { id: "survey" },
  });
  expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  const exported = await caller().recordTransfer.export({});
  expect(JSON.stringify(exported)).not.toContain(stored.tokenHash);
  await expect(
    caller().recordTransfer.preview({ files: exported.files }),
  ).resolves.toBeDefined();
});

it.each(roles.filter((r) => r !== "HEAD" && r !== "ADMIN"))(
  "blocks %s from preview, import and export",
  async (role) => {
    const files = fixtures();
    await expect(caller(role).recordTransfer.export({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller(role).recordTransfer.preview({ files }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(role).recordTransfer.import({ files, ticket: "anything" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.approvalRequest.count()).toBe(0);
  },
);

it("rejects a stale HEAD cookie after loss of management authority and a suspended HEAD", async () => {
  await db.user.update({
    where: { id: "HEAD" },
    data: { role: "COORDINATOR" },
  });
  await expect(caller().recordTransfer.export({})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await db.user.update({
    where: { id: "HEAD" },
    data: { role: "HEAD", suspendedAt: new Date() },
  });
  await expect(
    caller().recordTransfer.preview({ files: fixtures() }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it.each(["ADMIN", "HEAD"] as const)(
  "%s previews without persistence, imports linked history atomically, and skips identical retries",
  async (role) => {
    const files = fixtures();
    const preview = await caller(role).recordTransfer.preview({ files });
    expect(preview.summary.reduce((n, s) => n + s.created, 0)).toBe(8);
    expect(await db.tutor.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
    expect(await db.person.count()).toBe(0);
    const imported = await caller(role).recordTransfer.import({
      files,
      ticket: preview.ticket,
    });
    expect(imported.summary).toEqual(preview.summary);
    const tutorIdentity = await db.tutor.findUniqueOrThrow({
      where: { id: "tutor" },
      select: { personId: true },
    });
    const studentIdentity = await db.tutee.findUniqueOrThrow({
      where: { id: "tutee" },
      select: { personId: true, updatedAt: true },
    });
    expect(tutorIdentity.personId).toBeTruthy();
    expect(studentIdentity.personId).toBeTruthy();
    expect(tutorIdentity.personId).not.toBe(studentIdentity.personId);
    expect(studentIdentity.updatedAt).toEqual(new Date("2024-10-01T10:00:00Z"));
    const peopleBeforeRetry = await db.person.findMany({
      orderBy: { id: "asc" },
    });
    expect(
      await db.session.findUnique({
        where: { id: "session" },
        include: { tutees: true },
      }),
    ).toMatchObject({
      tutorId: "tutor",
      shCount: 2,
      tutees: [{ tuteeId: "tutee" }],
    });
    const repeat = await caller(role).recordTransfer.import({
      files,
      ticket: preview.ticket,
    });
    expect(repeat.summary.reduce((n, s) => n + s.created, 0)).toBe(0);
    expect(await db.session.count()).toBe(1);
    expect(await db.person.findMany({ orderBy: { id: "asc" } })).toEqual(
      peopleBeforeRetry,
    );
    expect(
      await db.auditLog.count({
        where: { operation: "recordTransfer.import" },
      }),
    ).toBe(2);
  },
);

it("initializes imported explicit ownership without changing account privileges or source versions", async () => {
  const before = await db.user.findUniqueOrThrow({ where: { id: "HEAD" } });
  const files = [
    file("StudentProfileOwnership", [
      { tuteeId: "owned-history", userId: "HEAD" },
    ]),
    file("Tutee", [
      {
        id: "owned-history",
        englishName: "Original history",
        status: "INACTIVE",
        updatedAt: "2024-10-01T10:00:00Z",
      },
    ]),
    // Archives reference the persisted account; its email trigger normalizes case.
    file("User", [{ id: before.id, email: before.email, name: before.name }]),
  ];
  const preview = await caller().recordTransfer.preview({ files });
  expect(await db.person.count()).toBe(0);
  await caller().recordTransfer.import({ files, ticket: preview.ticket });
  const owner = await db.user.findUniqueOrThrow({ where: { id: "HEAD" } });
  expect(owner.personId).toBeTruthy();
  expect(owner).toEqual({ ...before, personId: owner.personId });
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: "owned-history" } }),
  ).toMatchObject({
    personId: owner.personId,
    englishName: "Original history",
    status: "INACTIVE",
    updatedAt: new Date("2024-10-01T10:00:00Z"),
  });
  expect(
    await db.studentProfileOwnership.findUniqueOrThrow({
      where: { tuteeId: "owned-history" },
    }),
  ).toMatchObject({ userId: "HEAD", revision: 1 });
});

it("refuses conflicting explicit imported ownership and rolls back all identity metadata", async () => {
  await db.tutee.create({
    data: { id: "already-current", englishName: "Current source" },
  });
  const owner = await db.user.update({
    where: { id: "ADMIN" },
    data: { studentId: "already-current" },
  });
  const source = await db.tutee.findUniqueOrThrow({
    where: { id: "already-current" },
  });
  const files = [
    file("StudentProfileOwnership", [
      { tuteeId: "already-current", userId: "HEAD" },
    ]),
  ];
  // Import rejects conflicting ownership before directory initialization runs.
  await expect(caller().recordTransfer.preview({ files })).rejects.toThrow(
    "StudentProfileOwnership.csv, row 2: this student profile belongs to another account.",
  );
  expect(await db.person.count()).toBe(0);
  expect(await db.studentProfileOwnership.count()).toBe(0);
  expect(await db.user.findUniqueOrThrow({ where: { id: owner.id } })).toEqual(
    owner,
  );
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: source.id } }),
  ).toEqual(source);
});

it("keeps dated cohort authority outside historical attendance archives", async () => {
  const exported = await caller().recordTransfer.export({ templates: true });
  const attendance = exported.files.find(
    (entry) => entry.name === "Session.csv",
  );
  expect(attendance).toBeDefined();
  expect(attendance!.text).not.toContain("planningCohortId");
  expect(
    exported.files.some((entry) =>
      /^SessionPlan|^SessionNotice|^SessionCalendar/.test(entry.name),
    ),
  ).toBe(false);
  await expect(
    caller().recordTransfer.preview({
      files: [
        file("Session", [
          {
            id: "forged-attendance",
            planningCohortId: "live-cohort",
          },
        ]),
      ],
    }),
  ).rejects.toThrow(/unknown or duplicate columns/);
});

it("keeps operational identity IDs and invitation revisions outside archive authority", async () => {
  const exported = await caller().recordTransfer.export({ templates: true });
  for (const name of ["User.csv", "Tutor.csv", "Tutee.csv"])
    expect(
      exported.files.find((entry) => entry.name === name)?.text,
    ).not.toMatch(/personId|historyIdentityRevision/);
  for (const metadata of [
    { personId: "forged-person" },
    { historyIdentityRevision: 10 },
  ])
    await expect(
      caller().recordTransfer.preview({
        files: [
          file("Tutee", [
            {
              id: "forged",
              englishName: "Source",
              updatedAt: "2024-10-01T10:00:00Z",
              ...metadata,
            },
          ]),
        ],
      }),
    ).rejects.toThrow(/unknown or duplicate columns/);
  expect(await db.person.count()).toBe(0);
  expect(await db.tutee.count()).toBe(0);
});

it("round-trips historical pairing groups before their member references", async () => {
  const files = fixtures().filter((entry) => entry.name !== "Pairing.csv");
  files.push(
    file("PairingGroup", [
      {
        id: "historic-group",
        tutorId: "tutor",
        termId: "term",
        primaryPairingId: "pair",
        updatedAt: "2024-10-01T10:00:00Z",
      },
    ]),
  );
  files.push(
    file(
      "Pairing",
      ["pair", "second-pair"].map((id) => ({
        id,
        tutorId: "tutor",
        termId: "term",
        groupId: "historic-group",
        subject: id === "pair" ? "Math" : "Physics",
        dayOfWeek: 2,
        startMin: 600,
        endMin: 630,
      })),
    ),
  );
  const preview = await caller().recordTransfer.preview({ files });
  await caller().recordTransfer.import({ files, ticket: preview.ticket });
  const retainedGroup = await db.pairingGroup.findUnique({
    where: { id: "historic-group" },
    include: { pairings: true },
  });
  expect(retainedGroup?.primaryPairingId).toBe("pair");
  expect(retainedGroup?.pairings.map((p) => p.id).sort()).toEqual([
    "pair",
    "second-pair",
  ]);
  const exported = await caller().recordTransfer.export({});
  expect(
    exported.files.find((entry) => entry.name === "PairingGroup.csv")?.text,
  ).toContain("historic-group");
  expect(
    exported.files.find((entry) => entry.name === "Pairing.csv")?.text,
  ).toContain("historic-group");
  const repeated = await caller().recordTransfer.preview({
    files: exported.files,
  });
  expect(repeated.summary.every((entry) => entry.created === 0)).toBe(true);
});

it("rolls back earlier rows on missing references and returns CSV row context", async () => {
  const files = [
    ...fixtures(),
    file("MeetingAttendance", [
      { id: "bad", meetingId: "missing", tutorId: "tutor", status: "PRESENT" },
    ]),
  ];
  await expect(caller().recordTransfer.preview({ files })).rejects.toThrow(
    /MeetingAttendance.csv, row 2.*referenced record/i,
  );
  expect(await db.tutor.count()).toBe(0);
  expect(await db.session.count()).toBe(0);
});

it("rejects conflicts introduced after preview and tampered/expired tickets", async () => {
  const files = fixtures();
  const preview = await caller().recordTransfer.preview({ files });
  await expect(
    caller().recordTransfer.import({
      files: [file("Room", [{ id: "x", name: "Changed" }])],
      ticket: preview.ticket,
    }),
  ).rejects.toThrow(/preview/i);
  await expect(
    caller().recordTransfer.import({
      files,
      ticket: previewTicket(files, "HEAD", Date.now() - 1),
    }),
  ).rejects.toThrow(/expired/i);
  await db.tutor.create({ data: { id: "tutor", englishName: "Different" } });
  await expect(
    caller().recordTransfer.import({ files, ticket: preview.ticket }),
  ).rejects.toThrow(/different values/i);
  expect(await db.term.count()).toBe(0);
  expect(await db.auditLog.count({ where: { kind: { not: "ATTEMPT" } } })).toBe(
    0,
  );
  expect(
    await db.auditLog.count({
      where: { kind: "ATTEMPT", operation: "recordTransfer.import" },
    }),
  ).toBe(3);
});

it("exports re-importable files and excludes credentials and verification tokens", async () => {
  const files = fixtures();
  const preview = await caller().recordTransfer.preview({ files });
  await caller().recordTransfer.import({ files, ticket: preview.ticket });
  const exported = await caller().recordTransfer.export({});
  expect(JSON.stringify(exported)).not.toMatch(
    /never-export-this|passwordHash|sessionVersion|tokenHash|EmailVerificationCode/,
  );
  const repeated = await caller().recordTransfer.preview({
    files: exported.files,
  });
  expect(repeated.summary.reduce((n, s) => n + s.created, 0)).toBe(0);
  expect(repeated.summary.reduce((n, s) => n + s.skipped, 0)).toBe(
    exported.total,
  );
  const templates = await caller().recordTransfer.export({ templates: true });
  expect(templates.total).toBe(0);
  expect(
    templates.files.every((f) => parseRecordCsv(f.text).length === 1),
  ).toBe(true);
});

it.each([
  ["User", { id: "new", email: "new@example.test" }, /Account reference/],
  ["Tutor", { id: "t", englishName: "Name", status: "INVALID" }, /status/],
  [
    "Term",
    {
      id: "term",
      schoolYear: "24-25",
      quarter: "Q1",
      name: "Old",
      active: true,
    },
    /inactive/,
  ],
  [
    "RoomUnavailability",
    { id: "r", roomId: "room", dayOfWeek: 8, startMin: 600, endMin: 500 },
    /Times/,
  ],
  ["User", { id: "HEAD", role: "HEAD" }, /unknown/],
  ["AuditLog", { id: "forged" }, /unsupported/],
] as const)("rejects invalid %s records", async (table, row, error) => {
  await expect(
    caller().recordTransfer.preview({ files: [file(table, [row])] }),
  ).rejects.toThrow(error);
});

it("rejects repeated IDs within a file and handles unique collisions without echoing values", async () => {
  const row = { id: "room", name: "Private room" };
  await expect(
    caller().recordTransfer.preview({ files: [file("Room", [row, row])] }),
  ).rejects.toThrow(/Duplicate primary key/);
  await db.room.create({ data: row });
  await expect(
    caller().recordTransfer.preview({
      files: [file("Room", [{ ...row, id: "other" }])],
    }),
  ).rejects.toThrow(/unique value/);
  expect(await db.room.count()).toBe(1);
});

it("preserves JSON scalar types and JSON null while rejecting partial JSON matches", async () => {
  const row = {
    id: "survey-json",
    email: "past@example.test",
    intakeTermId: "term",
    payload: "null",
    policyRevision: "v1",
    policySnapshot: JSON.stringify("Original policy"),
    expiresAt: "2024-10-01T00:00:00Z",
    state: "RECALLED",
  };
  const files = [...fixtures(), file("StudentSurvey", [row])];
  const preview = await caller().recordTransfer.preview({ files });
  await caller().recordTransfer.import({ files, ticket: preview.ticket });
  expect(
    await db.$queryRaw`SELECT payload IS NULL AS "sqlNull", payload='null'::jsonb AS "jsonNull" FROM "StudentSurvey" WHERE id='survey-json'`,
  ).toEqual([{ sqlNull: false, jsonNull: true }]);
  const exported = await caller().recordTransfer.export({});
  await expect(
    caller().recordTransfer.preview({ files: exported.files }),
  ).resolves.toBeDefined();
  // Original submission evidence is now immutable; a distinct incoming JSON value
  // must still be rejected rather than compared as a partial object match.
  await expect(
    caller().recordTransfer.preview({
      files: [file("StudentSurvey", [{ ...row, payload: { a: 1 } }])],
    }),
  ).rejects.toThrow(/different values/);
});

it("rejects impossible calendar dates instead of normalizing them", async () => {
  await expect(
    caller().recordTransfer.preview({
      files: [
        file("Room", [
          {
            id: "invalid-date",
            name: "Old Room",
            createdAt: "2024-02-30T00:00:00Z",
          },
        ]),
      ],
    }),
  ).rejects.toThrow(/invalid calendar date/);
});
