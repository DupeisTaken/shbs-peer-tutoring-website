import { beforeEach, expect, it, vi } from "vitest";
import type { TransactionDb } from "~/server/transactions";

vi.mock("~/server/period", () => ({
  getActivePeriod: vi.fn(async () => ({ schoolYear: "26-27", quarter: "Q1" })),
}));
vi.mock("~/server/program/features", () => ({ assertFeatureEnabled: vi.fn() }));
vi.mock("~/server/audit/evidence", () => ({ recordDomainAudit: vi.fn() }));

import { recordDomainAudit } from "~/server/audit/evidence";

import {
  assertRecordedInterviewService,
  INTERVIEW_HOURS_REASON,
  interviewHourRows,
  interviewServiceContext,
  isAppliedInterviewCompletion,
  recordInterviewApprovalService,
  reviewInterviewCompletion,
  sameInterviewCompletionEvidence,
  sameRetainedInterviewServiceEvidence,
  writeInterviewCompletion,
} from "./interview-hours";

const applicationId = "application";
const completedAt = new Date("2026-09-01T02:00:37.456Z");
const before = {
  interviewCompletedAt: completedAt,
  interviewDurationMin: 45,
  interviewSchoolYear: "26-27",
  interviewQuarter: "Q1" as const,
  interviewers: ["current", "second", "third"].map((tutorId) => ({
    tutorId,
    attended: false,
  })),
};
const input = {
  completedAt,
  durationMin: 45,
  attendedTutorIds: [] as string[],
};
const credit = (tutorId = "former") => ({
  id: `interview_${applicationId}_${tutorId}`,
  tutorId,
  type: "EXTRA" as const,
  amount: 0.75,
  month: "2026-09",
  schoolYear: "26-27",
  quarter: "Q1" as const,
  reason: INTERVIEW_HOURS_REASON,
});
const receipt = (credits = [credit()]) => ({
  details: {
    effects: {
      panelRepairVersion: 1,
      previousPanel: ["former", "original-second", "original-third"].map(
        (tutorId) => ({ tutorId }),
      ),
      retainedService: {
        eligibleTutorIds: [
          ...new Set([
            ...credits.map((row) => row.tutorId),
            "original-second",
            "original-third",
          ]),
        ],
        completedAt: completedAt.toISOString(),
        durationMin: 45,
        schoolYear: "26-27",
        quarter: "Q1",
        credits,
      },
    },
  },
});
const serviceReceipt = (
  credits = [credit()],
  completion = {
    completedAt: completedAt.toISOString(),
    durationMin: 45,
    schoolYear: "26-27",
    quarter: "Q1",
  },
  eligibleTutorIds = ["former", "original-second", "original-third"],
) => ({
  details: {
    effects: {
      interviewServiceVersion: 1,
      eligibleTutorIds,
      completion,
      credits,
    },
  },
});
function fixture(credits = [credit()], audit: unknown = receipt(credits)) {
  const source = {
    tutor: {
      count: vi.fn(
        async (args: { where: { id: { in: string[] } } }) =>
          args.where.id.in.length,
      ),
    },
    serviceHourAdjustment: {
      findMany: vi.fn().mockResolvedValue(credits),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: {
      findMany: vi
        .fn()
        .mockResolvedValue(Array.isArray(audit) ? audit : audit ? [audit] : []),
    },
    tutorApplication: {
      update: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({
        ...before,
        status: "INTERVIEW",
        invalidatedAt: null,
      }),
    },
    interviewAssignment: {
      findMany: vi.fn(async () =>
        before.interviewers.map((row) => ({
          applicationId,
          tutorId: row.tutorId,
        })),
      ),
      updateMany: vi.fn(),
    },
    importedRecordProvenance: { findFirst: vi.fn(async () => null) },
  };
  return { source, tx: source as unknown as TransactionDb };
}
beforeEach(() => vi.clearAllMocks());

it("discovers former source owners without treating another application's prefix match as this interview", async () => {
  const otherApplication = {
    ...credit("other"),
    id: "interview_application_extension_other",
  };
  const { tx, source } = fixture([credit(), otherApplication]);
  expect(await interviewHourRows(tx, applicationId, ["current"])).toEqual([
    credit(),
  ]);
  expect(source.serviceHourAdjustment.findMany).toHaveBeenCalledWith({
    where: {
      OR: [
        { id: { in: ["interview_application_current"] } },
        { id: { startsWith: "interview_application_" } },
      ],
    },
  });
});

it.each([
  { ...credit("current"), tutorId: "unrelated" },
  { ...credit(), type: "MANUAL" as "EXTRA" },
  { ...credit(), reason: "Unrelated adjustment" },
])(
  "refuses a foreign-owned or foreign-shaped credit identifier",
  async (row) => {
    const { tx } = fixture([row]);
    await expect(
      interviewHourRows(tx, applicationId, ["current"]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  },
);

it("validates retained service after every original attendee leaves without writing service or attendance", async () => {
  const { tx, source } = fixture();
  expect(
    await assertRecordedInterviewService(tx, applicationId, before, input),
  ).toEqual([credit()]);
  expect(source.tutorApplication.update).not.toHaveBeenCalled();
  expect(source.interviewAssignment.updateMany).not.toHaveBeenCalled();
  expect(source.serviceHourAdjustment.createMany).not.toHaveBeenCalled();
  expect(source.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
});

it.each([
  "one missing",
  "all missing",
  "changed amount",
  "changed timestamp",
  "missing receipt",
  "malformed receipt",
])(
  "refuses incomplete or changed historical source evidence: %s",
  async (scenario) => {
    const original = [credit(), credit("another-former")];
    let credits = original;
    let audit: unknown = receipt(original);
    if (scenario === "one missing") credits = [original[0]!];
    if (scenario === "all missing") credits = [];
    if (scenario === "changed amount")
      credits = original.map((row) => ({ ...row, amount: 1 }));
    if (scenario === "changed timestamp")
      audit = {
        details: {
          effects: {
            ...receipt(original).details.effects,
            retainedService: {
              ...receipt(original).details.effects.retainedService,
              completedAt: "2026-09-01T02:01:37.456Z",
            },
          },
        },
      };
    if (scenario === "missing receipt") audit = null;
    if (scenario === "malformed receipt")
      audit = { details: { effects: { panelRepairVersion: 1 } } };
    const { tx, source } = fixture(credits, audit);
    await expect(
      assertRecordedInterviewService(tx, applicationId, before, input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(source.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
    expect(source.tutorApplication.update).not.toHaveBeenCalled();
  },
);

it("keeps ordinary exact completion receipts strict instead of classifying a repaired ledger as a correction no-op", () => {
  expect(sameRetainedInterviewServiceEvidence(before, [credit()], input)).toBe(
    true,
  );
  expect(sameInterviewCompletionEvidence(before, [credit()], input)).toBe(
    false,
  );
  const ordinary = {
    ...before,
    interviewers: [{ tutorId: "current", attended: true }],
  };
  const ordinaryInput = { ...input, attendedTutorIds: ["current"] };
  expect(
    sameInterviewCompletionEvidence(
      ordinary,
      [credit("current")],
      ordinaryInput,
    ),
  ).toBe(true);
  expect(sameInterviewCompletionEvidence(ordinary, [], ordinaryInput)).toBe(
    false,
  );
  expect(
    sameRetainedInterviewServiceEvidence(ordinary, [], ordinaryInput),
  ).toBe(false);
});

it.each([
  { ...input, durationMin: 46 },
  { ...input, completedAt: new Date("2026-09-01T02:01:37.456Z") },
  { ...input, attendedTutorIds: ["current"] },
  { ...input, attendedTutorIds: ["former"] },
  { ...input, attendedTutorIds: ["current", "current"] },
])(
  "requires the exact captured completion and current-panel attendance intersection",
  (changed) => {
    expect(
      sameRetainedInterviewServiceEvidence(before, [credit()], changed),
    ).toBe(false);
  },
);

it("accepts a newer authorized correction receipt without freezing service to the earlier repair snapshot", async () => {
  const correctedAt = new Date("2026-09-01T02:30:37.456Z");
  const current = {
    ...before,
    interviewCompletedAt: correctedAt,
    interviewDurationMin: 60,
    interviewers: [{ tutorId: "current", attended: true }],
  };
  const correctedCredit = { ...credit("current"), amount: 1 };
  const { tx } = fixture(
    [correctedCredit],
    serviceReceipt(
      [correctedCredit],
      {
        completedAt: correctedAt.toISOString(),
        durationMin: 60,
        schoolYear: "26-27",
        quarter: "Q1",
      },
      ["current", "original-second", "original-third"],
    ),
  );
  await expect(
    assertRecordedInterviewService(tx, applicationId, current, {
      completedAt: correctedAt,
      durationMin: 60,
      attendedTutorIds: ["current"],
    }),
  ).resolves.toEqual([correctedCredit]);
});

it("rejects credit for a replacement voter who was never an original interview participant", async () => {
  const { tx, source } = fixture();
  await expect(
    writeInterviewCompletion(
      tx,
      applicationId,
      before,
      { ...input, attendedTutorIds: ["current"] },
      [credit()],
    ),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(source.tutorApplication.update).not.toHaveBeenCalled();
  expect(source.interviewAssignment.updateMany).not.toHaveBeenCalled();
  expect(source.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
  expect(source.serviceHourAdjustment.createMany).not.toHaveBeenCalled();
});

it("corrects historical attendance and source-owned hours while keeping the original participant set and period", async () => {
  const { tx, source } = fixture();
  const corrected = {
    completedAt: new Date("2026-09-01T03:00:17.123Z"),
    durationMin: 60,
    attendedTutorIds: ["former", "original-second"],
  };
  const effects = await writeInterviewCompletion(
    tx,
    applicationId,
    before,
    corrected,
    [credit()],
  );
  expect(source.tutor.count).toHaveBeenCalledWith({
    where: { id: { in: corrected.attendedTutorIds } },
  });
  expect(source.serviceHourAdjustment.deleteMany).toHaveBeenCalledWith({
    where: { id: { in: [credit().id] } },
  });
  expect(source.serviceHourAdjustment.createMany).toHaveBeenCalledWith({
    data: effects.credits,
  });
  expect(effects.eligibleTutorIds).toEqual([
    "former",
    "original-second",
    "original-third",
  ]);
  expect(effects.completion).toEqual({
    completedAt: corrected.completedAt.toISOString(),
    durationMin: 60,
    schoolYear: "26-27",
    quarter: "Q1",
  });
  expect(effects.credits.map((row) => row.tutorId)).toEqual([
    "former",
    "original-second",
  ]);
  expect(
    effects.credits.every(
      (row) =>
        row.amount === 1 && row.schoolYear === "26-27" && row.quarter === "Q1",
    ),
  ).toBe(true);
  expect(recordDomainAudit).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({
      operation: "interviewService.record",
      entity: "TutorApplication",
      entityId: applicationId,
      effects,
    }),
  );
  expect(source.interviewAssignment.updateMany).toHaveBeenLastCalledWith({
    where: { applicationId, tutorId: { in: corrected.attendedTutorIds } },
    data: { attended: true },
  });
});

it("rejects a missing historical identity before changing completion, attendance, or credits", async () => {
  const { tx, source } = fixture();
  source.tutor.count.mockResolvedValueOnce(0);
  await expect(
    writeInterviewCompletion(
      tx,
      applicationId,
      before,
      { ...input, attendedTutorIds: ["former"] },
      [credit()],
    ),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(source.tutorApplication.update).not.toHaveBeenCalled();
  expect(source.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
  expect(recordDomainAudit).not.toHaveBeenCalled();
});

it("derives legacy completed-repair candidates from the evidenced original panel, including uncredited original members", async () => {
  const legacy = receipt();
  const { eligibleTutorIds: ignored, ...retainedService } =
    legacy.details.effects.retainedService;
  void ignored;
  const { tx } = fixture([credit()], {
    details: { effects: { ...legacy.details.effects, retainedService } },
  });
  expect(
    (await interviewServiceContext(tx, applicationId, before)).eligibleTutorIds,
  ).toEqual(["former", "original-second", "original-third"]);
});

it("recognizes only the exact historical service receipt as a completion no-op", async () => {
  const { tx, source } = fixture();
  const historical = {
    applicationId,
    completedAt,
    durationMin: 45,
    attendedTutorIds: ["former"],
    reason: "Reviewed historical service",
  };
  expect(await isAppliedInterviewCompletion(tx, historical)).toBe(true);
  expect(
    await isAppliedInterviewCompletion(tx, {
      ...historical,
      attendedTutorIds: ["original-second"],
    }),
  ).toBe(false);
  expect(
    await isAppliedInterviewCompletion(tx, { ...historical, durationMin: 46 }),
  ).toBe(false);
  expect(source.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
});

it("does not rewrite a damaged historical ledger while applying a correction", async () => {
  const { tx, source } = fixture([], receipt([credit()]));
  await expect(
    writeInterviewCompletion(
      tx,
      applicationId,
      before,
      { ...input, attendedTutorIds: ["original-second"] },
      [],
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(source.tutorApplication.update).not.toHaveBeenCalled();
  expect(source.serviceHourAdjustment.createMany).not.toHaveBeenCalled();
  expect(recordDomainAudit).not.toHaveBeenCalled();
});

it.each([
  { scenario: "empty", attendedTutorIds: [] },
  { scenario: "duplicate", attendedTutorIds: ["former", "former"] },
])(
  "rejects $scenario actual attendance for historical corrections",
  async ({ attendedTutorIds }) => {
    const { tx, source } = fixture();
    await expect(
      writeInterviewCompletion(
        tx,
        applicationId,
        before,
        { ...input, attendedTutorIds },
        [credit()],
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(source.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
    expect(recordDomainAudit).not.toHaveBeenCalled();
  },
);

it("starts a new source receipt after a legitimate initial-panel reset instead of reusing its old completion candidates", async () => {
  const reset = {
    ...before,
    interviewCompletedAt: null,
    interviewDurationMin: null,
    interviewSchoolYear: null,
    interviewQuarter: null,
  };
  const previous = serviceReceipt();
  const { tx } = fixture([], {
    details: { effects: { ...previous.details.effects, sourceRevision: 7 } },
  });
  const effects = await writeInterviewCompletion(
    tx,
    applicationId,
    reset,
    { ...input, attendedTutorIds: ["current"] },
    [],
  );
  expect(effects.eligibleTutorIds).toEqual(["current", "second", "third"]);
  expect(effects.sourceRevision).toBe(8);
  expect(recordDomainAudit).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({ effects }),
  );
});

it.each(["reversed", "equal"])(
  "selects the later source revision despite %s audit timestamps",
  async (ordering) => {
    const correctedAt = new Date("2026-09-01T03:00:17.123Z");
    const correctedCredit = { ...credit(), amount: 1 };
    const oldRepair = receipt();
    const correction = serviceReceipt([correctedCredit], {
      completedAt: correctedAt.toISOString(),
      durationMin: 60,
      schoolYear: "26-27",
      quarter: "Q1",
    });
    const oldTimestamp = new Date("2026-11-09T01:00:00Z");
    const audits = [
      {
        id: "z-repair",
        createdAt: oldTimestamp,
        details: {
          effects: {
            ...oldRepair.details.effects,
            retainedService: {
              ...oldRepair.details.effects.retainedService,
              sourceRevision: 3,
            },
          },
        },
      },
      {
        id: "a-source",
        createdAt:
          ordering === "equal"
            ? oldTimestamp
            : new Date("2026-11-09T00:59:59Z"),
        details: {
          effects: { ...correction.details.effects, sourceRevision: 4 },
        },
      },
    ];
    const { tx } = fixture([correctedCredit], audits);
    const context = await interviewServiceContext(tx, applicationId, {
      ...before,
      interviewCompletedAt: correctedAt,
      interviewDurationMin: 60,
    });
    expect(context.sourceRevision).toBe(4);
    expect(context.attendedTutorIds).toEqual(["former"]);
    expect(context.eligibleTutorIds).toEqual([
      "former",
      "original-second",
      "original-third",
    ]);
  },
);

it("preserves timestamp fallback for a newer legacy repair without a source revision", async () => {
  const correctedAt = new Date("2026-09-01T03:00:17.123Z");
  const correctedCredit = { ...credit(), amount: 1 };
  const repair = receipt([correctedCredit]);
  const newerRepair = {
    id: "newer",
    createdAt: new Date("2026-11-09T02:00:00Z"),
    details: {
      effects: {
        ...repair.details.effects,
        retainedService: {
          ...repair.details.effects.retainedService,
          completedAt: correctedAt.toISOString(),
          durationMin: 60,
        },
      },
    },
  };
  const olderSource = {
    id: "older",
    createdAt: new Date("2026-11-09T01:00:00Z"),
    ...serviceReceipt(),
  };
  const { tx } = fixture([correctedCredit], [newerRepair, olderSource]);
  const context = await interviewServiceContext(tx, applicationId, {
    ...before,
    interviewCompletedAt: correctedAt,
    interviewDurationMin: 60,
  });
  expect(context.sourceRevision).toBe(0);
  expect(context.credits).toEqual([correctedCredit]);
});

it("does not fall back past a malformed higher source revision", async () => {
  const valid = serviceReceipt();
  const { tx } = fixture(
    [credit()],
    [
      { details: { effects: { ...valid.details.effects, sourceRevision: 2 } } },
      {
        details: {
          effects: {
            interviewServiceVersion: 1,
            sourceRevision: 3,
            completion: {},
          },
        },
      },
    ],
  );
  await expect(
    interviewServiceContext(tx, applicationId, before),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("refuses revision exhaustion before changing source evidence", async () => {
  const original = serviceReceipt();
  const { tx, source } = fixture([credit()], {
    details: {
      effects: {
        ...original.details.effects,
        sourceRevision: Number.MAX_SAFE_INTEGER,
      },
    },
  });
  await expect(
    writeInterviewCompletion(
      tx,
      applicationId,
      before,
      { ...input, attendedTutorIds: ["former"] },
      [credit()],
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(source.tutorApplication.update).not.toHaveBeenCalled();
  expect(source.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
  expect(recordDomainAudit).not.toHaveBeenCalled();
});

it("requires same-revision repair and source snapshots to describe identical service", async () => {
  const oldRepair = receipt();
  const current = serviceReceipt();
  const matching = [
    {
      details: {
        effects: {
          ...oldRepair.details.effects,
          retainedService: {
            ...oldRepair.details.effects.retainedService,
            sourceRevision: 5,
          },
        },
      },
    },
    { details: { effects: { ...current.details.effects, sourceRevision: 5 } } },
  ];
  const { tx, source } = fixture([credit()], matching);
  expect(
    (await interviewServiceContext(tx, applicationId, before)).sourceRevision,
  ).toBe(5);
  source.auditLog.findMany.mockResolvedValueOnce([
    matching[1],
    {
      details: {
        effects: {
          ...oldRepair.details.effects,
          retainedService: {
            ...oldRepair.details.effects.retainedService,
            durationMin: 46,
            sourceRevision: 5,
          },
        },
      },
    },
  ]);
  await expect(
    interviewServiceContext(tx, applicationId, before),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("still refuses empty first-service attendance at the shared domain helper", async () => {
  const { tx, source } = fixture([], null);
  await expect(
    recordInterviewApprovalService(
      tx,
      applicationId,
      { ...before, interviewCompletedAt: null },
      input,
    ),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(source.tutorApplication.update).not.toHaveBeenCalled();
  expect(source.serviceHourAdjustment.createMany).not.toHaveBeenCalled();
});

const reviewedAt = new Date("2026-09-02T01:00:00Z");
const reviewedService = { ...before, updatedAt: reviewedAt };
const reviewedContext = {
  credits: [credit()],
  eligibleTutorIds: ["former", "original-second", "original-third"],
};
const reviewedInput = { ...input, attendedTutorIds: ["former"] };

it.each(
  [
    { label: "duration", change: { durationMin: 60 } },
    {
      label: "date",
      change: { completedAt: new Date("2026-09-02T02:00:37.456Z") },
    },
    { label: "attendance", change: { attendedTutorIds: ["original-second"] } },
  ].flatMap((row) =>
    (["missing", "stale"] as const).map((version) => ({ ...row, version })),
  ),
)(
  "recorded $label changes require a matching version ($version)",
  ({ change, version }) => {
    expect(() =>
      reviewInterviewCompletion(reviewedService, reviewedContext, {
        ...reviewedInput,
        ...change,
        ...(version === "stale" ? { expectedUpdatedAt: new Date(0) } : {}),
      }),
    ).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
  },
);

it.each([{ label: "tokenless" }, { label: "fresh" }, { label: "stale" }])(
  "recognizes an exact full-ledger $label receipt before requiring a version",
  ({ label }) => {
    expect(
      reviewInterviewCompletion(reviewedService, reviewedContext, {
        ...reviewedInput,
        ...(label === "tokenless"
          ? {}
          : {
              expectedUpdatedAt: label === "fresh" ? reviewedAt : new Date(0),
            }),
      }),
    ).toBe("EXACT_RECEIPT");
  },
);

it.each([{ label: "tokenless" }, { label: "fresh" }])(
  "retains $label first-completion admission",
  ({ label }) => {
    const initial = {
      ...reviewedService,
      interviewCompletedAt: null,
      interviewDurationMin: null,
      interviewSchoolYear: null,
      interviewQuarter: null,
    };
    expect(
      reviewInterviewCompletion(
        initial,
        {
          credits: [],
          eligibleTutorIds: initial.interviewers.map(
            (person) => person.tutorId,
          ),
        },
        {
          ...input,
          attendedTutorIds: ["current"],
          ...(label === "fresh" ? { expectedUpdatedAt: reviewedAt } : {}),
        },
      ),
    ).toBe("FIRST_COMPLETION");
  },
);

it("still rejects a supplied stale first-completion version", () => {
  const initial = {
    ...reviewedService,
    interviewCompletedAt: null,
    interviewDurationMin: null,
    interviewSchoolYear: null,
    interviewQuarter: null,
  };
  expect(() =>
    reviewInterviewCompletion(
      initial,
      {
        credits: [],
        eligibleTutorIds: initial.interviewers.map((person) => person.tutorId),
      },
      {
        ...input,
        attendedTutorIds: ["current"],
        expectedUpdatedAt: new Date(0),
      },
    ),
  ).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
});

it("admits a changed recorded service correction only with its captured current version", () => {
  expect(
    reviewInterviewCompletion(reviewedService, reviewedContext, {
      ...reviewedInput,
      durationMin: 60,
      expectedUpdatedAt: reviewedAt,
    }),
  ).toBe("CORRECTION");
});
