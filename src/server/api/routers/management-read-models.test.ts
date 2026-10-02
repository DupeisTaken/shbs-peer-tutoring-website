import { describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { db as database } from "~/server/db";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
// No live database is instantiated, even if an operator has a local .env file.
vi.mock("~/server/db", () => ({ db: {} }));
import { appRouter, createCaller } from "~/server/api/root";
import {
  createCallerFactory,
  createTRPCRouter,
  viewerProcedure,
} from "~/server/api/trpc";
import {
  managementReadModels,
  projectManagementRead,
} from "~/server/management-read-models";
import {
  applicationRow,
  auditRow,
  date,
  PRIVATE,
  sessionRow,
} from "~/test/management-read-fixtures";

type Access = "VIEWER" | "observer" | "ADMIN" | "COORDINATOR" | "HEAD";
function fixture(access: Access = "VIEWER") {
  const role = access === "observer" ? "TUTOR" : access;
  const actor = {
    role,
    name: "Reader",
    username: "reader",
    tutorId: null,
    suspendedAt: null,
    schoolDeparture:
      access === "observer"
        ? { reason: "GRADUATED", observerRevoked: false, tutorDerived: false }
        : null,
  };
  const empty = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
  });
  const mock = {
    user: {
      ...empty(),
      findUnique: vi.fn().mockImplementation(async () => actor),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ suspendedAt: date, suspendedReason: PRIVATE }),
    },
    accountAppeal: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ message: PRIVATE, state: "PENDING" }),
    },
    term: {
      ...empty(),
      findFirst: vi.fn().mockResolvedValue({
        id: "term",
        schoolYear: "26-27",
        quarter: "Q1",
        active: true,
        name: "26-27 Q1",
        createdAt: date,
      }),
    },
    tutor: empty(),
    tutee: empty(),
    historicalAcademicRecord: empty(),
    subject: empty(),
    subjectLevel: empty(),
    courseGroup: empty(),
    room: empty(),
    timeSlot: empty(),
    qualificationGrant: empty(),
    pairing: empty(),
    session: {
      ...empty(),
      findMany: vi.fn().mockResolvedValue([sessionRow]),
      findUniqueOrThrow: vi.fn().mockResolvedValue(sessionRow),
    },
    sessionTutee: empty(),
    disciplinaryCard: empty(),
    tutorApplication: {
      ...empty(),
      findMany: vi.fn().mockResolvedValue([applicationRow]),
    },
    auditLog: { ...empty(), findMany: vi.fn().mockResolvedValue([auditRow]) },
    tutorMeeting: empty(),
    serviceHourAdjustment: empty(),
    tutorStatusRequest: empty(),
    tuteeRemovalRequest: empty(),
    studentProfileOwnership: empty(),
    crewApplication: empty(),
    crewStatusRequest: empty(),
    registrationCode: empty(),
    patrol: {
      ...empty(),
      aggregate: vi
        .fn()
        .mockResolvedValue({ _sum: { hours: 0 }, _count: { _all: 0 } }),
    },
    sessionFlag: empty(),
    policyDocument: empty(),
    policyArchive: empty(),
    announcement: empty(),
    programFeature: { findUnique: vi.fn().mockResolvedValue(null) },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mock)),
  };
  const context = {
    db: mock as unknown as typeof database,
    headers: new Headers(),
    session: {
      user: { id: "reader", name: "Reader" },
      role,
      tutorId: null,
      expires: "2099-01-01",
    } as Session,
  };
  return { mock, actor, context, caller: createCaller(context) };
}

describe.each<Access>(["VIEWER", "observer"])(
  "%s management response boundary",
  (access) => {
    it("withholds attendance narratives and application evidence through real RPC handlers", async () => {
      const { caller } = fixture(access);
      const sessions = await caller.admin.sessions();
      const attendance = await caller.corrections.attendance({ id: "session" });
      const applications = await caller.admin.tutorApplications();
      expect(
        JSON.stringify({ sessions, attendance, applications }),
      ).not.toContain(PRIVATE);
      expect(sessions[0]).toMatchObject({
        id: "session",
        date,
        shCount: 1,
        comments: null,
        tutorAbsentReason: null,
        tutor: { englishName: "Tutor One" },
        tutees: [
          {
            status: "EXCUSED_ABSENT",
            absenceReason: null,
            tutee: { englishName: "Tutee One" },
          },
        ],
      });
      expect(applications[0]).toMatchObject({
        name: "Applicant One",
        status: "ACCEPTED",
        decisionComment: null,
        votes: [{ accept: true, comment: null }],
        subjectIntents: [
          {
            subject: { name: "Math" },
            grade: null,
            apScore: null,
            selfStudyNote: null,
          },
        ],
      });
    });

    it("withholds historical appeal text and searches only visible audit metadata", async () => {
      const { caller, mock } = fixture(access);
      const log = await caller.admin.auditLog({
        search: PRIVATE,
        cursor: "prior",
      });
      expect(JSON.stringify(log)).not.toContain(PRIVATE);
      expect(log[0]).toMatchObject({
        userName: "Staff One",
        entity: "StudentAppeal",
        action: "Management decision",
        details: null,
        undoData: null,
      });
      expect(mock.auditLog.findMany.mock.calls[0]?.[0]).toMatchObject({
        take: 100,
        cursor: { id: "prior" },
        skip: 1,
        where: {
          OR: [
            { userName: { contains: PRIVATE, mode: "insensitive" } },
            { entity: { contains: PRIVATE, mode: "insensitive" } },
            { operation: { contains: PRIVATE, mode: "insensitive" } },
          ],
        },
      });
      const where = mock.auditLog.findMany.mock.calls[0]?.[0] as {
        where: object;
      };
      expect(where.where).not.toHaveProperty("action");
    });

    it("covers nested pairing identities, meeting excuses, patrol notes and unknown fields", async () => {
      const { caller, mock } = fixture(access);
      const person = {
        englishName: "Named participant",
        notes: PRIVATE,
        email: PRIVATE,
        signatureName: PRIVATE,
        futureField: PRIVATE,
      };
      mock.pairing.findMany.mockResolvedValue([
        {
          id: "pairing",
          tutor: person,
          room: null,
          term: { name: "Q1" },
          timeSlot: null,
          tutees: [{ tutee: person }],
        },
      ]);
      mock.tutorMeeting.findMany.mockResolvedValue([
        {
          title: "Orientation",
          attendances: [
            { status: "EXCUSED_ABSENT", reason: PRIVATE, tutor: person },
          ],
        },
      ]);
      mock.patrol.findMany.mockResolvedValue([
        {
          hours: 0.5,
          note: PRIVATE,
          submissionKey: PRIVATE,
          // New internal credit metadata stays outside #246's explicit Viewer projection.
          creditAwardedAt: date,
          creditWindows: [{ windowStart: date, patrolId: PRIVATE }],
          crewUser: { name: "Crew One" },
          observations: [
            {
              headcount: "TWO",
              room: { name: "Library", futureField: PRIVATE },
            },
          ],
        },
      ]);
      const result = {
        pairings: await caller.admin.pairings(),
        meetings: await caller.admin.meetings(),
        patrols: await caller.corrections.patrols(),
      };
      expect(JSON.stringify(result)).not.toContain(PRIVATE);
      expect(result.pairings[0]?.tutees[0]?.tutee.englishName).toBe(
        "Named participant",
      );
      expect(result.patrols[0]).toMatchObject({
        hours: 0.5,
        observations: [{ headcount: "TWO", room: { name: "Library" } }],
      });
      expect(result.patrols[0]).not.toHaveProperty("creditAwardedAt");
      expect(result.patrols[0]).not.toHaveProperty("creditWindows");
    });

    it("does not reuse private code labels as public names", async () => {
      const { caller, mock } = fixture(access);
      mock.registrationCode.findMany.mockResolvedValue([
        {
          id: "code",
          code: PRIVATE,
          label: PRIVATE,
          email: PRIVATE,
          crewApplicationId: "missing-application",
          expiresAt: new Date("2099-01-01"),
        },
      ]);
      expect(await caller.admin.crewIssuedCodes()).toEqual([
        {
          id: "code",
          code: null,
          name: "—",
          expiresAt: new Date("2099-01-01"),
        },
      ]);
      expect(
        JSON.stringify(await caller.admin.registrationCodes()),
      ).not.toContain(PRIVATE);
      mock.crewApplication.findMany.mockResolvedValue([
        { id: "missing-application", name: "Named applicant" },
      ]);
      expect(await caller.admin.crewIssuedCodes()).toMatchObject([
        { name: "Named applicant", code: null },
      ]);
    });

    it("keeps roster names, structured academics and totals without raw grade or nested account evidence", async () => {
      const { caller, mock } = fixture(access);
      const account = {
        id: "owner",
        name: "Owner One",
        email: PRIVATE,
        passwordHash: PRIVATE,
        academicProfile: {
          status: "UNKNOWN",
          gradeLevel: null,
          rawGrade: PRIVATE,
          schoolYear: null,
          confirmedAt: null,
          reconfirmRequired: true,
        },
      };
      const student = {
        id: "tutee",
        englishName: "Tutee One",
        status: "ACTIVE",
        notes: PRIVATE,
        signatureName: PRIVATE,
        email: PRIVATE,
        phone: PRIVATE,
        gradeLevel: PRIVATE,
        createdAt: date,
        user: account,
        firstChoice: { name: "Math" },
        availabilities: [
          {
            slotId: "slot",
            slot: {
              id: "slot",
              label: "Monday",
              startMin: 900,
              endMin: 960,
              secret: PRIVATE,
            },
          },
        ],
      };
      mock.tutee.findMany.mockResolvedValue([student]);
      // Historical raw text can contain private evidence, just like account raw grades.
      mock.historicalAcademicRecord.findMany.mockResolvedValue([
        { tuteeId: "tutee", corrections: [{ rawGrade: PRIVATE, schoolYear: "24-25" }] },
      ]);
      mock.tutor.findMany.mockResolvedValue([
        {
          id: "tutor",
          englishName: "Tutor One",
          gradeLevel: 11,
          status: "ACTIVE",
          user: account,
        },
      ]);
      mock.session.groupBy.mockResolvedValue([
        { tutorId: "tutor", _sum: { shCount: 1.5 }, _count: { _all: 1 } },
      ]);
      mock.sessionTutee.groupBy.mockResolvedValue([
        { tuteeId: "tutee", status: "PRESENT", _count: { _all: 1 } },
      ]);
      const rows = await caller.admin.tutees();
      expect(rows[0]).toMatchObject({
        englishName: "Tutee One",
        gradeLevel: null,
        enrollmentCorrection: { rawGrade: null, schoolYear: "24-25" },
        owner: { name: "Owner One", email: null },
        availabilities: [{ slot: { label: "Monday" } }],
      });
      expect(await caller.admin.tuteeStats()).toMatchObject({
        tutee: { sessions: 1, present: 1 },
      });
      expect(await caller.admin.periodSummary()).toMatchObject({
        rows: [{ englishName: "Tutor One", earned: 1.5 }],
        totals: { total: 1.5 },
      });
      const report = await caller.admin.periodReport({
        depth: "full",
        month: "2026-10",
        maskPii: false,
      });
      expect(report.signups[0]).toMatchObject({
        name: "Tutee One",
        grade: null,
        contact: null,
      });
      expect(
        JSON.stringify([rows, report, await caller.admin.tutors()]),
      ).not.toContain(PRIVATE);
      mock.tutee.findMany.mockResolvedValue([
        { ...student, gradeLevel: "Grade 11" },
      ]);
      expect((await caller.admin.tutees())[0]?.gradeLevel).toBe("Grade 11");
    });

    it("preserves own-account private records under their existing ownership scope", async () => {
      const { caller, mock } = fixture(access);
      expect(await caller.account.suspension()).toMatchObject({
        reason: PRIVATE,
        appeal: { message: PRIVATE },
      });
      expect(mock.accountAppeal.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "reader" } }),
      );
    });

    it("runs every registered management query, including all report depths", async () => {
      const { caller } = fixture(access);
      const namespaces = caller as unknown as Record<
        string,
        Record<string, (input?: unknown) => Promise<unknown>>
      >;
      for (const path of Object.keys(managementReadModels)) {
        const [namespace, name] = path.split(".") as [string, string];
        const input =
          path === "corrections.attendance"
            ? { id: "session" }
            : path === "admin.periodReport"
              ? { depth: "full", month: "2026-10", maskPii: false }
              : undefined;
        const result = await namespaces[namespace]![name]!(input);
        expect(JSON.stringify(result), path).not.toContain(PRIVATE);
      }
      for (const depth of ["summary", "detailed"] as const)
        expect(
          JSON.stringify(
            await caller.admin.periodReport({
              depth,
              month: "2026-10",
              maskPii: false,
            }),
          ),
        ).not.toContain(PRIVATE);
      const options = await caller.admin.auditFilterOptions();
      expect(options.users[0]).toMatchObject({
        id: "staff",
        label: "Staff One",
        former: true,
      });
    });
  },
);

it.each<Access>(["HEAD", "ADMIN", "COORDINATOR"])(
  "preserves authorized %s narratives, contacts and audit search",
  async (access) => {
    const { caller, mock } = fixture(access);
    expect(await caller.admin.sessions()).toEqual([sessionRow]);
    expect(await caller.corrections.attendance({ id: "session" })).toEqual([
      sessionRow,
    ]);
    expect(await caller.admin.tutorApplications()).toEqual([applicationRow]);
    expect(await caller.admin.auditLog({ search: PRIVATE })).toEqual([
      auditRow,
    ]);
    expect(mock.auditLog.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        action: { contains: PRIVATE, mode: "insensitive" },
      },
    });
  },
);

it("reloads roles and denies revoked, suspended, merged and non-observer accounts", async () => {
  const { actor, caller } = fixture("observer");
  actor.schoolDeparture!.observerRevoked = true;
  await expect(caller.admin.sessions()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const suspended = fixture();
  Object.assign(suspended.actor, { suspendedAt: date });
  await expect(suspended.caller.admin.sessions()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  Object.assign(suspended.actor, {
    suspendedAt: null,
    mergedIntoId: "survivor",
  });
  await expect(suspended.caller.admin.sessions()).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  const demoted = fixture("ADMIN");
  Object.assign(demoted.actor, { role: "VIEWER" });
  expect(JSON.stringify(await demoted.caller.admin.sessions())).not.toContain(
    PRIVATE,
  );
  Object.assign(demoted.actor, { role: "TUTOR" });
  await expect(demoted.caller.admin.sessions()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

it("requires a projection for every actual viewer procedure, including future additions", () => {
  const boundary = viewerProcedure._def.middlewares.at(-1)!;
  // Runtime inventory also catches procedures introduced outside the admin router.
  const procedures = appRouter._def.procedures as unknown as Record<
    string,
    { _def: { middlewares: unknown[] } }
  >;
  const paths = Object.entries(procedures)
    .filter(([, procedure]) => procedure._def.middlewares.includes(boundary))
    .map(([path]) => path)
    .sort();
  expect(paths).toEqual(Object.keys(managementReadModels).sort());
});

it("fails closed for unregistered queries and accidental viewer mutations", async () => {
  const testRouter = createTRPCRouter({
    future: viewerProcedure.query(() => ({ secret: PRIVATE })),
    write: viewerProcedure.mutation(() => ({ secret: PRIVATE })),
  });
  const caller = createCallerFactory(testRouter)(fixture().context);
  await expect(caller.future()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller.write()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(() => projectManagementRead("__proto__", {})).toThrow();
});

it("rejects object/array payloads in scalar fields without disclosing validation data", () => {
  for (const name of [{ private: PRIVATE }, [PRIVATE]]) {
    expect(() => projectManagementRead("admin.crewRoster", [{ name }])).toThrow(
      "Management summary unavailable.",
    );
  }
});

it("preserves explicit Viewer oversight of published policies and announcements", () => {
  const publicPost = {
    id: "public",
    title: "Program news",
    body: "Public program content",
    audienceRestricted: false,
    createdBy: { name: "Staff" },
    recipientTutorIds: [],
    _count: { acks: 0 },
  };
  const result = projectManagementRead("admin.announcements", [
    publicPost,
    {
      ...publicPost,
      id: "targeted",
      audienceRestricted: true,
      title: "Selected tutors",
      body: "Published management announcement",
      recipientTutorIds: ["tutor"],
    },
  ]);
  expect(result).toMatchObject([
    { title: "Program news", body: "Public program content" },
    {
      title: "Selected tutors",
      body: "Published management announcement",
      recipientTutorIds: ["tutor"],
    },
  ]);
  expect(JSON.stringify(result)).not.toContain(PRIVATE);
  expect(
    projectManagementRead("admin.policies", [
      {
        title: "Tutor policy",
        body: "Published policy",
        updatedBy: { name: "Staff", email: PRIVATE },
      },
    ]),
  ).toMatchObject([
    { body: "Published policy", updatedBy: { name: "Staff", email: null } },
  ]);
});
