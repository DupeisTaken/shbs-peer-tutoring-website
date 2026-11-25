import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { auditActorScope } from "~/server/db-scope";
import { lockEntity } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  finalizeDueOptOuts,
  syncPunishmentRemoval,
} from "./removal";
import { correctionParticipantState } from "~/server/recovery/adapters/correction-state";

const headCaller = () =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: "head-user", name: "Head User", email: "head@example.test" },
      role: "HEAD",
      tutorId: null,
      expires: "2099-01-01",
    },
  });

const tutorCaller = (userId = "tutor-user", tutorId = "tutor-1") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: userId, name: "Tutor User", email: "tutor@example.test" },
      role: "TUTOR",
      tutorId,
      expires: "2099-01-01",
    },
  });

async function resetDb() {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((row) => `"${row.tablename.replaceAll('"', '""')}"`)
        .join(",") +
      " CASCADE",
  );
}

async function seedBase() {
  const term = await db.term.create({
    data: {
      id: "term-1",
      schoolYear: "2026-27",
      quarter: "Q1",
      name: "2026-27 Q1",
      active: true,
    },
  });
  await db.programFeature.upsert({
    where: { key: "DISCIPLINE" },
    create: { key: "DISCIPLINE", enabled: true },
    update: { enabled: true },
  });
  await db.tutor.create({
    data: {
      id: "tutor-1",
      englishName: "Synthetic Tutor",
      status: "ACTIVE",
    },
  });
  await db.user.createMany({
    data: [
      {
        id: "head-user",
        name: "Head User",
        email: "head@example.test",
        role: "HEAD",
      },
      {
        id: "tutor-user",
        name: "Tutor User",
        email: "tutor@example.test",
        role: "TUTOR",
        tutorId: "tutor-1",
      },
    ],
  });
  const tutee = await db.tutee.create({
    data: {
      id: "tutee-1",
      englishName: "Synthetic Learner",
      status: "ACTIVE",
      intakeTermId: term.id,
      notes: "Initial roster note",
    },
  });
  const pairing = await db.pairing.create({
    data: {
      id: "pairing-1",
      tutorId: "tutor-1",
      termId: term.id,
      subject: "Mathematics",
      dayOfWeek: 1,
      startMin: 540,
      endMin: 585,
      scheduleConfirmed: true,
      tutees: { create: { tuteeId: tutee.id } },
    },
  });
  return { term, tutee, pairing };
}

async function createDueVoluntaryRequest(id = "cvoluntaryreq000000000001") {
  return db.tuteeRemovalRequest.create({
    data: {
      id,
      tuteeId: "tutee-1",
      kind: "VOLUNTARY",
      state: "PENDING",
      pairingId: "pairing-1",
      requestedByTutorId: "tutor-1",
      eligibleAt: new Date(Date.now() - 60_000),
    },
  });
}

async function applyPunishmentRemoval() {
  const card1 = await db.disciplinaryCard.create({
    data: { tuteeId: "tutee-1", color: "RED", reviewStatus: "VALID" },
  });
  const card2 = await db.disciplinaryCard.create({
    data: { tuteeId: "tutee-1", color: "RED", reviewStatus: "VALID" },
  });
  const result = await auditActorScope.run(
    { id: "head-user", name: "Head User", role: "HEAD" },
    () => syncPunishmentRemoval(db, "tutee-1"),
  );
  expect(result).toEqual({ removed: true });
  return { card1, card2 };
}

beforeEach(async () => {
  await resetDb();
  await seedBase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("#619 voluntary removal finalization vs recall and staff cancellation", () => {
  it("serializes recall ahead of finalization so finalization never overwrites RECALLED or removes the tutee", async () => {
    const req = await createDueVoluntaryRequest();
    let releaseHolder!: () => void;
    let holderAcquired!: () => void;
    const holderReady = new Promise<void>((r) => {
      holderAcquired = r;
    });
    const holderDone = new Promise<void>((r) => {
      releaseHolder = r;
    });

    // Hold the tutee fence while starting finalization, then commit recall before releasing.
    const holder = db.$transaction(async (tx) => {
      await lockEntity(tx, "tutee:tutee-1");
      holderAcquired();
      await holderDone;
    });
    await holderReady;

    // Recall waits behind the shared fences; release the holder so recall and finalization race cleanly.
    const recallPromise = tutorCaller().tutor.recallTuteeRemoval({
      requestId: req.id,
    });
    await new Promise((r) => setTimeout(r, 40));
    const finalizePromise = finalizeDueOptOuts(db);
    await new Promise((r) => setTimeout(r, 40));
    releaseHolder();
    await holder;

    const [recallOutcome, finalizeOutcome] = await Promise.allSettled([
      recallPromise,
      finalizePromise,
    ]);
    const finalReq = await db.tuteeRemovalRequest.findUniqueOrThrow({
      where: { id: req.id },
    });
    const finalTutee = await db.tutee.findUniqueOrThrow({
      where: { id: "tutee-1" },
    });
    const linkCount = await db.pairingTutee.count({
      where: { tuteeId: "tutee-1" },
    });

    // Exactly one winner: either recall won (RECALLED + ACTIVE + link intact) or finalization won (APPROVED + INACTIVE + link removed).
    if (recallOutcome.status === "fulfilled") {
      expect(recallOutcome.value).toEqual({ ok: true });
      expect(finalizeOutcome).toEqual({ status: "fulfilled", value: 0 });
      expect(finalReq.state).toBe("RECALLED");
      expect(finalTutee.status).toBe("ACTIVE");
      expect(linkCount).toBe(1);
    } else {
      expect(finalizeOutcome).toEqual({ status: "fulfilled", value: 1 });
      expect(finalReq.state).toBe("APPROVED");
      expect(finalTutee.status).toBe("INACTIVE");
      expect(linkCount).toBe(0);
    }
  });

  it("deterministic ordering: recall commits RECALLED first, then finalization is a no-op", async () => {
    const req = await createDueVoluntaryRequest();
    expect(
      await tutorCaller().tutor.recallTuteeRemoval({ requestId: req.id }),
    ).toEqual({ ok: true });
    expect(await finalizeDueOptOuts(db)).toBe(0);
    expect(
      (await db.tuteeRemovalRequest.findUniqueOrThrow({ where: { id: req.id } }))
        .state,
    ).toBe("RECALLED");
    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: "tutee-1" } })).status,
    ).toBe("ACTIVE");
    expect(
      await db.pairingTutee.count({ where: { tuteeId: "tutee-1" } }),
    ).toBe(1);
    // Duplicate recall truthfully refuses.
    await expect(
      tutorCaller().tutor.recallTuteeRemoval({ requestId: req.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("deterministic ordering: finalization commits APPROVED first, then late recall and admin cancel truthfully refuse", async () => {
    const req = await createDueVoluntaryRequest();
    expect(await finalizeDueOptOuts(db)).toBe(1);
    await expect(
      tutorCaller().tutor.recallTuteeRemoval({ requestId: req.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      headCaller().admin.cancelTuteeOptOut({ requestId: req.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      (await db.tuteeRemovalRequest.findUniqueOrThrow({ where: { id: req.id } }))
        .state,
    ).toBe("APPROVED");
    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: "tutee-1" } })).status,
    ).toBe("INACTIVE");
  });

  it("admin.cancelTuteeOptOut commits DENIED under shared fences so finalization does not overwrite it", async () => {
    const req = await createDueVoluntaryRequest();
    expect(
      await headCaller().admin.cancelTuteeOptOut({ requestId: req.id }),
    ).toEqual({ ok: true });
    expect(await finalizeDueOptOuts(db)).toBe(0);
    expect(
      (await db.tuteeRemovalRequest.findUniqueOrThrow({ where: { id: req.id } }))
        .state,
    ).toBe("DENIED");
    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: "tutee-1" } })).status,
    ).toBe("ACTIVE");
  });
});

describe("#620 punishment-removal reinstatement vs harmless edits and real status decisions", () => {
  it("restores learner and pairing in the no-edit control after an upheld card correction", async () => {
    const { card1 } = await applyPunishmentRemoval();
    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: "tutee-1" } })).status,
    ).toBe("INACTIVE");
    expect(
      await db.pairingTutee.count({ where: { tuteeId: "tutee-1" } }),
    ).toBe(0);

    await headCaller().admin.reviewCard({
      id: card1.id,
      expectedUpdatedAt: card1.updatedAt,
      reviewStatus: "INVALID",
      reviewNote: "Verified excused absence",
    });

    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: "tutee-1" } })).status,
    ).toBe("ACTIVE");
    expect(
      await db.pairingTutee.count({ where: { tuteeId: "tutee-1" } }),
    ).toBe(1);
  });

  it("still reinstates learner and pairing after a harmless admin.updateTutee notes/contact edit", async () => {
    const { card1 } = await applyPunishmentRemoval();
    const removedTutee = await db.tutee.findUniqueOrThrow({
      where: { id: "tutee-1" },
    });
    // Edit notes and contact while keeping status INACTIVE (bumping updatedAt).
    await new Promise((r) => setTimeout(r, 15));
    await headCaller().admin.updateTutee({
      id: removedTutee.id,
      expectedUpdatedAt: removedTutee.updatedAt,
      englishName: removedTutee.englishName,
      status: "INACTIVE",
      notes: "Harmless follow-up note added by staff",
      email: "new-contact@example.test",
    });
    const edited = await db.tutee.findUniqueOrThrow({
      where: { id: "tutee-1" },
    });
    expect(edited.updatedAt.getTime()).toBeGreaterThan(
      removedTutee.updatedAt.getTime(),
    );

    // Recovery checkpoint projection must agree that restoration is eligible.
    const projected = await db.$transaction((tx) =>
      correctionParticipantState(tx, "tutee-1"),
    );
    expect(projected.restoration).not.toBeNull();
    expect(projected.restoration?.pairingIds).toEqual(["pairing-1"]);

    await headCaller().admin.reviewCard({
      id: card1.id,
      expectedUpdatedAt: card1.updatedAt,
      reviewStatus: "INVALID",
      reviewNote: "Appeal upheld after notes edit",
    });

    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: "tutee-1" } })).status,
    ).toBe("ACTIVE");
    expect(
      await db.pairingTutee.count({ where: { tuteeId: "tutee-1" } }),
    ).toBe(1);
  });

  it("blocks automatic reinstatement after a genuine later INACTIVE -> ACTIVE -> INACTIVE status round-trip", async () => {
    const { card1 } = await applyPunishmentRemoval();
    const removed = await db.tutee.findUniqueOrThrow({
      where: { id: "tutee-1" },
    });
    await headCaller().admin.setTuteeStatus({
      id: "tutee-1",
      expectedUpdatedAt: removed.updatedAt,
      status: "ACTIVE",
    });
    const reactivated = await db.tutee.findUniqueOrThrow({
      where: { id: "tutee-1" },
    });
    await headCaller().admin.setTuteeStatus({
      id: "tutee-1",
      expectedUpdatedAt: reactivated.updatedAt,
      status: "INACTIVE",
    });

    await headCaller().admin.reviewCard({
      id: card1.id,
      expectedUpdatedAt: card1.updatedAt,
      reviewStatus: "INVALID",
      reviewNote: "Card overturned after manual status decision",
    });

    expect(
      (await db.disciplinaryCard.findUniqueOrThrow({ where: { id: card1.id } }))
        .reviewStatus,
    ).toBe("INVALID");
    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: "tutee-1" } })).status,
    ).toBe("INACTIVE");
    expect(
      await db.pairingTutee.count({ where: { tuteeId: "tutee-1" } }),
    ).toBe(0);
  });

  it("blocks automatic reinstatement after a quarter rollover changes the active period", async () => {
    const { card1 } = await applyPunishmentRemoval();
    await db.term.update({ where: { id: "term-1" }, data: { active: false } });
    await db.term.create({
      data: {
        id: "term-2",
        schoolYear: "2026-27",
        quarter: "Q2",
        name: "2026-27 Q2",
        active: true,
      },
    });

    await headCaller().admin.reviewCard({
      id: card1.id,
      expectedUpdatedAt: card1.updatedAt,
      reviewStatus: "INVALID",
      reviewNote: "Overturned in a later quarter",
    });

    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: "tutee-1" } })).status,
    ).toBe("INACTIVE");
    expect(
      await db.pairingTutee.count({ where: { tuteeId: "tutee-1" } }),
    ).toBe(0);
  });

  it("falls back to PENDING instead of creating a schedule collision when the original pairing conflicts", async () => {
    const { card1 } = await applyPunishmentRemoval();
    // Create a conflicting confirmed pairing for the tutor at the exact same slot.
    await db.pairing.create({
      data: {
        id: "pairing-conflict",
        tutorId: "tutor-1",
        termId: "term-1",
        subject: "Physics",
        dayOfWeek: 1,
        startMin: 540,
        endMin: 585,
        scheduleConfirmed: true,
      },
    });

    await headCaller().admin.reviewCard({
      id: card1.id,
      expectedUpdatedAt: card1.updatedAt,
      reviewStatus: "INVALID",
      reviewNote: "Appeal upheld with conflicting slot",
    });

    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: "tutee-1" } })).status,
    ).toBe("PENDING");
    expect(
      await db.pairingTutee.count({ where: { tuteeId: "tutee-1" } }),
    ).toBe(0);
  });
});
