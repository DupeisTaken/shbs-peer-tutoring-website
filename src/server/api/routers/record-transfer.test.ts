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
import type { LegacySignupDeclineSnapshot } from "~/lib/legacy-signup-decline";

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

function declineHistory(): LegacySignupDeclineSnapshot {
  return {
    schemaVersion: 1,
    source: {
      id: "tutee",
      englishName: "Known decision-time learner",
      firstName: null,
      lastName: null,
      preferredName: null,
      legacyName: null,
      alternativeNames: null,
      email: "intake@example.test",
      phone: null,
      preferredContact: "Original intake contact",
      notes: null,
      gradeLevel: "10",
      academicallyGraduated: false,
      signupSource: "UNKNOWN",
      intakeTermId: null,
      signupSubmittedAt: null,
      createdAt: "2024-10-01T10:00:00.000Z",
      status: "PENDING",
      firstChoice: { id: "old-subject", name: "Original subject" },
      secondChoice: null,
      signedRulebook: true,
      signatureName: "Original signature",
      signedAt: "2024-10-01T10:00:00.000Z",
    },
    decisionPeriod: {
      id: "decision-term",
      name: "25-26 Q1",
      schoolYear: "25-26",
      quarter: "Q1",
    },
    availability: [
      {
        id: "old-slot",
        label: "Original slot",
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
      },
    ],
    ownership: {
      userId: null,
      retainedOwnerId: null,
      personId: null,
      historyIdentityRevision: 0,
    },
    pairings: [
      {
        id: "pair",
        termId: "term",
        subject: "Math",
        tutorId: "tutor",
        tutorName: "Historical tutor",
        dayOfWeek: 2,
        startMin: 600,
        endMin: 630,
        scheduleConfirmed: false,
        removed: false,
      },
    ],
  };
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
          {
            id: "new",
            englishName: "Old Tutor",
            username: "TAKEN",
            status: "ARCHIVED",
          },
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

it("round-trips retained legacy decline evidence and historical links without retry authority", async () => {
  const snapshot = declineHistory();
  const decline = {
    tuteeId: "tutee",
    termId: "decision-term",
    resolvedAt: "2025-10-02T10:00:00.000Z",
    resolvedById: "former-reviewer",
    resolvedByName: "Original reviewer",
    expectedUpdatedAt: "2025-10-01T10:00:00.000Z",
    intakeSnapshot: snapshot,
  };
  const files = [
    ...fixtures().filter(
      (item) =>
        !["Term.csv", "Session.csv", "SessionTutee.csv"].includes(item.name),
    ),
    file("Term", [
      {
        id: "term",
        schoolYear: "24-25",
        quarter: "Q1",
        name: "24-25 Q1",
        active: false,
      },
      {
        id: "decision-term",
        schoolYear: "25-26",
        quarter: "Q1",
        name: "25-26 Q1",
        active: false,
      },
    ]),
    file("LegacySignupDecline", [decline]),
  ];
  const preview = await caller().recordTransfer.preview({ files });
  expect(await db.legacySignupDecline.count()).toBe(0);
  await caller().recordTransfer.import({ files, ticket: preview.ticket });
  const stored = await db.legacySignupDecline.findUniqueOrThrow({
    where: { tuteeId: "tutee" },
  });
  expect(stored).toMatchObject({ intakeSnapshot: snapshot, inputHash: "" });
  expect(stored.clientKey).toMatch(/^[a-f\d-]{36}$/i);
  expect(
    await db.pairingTutee.count({
      where: { tuteeId: "tutee", pairingId: "pair" },
    }),
  ).toBe(1);

  // Later directory metadata does not replace retained decision-time evidence.
  await db.tutee.update({
    where: { id: "tutee" },
    data: { englishName: "Later directory label" },
  });
  const exported = await caller().recordTransfer.export({});
  const exportedDecline = exported.files.find(
    (item) => item.name === "LegacySignupDecline.csv",
  )!;
  const [header] = parseRecordCsv(exportedDecline.text);
  expect(header).toContain("intakeSnapshot");
  expect(header).not.toContain("clientKey");
  expect(header).not.toContain("inputHash");
  expect(exportedDecline.text).toContain("Original intake contact");
  expect(exportedDecline.text).toContain("Original signature");
  const repeat = await caller().recordTransfer.preview({
    files: [exportedDecline],
  });
  expect(repeat.summary).toEqual([
    { table: "LegacySignupDecline", created: 0, skipped: 1 },
  ]);
  await caller().recordTransfer.import({
    files: [exportedDecline],
    ticket: repeat.ticket,
  });
  expect(
    await db.legacySignupDecline.findUniqueOrThrow({
      where: { tuteeId: "tutee" },
    }),
  ).toEqual(stored);

  for (const capability of ["clientKey", "inputHash"]) {
    await expect(
      caller().recordTransfer.preview({
        files: [
          file("LegacySignupDecline", [
            {
              ...decline,
              [capability]: stored[capability as "clientKey" | "inputHash"],
            },
          ]),
        ],
      }),
    ).rejects.toThrow(/unknown or duplicate columns/);
  }
  await expect(
    caller().recordTransfer.preview({
      files: [
        file("LegacySignupDecline", [
          {
            ...decline,
            intakeSnapshot: {
              ...snapshot,
              source: { ...snapshot.source, englishName: "Changed original" },
            },
          },
        ]),
      ],
    }),
  ).rejects.toThrow(/Existing records are never overwritten/);
});

it("refuses importing decline history as a way to close active enrollment or invent source evidence", async () => {
  const base = fixtures();
  const imported = await caller().recordTransfer.preview({ files: base });
  await caller().recordTransfer.import({
    files: base,
    ticket: imported.ticket,
  });
  const snapshot = declineHistory();
  const row = {
    tuteeId: "tutee",
    termId: "term",
    resolvedById: "former-reviewer",
    expectedUpdatedAt: "2024-10-01T10:00:00.000Z",
    intakeSnapshot: {
      ...snapshot,
      decisionPeriod: { ...snapshot.decisionPeriod, id: "term" },
    },
  };
  await db.tutee.update({ where: { id: "tutee" }, data: { status: "ACTIVE" } });
  await expect(
    caller().recordTransfer.preview({
      files: [file("LegacySignupDecline", [row])],
    }),
  ).rejects.toThrow(/inactive legacy profile/);
  await db.tutee.update({
    where: { id: "tutee" },
    data: { status: "INACTIVE" },
  });
  await expect(
    caller().recordTransfer.preview({
      files: [file("LegacySignupDecline", [{ ...row, intakeSnapshot: {} }])],
    }),
  ).rejects.toThrow(/exact source and decision-period snapshot/);
  expect(await db.legacySignupDecline.count()).toBe(0);
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

it("records archive provenance only for inserted rows and rolls it back during preview", async () => {
  const files = fixtures();
  const preview = await caller().recordTransfer.preview({ files });
  expect(await db.importedRecordProvenance.count()).toBe(0);
  await caller().recordTransfer.import({ files, ticket: preview.ticket });
  const provenance = await db.importedRecordProvenance.findMany({
    orderBy: [{ entity: "asc" }, { recordId: "asc" }],
  });
  expect(
    provenance.map(({ entity, recordId }) => ({ entity, recordId })),
  ).toEqual([
    { entity: "Pairing", recordId: "pair" },
    {
      entity: "PairingTutee",
      recordId: '[["pairingId","pair"],["tuteeId","tutee"]]',
    },
    { entity: "ServiceHourAdjustment", recordId: "extra" },
    { entity: "Session", recordId: "session" },
    {
      entity: "SessionTutee",
      recordId: '[["sessionId","session"],["tuteeId","tutee"]]',
    },
    { entity: "Term", recordId: "term" },
    { entity: "Tutee", recordId: "tutee" },
    { entity: "Tutor", recordId: "tutor" },
  ]);
  const repeated = await caller().recordTransfer.preview({ files });
  await caller().recordTransfer.import({ files, ticket: repeated.ticket });
  expect(
    await db.importedRecordProvenance.findMany({
      orderBy: [{ entity: "asc" }, { recordId: "asc" }],
    }),
  ).toEqual(provenance);
  const exported = await caller().recordTransfer.export({});
  expect(
    exported.files.some((row) => row.name === "ImportedRecordProvenance.csv"),
  ).toBe(false);
  await expect(
    caller().recordTransfer.preview({
      files: [
        file("ImportedRecordProvenance", [
          { entity: "Session", recordId: "native" },
        ]),
      ],
    }),
  ).rejects.toThrow(/unsupported/);
});

it("skips an identical current native tutor without changing its lifecycle or origin", async () => {
  await db.tutor.create({
    data: {
      id: "native-current",
      englishName: "Current Tutor",
      status: "ACTIVE",
    },
  });
  const files = [
    file("Tutor", [
      { id: "native-current", englishName: "Current Tutor", status: "ACTIVE" },
    ]),
  ];
  const preview = await caller().recordTransfer.preview({ files });
  expect(preview.summary).toEqual([{ table: "Tutor", created: 0, skipped: 1 }]);
  await caller().recordTransfer.import({ files, ticket: preview.ticket });
  expect(await db.importedRecordProvenance.count()).toBe(0);
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: "native-current" } }))
      .status,
  ).toBe("ACTIVE");
});

it.each([
  ["Tutor", { id: "new-current", englishName: "Current" }, /inactive status/],
  [
    "Tutor",
    { id: "new-current", englishName: "Current", status: "PENDING" },
    /inactive status/,
  ],
  [
    "Tutee",
    {
      id: "new-current",
      englishName: "Current",
      updatedAt: "2024-10-01T00:00:00Z",
    },
    /status=INACTIVE/,
  ],
  [
    "TutorMeeting",
    { id: "new-upcoming", title: "Upcoming", date: "2099-01-01T00:00:00Z" },
    /must be in the past/,
  ],
  [
    "CrewApplication",
    { id: "pending", name: "Applicant", email: "applicant@example.test" },
    /completed status/,
  ],
  [
    "Announcement",
    { id: "new-live", title: "Broadcast", body: "Historical text" },
    /active=false/,
  ],
] as const)(
  "does not activate new %s archive records through schema defaults",
  async (table, row, error) => {
    await expect(
      caller().recordTransfer.preview({ files: [file(table, [row])] }),
    ).rejects.toThrow(error);
    expect(await db.importedRecordProvenance.count()).toBe(0);
  },
);

it("rejects archived discipline against current participation and honors same-batch inactive targets", async () => {
  const files = fixtures();
  const preview = await caller().recordTransfer.preview({ files });
  await caller().recordTransfer.import({ files, ticket: preview.ticket });
  await db.tutee.update({ where: { id: "tutee" }, data: { status: "ACTIVE" } });
  const card = {
    id: "archived-card",
    tuteeId: "tutee",
    color: "RED",
    reviewStatus: "VALID",
    updatedAt: "2024-10-01T00:00:00Z",
  };
  await expect(
    caller().recordTransfer.preview({
      files: [file("DisciplinaryCard", [card])],
    }),
  ).rejects.toThrow(/require an inactive tutee/);
  expect(await db.disciplinaryCard.count()).toBe(0);
  const archivedTutee = {
    id: "other-archive",
    englishName: "Past Learner",
    status: "INACTIVE",
    updatedAt: "2024-10-01T00:00:00Z",
  };
  const sameBatch = [
    file("DisciplinaryCard", [{ ...card, tuteeId: "other-archive" }]),
    file("Tutee", [archivedTutee]),
  ];
  const accepted = await caller().recordTransfer.preview({ files: sameBatch });
  await caller().recordTransfer.import({
    files: sameBatch,
    ticket: accepted.ticket,
  });
  expect(
    (await db.disciplinaryCard.findUniqueOrThrow({ where: { id: card.id } }))
      .tuteeId,
  ).toBe("other-archive");
});

it("rejects child-only imports that would change an upcoming meeting or current interview panel", async () => {
  await db.tutor.create({
    data: { id: "native-tutor", englishName: "Current Tutor" },
  });
  await db.tutorMeeting.create({
    data: {
      id: "upcoming-native",
      title: "Current meeting",
      date: new Date("2099-01-01T00:00:00Z"),
    },
  });
  await expect(
    caller().recordTransfer.preview({
      files: [
        file("MeetingAttendance", [
          {
            id: "new-absence",
            meetingId: "upcoming-native",
            tutorId: "native-tutor",
            status: "EXCUSED_ABSENT",
          },
        ]),
      ],
    }),
  ).rejects.toThrow(/requires a past meeting/);
  await db.tutorApplication.create({
    data: {
      id: "native-interview",
      name: "Current Applicant",
      email: "current-applicant@example.test",
      status: "INTERVIEW",
    },
  });
  await expect(
    caller().recordTransfer.preview({
      files: [
        file("InterviewAssignment", [
          {
            applicationId: "native-interview",
            tutorId: "native-tutor",
            isHead: true,
          },
        ]),
      ],
    }),
  ).rejects.toThrow(/require a completed application/);
  expect(await db.meetingAttendance.count()).toBe(0);
  expect(await db.interviewAssignment.count()).toBe(0);
});

it("does not add live screening or qualification authority through child-only archives", async () => {
  await db.tutee.create({
    data: {
      id: "current-learner",
      englishName: "Current Learner",
      status: "ACTIVE",
    },
  });
  await expect(
    caller().recordTransfer.preview({
      files: [
        file("TuteeRequestInvalidity", [
          {
            tuteeId: "current-learner",
            invalidatedAt: "2024-10-01T00:00:00Z",
            invalidReason: "Historical screening",
          },
        ]),
      ],
    }),
  ).rejects.toThrow(/require an inactive tutee/);
  await expect(
    caller().recordTransfer.preview({
      files: [
        file("TuteeRequestInvalidity", [
          { tuteeId: "missing-learner", invalidReason: "Historical screening" },
        ]),
      ],
    }),
  ).rejects.toThrow(/missing Tutee/);
  await db.term.create({
    data: {
      id: "live-intake",
      name: "Current",
      schoolYear: "26-27",
      quarter: "Q2",
      active: true,
    },
  });
  await db.tutee.update({
    where: { id: "current-learner" },
    data: { status: "INACTIVE", intakeTermId: "live-intake" },
  });
  await expect(
    caller().recordTransfer.preview({
      files: [
        file("TuteeRequestInvalidity", [
          { tuteeId: "current-learner", invalidReason: "Historical screening" },
        ]),
      ],
    }),
  ).rejects.toThrow(/requires an inactive intake term/);
  await db.tutor.create({
    data: {
      id: "current-tutor",
      englishName: "Current Tutor",
      status: "ACTIVE",
    },
  });
  await db.subject.create({
    data: { id: "qualification-subject", name: "Math" },
  });
  await expect(
    caller().recordTransfer.preview({
      files: [
        file("TutorQualification", [
          {
            tutorId: "current-tutor",
            subjectId: "qualification-subject",
            approvedById: "HEAD",
            status: "APPROVED",
          },
        ]),
      ],
    }),
  ).rejects.toThrow(/require an inactive tutor/);
  await db.tutorQualification.create({
    data: {
      tutorId: "current-tutor",
      subjectId: "qualification-subject",
      approvedById: "HEAD",
    },
  });
  await expect(
    caller().recordTransfer.preview({
      files: [
        file("QualificationGrant", [
          {
            tutorId: "current-tutor",
            sourceSubjectId: "qualification-subject",
            subjectId: "qualification-subject",
          },
        ]),
      ],
    }),
  ).rejects.toThrow(/require an inactive tutor/);
  expect(await db.tuteeRequestInvalidity.count()).toBe(0);
  expect(await db.qualificationGrant.count()).toBe(0);
});
