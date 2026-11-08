import { afterAll, beforeEach, expect, it } from "vitest";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { readPublicSignupTransition } from "./public-signup-transition";
import { readNextRecruitment, saveNextRecruitment } from "./next-recruitment";
import { scheduleProgramRefresh } from "./scheduled-refresh";
import { publicSignupView } from "~/lib/public-signup-transition";
import type { RecruitmentAudience } from "~/lib/recruitment";

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

async function prepare(
  opensAt: Date | null,
  audience: RecruitmentAudience = "tutee",
) {
  const value = await readNextRecruitment(db);
  await saveNextRecruitment(
    db,
    {
      audience,
      opensAt,
      expectedTarget: value.target,
      expectedTimeZone: value.timeZone,
      expectedVersion: value.preparations[audience]?.version ?? 0,
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

it("projects each audience's own current window and next opening independently", async () => {
  await db.term.update({
    where: { id: "source" },
    data: {
      tutorSignupEnabled: false,
      tutorSignupOpensAt: new Date("2026-09-02T02:00:00Z"),
      signupOpensAt: new Date("2026-09-03T02:00:00Z"),
    },
  });
  await prepare(new Date("2090-11-01T02:00:00Z"), "tutor");
  await prepare(new Date("2090-11-02T03:00:00Z"), "tutee");

  const tutor = await readPublicSignupTransition(db, "tutor");
  const tutee = await readPublicSignupTransition(db);
  expect(tutor.current).toMatchObject({
    termId: "source",
    window: { enabled: false, opensAt: new Date("2026-09-02T02:00:00Z") },
  });
  expect(tutee.current).toMatchObject({
    termId: "source",
    window: { enabled: false, opensAt: new Date("2026-09-03T02:00:00Z") },
  });
  expect(tutor.next).toMatchObject({
    label: "2026–27 Q2",
    opensAt: "2090-11-01T02:00:00.000Z",
    preparationValid: true,
  });
  expect(tutee.next).toMatchObject({
    label: "2026–27 Q2",
    opensAt: "2090-11-02T03:00:00.000Z",
    preparationValid: true,
  });
  expect(await db.term.count()).toBe(1);
  expect(await db.studentSurvey.count()).toBe(0);
  expect(await db.tutorApplication.count()).toBe(0);
});

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

it.each(["tutor", "tutee"] as const)(
  "distinguishes absent %s preparation from an explicit clear and retains its destination controls",
  async (audience) => {
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
        tutorSignupEnabled: false,
        tutorSignupOpensAt: new Date("2090-11-03T03:00:00Z"),
        tutorSignupClosesAt: new Date("2090-11-04T03:00:00Z"),
        tutorSignupPreviewUrl: "https://example.test/tutor-sheet",
      },
    });
    const tutor = audience === "tutor";
    const opening = tutor
      ? "2090-11-03T03:00:00.000Z"
      : "2090-11-01T02:00:00.000Z";
    const closing = tutor
      ? "2090-11-04T03:00:00.000Z"
      : "2090-11-02T02:00:00.000Z";
    const previewUrl = tutor
      ? "https://example.test/tutor-sheet"
      : "https://example.test/public-sheet";
    expect((await readPublicSignupTransition(db, audience)).next).toMatchObject(
      {
        opensAt: opening,
        enabled: false,
        closesAt: closing,
        previewUrl,
      },
    );
    await prepare(null, audience);
    expect((await readPublicSignupTransition(db, audience)).next).toMatchObject(
      {
        opensAt: null,
        enabled: false,
        closesAt: closing,
        previewUrl,
      },
    );
    expect(
      (await readPublicSignupTransition(db, tutor ? "tutee" : "tutor")).next
        ?.opensAt,
    ).toBe(tutor ? "2090-11-01T02:00:00.000Z" : "2090-11-03T03:00:00.000Z");
  },
);

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
  expect(
    publicSignupView(blocked, Date.parse(blocked.serverNow)),
  ).toMatchObject({
    state: "needsReview",
    opensAt: "2090-11-01T03:00:00.000Z",
  });
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
  expect(publicSignupView(result, Date.parse(result.serverNow))).toMatchObject({
    state: "needsReview",
    opensAt: null,
  });
});

it.each(["tutor", "tutee"] as const)(
  "does not present a %s opening prepared for semester Q3 as quarter Q2 configuration",
  async (audience) => {
    await db.term.update({
      where: { id: "source" },
      data: { tutorSignupEnabled: false },
    });
    await db.programFeature.create({
      data: {
        key: "QUARTER_SYSTEM",
        enabled: true,
        pendingEnabled: false,
        revision: 1,
      },
    });
    await prepare(new Date("2090-11-01T02:00:00Z"), audience);
    const prepared = (await readNextRecruitment(db)).preparations[audience];
    expect(prepared?.target).toMatchObject({
      destinationQuarter: "Q3",
      semesterMode: true,
    });

    await db.programFeature.update({
      where: { key: "QUARTER_SYSTEM" },
      data: { pendingEnabled: null, revision: { increment: 1 } },
    });
    const result = await readPublicSignupTransition(db, audience);
    expect(result.next).toMatchObject({
      label: "2026–27 Q2",
      preparationValid: false,
    });
    expect(
      publicSignupView(result, Date.parse(result.serverNow)),
    ).toMatchObject({
      label: "2026–27 Q2",
      state: "needsReview",
      opensAt: null,
    });
  },
);
