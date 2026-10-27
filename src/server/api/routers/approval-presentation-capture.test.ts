import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import superjson from "superjson";
import type { Prisma } from "../../../../generated/prisma";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "../root";
import { approvalPresentation } from "~/lib/approval-presentation";
import { db } from "~/server/db";
import {
  ApprovalQueued,
  fingerprint,
  proposalTargets,
} from "~/server/approvals";
import { DEFAULT_FEATURES } from "~/server/program/features";
import { captureReviewReferences } from "~/server/approval-reference-capture";

type Request = Awaited<ReturnType<typeof db.approvalRequest.findUniqueOrThrow>>;
const actor = (id: string, role: Session["role"]) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, name: "Session display name", email: `${id}@example.test` },
      role,
      tutorId: null,
      expires: "2099-01-01T00:00:00Z",
    },
  });
const admin = () => actor("capture-admin", "ADMIN");
const head = () => actor("capture-head", "HEAD");
const coordinator = () => actor("capture-coordinator", "COORDINATOR");
const targetId = "capture-target";

it("does not treat prototype-named audit entities as display tables", async () => {
  const result = await db.$transaction((tx) =>
    captureReviewReferences(
      tx,
      "admin.undoAudit",
      { id: "unknown-event" },
      {
        AuditLog: [
          {
            record: {
              id: "unknown-event",
              entity: "constructor",
              entityId: "unrelated",
            },
          },
        ],
      },
    ),
  );
  expect(result).toMatchObject({ version: 1, entities: {} });
});

async function queued(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    const cause = (error as { cause: unknown }).cause;
    expect(cause).toBeInstanceOf(ApprovalQueued);
    return db.approvalRequest.findUniqueOrThrow({
      where: { id: (cause as ApprovalQueued).approvalId },
    });
  }
  throw new Error("Expected an approval proposal without a live write");
}

const presentation = (request: Request) =>
  approvalPresentation(
    request.operation,
    superjson.deserialize(
      request.payload as unknown as Parameters<typeof superjson.deserialize>[0],
    ),
    request.targets,
  );
const userEvidence = (request: Request) =>
  (
    request.targets as unknown as {
      User: { record: Record<string, unknown> }[];
    }
  ).User[0]!.record;
const approve = (request: Request) =>
  head().approval.decide({
    id: request.id,
    approve: true,
    note: "Captured originals and proposed effects reviewed",
  });

/** Recreate both historical digest generations, without recapturing new display
 * fields. Pending requests must choose their stored evidence version at replay. */
async function historical(request: Request, withAuthority = true) {
  const targets = await proposalTargets(
    db,
    request.operation,
    request.payload,
    false,
    withAuthority,
    request.requesterId,
  );
  if (withAuthority) {
    const saved = request.targets as Prisma.JsonObject;
    targets.reviewAuthority = saved.reviewAuthority!;
  }
  return db.approvalRequest.update({
    where: { id: request.id },
    data: { targets, fingerprint: fingerprint(targets) },
  });
}

beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/shbs_shipping_test"
  )
    throw new Error(
      "Capture tests require the dedicated local shipping database",
    );
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((table) => '"' + table.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.user.createMany({
    data: [
      {
        id: "capture-admin",
        role: "ADMIN",
        email: "capture-admin@example.test",
        name: "Requesting Admin",
      },
      {
        id: "capture-head",
        role: "HEAD",
        email: "capture-head@example.test",
        name: "Reviewing Head",
      },
      {
        id: "capture-coordinator",
        role: "COORDINATOR",
        email: "capture-coordinator@example.test",
        name: "Translator Coordinator",
        canTranslate: true,
      },
      {
        id: targetId,
        role: "VIEWER",
        email: "capture-target@example.test",
        name: "Mina Lin",
        firstName: "Mina",
        lastName: "Lin",
        preferredName: "June",
        alternativeNames: "林敏 · ミナ",
        username: "minalin",
        passwordHash: "CAPTURE_PRIVATE_PASSWORD_HASH",
      },
    ],
  });
  await db.term.create({
    data: {
      id: "capture-term",
      name: "Captured 26–27 Q1",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
});
afterAll(() => db.$disconnect());

it("captures exact safe structured originals and leaves the live profile untouched until Head applies", async () => {
  const request = await queued(() =>
    admin().admin.updateAccountProfile({
      userId: targetId,
      // The default display policy materializes the preferred name in User.name.
      name: "June Lin",
      firstName: "Mira",
      lastName: "Lin",
      preferredName: "June",
      alternativeNames: "林敏 · ミナ",
      expectedProfileVersion: 0,
    }),
  );
  expect(request.targets).toMatchObject({ reviewPresentation: { version: 1 } });
  expect(userEvidence(request)).toMatchObject({
    firstName: "Mina",
    lastName: "Lin",
    preferredName: "June",
    alternativeNames: "林敏 · ミナ",
    profileVersion: 0,
  });
  expect(JSON.stringify(request)).not.toContain(
    "CAPTURE_PRIVATE_PASSWORD_HASH",
  );
  expect(userEvidence(request)).not.toHaveProperty("email");
  const model = presentation(request);
  expect(model.changes).toEqual([
    { key: "firstName", before: "Mina", requested: "Mira", hasBefore: true },
  ]);
  expect(model.unchanged).toEqual(
    expect.arrayContaining([
      { key: "lastName", before: "Lin", requested: "Lin", hasBefore: true },
      {
        key: "alternativeNames",
        before: "林敏 · ミナ",
        requested: "林敏 · ミナ",
        hasBefore: true,
      },
    ]),
  );
  expect(
    await db.user.findUniqueOrThrow({ where: { id: targetId } }),
  ).toMatchObject({ firstName: "Mina", profileVersion: 0 });
  await expect(
    admin().approval.decide({
      id: request.id,
      approve: true,
      note: "Cannot review own proposal",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await approve(request);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: targetId } }),
  ).toMatchObject({
    name: "June Lin",
    firstName: "Mira",
    lastName: "Lin",
    profileVersion: 1,
  });
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }))
      .targets,
  ).toEqual(request.targets);
});

it("distinguishes an explicit preferred-name clear from an omitted unchanged name field", async () => {
  const request = await queued(() =>
    admin().admin.updateAccountProfile({
      userId: targetId,
      name: "Mina Lin",
      preferredName: null,
      alternativeNames: null,
      expectedProfileVersion: 0,
    }),
  );
  const model = presentation(request);
  expect(model.changes).toEqual(
    expect.arrayContaining([
      {
        key: "preferredName",
        before: "June",
        requested: null,
        hasBefore: true,
      },
      {
        key: "alternativeNames",
        before: "林敏 · ミナ",
        requested: null,
        hasBefore: true,
      },
    ]),
  );
  expect(
    [...model.changes, ...model.unchanged].map((field) => field.key),
  ).not.toContain("firstName");
  expect(userEvidence(request)).toMatchObject({
    firstName: "Mina",
    preferredName: "June",
  });
  await approve(request);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: targetId } }),
  ).toMatchObject({
    firstName: "Mina",
    lastName: "Lin",
    preferredName: null,
    alternativeNames: null,
  });
});

it("retains explicit null originals and an unsplit legacy identity without inventing name parts", async () => {
  await db.user.update({
    where: { id: targetId },
    data: {
      name: "王小明",
      legacyName: "王小明",
      firstName: null,
      lastName: null,
      preferredName: null,
      alternativeNames: null,
    },
  });
  const request = await queued(() =>
    admin().admin.updateAccountProfile({
      userId: targetId,
      name: "王小明",
      preferredName: null,
      alternativeNames: "小明 · Xiaoming",
      expectedProfileVersion: 0,
    }),
  );
  expect(userEvidence(request)).toMatchObject({
    name: "王小明",
    firstName: null,
    lastName: null,
    preferredName: null,
    alternativeNames: null,
  });
  expect(presentation(request).changes).toEqual([
    {
      key: "alternativeNames",
      before: null,
      requested: "小明 · Xiaoming",
      hasBefore: true,
    },
  ]);
  expect(presentation(request).unchanged).toContainEqual({
    key: "preferredName",
    before: null,
    requested: null,
    hasBefore: true,
  });
  await approve(request);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: targetId } }),
  ).toMatchObject({
    name: "王小明",
    legacyName: "王小明",
    firstName: null,
    lastName: null,
    preferredName: null,
    alternativeNames: "小明 · Xiaoming",
  });
});

it.each(["firstName", "lastName", "preferredName"] as const)(
  "rejects a changed captured %s even if an external writer did not advance profileVersion",
  async (field) => {
    const request = await queued(() =>
      admin().admin.updateAccountProfile({
        userId: targetId,
        name: "Mina Lin",
        firstName: "Mira",
        alternativeNames: null,
        expectedProfileVersion: 0,
      }),
    );
    await db.user.update({
      where: { id: targetId },
      data: { [field]: "Different" },
    });
    await expect(approve(request)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).toMatchObject({
      state: "PENDING",
      targets: request.targets,
      fingerprint: request.fingerprint,
    });
    expect(
      await db.user.findUniqueOrThrow({ where: { id: targetId } }),
    ).toMatchObject({ [field]: "Different", profileVersion: 0 });
  },
);

it.each([false, true])(
  "replays a historical profile capture with authority=%s without backfilling originals",
  async (withAuthority) => {
    const fresh = await queued(() =>
      admin().admin.updateAccountProfile({
        userId: targetId,
        name: "Mina Lin",
        firstName: "Mira",
        lastName: "Lin",
        preferredName: null,
        alternativeNames: "林敏",
        expectedProfileVersion: 0,
      }),
    );
    const request = await historical(fresh, withAuthority);
    expect(request.targets).not.toHaveProperty("reviewPresentation");
    expect(Object.keys(userEvidence(request)).sort()).toEqual([
      "alternativeNames",
      "id",
      "name",
      "profileVersion",
      "role",
      "studentId",
      "tutorId",
    ]);
    expect(presentation(request).changes).toEqual(
      expect.arrayContaining([
        {
          key: "firstName",
          before: undefined,
          requested: "Mira",
          hasBefore: false,
        },
        {
          key: "preferredName",
          before: undefined,
          requested: null,
          hasBefore: false,
        },
      ]),
    );
    await approve(request);
    const decided = await db.approvalRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(decided).toMatchObject({
      state: "APPROVED",
      targets: request.targets,
      fingerprint: request.fingerprint,
    });
    expect(
      presentation(decided).changes.find((field) => field.key === "firstName")
        ?.hasBefore,
    ).toBe(false);
  },
);

it.each([null, "minalin"])(
  "captures username original %s together with zero profile version",
  async (username) => {
    await db.user.update({ where: { id: targetId }, data: { username } });
    const request = await queued(() =>
      admin().admin.updateAccountUsername({
        userId: targetId,
        username: "miralin",
        expectedProfileVersion: 0,
      }),
    );
    expect(userEvidence(request)).toMatchObject({
      username,
      profileVersion: 0,
      canTranslate: false,
      tutorId: null,
    });
    expect(presentation(request).changes).toEqual([
      {
        key: "username",
        before: username,
        requested: "miralin",
        hasBefore: true,
      },
    ]);
    expect(
      await db.user.findUniqueOrThrow({ where: { id: targetId } }),
    ).toMatchObject({ username, profileVersion: 0 });
    await approve(request);
    expect(
      await db.user.findUniqueOrThrow({ where: { id: targetId } }),
    ).toMatchObject({ username: "miralin", profileVersion: 1 });
    expect(JSON.stringify(request)).not.toContain(
      "CAPTURE_PRIVATE_PASSWORD_HASH",
    );
  },
);

it("fences changed username originals independently from the resolver's profile version check", async () => {
  const request = await queued(() =>
    admin().admin.updateAccountUsername({
      userId: targetId,
      username: "miralin",
      expectedProfileVersion: 0,
    }),
  );
  await db.user.update({
    where: { id: targetId },
    data: { username: "changedexternally" },
  });
  await expect(approve(request)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: targetId } }),
  ).toMatchObject({ username: "changedexternally", profileVersion: 0 });
  expect(
    await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }),
  ).toMatchObject({ state: "PENDING", targets: request.targets });
});

it.each([false, true])(
  "replays historical username evidence with authority=%s and leaves its missing original visible",
  async (withAuthority) => {
    const fresh = await queued(() =>
      admin().admin.updateAccountUsername({
        userId: targetId,
        username: "miralin",
        expectedProfileVersion: 0,
      }),
    );
    const request = await historical(fresh, withAuthority);
    expect(userEvidence(request)).not.toHaveProperty("username");
    expect(userEvidence(request)).not.toHaveProperty("profileVersion");
    expect(presentation(request).changes).toEqual([
      {
        key: "username",
        before: undefined,
        requested: "miralin",
        hasBefore: false,
      },
    ]);
    await approve(request);
    expect(
      await db.user.findUniqueOrThrow({ where: { id: targetId } }),
    ).toMatchObject({ username: "miralin", profileVersion: 1 });
    const decided = await db.approvalRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(decided.targets).toEqual(request.targets);
    expect(presentation(decided).changes[0]?.hasBefore).toBe(false);
  },
);

it.each([
  {
    effective: true,
    pending: null,
    requested: false,
    intent: "stage",
    result: false,
  },
  {
    effective: true,
    pending: false,
    requested: true,
    intent: "clear",
    result: null,
  },
  {
    effective: false,
    pending: true,
    requested: false,
    intent: "clear",
    result: null,
  },
  {
    effective: true,
    pending: false,
    requested: false,
    intent: "unchanged",
    result: false,
  },
  {
    effective: false,
    pending: null,
    requested: false,
    intent: "unchanged",
    result: null,
  },
])(
  "captures stored feature state and applies only its staged $intent effect ($effective/$pending/$requested)",
  async ({ effective, pending, requested, intent, result }) => {
    await db.programFeature.create({
      data: { key: "CREW", enabled: effective, pendingEnabled: pending },
    });
    const request = await queued(() =>
      admin().program.setFeaturePending({ key: "CREW", enabled: requested }),
    );
    expect(request.targets).toMatchObject({
      reviewPresentation: {
        version: 1,
        feature: { key: "CREW", effective, pending, source: "stored" },
      },
    });
    expect(presentation(request).feature).toMatchObject({
      effective,
      pending,
      intent,
      source: "stored",
      known: true,
    });
    expect(presentation(request).changes[0]).toMatchObject({
      before: pending,
      requested: result,
      hasBefore: true,
    });
    expect(
      await db.programFeature.findUniqueOrThrow({ where: { key: "CREW" } }),
    ).toMatchObject({ enabled: effective, pendingEnabled: pending });
    await approve(request);
    expect(
      await db.programFeature.findUniqueOrThrow({ where: { key: "CREW" } }),
    ).toMatchObject({ enabled: effective, pendingEnabled: result });
  },
);

it("captures a missing feature's effective default at submission and rejects a later default change", async () => {
  const originalDefault = DEFAULT_FEATURES.CREW;
  expect(originalDefault).toBe(true);
  const request = await queued(() =>
    admin().program.setFeaturePending({ key: "CREW", enabled: false }),
  );
  expect(request.targets).toMatchObject({
    programFeature: [],
    reviewPresentation: {
      version: 1,
      feature: {
        key: "CREW",
        effective: true,
        pending: null,
        source: "default",
      },
    },
  });
  expect(await db.programFeature.count()).toBe(0);
  try {
    // Model a deployment default change; restore the module constant before the
    // next serial test so this check never changes other fixtures' behavior.
    DEFAULT_FEATURES.CREW = false;
    await expect(approve(request)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.programFeature.count()).toBe(0);
    const pending = await db.approvalRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(pending).toMatchObject({
      state: "PENDING",
      targets: request.targets,
      fingerprint: request.fingerprint,
    });
    expect(presentation(pending).feature).toMatchObject({
      effective: true,
      pending: null,
      source: "default",
      intent: "stage",
    });
  } finally {
    DEFAULT_FEATURES.CREW = originalDefault;
  }
  await approve(request);
  expect(
    await db.programFeature.findUniqueOrThrow({ where: { key: "CREW" } }),
  ).toMatchObject({ enabled: true, pendingEnabled: false });
});

it("replays an old absent-row feature proposal without replacing its uncaptured default evidence", async () => {
  const fresh = await queued(() =>
    admin().program.setFeaturePending({ key: "CREW", enabled: false }),
  );
  const request = await historical(fresh);
  expect(request.targets).toMatchObject({ programFeature: [] });
  expect(request.targets).not.toHaveProperty("reviewPresentation");
  expect(presentation(request).feature).toMatchObject({
    source: "uncapturedDefault",
    known: false,
    intent: "unknown",
  });
  await approve(request);
  expect(
    await db.programFeature.findUniqueOrThrow({ where: { key: "CREW" } }),
  ).toMatchObject({ enabled: true, pendingEnabled: false });
  const decided = await db.approvalRequest.findUniqueOrThrow({
    where: { id: request.id },
  });
  expect(decided.targets).toEqual(request.targets);
  expect(presentation(decided).feature).toMatchObject({
    source: "uncapturedDefault",
    known: false,
  });
});

it.each(["tutor", "tutee"] as const)(
  "captures the effective default timezone and only the requested %s recruitment fields",
  async (audience) => {
    const closesAt = new Date("2027-01-01T00:00:00Z");
    await db.term.update({
      where: { id: "capture-term" },
      data: {
        signupEnabled: false,
        signupClosesAt: closesAt,
        tutorSignupEnabled: false,
        tutorSignupClosesAt: closesAt,
      },
    });
    const request = await queued(() =>
      admin().program.setSignupWindow({
        audience,
        expectedTermId: "capture-term",
        opensAt: null,
        previewUrl: null,
      }),
    );
    expect(request.targets).toMatchObject({
      reviewPresentation: { version: 1, timeZone: "Asia/Shanghai" },
      authorityContext: { programSettings: null },
    });
    const model = presentation(request);
    expect(model.timeZone).toBe("Asia/Shanghai");
    expect(model.changes).toEqual([]);
    expect(model.unchanged).toEqual([
      { key: "opensAt", requested: null, before: null, hasBefore: true },
      { key: "previewUrl", requested: null, before: null, hasBefore: true },
    ]);
    const reviewedFields = [...model.changes, ...model.unchanged].map(
      (field) => field.key,
    );
    expect(reviewedFields).not.toContain("enabled");
    expect(reviewedFields).not.toContain("closesAt");
    await approve(request);
    expect(
      await db.term.findUniqueOrThrow({ where: { id: "capture-term" } }),
    ).toMatchObject({
      signupEnabled: false,
      signupClosesAt: closesAt,
      tutorSignupEnabled: false,
      tutorSignupClosesAt: closesAt,
    });
  },
);

it("retains the saved timezone through later live configuration drift and rejects applying a stale window", async () => {
  await db.programSettings.create({
    data: { id: "program", timeZone: "America/New_York" },
  });
  const request = await queued(() =>
    admin().program.setSignupWindow({
      audience: "tutor",
      enabled: false,
      opensAt: new Date("2027-01-01T05:00:00Z"),
      closesAt: null,
      previewUrl: "https://example.test/tutor-intake",
      expectedTermId: "capture-term",
    }),
  );
  expect(presentation(request).timeZone).toBe("America/New_York");
  await db.programSettings.update({
    where: { id: "program" },
    data: { timeZone: "UTC" },
  });
  await expect(approve(request)).rejects.toMatchObject({ code: "CONFLICT" });
  const pending = await db.approvalRequest.findUniqueOrThrow({
    where: { id: request.id },
  });
  expect(pending).toMatchObject({ state: "PENDING", targets: request.targets });
  expect(presentation(pending).timeZone).toBe("America/New_York");
  expect(
    await db.term.findUniqueOrThrow({ where: { id: "capture-term" } }),
  ).toMatchObject({ tutorSignupEnabled: true, tutorSignupOpensAt: null });
});

it("replays a historical default-zone window without backfilling its missing timezone", async () => {
  const fresh = await queued(() =>
    admin().program.setSignupWindow({
      audience: "tutee",
      enabled: false,
      opensAt: null,
      previewUrl: null,
      expectedTermId: "capture-term",
    }),
  );
  const request = await historical(fresh);
  expect(presentation(request).timeZone).toBeUndefined();
  await approve(request);
  const decided = await db.approvalRequest.findUniqueOrThrow({
    where: { id: request.id },
  });
  expect(decided.targets).toEqual(request.targets);
  expect(presentation(decided).timeZone).toBeUndefined();
  expect(
    await db.term.findUniqueOrThrow({ where: { id: "capture-term" } }),
  ).toMatchObject({ signupEnabled: false, tutorSignupEnabled: true });
});

it("preserves nested translation destination captures and exact multiline publication text", async () => {
  const value = "第一行\n  Second line\n";
  await db.messageOverride.create({
    data: { locale: "zh", key: "approvals.title", value: "" },
  });
  await coordinator().localization.setString({
    locale: "zh",
    key: "approvals.title",
    value,
  });
  const draft = await db.translationDraft.findFirstOrThrow();
  const request = await queued(() =>
    coordinator().translationReview.decide({
      id: draft.id,
      approve: true,
      expectedUpdatedAt: draft.updatedAt,
    }),
  );
  expect(request.targets).not.toHaveProperty("reviewPresentation");
  expect(request.targets).toMatchObject({
    destination: {
      translation: [{ locale: "zh", key: "approvals.title", value: "" }],
    },
  });
  expect(presentation(request).changes).toEqual([
    { key: "value", before: "", requested: value, hasBefore: true },
  ]);
  await approve(request);
  expect(
    await db.messageOverride.findUniqueOrThrow({
      where: { locale_key: { locale: "zh", key: "approvals.title" } },
    }),
  ).toMatchObject({ value });
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }))
      .targets,
  ).toEqual(request.targets);
});

/** A combined block has one primary credit owner and per-subject historical
 * rosters. Cai belongs to both subjects, so its identical originals must be
 * coalesced rather than displayed as an added or ambiguous participant. */
async function mergedAttendance() {
  const tutor = await db.tutor.create({
    data: { englishName: "Captured combined tutor", status: "ACTIVE" },
  });
  const learners = [];
  for (const englishName of ["Captured Ana", "Captured Bo", "Captured Cai"])
    learners.push(await db.tutee.create({ data: { englishName } }));
  const primaryPairing = await db.pairing.create({
    data: {
      tutorId: tutor.id,
      termId: "capture-term",
      subject: "Captured mathematics",
      scheduleConfirmed: true,
      dayOfWeek: 7,
      startMin: 600,
      endMin: 660,
      tutees: {
        create: [learners[0]!, learners[2]!].map((row) => ({
          tuteeId: row.id,
        })),
      },
    },
  });
  const siblingPairing = await db.pairing.create({
    data: {
      tutorId: tutor.id,
      termId: "capture-term",
      subject: "Captured physics",
      scheduleConfirmed: true,
      dayOfWeek: 7,
      startMin: 600,
      endMin: 660,
      tutees: {
        create: [learners[1]!, learners[2]!].map((row) => ({
          tuteeId: row.id,
        })),
      },
    },
  });
  const common = {
    tutorId: tutor.id,
    date: new Date("2026-10-25T00:00:00Z"),
    month: "2026-10",
    schoolYear: "26-27",
    quarter: "Q1" as const,
    startMin: 600,
    endMin: 660,
    durationMin: 60,
    online: true,
    tutorStatus: "PRESENT" as const,
    comments: "Exact combined-session comment",
    ratingPreparedness: 4,
    ratingParticipation: 4,
    ratingUnderstanding: 4,
    ratingBehavior: 4,
    ratingProgress: 4,
  };
  const primary = await db.session.create({
    data: {
      ...common,
      pairingId: primaryPairing.id,
      shFactor: 4,
      shCount: 4,
      tutees: {
        create: [learners[0]!, learners[2]!].map((row) => ({
          tuteeId: row.id,
        })),
      },
    },
  });
  const sibling = await db.session.create({
    data: {
      ...common,
      pairingId: siblingPairing.id,
      mergeGroupId: primary.id,
      shFactor: 0,
      shCount: 0,
      tutees: {
        create: [learners[1]!, learners[2]!].map((row) => ({
          tuteeId: row.id,
        })),
      },
    },
  });
  const input = {
    id: primary.id,
    expectedUpdatedAt: primary.updatedAt,
    reason:
      "The combined block's Bo attendance was an excused school activity.",
    date: primary.date,
    startMin: primary.startMin,
    endMin: primary.endMin,
    tutorStatus: primary.tutorStatus,
    tutorAbsentReason: primary.tutorAbsentReason,
    comments: primary.comments,
    online: primary.online,
    actualRoomId: primary.actualRoomId,
    ratingPreparedness: primary.ratingPreparedness,
    ratingParticipation: primary.ratingParticipation,
    ratingUnderstanding: primary.ratingUnderstanding,
    ratingBehavior: primary.ratingBehavior,
    ratingProgress: primary.ratingProgress,
    tutees: learners.map((row, index) => ({
      tuteeId: row.id,
      status: index === 1 ? ("EXCUSED_ABSENT" as const) : ("PRESENT" as const),
      absenceReason: index === 1 ? "School activity — exact reason" : null,
    })),
  };
  return { primary, sibling, learners, input };
}

it.each(["primary", "sibling"] as const)(
  "captures the full merged attendance block from its %s member and applies one participant change",
  async (selected) => {
    const fixture = await mergedAttendance();
    const input = { ...fixture.input, id: fixture[selected].id };
    const request = await queued(() =>
      admin().corrections.correctAttendance(input),
    );
    expect(request.targets).toMatchObject({
      reviewPresentation: { version: 1 },
    });
    const captured = request.targets as unknown as {
      Session: { record: { id: string } }[];
      "Session.SessionTutee": {
        record: { sessionId: string; tuteeId: string };
      }[];
    };
    expect(captured.Session.map((row) => row.record.id).sort()).toEqual(
      [fixture.primary.id, fixture.sibling.id].sort(),
    );
    expect(captured["Session.SessionTutee"]).toHaveLength(4);
    const field = presentation(request).changes.find(
      (row) => row.key === "tutees",
    );
    expect(field?.collection?.counts).toEqual({
      added: 0,
      removed: 0,
      changed: 1,
      unchanged: 2,
    });
    expect(field?.before).toHaveLength(3);
    expect(
      await db.sessionTutee.findMany({
        where: { tuteeId: fixture.learners[1]!.id },
      }),
    ).toEqual([
      expect.objectContaining({ status: "PRESENT", absenceReason: null }),
    ]);
    await approve(request);
    const rows = await db.session.findMany({
      where: { id: { in: [fixture.primary.id, fixture.sibling.id] } },
      include: { tutees: true },
    });
    expect(rows.find((row) => row.id === fixture.primary.id)).toMatchObject({
      shFactor: 3,
      shCount: 3,
    });
    expect(rows.find((row) => row.id === fixture.sibling.id)).toMatchObject({
      shFactor: 0,
      shCount: 0,
    });
    expect(
      rows
        .flatMap((row) => row.tutees)
        .filter((row) => row.tuteeId === fixture.learners[1]!.id),
    ).toEqual([
      expect.objectContaining({
        status: "EXCUSED_ABSENT",
        absenceReason: "School activity — exact reason",
      }),
    ]);
    expect(
      rows
        .flatMap((row) => row.tutees)
        .filter((row) => row.tuteeId === fixture.learners[2]!.id),
    ).toEqual([
      expect.objectContaining({ status: "PRESENT" }),
      expect.objectContaining({ status: "PRESENT" }),
    ]);
    expect(
      (
        await db.approvalRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).targets,
    ).toEqual(request.targets);
  },
);

it.each(["session", "participant"] as const)(
  "rejects a merged attendance proposal after captured sibling %s evidence changes",
  async (changed) => {
    const fixture = await mergedAttendance();
    const request = await queued(() =>
      admin().corrections.correctAttendance(fixture.input),
    );
    if (changed === "session") {
      await db.session.update({
        where: { id: fixture.sibling.id },
        data: { comments: "Changed sibling history" },
      });
    } else {
      await db.sessionTutee.update({
        where: {
          sessionId_tuteeId: {
            sessionId: fixture.sibling.id,
            tuteeId: fixture.learners[1]!.id,
          },
        },
        data: {
          status: "EXCUSED_ABSENT",
          absenceReason: "Different recorded reason",
        },
      });
    }
    const primaryBefore = await db.session.findUniqueOrThrow({
      where: { id: fixture.primary.id },
      include: { tutees: true },
    });
    await expect(approve(request)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await db.session.findUniqueOrThrow({
        where: { id: fixture.primary.id },
        include: { tutees: true },
      }),
    ).toEqual(primaryBefore);
    expect(
      await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).toMatchObject({
      state: "PENDING",
      targets: request.targets,
      fingerprint: request.fingerprint,
    });
  },
);

it.each([false, true])(
  "replays historical partial merged attendance evidence with authority=%s without presenting missing siblings as additions",
  async (withAuthority) => {
    const fixture = await mergedAttendance();
    const fresh = await queued(() =>
      admin().corrections.correctAttendance(fixture.input),
    );
    const request = await historical(fresh, withAuthority);
    expect(request.targets).not.toHaveProperty("reviewPresentation");
    const captured = request.targets as unknown as {
      Session: { record: { id: string } }[];
    };
    expect(captured.Session.map((row) => row.record.id)).toEqual([
      fixture.primary.id,
    ]);
    const field = presentation(request).changes.find(
      (row) => row.key === "tutees",
    );
    expect(field).toMatchObject({ hasBefore: true, collection: null });
    expect(field?.before).toHaveLength(2);
    expect(field?.requested).toHaveLength(3);
    await approve(request);
    expect(
      await db.sessionTutee.findUniqueOrThrow({
        where: {
          sessionId_tuteeId: {
            sessionId: fixture.sibling.id,
            tuteeId: fixture.learners[1]!.id,
          },
        },
      }),
    ).toMatchObject({
      status: "EXCUSED_ABSENT",
      absenceReason: "School activity — exact reason",
    });
    const decided = await db.approvalRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(decided.targets).toEqual(request.targets);
    expect(
      presentation(decided).changes.find((row) => row.key === "tutees")
        ?.collection,
    ).toBeNull();
  },
);

it("applies a valid pairing proposal with one learner added, one removed and two retained", async () => {
  const tutor = await db.tutor.create({
    data: { englishName: "Qualified captured roster tutor", status: "ACTIVE" },
  });
  const subject = await db.subject.create({
    data: { name: "Captured roster mathematics" },
  });
  await db.tutorQualification.create({
    data: {
      tutorId: tutor.id,
      subjectId: subject.id,
      approvedById: "capture-admin",
      grants: { create: { subjectId: subject.id } },
    },
  });
  const slot = await db.timeSlot.create({
    data: {
      label: "Captured roster Sunday",
      dayOfWeek: 7,
      startMin: 480,
      endMin: 540,
    },
  });
  const learners = [];
  for (const englishName of [
    "Captured Ana",
    "Captured Bo",
    "Captured Cai",
    "Captured Dee",
  ])
    learners.push(
      await db.tutee.create({ data: { englishName, status: "ACTIVE" } }),
    );
  const originalIds = learners.slice(0, 3).map((row) => row.id);
  const requestedIds = [learners[0]!.id, learners[2]!.id, learners[3]!.id];
  const pairing = await db.pairing.create({
    data: {
      tutorId: tutor.id,
      subject: subject.name,
      termId: "capture-term",
      timeSlotId: slot.id,
      scheduleConfirmed: true,
      dayOfWeek: 7,
      startMin: 480,
      endMin: 540,
      roomMode: "NONE",
      tutees: { create: originalIds.map((tuteeId) => ({ tuteeId })) },
    },
  });
  const before = await db.pairing.findUniqueOrThrow({
    where: { id: pairing.id },
    include: { tutees: { orderBy: { tuteeId: "asc" } } },
  });
  const input = {
    id: pairing.id,
    tutorId: tutor.id,
    subject: subject.name,
    subjectId: subject.id,
    timeSlotId: slot.id,
    roomMode: "NONE" as const,
    expectedRoomVersion: before.roomVersion,
    tuteeIds: requestedIds,
  };
  expect(
    await coordinator().assignment.prepare({
      operation: "admin.updatePairing",
      payload: input,
    }),
  ).toEqual({ ticket: null, mismatches: [] });
  const request = await queued(() => coordinator().admin.updatePairing(input));
  const field = presentation(request).changes.find(
    (row) => row.key === "tuteeIds",
  );
  expect(field?.collection?.counts).toEqual({
    added: 1,
    removed: 1,
    changed: 0,
    unchanged: 2,
  });
  expect(
    await db.pairing.findUniqueOrThrow({
      where: { id: pairing.id },
      include: { tutees: { orderBy: { tuteeId: "asc" } } },
    }),
  ).toEqual(before);
  await admin().approval.decide({
    id: request.id,
    approve: true,
    note: "Qualified assignment and manual participant roster checked",
  });
  expect(
    (await db.pairingTutee.findMany({ where: { pairingId: pairing.id } }))
      .map((row) => row.tuteeId)
      .sort(),
  ).toEqual([...requestedIds].sort());
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: learners[1]!.id } }),
  ).toMatchObject({ status: "ACTIVE" });
  expect(await db.session.count()).toBe(0);
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }))
      .targets,
  ).toEqual(request.targets);
});

type SavedReferences = {
  version: number;
  timeZone: string;
  entities: Record<string, Record<string, unknown>[]>;
};
const references = (request: Request) =>
  (request.targets as unknown as { reviewReferences: SavedReferences })
    .reviewReferences;

/** Original and requested identities are deliberately different. The removed
 * learner, former tutor, room and slot are absent from collect(input)'s rows. */
async function referencedPairing() {
  const level = await db.subjectLevel.create({
    data: { name: "Captured honors level", prefix: "Honors" },
  });
  const subject = await db.subject.create({
    data: { name: "Reference mathematics", levelId: level.id },
  });
  const oldTutor = await db.tutor.create({
    data: { englishName: "Original reference tutor", status: "ACTIVE" },
  });
  const newTutor = await db.tutor.create({
    data: { englishName: "Requested reference tutor", status: "ACTIVE" },
  });
  await db.tutorQualification.create({
    data: {
      tutorId: newTutor.id,
      subjectId: subject.id,
      approvedById: "capture-admin",
      grants: { create: { subjectId: subject.id } },
    },
  });
  const removed = await db.tutee.create({
    data: {
      englishName: "Removed reference learner",
      email: "PRIVATE_REFERENCE_EMAIL@example.test",
      firstChoiceId: subject.id,
    },
  });
  const retained = await db.tutee.create({
    data: {
      englishName: "Retained reference learner",
      firstChoiceId: subject.id,
    },
  });
  const added = await db.tutee.create({
    data: { englishName: "Added reference learner", firstChoiceId: subject.id },
  });
  const oldRoom = await db.room.create({
    data: { name: "Original reference room" },
  });
  const newRoom = await db.room.create({
    data: { name: "Requested reference room" },
  });
  const oldSlot = await db.timeSlot.create({
    data: {
      label: "Original reference slot",
      dayOfWeek: 7,
      startMin: 480,
      endMin: 540,
    },
  });
  const newSlot = await db.timeSlot.create({
    data: {
      label: "Requested reference slot",
      dayOfWeek: 7,
      startMin: 600,
      endMin: 660,
    },
  });
  const pairing = await db.pairing.create({
    data: {
      tutorId: oldTutor.id,
      subject: subject.name,
      termId: "capture-term",
      timeSlotId: oldSlot.id,
      roomId: oldRoom.id,
      roomMode: "FIXED",
      scheduleConfirmed: true,
      dayOfWeek: 7,
      startMin: 480,
      endMin: 540,
      tutees: { create: [{ tuteeId: removed.id }, { tuteeId: retained.id }] },
    },
  });
  const current = await db.pairing.findUniqueOrThrow({
    where: { id: pairing.id },
  });
  const input = {
    id: pairing.id,
    tutorId: newTutor.id,
    subject: subject.name,
    subjectId: subject.id,
    roomId: newRoom.id,
    roomMode: "FIXED" as const,
    timeSlotId: newSlot.id,
    expectedRoomVersion: current.roomVersion,
    tuteeIds: [retained.id, added.id],
  };
  return {
    level,
    subject,
    oldTutor,
    newTutor,
    removed,
    retained,
    added,
    oldRoom,
    newRoom,
    oldSlot,
    newSlot,
    pairing,
    input,
  };
}

it("captures minimal typed original and requested pairing references and applies the same valid proposal", async () => {
  const fixture = await referencedPairing();
  const request = await queued(() =>
    coordinator().admin.updatePairing(fixture.input),
  );
  const saved = references(request);
  expect(saved).toMatchObject({ version: 1, timeZone: "Asia/Shanghai" });
  expect(saved.entities.Tutor).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: fixture.oldTutor.id,
        englishName: "Original reference tutor",
      }),
      expect.objectContaining({
        id: fixture.newTutor.id,
        englishName: "Requested reference tutor",
      }),
    ]),
  );
  expect(saved.entities.Tutee).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: fixture.removed.id,
        englishName: "Removed reference learner",
      }),
      expect.objectContaining({
        id: fixture.retained.id,
        englishName: "Retained reference learner",
      }),
      expect.objectContaining({
        id: fixture.added.id,
        englishName: "Added reference learner",
      }),
    ]),
  );
  expect(saved.entities.Room).toEqual(
    expect.arrayContaining([
      { id: fixture.oldRoom.id, name: "Original reference room" },
      { id: fixture.newRoom.id, name: "Requested reference room" },
    ]),
  );
  expect(saved.entities.TimeSlot).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: fixture.oldSlot.id,
        label: "Original reference slot",
        startMin: 480,
      }),
      expect.objectContaining({
        id: fixture.newSlot.id,
        label: "Requested reference slot",
        startMin: 600,
      }),
    ]),
  );
  expect(saved.entities.SubjectLevel).toContainEqual({
    id: fixture.level.id,
    name: "Captured honors level",
    prefix: "Honors",
  });
  expect(saved.entities.Subject).toContainEqual(
    expect.objectContaining({
      id: fixture.subject.id,
      levelId: fixture.level.id,
    }),
  );
  expect(saved.entities.Term).toContainEqual(
    expect.objectContaining({ id: "capture-term", name: "Captured 26–27 Q1" }),
  );
  expect(saved.entities.PairingTutee).toEqual(
    expect.arrayContaining([
      { pairingId: fixture.pairing.id, tuteeId: fixture.removed.id },
      { pairingId: fixture.pairing.id, tuteeId: fixture.retained.id },
    ]),
  );
  expect(JSON.stringify(saved)).not.toContain("PRIVATE_REFERENCE_EMAIL");
  expect(JSON.stringify(saved)).not.toContain("passwordHash");
  await admin().approval.decide({
    id: request.id,
    approve: true,
    note: "Original and requested participants, tutor, room and slot checked",
  });
  expect(
    await db.pairing.findUniqueOrThrow({ where: { id: fixture.pairing.id } }),
  ).toMatchObject({
    tutorId: fixture.newTutor.id,
    roomId: fixture.newRoom.id,
    timeSlotId: fixture.newSlot.id,
  });
  expect(
    (
      await db.pairingTutee.findMany({
        where: { pairingId: fixture.pairing.id },
      })
    )
      .map((row) => row.tuteeId)
      .sort(),
  ).toEqual([fixture.retained.id, fixture.added.id].sort());
  expect(
    references(
      await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ),
  ).toEqual(saved);
});

it("rejects a new pairing review when a removed participant's captured label changes", async () => {
  const fixture = await referencedPairing();
  const request = await queued(() =>
    coordinator().admin.updatePairing(fixture.input),
  );
  const originalTargets = request.targets as unknown as {
    Tutee: { record: { id: string } }[];
  };
  expect(originalTargets.Tutee.map((row) => row.record.id)).not.toContain(
    fixture.removed.id,
  );
  await db.tutee.update({
    where: { id: fixture.removed.id },
    data: { englishName: "Changed removed learner label" },
  });
  await expect(approve(request)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.pairing.findUniqueOrThrow({ where: { id: fixture.pairing.id } }),
  ).toMatchObject({ tutorId: fixture.oldTutor.id });
  const pending = await db.approvalRequest.findUniqueOrThrow({
    where: { id: request.id },
  });
  expect(pending).toMatchObject({
    state: "PENDING",
    fingerprint: request.fingerprint,
    targets: request.targets,
  });
  expect(references(pending).entities.Tutee).toContainEqual(
    expect.objectContaining({
      id: fixture.removed.id,
      englishName: "Removed reference learner",
    }),
  );
});

it("keeps historical pairing digests and replay unchanged without joining newly available original labels", async () => {
  const fixture = await referencedPairing();
  const fresh = await queued(() =>
    coordinator().admin.updatePairing(fixture.input),
  );
  const request = await historical(fresh);
  expect(request.targets).not.toHaveProperty("reviewReferences");
  await db.tutee.update({
    where: { id: fixture.removed.id },
    data: { englishName: "Changed removed learner label" },
  });
  // This label was never part of the old evidence; adding it during replay would
  // incorrectly stale a previously valid historical request.
  await admin().approval.decide({
    id: request.id,
    approve: true,
    note: "Historical evidence generation preserved",
  });
  const decided = await db.approvalRequest.findUniqueOrThrow({
    where: { id: request.id },
  });
  expect(decided).toMatchObject({
    state: "APPROVED",
    fingerprint: request.fingerprint,
    targets: request.targets,
  });
  expect(decided.targets).not.toHaveProperty("reviewReferences");
});

it("preserves existing presentation-v1 projection bytes and fingerprints when reference capture is absent", async () => {
  const fresh = await queued(() =>
    admin().admin.updateAccountProfile({
      userId: targetId,
      name: "June Lin",
      firstName: "Mira",
      alternativeNames: null,
      expectedProfileVersion: 0,
    }),
  );
  const prior = await proposalTargets(
    db,
    fresh.operation,
    fresh.payload,
    true,
    true,
    fresh.requesterId,
    true,
  );
  const current = await proposalTargets(
    db,
    fresh.operation,
    fresh.payload,
    true,
    true,
    fresh.requesterId,
    true,
    true,
  );
  const { reviewReferences: ignored, ...existingBytes } = current;
  expect(ignored).toMatchObject({ version: 1 });
  expect(JSON.stringify(existingBytes)).toBe(JSON.stringify(prior));
  expect(fingerprint(existingBytes)).toBe(fingerprint(prior));
  expect(prior.reviewPresentation).toEqual({ version: 1 });
  prior.reviewAuthority = (fresh.targets as Prisma.JsonObject).reviewAuthority!;
  const request = await db.approvalRequest.update({
    where: { id: fresh.id },
    data: { targets: prior, fingerprint: fingerprint(prior) },
  });
  await approve(request);
  const decided = await db.approvalRequest.findUniqueOrThrow({
    where: { id: request.id },
  });
  expect(decided).toMatchObject({
    state: "APPROVED",
    targets: request.targets,
    fingerprint: request.fingerprint,
  });
  expect(decided.targets).not.toHaveProperty("reviewReferences");
});

it("fails closed on an unsupported saved display reference version", async () => {
  const fresh = await queued(() =>
    admin().admin.updateAccountUsername({
      userId: targetId,
      username: "miralin",
      expectedProfileVersion: 0,
    }),
  );
  const targets = {
    ...(fresh.targets as Prisma.JsonObject),
    reviewReferences: { version: 2, entities: {} },
  };
  const request = await db.approvalRequest.update({
    where: { id: fresh.id },
    data: { targets, fingerprint: fingerprint(targets) },
  });
  await expect(approve(request)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: targetId } }),
  ).toMatchObject({ username: "minalin", profileVersion: 0 });
  expect(
    await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }),
  ).toMatchObject({ state: "PENDING", targets });
});

it("captures a session flag's exact nested tutor, schedule and participants without private text", async () => {
  const fixture = await mergedAttendance();
  const flag = await db.sessionFlag.create({
    data: {
      sessionId: fixture.primary.id,
      tutorId: fixture.primary.tutorId,
      expected: 3,
      observed: 1,
    },
  });
  const request = await queued(() =>
    coordinator().admin.decideSessionFlag({
      flagId: flag.id,
      action: "WARN",
      note: "Review the recorded discrepancy",
    }),
  );
  const saved = references(request);
  expect(saved.entities.SessionFlag).toContainEqual({
    id: flag.id,
    sessionId: fixture.primary.id,
    tutorId: fixture.primary.tutorId,
  });
  expect(saved.entities.Session).toContainEqual(
    expect.objectContaining({
      id: fixture.primary.id,
      date: expect.stringMatching(/^2026-10-25T00:00:00/) as unknown,
      startMin: 600,
      endMin: 660,
    }),
  );
  expect(saved.entities.Tutor).toContainEqual(
    expect.objectContaining({
      id: fixture.primary.tutorId,
      englishName: "Captured combined tutor",
    }),
  );
  expect(saved.entities.Tutee).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: fixture.learners[0]!.id,
        englishName: "Captured Ana",
      }),
      expect.objectContaining({
        id: fixture.learners[1]!.id,
        englishName: "Captured Bo",
      }),
      expect.objectContaining({
        id: fixture.learners[2]!.id,
        englishName: "Captured Cai",
      }),
    ]),
  );
  expect(JSON.stringify(saved)).not.toContain("Exact combined-session comment");
});

it("uses the Crew application namespace for a requested applicationId without changing old target evidence", async () => {
  const application = await db.crewApplication.create({
    data: {
      name: "Captured crew applicant",
      email: "PRIVATE_CREW_CONTACT@example.test",
    },
  });
  const request = await queued(() =>
    admin().admin.decideCrewApplication({
      applicationId: application.id,
      action: "ACCEPT",
    }),
  );
  expect(references(request).entities.CrewApplication).toContainEqual({
    id: application.id,
    name: "Captured crew applicant",
  });
  expect(JSON.stringify(references(request))).not.toContain(
    "PRIVATE_CREW_CONTACT",
  );
  expect(request.targets).toMatchObject({ TutorApplication: [] });
  expect(await db.registrationCode.count()).toBe(0);
});

it("captures an explicit new interview chair and requested actual room from their typed input fields", async () => {
  const fixture = await mergedAttendance();
  const room = await db.room.create({
    data: { name: "Requested actual room" },
  });
  const input = { ...fixture.input, online: false, actualRoomId: room.id };
  const request = await queued(() =>
    admin().corrections.correctAttendance(input),
  );
  expect(references(request).entities.Room).toContainEqual({
    id: room.id,
    name: "Requested actual room",
  });
  // The chair field is typed independently, while the parser and domain input
  // retain the required membership of that chair in the requested panel.
  const application = await db.tutorApplication.create({
    data: {
      name: "Panel reference applicant",
      email: "panel-ref@example.test",
    },
  });
  const panel = await db.tutor.findMany({
    where: { id: fixture.primary.tutorId },
  });
  const second = await db.tutor.create({
    data: { englishName: "Second panel reference", status: "ACTIVE" },
  });
  const chair = await db.tutor.create({
    data: { englishName: "Explicit requested chair", status: "ACTIVE" },
  });
  const payload = await import("~/server/approvals").then(({ parseProposal }) =>
    parseProposal("admin.assignInterviewers", {
      applicationId: application.id,
      tutorIds: [panel[0]!.id, second.id, chair.id],
      headTutorId: chair.id,
      expectedUpdatedAt: application.updatedAt,
    }),
  );
  const targets = await proposalTargets(
    db,
    "admin.assignInterviewers",
    payload,
    true,
    true,
    "capture-admin",
    true,
    true,
  );
  expect(
    (targets.reviewReferences as unknown as SavedReferences).entities.Tutor,
  ).toContainEqual(
    expect.objectContaining({
      id: chair.id,
      englishName: "Explicit requested chair",
    }),
  );
});

it("captures an automatic allocation's original room while excluding an ignored requested candidate", async () => {
  const fixture = await referencedPairing();
  const request = await queued(() =>
    coordinator().admin.updatePairing({ ...fixture.input, roomMode: "AUTO" }),
  );
  expect(references(request).entities.Room).toContainEqual({
    id: fixture.oldRoom.id,
    name: "Original reference room",
  });
  expect(references(request).entities.Room).not.toContainEqual(
    expect.objectContaining({ id: fixture.newRoom.id }),
  );
  await db.room.update({
    where: { id: fixture.newRoom.id },
    data: { name: "Changed ignored candidate" },
  });
  const recomputed = await proposalTargets(
    db,
    request.operation,
    request.payload,
    true,
    true,
    request.requesterId,
    true,
    true,
  );
  recomputed.reviewAuthority = (
    request.targets as Prisma.JsonObject
  ).reviewAuthority!;
  expect(fingerprint(recomputed)).toBe(request.fingerprint);
});

async function announcementAudienceFixture() {
  const selected = await db.tutor.create({
    data: {
      englishName: "Selected filtered tutor",
      gradeLevel: 12,
      status: "ACTIVE",
    },
  });
  const included = await db.tutor.create({
    data: {
      englishName: "Explicitly included tutor",
      gradeLevel: 10,
      status: "PENDING",
    },
  });
  const excluded = await db.tutor.create({
    data: {
      englishName: "Explicitly excluded tutor",
      gradeLevel: 12,
      status: "ACTIVE",
      email: "PRIVATE_EXCLUDED_CONTACT@example.test",
    },
  });
  const unrelated = await db.tutor.create({
    data: {
      englishName: "Unrelated filtered-out tutor",
      gradeLevel: 9,
      status: "ACTIVE",
    },
  });
  const input = {
    title: "Captured announcement audience",
    body: "Exact announcement text",
    audience: {
      mode: "filtered" as const,
      grades: [12],
      statuses: ["ACTIVE" as const],
      includeTutorIds: [included.id],
      excludeTutorIds: [excluded.id],
    },
  };
  return { selected, included, excluded, unrelated, input };
}

it("captures selected announcement recipients and explicit audience overrides without unrelated tutor labels", async () => {
  const fixture = await announcementAudienceFixture();
  const request = await queued(() =>
    coordinator().admin.createAnnouncement(fixture.input),
  );
  expect(request.targets).toMatchObject({
    announcementRecipients: expect.arrayContaining([
      { id: fixture.selected.id, name: "Selected filtered tutor" },
      { id: fixture.included.id, name: "Explicitly included tutor" },
    ]) as unknown,
  });
  const saved = references(request);
  expect(saved.entities.Tutor?.map((tutor) => tutor.id).sort()).toEqual(
    [fixture.selected.id, fixture.included.id, fixture.excluded.id].sort(),
  );
  expect(saved.entities.Tutor).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: fixture.selected.id,
        englishName: "Selected filtered tutor",
      }),
      expect.objectContaining({
        id: fixture.included.id,
        englishName: "Explicitly included tutor",
      }),
      expect.objectContaining({
        id: fixture.excluded.id,
        englishName: "Explicitly excluded tutor",
      }),
    ]),
  );
  expect(JSON.stringify(saved)).not.toContain(fixture.unrelated.id);
  expect(JSON.stringify(saved)).not.toContain("Unrelated filtered-out tutor");
  expect(JSON.stringify(saved)).not.toContain("PRIVATE_EXCLUDED_CONTACT");
  expect(await db.announcement.count()).toBe(0);
});

it("retains an explicitly excluded announcement tutor's saved label and refuses a changed audience reference", async () => {
  const fixture = await announcementAudienceFixture();
  const request = await queued(() =>
    coordinator().admin.createAnnouncement(fixture.input),
  );
  await db.tutor.update({
    where: { id: fixture.excluded.id },
    data: { englishName: "Changed excluded tutor label" },
  });
  await expect(approve(request)).rejects.toMatchObject({ code: "CONFLICT" });
  const pending = await db.approvalRequest.findUniqueOrThrow({
    where: { id: request.id },
  });
  expect(pending).toMatchObject({ state: "PENDING", targets: request.targets });
  expect(references(pending).entities.Tutor).toContainEqual(
    expect.objectContaining({
      id: fixture.excluded.id,
      englishName: "Explicitly excluded tutor",
    }),
  );
  expect(await db.announcement.count()).toBe(0);
});
