import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import superjson from "superjson";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { ApprovalQueued } from "~/server/approvals";
import { recruitmentStatus, recruitmentWindow } from "~/lib/recruitment";
import { getRecruitment } from "~/server/program/recruitment";
import { parseProgramDateTime } from "~/lib/program-time";
import type { PrepareNextRecruitmentInput } from "~/lib/next-recruitment";
import * as audit from "~/server/audit/log";
import { databaseScope } from "~/server/db-scope";
import { lockEntity } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

const sourceId = "next-recruitment-source";
const opening = new Date("2030-11-01T00:00:00.000Z");
const laterOpening = new Date("2030-11-02T00:00:00.000Z");
const actor = (role: Session["role"] = "HEAD") => createCaller({
  db,
  headers: new Headers(),
  session: {
    user: { id: `next-${role}`, name: `Synthetic ${role}`, email: `${role}@example.test` },
    role, tutorId: null, expires: "2099-01-01T00:00:00Z",
  },
});
const publicCaller = () => createCaller({ db, headers: new Headers(), session: null });
async function preparation(audience: "tutor" | "tutee", opensAt: Date | null = opening): Promise<PrepareNextRecruitmentInput> {
  const snapshot = await actor().program.nextRecruitment();
  return { audience, opensAt, expectedTarget: snapshot.target,
    expectedVersion: snapshot.preparations[audience]?.version ?? 0,
    expectedTimeZone: snapshot.timeZone };
}
async function refreshInput() {
  const snapshot = await actor().program.nextRecruitment();
  return { confirm: "REFRESH", expectedTermId: snapshot.target.sourceTermId,
    expectedPreparation: snapshot.refreshEvidence };
}
async function queued(work: Promise<unknown>) {
  const error: unknown = await work.catch((error: unknown) => error);
  expect((error as { cause?: unknown }).cause).toBeInstanceOf(ApprovalQueued);
  return db.approvalRequest.findUniqueOrThrow({
    where: { id: (error as { cause: ApprovalQueued }).cause.approvalId },
  });
}

// Every test owns an isolated loopback database. Never reuse the demo or production fixtures.
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const url = new URL(process.env.DATABASE_URL!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/shbs_shipping_test")
    throw new Error("Next recruitment integration tests require local shbs_shipping_test");
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  await db.user.createMany({ data: (["HEAD", "ADMIN", "COORDINATOR", "VIEWER"] as const).map((role) => ({
    id: `next-${role}`, role, name: `Synthetic ${role}`, email: `${role}@example.test`,
  })) });
  await db.term.create({ data: { id: sourceId, name: "26-27 Q1", schoolYear: "26-27", quarter: "Q1", active: true,
    signupEnabled: false, signupOpensAt: new Date("2026-01-01"),
    tutorSignupOpensAt: new Date("2026-01-01"), tutorSignupPreviewUrl: "https://example.test/current" } });
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$disconnect());

describe("next-period opening authority and public isolation", () => {
  it("saves, edits and clears independently without changing current intake or creating historical periods", async () => {
    const before = await db.term.findUniqueOrThrow({ where: { id: sourceId } });
    await actor().program.prepareNextRecruitment(await preparation("tutor"));
    await actor().program.prepareNextRecruitment(await preparation("tutee", laterOpening));
    await actor().program.prepareNextRecruitment(await preparation("tutor", laterOpening));
    await actor().program.prepareNextRecruitment(await preparation("tutee", null));
    const after = await db.term.findUniqueOrThrow({ where: { id: sourceId } });
    for (const audience of ["tutor", "tutee"] as const) {
      expect(recruitmentWindow(after, audience)).toEqual(recruitmentWindow(before, audience));
      expect(await getRecruitment(db, audience)).toMatchObject(recruitmentWindow(before, audience));
    }
    expect(await db.term.count()).toBe(1);
    expect(await actor().program.nextRecruitment()).toMatchObject({
      preparations: { tutor: { opensAt: laterOpening, version: 2 }, tutee: { opensAt: null, version: 2 } },
    });
    expect(await db.auditLog.count({ where: { operation: "program.prepareNextRecruitment" } })).toBeGreaterThanOrEqual(4);
  });

  it("queues independent Admin proposals without writing preparations and lets Head apply both", async () => {
    const tutor = await queued(actor("ADMIN").program.prepareNextRecruitment(await preparation("tutor")));
    const tutee = await queued(actor("ADMIN").program.prepareNextRecruitment(await preparation("tutee", laterOpening)));
    expect(await db.nextRecruitmentPreparation.count()).toBe(0);
    await expect(actor("ADMIN").approval.decide({ id: tutor.id, approve: true, note: "Self-review refused" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await actor().approval.decide({ id: tutor.id, approve: true, note: "Reviewed tutor date" });
    // Current-window edits are unrelated to a future audience's independent proposal.
    await actor().program.setSignupWindow({ audience: "tutor", expectedTermId: sourceId,
      enabled: false, opensAt: null, closesAt: null, previewUrl: null });
    await actor().approval.decide({ id: tutee.id, approve: true, note: "Reviewed tutee date" });
    expect(await db.nextRecruitmentPreparation.count()).toBe(2);
    expect(await actor().program.nextRecruitment()).toMatchObject({
      preparations: { tutor: { opensAt: opening }, tutee: { opensAt: laterOpening } },
    });
  });

  it.each(["COORDINATOR", "VIEWER"] as const)("denies %s preparation writes before queueing", async (role) => {
    await expect(actor(role).program.prepareNextRecruitment(await preparation("tutor"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.approvalRequest.count()).toBe(0);
    expect(await db.nextRecruitmentPreparation.count()).toBe(0);
  });

  it("uses current roles rather than stale requester and reviewer sessions", async () => {
    const proposal = await queued(actor("ADMIN").program.prepareNextRecruitment(await preparation("tutor")));
    await db.user.update({ where: { id: "next-ADMIN" }, data: { role: "COORDINATOR" } });
    await expect(actor().approval.decide({ id: proposal.id, approve: true, note: "Requester demoted" })).rejects.toMatchObject({ code: "CONFLICT" });
    await db.user.update({ where: { id: "next-ADMIN" }, data: { role: "ADMIN" } });
    await db.user.update({ where: { id: "next-HEAD" }, data: { role: "ADMIN" } });
    await expect(actor().approval.decide({ id: proposal.id, approve: true, note: "Reviewer demoted" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.nextRecruitmentPreparation.count()).toBe(0);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: proposal.id } })).state).toBe("PENDING");
  });

  it("validates a reused destination's closing bound during proposal capture", async () => {
    await db.term.create({ data: { name: "Existing next", schoolYear: "26-27", quarter: "Q2", tutorSignupClosesAt: opening } });
    await expect(actor("ADMIN").program.prepareNextRecruitment(await preparation("tutor"))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.approvalRequest.count()).toBe(0);
  });
});

describe("reviewed atomic refresh", () => {
  it("requires Head approval and installs both reviewed openings together with activation", async () => {
    await actor().program.prepareNextRecruitment(await preparation("tutor"));
    await actor().program.prepareNextRecruitment(await preparation("tutee", laterOpening));
    const input = await refreshInput();
    const request = await queued(actor("ADMIN").admin.refresh(input));
    expect((await db.term.findFirstOrThrow({ where: { active: true } })).id).toBe(sourceId);
    expect(await db.term.count()).toBe(1);
    await actor().approval.decide({ id: request.id, approve: true, note: "Reviewed both openings and destination" });
    const active = await db.term.findFirstOrThrow({ where: { active: true } });
    expect(active).toMatchObject({ quarter: "Q2", schoolYear: "26-27", tutorSignupOpensAt: opening,
      signupOpensAt: laterOpening, signupEnabled: true, tutorSignupEnabled: true });
    expect((await actor().admin.currentPeriod())?.recruitment).toMatchObject({ tutor: { opensAt: opening }, tutee: { opensAt: laterOpening } });
    expect(await db.nextRecruitmentPreparation.count({ where: { sourceTermId: sourceId } })).toBe(2);
    await expect(actor().admin.refresh(input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.term.count({ where: { active: true } })).toBe(1);
  });

  it("preserves a reused destination's switches, closes and preview links, and distinguishes unset from clear", async () => {
    const close = new Date("2031-01-01");
    const existing = await db.term.create({ data: { name: "Original destination name", schoolYear: "26-27", quarter: "Q2",
      signupEnabled: false, signupOpensAt: opening, signupClosesAt: close, signupPreviewUrl: "https://example.test/tutee",
      tutorSignupEnabled: false, tutorSignupOpensAt: laterOpening, tutorSignupClosesAt: close, tutorSignupPreviewUrl: "https://example.test/tutor" } });
    await actor().program.prepareNextRecruitment(await preparation("tutor", null));
    await actor().admin.refresh(await refreshInput());
    const active = await db.term.findUniqueOrThrow({ where: { id: existing.id } });
    expect(active).toMatchObject({ active: true, name: existing.name, tutorSignupOpensAt: null,
      signupEnabled: false, signupOpensAt: opening, signupClosesAt: close, signupPreviewUrl: existing.signupPreviewUrl,
      tutorSignupEnabled: false, tutorSignupClosesAt: close, tutorSignupPreviewUrl: existing.tutorSignupPreviewUrl });
  });

  it("keeps unprepared new-period defaults and enforces the ordinary public setup prerequisites", async () => {
    await actor().admin.refresh(await refreshInput());
    const active = await db.term.findFirstOrThrow({ where: { active: true } });
    expect(active).toMatchObject({ signupEnabled: true, tutorSignupEnabled: true,
      signupOpensAt: null, tutorSignupOpensAt: null, signupClosesAt: null, tutorSignupClosesAt: null });
    await expect(publicCaller().application.submit({ name: "Synthetic Applicant", email: "applicant@example.test", agreed: true,
      policyRevision: "unpublished", subjects: [{ subjectId: "missing" }] })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.tutorApplication.count()).toBe(0);
  });

  it("keeps a queued refresh pending when a prepared value changes, without partial writes", async () => {
    await actor().program.prepareNextRecruitment(await preparation("tutor"));
    const request = await queued(actor("ADMIN").admin.refresh(await refreshInput()));
    await actor().program.prepareNextRecruitment(await preparation("tutor", laterOpening));
    await expect(actor().approval.decide({ id: request.id, approve: true, note: "Earlier opening review" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.term.findFirstOrThrow({ where: { active: true } })).id).toBe(sourceId);
    expect(await db.term.count()).toBe(1);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).state).toBe("PENDING");
  });

  it("refuses legacy queued refresh payloads without preparation evidence", async () => {
    const request = await queued(actor("ADMIN").admin.refresh(await refreshInput()));
    await db.approvalRequest.update({ where: { id: request.id }, data: {
      payload: superjson.serialize({ confirm: "REFRESH", expectedTermId: sourceId }),
    } });
    await expect(actor().approval.decide({ id: request.id, approve: true, note: "Legacy review" })).rejects.toBeDefined();
    expect((await db.term.findFirstOrThrow({ where: { active: true } })).id).toBe(sourceId);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).state).toBe("PENDING");
  });

  it("rolls back settings, activation and participation on failure, then safely retries", async () => {
    await actor().program.prepareNextRecruitment(await preparation("tutor"));
    const learner = await db.tutee.create({ data: { englishName: "Synthetic Learner", status: "ACTIVE" } });
    const input = await refreshInput();
    const spy = vi.spyOn(audit, "recordAudit").mockRejectedValueOnce(new Error("Synthetic audit failure"));
    await expect(actor().admin.refresh(input)).rejects.toThrow();
    spy.mockRestore();
    expect((await db.term.findFirstOrThrow({ where: { active: true } })).id).toBe(sourceId);
    expect(await db.term.count()).toBe(1);
    expect((await db.tutee.findUniqueOrThrow({ where: { id: learner.id } })).status).toBe("ACTIVE");
    expect((await actor().program.nextRecruitment()).preparations.tutor?.opensAt).toEqual(opening);
    await actor().admin.refresh(input);
    expect((await db.tutee.findUniqueOrThrow({ where: { id: learner.id } })).status).toBe("INACTIVE");
    expect((await db.term.findFirstOrThrow({ where: { active: true } })).tutorSignupOpensAt).toEqual(opening);
  });

  it("activates elapsed times and preserves the exact inclusive opening boundary", async () => {
    const elapsed = new Date("2020-01-01T00:00:00Z");
    await actor().program.prepareNextRecruitment(await preparation("tutor", elapsed));
    await actor().program.prepareNextRecruitment(await preparation("tutee", opening));
    await actor().admin.refresh(await refreshInput());
    expect(recruitmentStatus(await getRecruitment(db, "tutor"))).toBe("open");
    const window = await getRecruitment(db, "tutee");
    expect(recruitmentStatus(window, opening.getTime() - 1)).toBe("scheduled");
    expect(recruitmentStatus(window, opening.getTime())).toBe("open");
  });
});

describe("stale target and boundary protection", () => {
  it.each([
    ["Q4", true, true, "27-28", "Q1"],
    ["Q1", true, false, "26-27", "Q3"],
    ["Q3", false, true, "26-27", "Q4"],
    ["Q3", false, false, "27-28", "Q1"],
  ] as const)("advances %s with applied mode %s and next mode %s to %s %s", async (quarter, enabled, nextEnabled, year, destinationQuarter) => {
    await db.term.update({ where: { id: sourceId }, data: { quarter } });
    await db.programFeature.create({ data: { key: "QUARTER_SYSTEM", enabled } });
    if (enabled !== nextEnabled) await actor().program.setFeaturePending({ key: "QUARTER_SYSTEM", enabled: nextEnabled });
    await actor().program.prepareNextRecruitment(await preparation("tutor"));
    await actor().admin.refresh(await refreshInput());
    expect(await db.term.findFirstOrThrow({ where: { active: true } })).toMatchObject({ schoolYear: year, quarter: destinationQuarter, tutorSignupOpensAt: opening });
  });

  it("requires replacement after a mode change away and back, including already queued requests", async () => {
    const stale = await preparation("tutor");
    await actor().program.prepareNextRecruitment(stale);
    const request = await queued(actor("ADMIN").program.prepareNextRecruitment(await preparation("tutee")));
    const reviewed = await refreshInput();
    await actor().program.setFeaturePending({ key: "QUARTER_SYSTEM", enabled: false });
    await actor().program.setFeaturePending({ key: "QUARTER_SYSTEM", enabled: true });
    await expect(actor().admin.refresh(reviewed)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(actor().approval.decide({ id: request.id, approve: true, note: "Stale mode evidence" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(actor().admin.refresh(await refreshInput())).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await actor().program.nextRecruitment()).preparations.tutor?.matchesTarget).toBe(false);
    await actor().program.prepareNextRecruitment(await preparation("tutor", null));
    await actor().admin.refresh(await refreshInput());
    expect((await db.term.findFirstOrThrow({ where: { active: true } })).quarter).toBe("Q2");
  });

  it("preserves saved instants after a timezone change and rejects old editor evidence", async () => {
    const local = parseProgramDateTime("2030-11-01T08:00", "Asia/Shanghai");
    expect(local).toEqual(opening);
    await actor().program.prepareNextRecruitment(await preparation("tutor", local));
    const stale = await preparation("tutee");
    await actor().program.setTimeZone({ timeZone: "America/New_York", expectedTimeZone: "Asia/Shanghai" });
    await expect(actor().program.prepareNextRecruitment(stale)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(() => parseProgramDateTime("2026-03-08T02:30", "America/New_York")).toThrow("does not exist");
    expect(() => parseProgramDateTime("2026-11-01T01:30", "America/New_York")).toThrow("occurs twice");
    await actor().admin.refresh(await refreshInput());
    expect((await db.term.findFirstOrThrow({ where: { active: true } })).tutorSignupOpensAt).toEqual(opening);
  });

  it("serializes a preparation save against refresh so stale intent cannot partially activate", async () => {
    const input = await preparation("tutor");
    const refresh = await refreshInput();
    const results = await Promise.allSettled([
      actor().program.prepareNextRecruitment(input), actor().admin.refresh(refresh),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const active = await db.term.findFirstOrThrow({ where: { active: true } });
    if (active.id === sourceId) {
      expect((await actor().program.nextRecruitment()).preparations.tutor?.opensAt).toEqual(opening);
      await actor().admin.refresh(await refreshInput());
      expect((await db.term.findFirstOrThrow({ where: { active: true } })).tutorSignupOpensAt).toEqual(opening);
    } else {
      expect(await db.nextRecruitmentPreparation.count()).toBe(0);
      await expect(actor().program.prepareNextRecruitment(input)).rejects.toMatchObject({ code: "CONFLICT" });
    }
  });

  it("never admits a public submission through an unconfigured intermediate period during refresh", async () => {
    await db.term.update({ where: { id: sourceId }, data: { tutorSignupEnabled: false } });
    await actor().program.prepareNextRecruitment(await preparation("tutor"));
    const input = await refreshInput();
    let announceRefresh!: () => void;
    let commitRefresh!: () => void;
    const refreshed = new Promise<void>((resolve) => { announceRefresh = resolve; });
    const commit = new Promise<void>((resolve) => { commitRefresh = resolve; });
    const refreshing = db.$transaction((tx) => databaseScope.run(tx, async () => {
      const result = await actor().admin.refresh(input);
      announceRefresh();
      await commit;
      return result;
    }), { timeout: 10_000 }).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => { announceRefresh(); return { status: "rejected" as const, reason }; },
    );
    await refreshed;
    let pid = 0;
    const submitting = db.$transaction(async (tx) => {
      pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      return databaseScope.run(tx, () => publicCaller().application.submit({
        name: "Synthetic Race Applicant", email: "race@example.test", agreed: true,
        policyRevision: "unused", subjects: [{ subjectId: "unused" }],
      }));
    }, { timeout: 10_000 }).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    let observed = false;
    let observationError: unknown;
    try {
      // The new period is still invisible outside refresh's transaction.
      expect((await db.term.findFirstOrThrow({ where: { active: true } })).id).toBe(sourceId);
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const rows = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid = ${pid} AND wait_event_type = 'Lock' AND wait_event = 'advisory') AS waiting`;
        if (rows[0]?.waiting) { observed = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } catch (error) {
      observationError = error;
    } finally {
      commitRefresh();
    }
    // Settle every owned transaction before asserting, including an early refresh
    // failure or a failed wait observation, so later fixtures never inherit work.
    const [refreshResult, submissionResult] = await Promise.all([refreshing, submitting]);
    expect(observationError).toBeUndefined();
    expect(observed).toBe(true);
    expect(refreshResult).toMatchObject({ status: "fulfilled" });
    expect(submissionResult).toMatchObject({ status: "rejected", reason: { code: "PRECONDITION_FAILED", message: expect.stringContaining("recruitment is currently closed") } });
    expect(await db.tutorApplication.count()).toBe(0);
    expect((await db.term.findFirstOrThrow({ where: { active: true } })).tutorSignupOpensAt).toEqual(opening);
  });

  it.each(["prepare", "refresh", "mode", "timezone"] as const)("rechecks Head authority after %s waits behind the period barrier", async (operation) => {
    const write = await preparation("tutor");
    const refresh = await refreshInput();
    let releaseWriter!: () => void;
    let announceWriter!: () => void;
    const release = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const ready = new Promise<void>((resolve) => { announceWriter = resolve; });
    const writer = db.$transaction(async (tx) => {
      await lockEntity(tx, "program:period");
      announceWriter();
      await release;
      await tx.user.update({ where: { id: "next-HEAD" }, data: { role: "COORDINATOR" } });
    }, { timeout: 10_000 }).then(
      () => ({ status: "fulfilled" as const }),
      (reason: unknown) => { announceWriter(); return { status: "rejected" as const, reason }; },
    );
    await ready;
    let pid = 0;
    const saving = db.$transaction(async (tx) => {
      pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      return databaseScope.run(tx, () => {
        if (operation === "prepare") return actor().program.prepareNextRecruitment(write);
        if (operation === "refresh") return actor().admin.refresh(refresh);
        if (operation === "mode") return actor().program.setFeaturePending({ key: "QUARTER_SYSTEM", enabled: false });
        return actor().program.setTimeZone({ timeZone: "UTC", expectedTimeZone: "Asia/Shanghai" });
      });
    }, { timeout: 10_000 }).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    let observed = false;
    let observationError: unknown;
    try {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const rows = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid = ${pid} AND wait_event_type = 'Lock' AND wait_event = 'advisory') AS waiting`;
        if (rows[0]?.waiting) { observed = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } catch (error) {
      observationError = error;
    } finally {
      releaseWriter();
    }
    const [writerResult, savingResult] = await Promise.all([writer, saving]);
    expect(observationError).toBeUndefined();
    expect(observed).toBe(true);
    expect(writerResult).toMatchObject({ status: "fulfilled" });
    expect(savingResult).toMatchObject({ status: "rejected", reason: { code: "FORBIDDEN" } });
    expect(await db.nextRecruitmentPreparation.count()).toBe(0);
    expect(await db.term.count()).toBe(1);
    expect(await db.programFeature.count()).toBe(0);
    expect(await db.programSettings.count()).toBe(0);
  });
});
