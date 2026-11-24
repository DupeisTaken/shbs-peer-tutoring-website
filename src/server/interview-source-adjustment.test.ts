import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { approveQualification } from "~/server/qualifications";
import { interviewHoursId } from "~/server/interview-hours";
import { lockUsernameNamespace } from "~/server/auth/username";
import { lockApplicationReview } from "~/server/request-invalidity";
import { databaseScope } from "~/server/db-scope";
import {
  fingerprint,
  parseProposal,
  proposalTargets,
} from "~/server/approvals";
import { INTERVIEW_ADJUSTMENT_SOURCE_CONFLICT_MESSAGE } from "~/server/interview-adjustment-source";

const originalPanel = ["source-chair", "source-qualified", "source-member"];
const repairedPanel = ["source-head", "source-qualified", "source-member"];
const completedAt = new Date("2026-09-15T04:00:37.456Z");
const tutorIds = (ids: string[]) => ids.map((id) => `${id}-tutor`);
const caller = (id = "source-head") =>
  createCaller({
    db,
    headers: new Headers(),
    // Identity comes from the session; role/link authority comes from stored state.
    session: {
      user: { id, name: `Synthetic ${id}`, email: `${id}@example.test` },
      role: "HEAD" as Session["role"],
      tutorId: "stale-session-link",
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
      name: "Synthetic source quarter",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  for (const [id, role] of [
    ["source-applicant", "TUTOR"],
    ["source-head", "HEAD"],
    ["source-chair", "ADMIN"],
    ["source-qualified", "TUTOR"],
    ["source-member", "TUTOR"],
    ["source-coordinator", "COORDINATOR"],
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
        emailVerifiedAt: new Date(),
        tutorId: `${id}-tutor`,
      },
    });
  }
  await db.subject.create({
    data: { id: "source-subject", name: "Synthetic source history" },
  });
  await db.$transaction((tx) =>
    approveQualification(
      tx,
      "source-qualified-tutor",
      "source-subject",
      "source-head",
    ),
  );
});

afterAll(() => db.$disconnect());

async function application(id: string) {
  return db.tutorApplication.findUniqueOrThrow({
    where: { id },
    include: {
      interviewers: { orderBy: { tutorId: "asc" } },
      votes: { orderBy: { tutorId: "asc" } },
    },
  });
}

async function vote(id: string, panel: string[]) {
  for (const person of panel)
    await caller(person).tutor.castInterviewVote({
      applicationId: id,
      accept: true,
      comment: "Synthetic source review vote",
    });
}

async function assignedReview(initialApplicationId?: string) {
  const { id } = initialApplicationId
    ? await db.tutorApplication.create({
        data: {
          id: initialApplicationId,
          name: "Synthetic legacy source identity",
          email: "legacy-source@example.test",
          subjectIntents: { create: { subjectId: "source-subject" } },
        },
      })
    : await caller("source-applicant").qualificationApplication.submit({
        subjectId: "source-subject",
        reason: "Synthetic additional qualification source",
      });
  // Real panel assignment/completion APIs acquire namespace before application;
  // no direct fixture edit fabricates a canonical credit or service receipt.
  await caller().admin.assignInterviewers({
    applicationId: id,
    tutorIds: tutorIds(originalPanel),
    headTutorId: "source-chair-tutor",
    expectedUpdatedAt: (await application(id)).updatedAt,
  });
  await vote(id, originalPanel);
  return application(id);
}

async function completedReview(initialApplicationId?: string) {
  const { id } = await assignedReview(initialApplicationId);
  await caller().interviewManagement.complete({
    applicationId: id,
    completedAt,
    durationMin: 30,
    attendedTutorIds: tutorIds(originalPanel),
    reason: "Synthetic actual completed interview",
    expectedUpdatedAt: (await application(id)).updatedAt,
  });
  return application(id);
}

async function repair(id: string) {
  await caller().admin.assignInterviewers({
    applicationId: id,
    tutorIds: tutorIds(repairedPanel),
    headTutorId: "source-head-tutor",
    repairReason:
      "Synthetic valid open-panel amendment retaining physical service",
    expectedUpdatedAt: (await application(id)).updatedAt,
  });
}

async function source(id: string) {
  return {
    application: await application(id),
    credits: await db.serviceHourAdjustment.findMany({
      where: {
        id: {
          in: tutorIds(originalPanel).map((tutorId) =>
            interviewHoursId(id, tutorId),
          ),
        },
      },
      orderBy: { id: "asc" },
    }),
    receipts: await db.auditLog.findMany({
      where: {
        entity: "TutorApplication",
        entityId: id,
        OR: [
          {
            details: {
              path: ["effects", "interviewServiceVersion"],
              equals: 1,
            },
          },
          { details: { path: ["effects", "panelRepairVersion"], equals: 1 } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  };
}

async function state(id: string) {
  return {
    source: await source(id),
    allCredits: await db.serviceHourAdjustment.findMany({
      orderBy: { id: "asc" },
    }),
    proposals: await db.approvalRequest.findMany({ orderBy: { id: "asc" } }),
    grants: await db.qualificationGrant.findMany({
      orderBy: [
        { tutorId: "asc" },
        { sourceSubjectId: "asc" },
        { subjectId: "asc" },
      ],
    }),
    codes: await db.registrationCode.findMany({ orderBy: { id: "asc" } }),
    notices: await db.notification.findMany({ orderBy: { id: "asc" } }),
  };
}

it.each(
  ["source-head", "source-chair", "source-coordinator"].flatMap((actor) =>
    [false, true].map((repaired) => ({ actor, repaired })),
  ),
)(
  "protects canonical interview credits from generic deletion and prequeue ($actor, repaired=$repaired)",
  async ({ actor, repaired }) => {
    const app = await completedReview();
    if (repaired) await repair(app.id);
    // The repaired case targets a historical owner absent from today's panel.
    const id = interviewHoursId(app.id, "source-chair-tutor");
    const before = await state(app.id);
    expect(before.source.credits).toHaveLength(originalPanel.length);
    // Retain the actual resulting ledger/proposal differences in the baseline
    // receipt when a direct deletion succeeds or Coordinator admission queues.
    const deletion: unknown = await caller(actor)
      .admin.deleteAdjustment({ id })
      .catch((error: unknown) => error);
    expect.soft(deletion).toMatchObject({ code: "CONFLICT" });
    expect.soft(await state(app.id)).toEqual(before);
    expect.soft(await db.approvalRequest.count()).toBe(0);
    const evidence = await caller().interviewManagement.completionEvidence({
      applicationId: app.id,
    });
    expect(
      evidence.completionParticipants.filter((person) => person.attended),
    ).toHaveLength(originalPanel.length);
    expect(
      evidence.completionParticipants.every(
        (person) => person.creditHours === 0.5,
      ),
    ).toBe(true);

    // A refused generic operation leaves the supported interview flow usable.
    // Repair never drops the protected historical owner's service credit.
    await repair(app.id);
    await vote(app.id, repairedPanel);
    const current = await application(app.id);
    await expect(
      caller().qualificationApplication.decide({
        id: app.id,
        accept: true,
        comment: "Synthetic protected source remains decidable",
        expectedUpdatedAt: current.updatedAt,
        retainRecordedService: true,
        completion: {
          completedAt,
          durationMin: 30,
          attendedTutorIds: current.interviewers
            .filter((person) => person.attended)
            .map((person) => person.tutorId),
        },
      }),
    ).resolves.toEqual({ ok: true });
    expect((await application(app.id)).status).toBe("ACCEPTED");
    expect(
      await db.qualificationGrant.count({
        where: {
          tutorId: "source-applicant-tutor",
          subjectId: "source-subject",
        },
      }),
    ).toBe(1);
    expect((await source(app.id)).credits).toEqual(before.source.credits);
    expect(await db.registrationCode.count()).toBe(0);
  },
);

it.each(["ordinary", "prefix-neighbor"] as const)(
  "allows generic deletion of an unrelated %s manual adjustment without damaging interview service",
  async (kind) => {
    const app = await completedReview();
    const row =
      kind === "ordinary"
        ? await caller().admin.createAdjustment({
            tutorId: "source-member-tutor",
            month: "2026-09",
            type: "EXTRA",
            amount: 1.25,
            reason: "Synthetic independent manual award",
          })
        : // A manually assigned historical ID is not evidence of interview ownership.
          // Its reason and owner deliberately make no claim to a canonical source.
          await db.serviceHourAdjustment.create({
            data: {
              id: `interview_${app.id}_neighbor_manual`,
              tutorId: "source-member-tutor",
              month: "2026-09",
              schoolYear: "26-27",
              quarter: "Q1",
              type: "EXTRA",
              amount: 1.25,
              reason: "Synthetic independent prefixed manual award",
            },
          });
    const before = await source(app.id);
    await expect(
      caller().admin.deleteAdjustment({ id: row.id }),
    ).resolves.toMatchObject({ id: row.id });
    expect(
      await db.serviceHourAdjustment.findUnique({ where: { id: row.id } }),
    ).toBeNull();
    expect(await source(app.id)).toEqual(before);
    await expect(
      caller().interviewManagement.completionEvidence({
        applicationId: app.id,
      }),
    ).resolves.toMatchObject({ id: app.id });
  },
);

it("retains normal Coordinator proposal and review semantics for an unrelated manual deletion", async () => {
  const app = await completedReview();
  const row = await caller().admin.createAdjustment({
    tutorId: "source-member-tutor",
    month: "2026-09",
    type: "EXTRA",
    amount: 1.25,
    reason: "Synthetic reviewable manual award",
  });
  const before = await source(app.id);
  await expect(
    caller("source-coordinator").admin.deleteAdjustment({ id: row.id }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(
    await db.serviceHourAdjustment.findUnique({ where: { id: row.id } }),
  ).toEqual(row);
  expect(await source(app.id)).toEqual(before);
  const proposal = await db.approvalRequest.findFirstOrThrow({
    where: {
      requesterId: "source-coordinator",
      operation: "admin.deleteAdjustment",
      state: "PENDING",
    },
  });
  await caller().approval.decide({
    id: proposal.id,
    approve: true,
    note: "Synthetic independent manual deletion review",
  });
  expect(
    await db.serviceHourAdjustment.findUnique({ where: { id: row.id } }),
  ).toBeNull();
  expect(await source(app.id)).toEqual(before);
  await expect(
    caller().interviewManagement.completionEvidence({ applicationId: app.id }),
  ).resolves.toMatchObject({ id: app.id });
});

it.each([
  { label: "owner", data: { tutorId: "source-applicant-tutor" } },
  { label: "type", data: { type: "PUNISHMENT" as const } },
  { label: "reason", data: { reason: "Synthetic damaged source label" } },
])(
  "protects a typed source receipt's exact credit after its current $label is damaged",
  async ({ data }) => {
    const app = await completedReview();
    const id = interviewHoursId(app.id, "source-chair-tutor");
    // Damage only the operational row. Its real completion receipt remains the
    // original source claim, so changed labels cannot authorize generic removal.
    await db.serviceHourAdjustment.update({ where: { id }, data });
    const before = await state(app.id);
    expect(before.source.receipts).toHaveLength(1);
    for (const actor of ["source-head", "source-coordinator"]) {
      await expect(
        caller(actor).admin.deleteAdjustment({ id }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await state(app.id)).toEqual(before);
    }
    expect(await db.approvalRequest.count()).toBe(0);
  },
);

it.each([
  { role: "VIEWER", departed: false },
  { role: "STUDENT", departed: false },
  { role: "CREW", departed: false },
  { role: "TUTOR", departed: false },
  { role: "TUTOR", departed: true },
] as const)(
  "denies generic source deletion before private source inspection for $role (departed=$departed)",
  async ({ role, departed }) => {
    const app = await completedReview();
    const id = interviewHoursId(app.id, "source-chair-tutor");
    await db.serviceHourAdjustment.update({
      where: { id },
      data: { reason: "Synthetic malformed private source evidence" },
    });
    await db.user.update({
      where: { id: "source-applicant" },
      data: {
        role,
        // VIEWER is exclusive of active participation. Preserve the completed
        // application's Tutor record while giving this observer no tutor access.
        ...(role === "VIEWER"
          ? {
              tutorId: null,
              tuteeMember: false,
              canTranslate: false,
              crewStatus: null,
            }
          : {}),
      },
    });
    if (departed)
      await db.schoolDeparture.create({
        data: {
          userId: "source-applicant",
          reason: "TRANSFERRED",
          effectiveAt: new Date(),
          source: "Synthetic historical observer",
          tutorDerived: true,
        },
      });
    const before = await state(app.id);
    await expect(
      caller("source-applicant").admin.deleteAdjustment({ id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    if (role === "VIEWER" || departed) {
      const rows = await caller("source-applicant").admin.adjustments();
      const observed = rows.find((row) => row.id === id);
      expect(observed).toMatchObject({ reason: null });
      expect(observed?.source).toEqual({
        kind: "INTERVIEW",
        canDelete: false,
        correctionHref: null,
      });
    } else {
      await expect(
        caller("source-applicant").admin.adjustments(),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await state(app.id)).toEqual(before);
  },
);

it("protects completed legacy source ownership without requiring a typed receipt or an intact sibling ledger", async () => {
  const app = await completedReview();
  const recorded = await source(app.id);
  expect(recorded.receipts).toHaveLength(1);
  // Reproduce an older completed record, then unrelated damage to one sibling.
  // The remaining canonical credit's ownership does not depend on accepting
  // that incomplete ledger as a valid correction or counted completion receipt.
  await db.auditLog.deleteMany({
    where: { id: { in: recorded.receipts.map((receipt) => receipt.id) } },
  });
  await db.serviceHourAdjustment.delete({
    where: { id: interviewHoursId(app.id, "source-member-tutor") },
  });
  const id = interviewHoursId(app.id, "source-chair-tutor");
  const before = await state(app.id);
  expect(before.source.receipts).toHaveLength(0);
  expect(before.source.credits).toHaveLength(2);
  for (const actor of ["source-head", "source-coordinator"]) {
    await expect(
      caller(actor).admin.deleteAdjustment({ id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await state(app.id)).toEqual(before);
  }
  await expect(
    caller().interviewManagement.completionEvidence({ applicationId: app.id }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await state(app.id)).toEqual(before);
});

it("resolves a real completed legacy application containing underscores without treating its first prefix as the source", async () => {
  // A shorter application is a real neighboring identity, not the owner of the
  // longer application's exact canonical source key.
  await db.tutorApplication.create({
    data: {
      id: "source",
      name: "Synthetic prefix neighbor application",
      email: "source-prefix@example.test",
    },
  });
  const app = await completedReview("source_legacy_with_under_scores");
  const recorded = await source(app.id);
  expect(recorded.receipts).toHaveLength(1);
  await db.auditLog.deleteMany({
    where: { id: { in: recorded.receipts.map((receipt) => receipt.id) } },
  });
  const id = interviewHoursId(app.id, "source-chair-tutor");
  const before = await state(app.id);
  for (const actor of ["source-head", "source-coordinator"]) {
    await expect(
      caller(actor).admin.deleteAdjustment({ id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await state(app.id)).toEqual(before);
  }
  await expect(
    caller().interviewManagement.completionEvidence({ applicationId: app.id }),
  ).resolves.toMatchObject({ id: app.id });
});

it("refuses approval of an old queued canonical source deletion with its authentic unchanged target snapshot", async () => {
  const app = await completedReview();
  const id = interviewHoursId(app.id, "source-chair-tutor");
  const legacy = await db.$transaction(async (tx) => {
    await lockUsernameNamespace(tx);
    await lockApplicationReview(tx, app.id);
    await tx.$queryRaw`SELECT id FROM "ServiceHourAdjustment" WHERE id = ${id} FOR SHARE`;
    // Reconstruct a request queued before source ownership was guarded. Capture
    // today's real target via the legacy snapshot protocol; never alter a live
    // source receipt or mutate a previously published request to make it replay.
    const payload = await parseProposal("admin.deleteAdjustment", { id });
    const targets = await proposalTargets(
      tx,
      "admin.deleteAdjustment",
      payload,
    );
    return tx.approvalRequest.create({
      data: {
        requesterId: "source-coordinator",
        requesterName: "Synthetic source coordinator",
        operation: "admin.deleteAdjustment",
        payload,
        targets,
        fingerprint: fingerprint(targets),
      },
    });
  });
  const before = await state(app.id);
  expect(before.proposals).toHaveLength(1);
  expect(legacy.state).toBe("PENDING");
  await expect(
    caller().approval.decide({
      id: legacy.id,
      approve: true,
      note: "Synthetic review of a pre-protection source deletion",
    }),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    message: INTERVIEW_ADJUSTMENT_SOURCE_CONFLICT_MESSAGE,
  });
  expect(await state(app.id)).toEqual(before);
  expect(
    await db.approvalRequest.findUniqueOrThrow({ where: { id: legacy.id } }),
  ).toEqual(legacy);
  await expect(
    caller().interviewManagement.completionEvidence({ applicationId: app.id }),
  ).resolves.toMatchObject({ id: app.id });
});

it("projects only actionable source metadata to management and preserves independent manual controls", async () => {
  const app = await completedReview();
  await repair(app.id);
  const id = interviewHoursId(app.id, "source-chair-tutor");
  const manual = await caller().admin.createAdjustment({
    tutorId: "source-member-tutor",
    month: "2026-09",
    type: "EXTRA",
    amount: 1.25,
    reason: "Synthetic independently removable read control",
  });
  const before = await state(app.id);
  for (const actor of ["source-head", "source-chair", "source-coordinator"]) {
    const rows = await caller(actor).admin.adjustments();
    const owned = rows.find((row) => row.id === id);
    const independent = rows.find((row) => row.id === manual.id);
    expect(owned?.source).toEqual({
      kind: "LIVE_INTERVIEW",
      canDelete: false,
      correctionHref: `/admin/applications#interview-completion-${encodeURIComponent(app.id)}`,
    });
    expect(independent?.source).toEqual({
      kind: "INDEPENDENT",
      canDelete: true,
      correctionHref: null,
    });
    expect(independent?.reason).toBe(manual.reason);
  }
  expect(await state(app.id)).toEqual(before);
});

it("cannot generically delete a canonical credit first created while its stale deletion waits for the namespace", async () => {
  const app = await assignedReview();
  const id = interviewHoursId(app.id, "source-chair-tutor");
  expect(
    await db.serviceHourAdjustment.findUnique({ where: { id } }),
  ).toBeNull();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: (pid: number) => void;
  const locked = new Promise<number>((resolve) => {
    ready = resolve;
  });
  let winning: Awaited<ReturnType<typeof state>> | undefined;
  const blocker = db.$transaction(
    async (tx) => {
      await lockUsernameNamespace(tx);
      await lockApplicationReview(tx, app.id);
      const [backend] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      ready(backend!.pid);
      await gate;
      await databaseScope.run(tx, async () => {
        // The row does not exist at deletion preflight. A real first completion
        // creates it under N→application before the stale deletion may proceed.
        await caller().interviewManagement.complete({
          applicationId: app.id,
          completedAt,
          durationMin: 30,
          attendedTutorIds: tutorIds(originalPanel),
          reason: "Synthetic first completion wins a stale generic deletion",
          expectedUpdatedAt: app.updatedAt,
        });
        winning = await state(app.id);
      });
    },
    { timeout: 10000 },
  );
  let deleting: Promise<unknown> | undefined;
  let observedWait = false;
  try {
    const blockerPid = await Promise.race([
      locked,
      blocker.then(() => {
        throw new Error("Source blocker completed before its release gate");
      }),
    ]);
    deleting = caller()
      .admin.deleteAdjustment({ id })
      .then(
        (value) => ({ status: "fulfilled", value }),
        (reason: unknown) => ({ status: "rejected", reason }),
      );
    await vi.waitUntil(
      async () => {
        const [row] = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND wait_event = 'advisory'
            AND ${blockerPid} = ANY(pg_blocking_pids(pid))
            AND query LIKE '%pg_advisory_xact_lock%'
        ) AS waiting`;
        observedWait = row?.waiting === true;
        return observedWait;
      },
      { timeout: 3000, interval: 25 },
    );
  } finally {
    release();
    const [blockerResult] = await Promise.allSettled([blocker, deleting]);
    if (blockerResult.status === "rejected") throw blockerResult.reason;
  }
  expect(observedWait).toBe(true);
  expect(await deleting).toMatchObject({
    status: "rejected",
    reason: { code: "CONFLICT" },
  });
  expect(winning).toBeDefined();
  expect(await state(app.id)).toEqual(winning);
  expect(await db.approvalRequest.count()).toBe(0);
  const evidence = await caller().interviewManagement.completionEvidence({
    applicationId: app.id,
  });
  expect(
    evidence.completionParticipants.filter((row) => row.attended),
  ).toHaveLength(originalPanel.length);
});
