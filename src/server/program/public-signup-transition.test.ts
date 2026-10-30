import { afterAll, beforeEach, expect, it } from "vitest";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { readPublicSignupTransition } from "./public-signup-transition";
import { readNextRecruitment, saveNextRecruitment } from "./next-recruitment";
import { scheduleProgramRefresh } from "./scheduled-refresh";
import { publicSignupView } from "~/lib/public-signup-transition";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const head = { id: "public-transition-head", name: "Synthetic Head" };
beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.user.create({
    data: {
      ...head,
      role: "HEAD",
      username: "public-transition-head",
      email: "public-transition@example.test",
    },
  });
  await db.term.create({
    data: {
      id: "source",
      schoolYear: "26-27",
      quarter: "Q1",
      name: "26-27 Q1",
      active: true,
      signupEnabled: false,
    },
  });
});
afterAll(() => db.$disconnect());

async function prepare(opensAt: Date | null) {
  const value = await readNextRecruitment(db);
  await saveNextRecruitment(
    db,
    {
      audience: "tutee",
      opensAt,
      expectedTarget: value.target,
      expectedTimeZone: value.timeZone,
      expectedVersion: value.preparations.tutee?.version ?? 0,
    },
    head,
  );
}

it.each(["Q1", "Q3"] as const)(
  "projects the prepared same-semester target for %s without creating destination enrollment",
  async (quarter) => {
    await db.term.update({ where: { id: "source" }, data: { quarter } });
    await prepare(new Date("2090-11-01T02:00:00Z"));
    const result = await readPublicSignupTransition(db);
    expect(result.current).toMatchObject({ termId: "source", kind: "quarter" });
    expect(result.next).toMatchObject({
      label: quarter === "Q1" ? "2026–27 Q2" : "2026–27 Q4",
      opensAt: "2090-11-01T02:00:00.000Z",
      preparationValid: true,
      refresh: null,
    });
    expect(await db.term.count()).toBe(1);
    expect(await db.studentSurvey.count()).toBe(0);
  },
);

it.each(["Q2", "Q4"] as const)(
  "does not announce an unrequested handoff from %s",
  async (quarter) => {
    await db.term.update({ where: { id: "source" }, data: { quarter } });
    expect((await readPublicSignupTransition(db)).next).toBeNull();
  },
);

it("does not present staged or applied semester transitions as a next-quarter opening", async () => {
  await db.programFeature.create({
    data: { key: "QUARTER_SYSTEM", enabled: true, pendingEnabled: false },
  });
  expect((await readPublicSignupTransition(db)).next).toBeNull();
  await db.programFeature.update({
    where: { key: "QUARTER_SYSTEM" },
    data: { enabled: false, pendingEnabled: null },
  });
  const result = await readPublicSignupTransition(db);
  expect(result.next).toBeNull();
  expect(result.current).toMatchObject({
    kind: "semester",
    label: "2026–27 S1",
  });
});

it("distinguishes absent preparation from an explicit clear and retains destination controls", async () => {
  await db.term.create({
    data: {
      schoolYear: "26-27",
      quarter: "Q2",
      name: "26-27 Q2",
      active: false,
      signupEnabled: false,
      signupOpensAt: new Date("2090-11-01T02:00:00Z"),
      signupClosesAt: new Date("2090-11-02T02:00:00Z"),
      signupPreviewUrl: "https://example.test/public-sheet",
    },
  });
  expect((await readPublicSignupTransition(db)).next).toMatchObject({
    opensAt: "2090-11-01T02:00:00.000Z",
    enabled: false,
    previewUrl: "https://example.test/public-sheet",
  });
  await prepare(null);
  expect((await readPublicSignupTransition(db)).next).toMatchObject({
    opensAt: null,
    enabled: false,
    closesAt: "2090-11-02T02:00:00.000Z",
  });
});

it("publishes only allowlisted schedule fields and withdraws its promise on review drift", async () => {
  await prepare(new Date("2090-11-01T02:00:00Z"));
  const snapshot = await readNextRecruitment(db);
  await scheduleProgramRefresh(
    db,
    {
      confirm: "REFRESH",
      expectedTermId: "source",
      expectedPreparation: snapshot.refreshEvidence,
      expectedScheduleVersion: 0,
      executeAt: new Date("2090-11-01T01:00:00Z"),
    },
    head,
  );
  const scheduled = await readPublicSignupTransition(db);
  expect(scheduled.next?.refresh).toEqual({
    executeAt: "2090-11-01T01:00:00.000Z",
    state: "SCHEDULED",
    valid: true,
  });
  const json = JSON.stringify(scheduled);
  for (const privateField of [
    "expectedPreparation",
    "authorizedById",
    "authorizedByName",
    "blockedReason",
    "stagedFeatures",
    head.name,
    head.id,
  ])
    expect(json).not.toContain(privateField);
  await prepare(new Date("2090-11-01T03:00:00Z"));
  const blocked = await readPublicSignupTransition(db);
  expect(blocked.next?.refresh).toMatchObject({
    state: "BLOCKED",
    valid: false,
  });
  expect(publicSignupView(blocked, Date.parse(blocked.serverNow)).state).toBe(
    "needsReview",
  );
});

it("marks a preparation stale after a mode revision changes away and back", async () => {
  await prepare(new Date("2090-11-01T02:00:00Z"));
  await db.programFeature.create({
    data: {
      key: "QUARTER_SYSTEM",
      enabled: true,
      pendingEnabled: null,
      revision: 2,
    },
  });
  const result = await readPublicSignupTransition(db);
  expect(result.next?.preparationValid).toBe(false);
  expect(publicSignupView(result, Date.parse(result.serverNow)).state).toBe(
    "needsReview",
  );
});
