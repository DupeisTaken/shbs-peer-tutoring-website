import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { db } from "./db";
import { createCaller } from "./api/root";
import { hashPassword } from "./auth/password";
import { isSessionCurrent } from "./auth/session-version";
import { accountHistoryIds, accountRetirementChain } from "./account-history";
import {
  eligiblePatrolCredit,
  lockPatrolCreditOwner,
  reservePatrolEvidence,
} from "./crew/patrol-credit";
import { combinePersonRecords, previewPersonCombine, reviewPersonParticipation, finalizePersonParticipation } from "./person-combine";
import { syncAccountPerson } from "./person-identity";
import { linkTutorHistory, previewTutorHistory } from "./tutor-history";
import { linkTuteeHistory, previewHistoryLink } from "./tutee-history";
import { deleteAccount, previewDeleteAccount } from "./delete-account";
import { lockEntity } from "./transactions";
import { recordCsv } from "~/lib/record-transfer";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const password = "Unified-person-review-fixture-2026!";
const passwordHash = hashPassword(password);
const reason = "Staff reviewed original records and confirmed the exact person";
type Selection = Parameters<typeof previewPersonCombine>[1];
const user = (id: string) => ({ kind: "USER" as const, id });
const tutor = (id: string) => ({ kind: "TUTOR" as const, id });
const tutee = (id: string) => ({ kind: "TUTEE" as const, id });
const archives: Selection = { sources: [tutor("archive"), tutee("past")] };

/** Active work is independent of a roster's archived label. */
const currentAssignment = (kind: "TUTOR" | "TUTEE") =>
  db.pairing.create({
    data: {
      tutorId: kind === "TUTOR" ? "archive" : "current-tutor",
      termId: "current-term",
      subject: "Mathematics",
      dayOfWeek: 3,
      startMin: 600,
      endMin: 630,
      ...(kind === "TUTEE" ? { tutees: { create: { tuteeId: "past" } } } : {}),
    },
  });
const caller = (id = "head", role: Session["role"] = "HEAD") =>
  createCaller({
    db,
    headers: new Headers(),
    session: { user: { id }, role, tutorId: null, expires: "2099-01-01" },
  });

/** New identity tables participate in the same disposable fixture as source rows.
 * Dynamic truncation handles restrictive FKs without production deletion bypasses. */
async function clearFixture() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
}

beforeEach(async () => {
  (
    globalThis as { rateLimitStore?: Map<string, unknown> }
  ).rateLimitStore?.clear();
  await clearFixture();
  await db.user.createMany({
    data: (
      [
        ["head", "HEAD"],
        ["admin", "ADMIN"],
        ["coord", "COORDINATOR"],
        ["viewer", "VIEWER"],
        ["owner", "STUDENT"],
        ["other", "STUDENT"],
      ] as const
    ).map(([id, role]) => ({
      id,
      role,
      name: id,
      username: id,
      email: `${id}@example.test`,
      passwordHash,
      emailVerifiedAt: new Date("2026-10-01"),
    })),
  });
  await db.term.createMany({
    data: [
      {
        id: "old",
        name: "Original term",
        schoolYear: "24-25",
        quarter: "Q1",
        active: false,
      },
      {
        id: "current-term",
        name: "Current term",
        schoolYear: "26-27",
        quarter: "Q1",
        active: true,
      },
    ],
  });
  await db.tutor.createMany({
    data: [
      {
        id: "archive",
        englishName: "Same original name",
        status: "ARCHIVED",
        gradeLevel: 9,
      },
      {
        id: "archive-two",
        englishName: "Same original name",
        status: "GRADUATED",
        gradeLevel: 10,
      },
      { id: "current-tutor", englishName: "Current tutor", status: "ACTIVE" },
      {
        id: "other-tutor",
        englishName: "Another current tutor",
        status: "ACTIVE",
      },
    ],
  });
  await db.tutee.createMany({
    data: [
      {
        id: "past",
        englishName: "Same original name",
        status: "INACTIVE",
        intakeTermId: "old",
        gradeLevel: "9",
      },
      {
        id: "past-two",
        englishName: "Second enrollment",
        status: "INACTIVE",
        intakeTermId: "old",
        gradeLevel: "10",
      },
      {
        id: "current-tutee",
        englishName: "Current tutee",
        status: "ACTIVE",
        intakeTermId: "current-term",
      },
      {
        id: "other-tutee",
        englishName: "Another current tutee",
        status: "ACTIVE",
        intakeTermId: "current-term",
      },
    ],
  });
  await db.pairing.create({
    data: {
      id: "original-pairing",
      tutorId: "archive",
      termId: "old",
      subject: "Mathematics",
      dayOfWeek: 2,
      startMin: 600,
      endMin: 630,
    },
  });
  await db.session.create({
    data: {
      id: "original-session",
      tutorId: "archive",
      pairingId: "original-pairing",
      date: new Date("2024-10-01"),
      startMin: 600,
      endMin: 630,
      durationMin: 30,
      shCount: 2,
      shFactor: 2,
      month: "2024-10",
      schoolYear: "24-25",
      quarter: "Q1",
    },
  });
  await db.sessionTutee.create({
    data: {
      sessionId: "original-session",
      tuteeId: "past",
      status: "PRESENT",
    },
  });
  await db.tutorMeeting.create({
    data: {
      id: "original-meeting",
      title: "Original meeting",
      date: new Date("2024-10-02"),
      termId: "old",
    },
  });
  await db.meetingAttendance.create({
    data: {
      id: "original-attendance",
      tutorId: "archive",
      meetingId: "original-meeting",
      status: "PRESENT",
    },
  });
  await db.serviceHourAdjustment.create({
    data: {
      id: "original-adjustment",
      tutorId: "archive",
      month: "2024-10",
      schoolYear: "24-25",
      quarter: "Q1",
      type: "EXTRA",
      amount: 0.5,
      reason: "Documented original amendment",
    },
  });
});
afterAll(async () => {
  await clearFixture();
  await db.$disconnect();
});

async function reviewed(selection: Selection) {
  const preview = await previewPersonCombine(db, selection);
  return {
    ...selection,
    fingerprint: preview.fingerprint,
    reason,
    acknowledged: true as const,
    operationId: randomUUID(),
    ...(preview.requiresHead ? { confirmPassword: password } : {}),
  };
}
async function combine(selection: Selection, actorId = "head") {
  return combinePersonRecords(db, actorId, await reviewed(selection));
}
const originals = async () => ({
  sessions: await db.session.findMany({ orderBy: { id: "asc" } }),
  attendance: await db.sessionTutee.findMany({ orderBy: { sessionId: "asc" } }),
  meetings: await db.meetingAttendance.findMany({ orderBy: { id: "asc" } }),
  adjustments: await db.serviceHourAdjustment.findMany({
    orderBy: { id: "asc" },
  }),
  tutor: await db.tutor.findUnique({
    where: { id: "archive" },
    select: {
      id: true,
      englishName: true,
      gradeLevel: true,
      status: true,
      updatedAt: true,
    },
  }),
  tutee: await db.tutee.findUnique({
    where: { id: "past" },
    select: {
      id: true,
      englishName: true,
      gradeLevel: true,
      status: true,
      intakeTermId: true,
      signatureName: true,
      signedAt: true,
      signedRulebook: true,
      updatedAt: true,
    },
  }),
});
const credentials = (id: string) =>
  db.user.findUniqueOrThrow({
    where: { id },
    select: {
      passwordHash: true,
      profileVersion: true,
      email: true,
      username: true,
      sessionVersion: true,
      tutorId: true,
      studentId: true,
      tutorAccessRevoked: true,
      tuteeMember: true,
      canTranslate: true,
      crewStatus: true,
      role: true,
      mergedIntoId: true,
      mustChangePassword: true,
      emailVerifiedAt: true,
    },
  });

it.each([
  ["tutor archives", [tutor("archive"), tutor("archive-two")]],
  ["tutee enrollments", [tutee("past"), tutee("past-two")]],
  ["mixed participant records", [tutor("archive"), tutee("past")]],
] as const)(
  "lets Admin group accountless %s without inventing credentials or changing evidence",
  async (_label, sources) => {
    const selection = { sources: [...sources] };
    const before = await originals();
    const usersBefore = await db.user.count();
    const preview = await previewPersonCombine(db, selection);
    expect(preview.requiresHead).toBe(false);
    expect(preview.accounts).toEqual([]);
    const result = await combine(selection, "admin");
    expect(result).toMatchObject({
      ok: true,
      outcome: "GROUPED",
      retiredUserIds: [],
    });
    expect(await db.user.count()).toBe(usersBefore);
    expect(await db.policyAcceptance.count()).toBe(0);
    expect(await db.studentProfileOwnership.count()).toBe(0);
    expect(await db.tutorProfileOwnership.count()).toBe(0);
    expect(await originals()).toEqual(before);
    const after = await previewPersonCombine(db, selection);
    expect(after.alreadyTogether).toBe(true);
  },
);

it("adds a later accountless source through any existing group member without losing earlier records", async () => {
  await combine(archives, "admin");
  await combine({ sources: [tutor("archive"), tutor("archive-two")] }, "admin");
  const preview = await previewPersonCombine(db, {
    sources: [tutee("past"), tutor("archive-two")],
  });
  expect(preview.alreadyTogether).toBe(true);
  expect(preview.counts).toMatchObject({ users: 0, tutors: 2, tutees: 1 });
  expect(await db.user.count()).toBe(6);
  expect(await db.session.count()).toBe(1);
});

it.each(["short", "long"] as const)(
  "persists both accountless participant assignments through the full router middleware with %s source IDs",
  async (idLength) => {
    const tutorId =
      idLength === "short" ? "archive" : "demo-combine-archive-tutor";
    const tuteeId =
      idLength === "short" ? "past" : "demo-combine-archive-tutee";
    if (idLength === "long") {
      await db.tutor.create({
        data: {
          id: tutorId,
          englishName: "Long identity tutor",
          status: "ARCHIVED",
        },
      });
      await db.tutee.create({
        data: {
          id: tuteeId,
          englishName: "Long identity tutee",
          status: "INACTIVE",
          intakeTermId: "old",
        },
      });
    }
    const sourceBefore = {
      tutor: await db.tutor.findUniqueOrThrow({ where: { id: tutorId } }),
      tutee: await db.tutee.findUniqueOrThrow({ where: { id: tuteeId } }),
    };
    const selection = { sources: [tutor(tutorId), tutee(tuteeId)] };
    const admin = caller("admin", "ADMIN");
    const preview = await admin.personCombine.preview(selection);
    expect(preview).toMatchObject({
      requiresHead: false,
      alreadyTogether: false,
    });
    // Service-only tests bypass mutation audit/scoped-database middleware. A
    // receipt is insufficient: check committed source metadata after that scope exits.
    const result = await admin.personCombine.combine({
      ...selection,
      fingerprint: preview.fingerprint,
      reason,
      acknowledged: true,
      operationId: randomUUID(),
    });
    expect(result).toMatchObject({ ok: true, outcome: "GROUPED" });
    expect(
      await db.person.findUnique({ where: { id: result.personId } }),
    ).not.toBeNull();
    expect(
      await db.personCombineReceipt.findUnique({
        where: { id: result.receiptId },
      }),
    ).toMatchObject({ personId: result.personId, actorId: "admin" });
    expect(
      await db.tutor.findUniqueOrThrow({ where: { id: tutorId } }),
    ).toEqual({ ...sourceBefore.tutor, personId: result.personId, historyIdentityRevision: sourceBefore.tutor.historyIdentityRevision + 1 });
    expect(
      await db.tutee.findUniqueOrThrow({ where: { id: tuteeId } }),
    ).toEqual({ ...sourceBefore.tutee, personId: result.personId, historyIdentityRevision: sourceBefore.tutee.historyIdentityRevision + 1 });
    expect(await admin.personCombine.preview(selection)).toMatchObject({
      alreadyTogether: true,
      counts: { users: 0, tutors: 1, tutees: 1 },
    });
  },
);

it("lets Admin attach an unowned mixed archive group to a ready account without participation grants", async () => {
  await combine(archives, "admin");
  const before = await originals();
  const account = await credentials("owner");
  const selection = {
    sources: [user("owner"), tutor("archive")],
    retainedUserId: "owner",
  };
  expect((await previewPersonCombine(db, selection)).requiresHead).toBe(false);
  await combine(selection, "admin");
  expect(
    await db.tutorProfileOwnership.findUnique({
      where: { tutorId: "archive" },
    }),
  ).toMatchObject({ userId: "owner" });
  expect(
    await db.studentProfileOwnership.findUnique({ where: { tuteeId: "past" } }),
  ).toMatchObject({ userId: "owner" });
  expect(await credentials("owner")).toEqual(account);
  expect(await originals()).toEqual(before);
  expect(
    (await caller("owner", "STUDENT").tuteeHistory.myTutorRecords()).map(
      (row) => row.id,
    ),
  ).toContain("archive");
  expect(
    (await caller("owner", "STUDENT").tuteeHistory.myRecords()).map(
      (row) => row.id,
    ),
  ).toContain("past");
  expect(
    await caller("other", "STUDENT").tuteeHistory.myTutorRecords(),
  ).toEqual([]);
  await expect(
    caller("other", "STUDENT").tuteeHistory.myDetails({ tuteeId: "past" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it.each(["coord", "viewer", "owner"])(
  "rejects %s as a person-group reviewer",
  async (actorId) => {
    await expect(combine(archives, actorId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await previewPersonCombine(db, archives)).alreadyTogether).toBe(
      false,
    );
  },
);

it("requires Head and their live password for multiple-login grouping", async () => {
  const selection = {
    sources: [user("owner"), user("other")],
    retainedUserId: "owner",
  };
  const preview = await previewPersonCombine(db, selection);
  expect(preview.requiresHead).toBe(true);
  const input = await reviewed(selection);
  await expect(combinePersonRecords(db, "admin", input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    combinePersonRecords(db, "head", {
      ...input,
      confirmPassword: "incorrect",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.user.update({ where: { id: "head" }, data: { role: "ADMIN" } });
  await expect(combinePersonRecords(db, "head", input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(await credentials("other")).toMatchObject({
    passwordHash,
    mergedIntoId: null,
  });
});

it("enforces identity acknowledgement and role checks through the actual API", async () => {
  const input = await reviewed(archives);
  await expect(
    caller("admin", "ADMIN").personCombine.combine({
      ...input,
      acknowledged: false as unknown as true,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller("owner", "HEAD").personCombine.preview(archives),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await previewPersonCombine(db, archives)).alreadyTogether).toBe(
    false,
  );
});

it("requires Head when an unowned participant is active, preserving its operational state", async () => {
  const selection = {
    sources: [tutor("current-tutor"), tutee("current-tutee")],
  };
  expect((await previewPersonCombine(db, selection)).requiresHead).toBe(true);
  await expect(combine(selection, "admin")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await combine(selection);
  expect(
    await db.tutor.findUnique({ where: { id: "current-tutor" } }),
  ).toMatchObject({ status: "ACTIVE" });
  expect(
    await db.tutee.findUnique({ where: { id: "current-tutee" } }),
  ).toMatchObject({ status: "ACTIVE" });
  expect(await db.user.count()).toBe(6);
});

it("keeps conflicting active logins and their private histories separate while grouping identity for review", async () => {
  await db.user.update({
    where: { id: "owner" },
    data: {
      tutorId: "current-tutor",
      studentId: "current-tutee",
      tuteeMember: true,
    },
  });
  await db.user.update({
    where: { id: "other" },
    data: {
      tutorId: "other-tutor",
      studentId: "other-tutee",
      tuteeMember: true,
    },
  });
  await db.tutorProfileOwnership.create({
    data: { tutorId: "archive", userId: "other" },
  });
  await db.studentProfileOwnership.create({
    data: { tuteeId: "past", userId: "other" },
  });
  const ownerBefore = await credentials("owner");
  const otherBefore = await credentials("other");
  const before = await originals();
  const selection = {
    sources: [user("owner"), user("other")],
    retainedUserId: "owner",
  };
  const result = await combine(selection);
  expect(result).toMatchObject({
    outcome: "REVIEW_REQUIRED",
    retiredUserIds: [],
  });
  expect(await credentials("owner")).toEqual(ownerBefore);
  expect(await credentials("other")).toEqual(otherBefore);
  expect(await originals()).toEqual(before);
  expect(
    (await caller("owner", "STUDENT").tuteeHistory.myTutorRecords()).map(
      (row) => row.id,
    ),
  ).not.toContain("archive");
  expect(
    (await caller("other", "STUDENT").tuteeHistory.myTutorRecords()).map(
      (row) => row.id,
    ),
  ).toContain("archive");
  await expect(
    caller("owner", "STUDENT").tuteeHistory.myDetails({ tuteeId: "past" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await isSessionCurrent(db, {
      sub: "other",
      sessionVersion: otherBefore.sessionVersion,
    }),
  ).toBe(true);
  expect(await accountHistoryIds(db, "owner")).toEqual(["owner"]);
  expect(await accountHistoryIds(db, "other")).toEqual(["other"]);
});

it("does not transfer an already owned archive through an Admin review", async () => {
  await db.tutorProfileOwnership.create({
    data: { tutorId: "archive", userId: "other" },
  });
  const selection = {
    sources: [user("owner"), tutor("archive")],
    retainedUserId: "owner",
  };
  expect((await previewPersonCombine(db, selection)).requiresHead).toBe(true);
  await expect(combine(selection, "admin")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(
    await db.tutorProfileOwnership.findUnique({
      where: { tutorId: "archive" },
    }),
  ).toMatchObject({ userId: "other" });
});

it.each(["departure", "suspension"])(
  "preserves %s decisions during identity-only grouping without retiring credentials",
  async (restriction) => {
    if (restriction === "departure") {
      await db.schoolDeparture.create({
        data: {
          userId: "other",
          reason: "TRANSFERRED",
          source: "HEAD",
          observerRevoked: true,
        },
      });
    } else {
      await db.user.update({
        where: { id: "other" },
        data: {
          suspendedAt: new Date(),
          suspendedReason: "Existing review restriction",
        },
      });
    }
    const account = await db.user.findUniqueOrThrow({ where: { id: "other" } });
    const departure = await db.schoolDeparture.findUnique({
      where: { userId: "other" },
    });
    const selection = {
      sources: [user("owner"), user("other")],
      retainedUserId: "owner",
    };
    expect((await previewPersonCombine(db, selection)).requiresHead).toBe(true);
    expect(await combine(selection)).toMatchObject({
      outcome: "REVIEW_REQUIRED",
      retiredUserIds: [],
    });
    expect(await db.user.findUnique({ where: { id: "other" } })).toMatchObject({
      suspendedAt: account.suspendedAt,
      suspendedReason: account.suspendedReason,
      passwordHash: account.passwordHash,
      mergedIntoId: null,
    });
    expect(
      await db.schoolDeparture.findUnique({ where: { userId: "other" } }),
    ).toEqual(departure);
  },
);

it("does not treat grouping as consent, translator assignment or membership union", async () => {
  await db.user.update({
    where: { id: "other" },
    data: { canTranslate: true, tuteeMember: true, crewStatus: "ACTIVE" },
  });
  await db.policyAcceptance.create({
    data: {
      userId: "other",
      slug: "tutee-policy",
      revision: "original",
      snapshot: { original: "accepted text" },
      signature: "Original signer",
    },
  });
  const ownerBefore = await credentials("owner");
  const otherBefore = await credentials("other");
  const policy = await db.policyAcceptance.findFirstOrThrow();
  await combine({
    sources: [user("owner"), user("other")],
    retainedUserId: "owner",
  });
  expect(await credentials("owner")).toEqual(ownerBefore);
  expect(await credentials("other")).toEqual(otherBefore);
  expect(await db.policyAcceptance.findFirst()).toEqual(policy);
});

it("retires a compatible duplicate only when explicitly requested and preserves immutable evidence", async () => {
  const duplicateBefore = await credentials("other");
  const survivorBefore = await credentials("owner");
  const message = await db.directMessage.create({
    data: {
      senderId: "other",
      recipientId: "head",
      clientKey: "original-message",
      body: "Original private evidence",
    },
  });
  await db.passwordResetToken.create({
    data: {
      userId: "other",
      tokenHash: "original-reset",
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const result = await combine({
    sources: [user("owner"), user("other")],
    retainedUserId: "owner",
    retireDuplicateLogins: true,
  });
  expect(result.retiredUserIds).toEqual(["other"]);
  expect(await credentials("other")).toMatchObject({
    mergedIntoId: "owner",
    passwordHash: null,
  });
  expect(await credentials("owner")).toMatchObject({
    email: survivorBefore.email,
    username: survivorBefore.username,
    passwordHash: survivorBefore.passwordHash,
  });
  expect(
    await isSessionCurrent(db, {
      sub: "other",
      sessionVersion: duplicateBefore.sessionVersion,
    }),
  ).toBe(false);
  expect(
    await db.passwordResetToken.count({ where: { userId: "other" } }),
  ).toBe(0);
  expect(
    await db.directMessage.findUnique({ where: { id: message.id } }),
  ).toEqual(message);
});

it("rejects unsafe explicit retirement without partially grouping or changing either login", async () => {
  await db.user.update({
    where: { id: "other" },
    data: { canTranslate: true },
  });
  const ownerBefore = await credentials("owner");
  const otherBefore = await credentials("other");
  const selection = {
    sources: [user("owner"), user("other")],
    retainedUserId: "owner",
    retireDuplicateLogins: true,
  };
  expect((await previewPersonCombine(db, selection)).canRetireLogins).toBe(
    false,
  );
  await expect(combine(selection)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await credentials("owner")).toEqual(ownerBefore);
  expect(await credentials("other")).toEqual(otherBefore);
  expect(
    (
      await previewPersonCombine(db, {
        ...selection,
        retireDuplicateLogins: false,
      })
    ).alreadyTogether,
  ).toBe(false);
});

it.each(["primary-email-intake", "retained-tutor-request"] as const)(
  "preserves pending %s evidence and refuses to retire its login",
  async (pending) => {
    if (pending === "retained-tutor-request") {
      await db.tutorProfileOwnership.create({
        data: { tutorId: "archive", userId: "other" },
      });
    }
    const selection = {
      sources: [user("owner"), user("other")],
      retainedUserId: "owner",
      retireDuplicateLogins: true,
    };
    const oldReview = await reviewed(selection);
    if (pending === "primary-email-intake") {
      // Recreate an older account with no primary-email alias row so the next
      // review must use User.email independently of the normal fixture aliases.
      await db.accountEmail.deleteMany({ where: { userId: "other" } });
      expect(await db.accountEmail.count({ where: { userId: "other" } })).toBe(
        0,
      );
      await db.studentSurvey.create({
        data: {
          email: "other@example.test",
          intakeTermId: "current-term",
          payload: {},
          policyRevision: "original",
          policySnapshot: {},
          tokenHash: "pending-intake-proof",
          expiresAt: new Date(Date.now() + 60000),
        },
      });
    } else {
      await db.tutorStatusRequest.create({
        data: { tutorId: "archive", kind: "REENTRY" },
      });
    }
    const before = await credentials("other");
    const pendingIntakes = await db.studentSurvey.findMany();
    const pendingTutors = await db.tutorStatusRequest.findMany();
    await expect(
      combinePersonRecords(db, "head", oldReview),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await previewPersonCombine(db, selection)).canRetireLogins).toBe(
      false,
    );
    await expect(combine(selection)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await credentials("other")).toEqual(before);
    expect(await db.studentSurvey.findMany()).toEqual(pendingIntakes);
    expect(await db.tutorStatusRequest.findMany()).toEqual(pendingTutors);
    expect(
      await combine({ ...selection, retireDuplicateLogins: false }),
    ).toMatchObject({ outcome: "REVIEW_REQUIRED", retiredUserIds: [] });
  },
);

it("preserves an immutable retirement chain and its original patrol author through a later consolidation", async () => {
  await db.user.create({
    data: {
      id: "third",
      role: "STUDENT",
      name: "Final retained login",
      username: "third",
      email: "third@example.test",
      passwordHash,
      emailVerifiedAt: new Date(),
      crewStatus: "ACTIVE",
    },
  });
  await db.user.updateMany({
    where: { id: { in: ["owner", "other"] } },
    data: { crewStatus: "ACTIVE" },
  });
  const room = await db.room.create({ data: { name: "Original patrol room" } });
  const now = new Date();
  const original = await db.patrol.create({
    data: {
      crewUserId: "other",
      hours: 0.5,
      creditAwardedAt: now,
      observations: {
        create: { roomId: room.id, headcount: "ONE", observedAt: now },
      },
    },
    include: { observations: true },
  });
  await db.$transaction((tx) =>
    reservePatrolEvidence(tx, original, original.observations),
  );
  await combine({
    sources: [user("owner"), user("other")],
    retainedUserId: "owner",
    retireDuplicateLogins: true,
  });
  await combine({
    sources: [user("third"), user("owner")],
    retainedUserId: "third",
    retireDuplicateLogins: true,
  });
  // Older retirement edges remain untouched; recursive readers follow the final survivor.
  expect(await accountRetirementChain(db, "other")).toEqual([
    "other",
    "owner",
    "third",
  ]);
  expect(new Set(await accountHistoryIds(db, "third"))).toEqual(
    new Set(["other", "owner", "third"]),
  );
  await expect(
    db.$transaction((tx) => lockPatrolCreditOwner(tx, "other")),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.$transaction(async (tx) => {
    const ids = await lockPatrolCreditOwner(tx, "other", true);
    expect(new Set(ids)).toEqual(new Set(["other", "owner", "third"]));
    expect(
      await eligiblePatrolCredit(tx, ids, [{ observedAt: now }], now),
    ).toBe(false);
  });
  await caller().corrections.correctPatrol({
    id: original.id,
    expectedUpdatedAt: original.updatedAt,
    reason: "Correct original patrol after repeated identity consolidation",
    note: null,
    observations: original.observations.map((row) => ({
      id: row.id,
      roomId: room.id,
      headcount: "TWO" as const,
      observedAt: row.observedAt,
    })),
  });
  expect(
    await db.patrol.findUnique({ where: { id: original.id } }),
  ).toMatchObject({
    crewUserId: "other",
    hours: 0.5,
    creditAwardedAt: now,
  });
  expect(
    await db.patrolCreditWindow.count({ where: { crewUserId: "other" } }),
  ).toBeGreaterThan(0);
});

it.each([
  ["TUTOR", "current-tutor"],
  ["TUTOR", "archive-two"],
  ["TUTEE", "current-tutee"],
  ["TUTEE", "past-two"],
] as const)(
  "retires an archived direct %s pointer beside survivor profile %s without rewriting either source",
  async (kind, retainedProfile) => {
    await db.user.update({
      where: { id: "owner" },
      data:
        kind === "TUTOR"
          ? { tutorId: retainedProfile }
          : { studentId: retainedProfile },
    });
    await db.user.update({
      where: { id: "other" },
      data: kind === "TUTOR" ? { tutorId: "archive" } : { studentId: "past" },
    });
    const before = await originals();
    const survivor = await credentials("owner");
    // Original evidence stays identical; directory and ownership fences advance
    // separately and are checked below for exactly the affected source records.
    const sourceRows = async () => ({
      tutors: (await db.tutor.findMany({ orderBy: { id: "asc" } })).map(
        ({ personId: _personId, historyIdentityRevision: _revision, ...row }) => {
          void _personId;
          void _revision;
          return row;
        },
      ),
      tutees: (await db.tutee.findMany({ orderBy: { id: "asc" } })).map(
        ({ personId: _personId, historyIdentityRevision: _revision, ...row }) => {
          void _personId;
          void _revision;
          return row;
        },
      ),
    });
    const sourceBefore = await sourceRows();
    const identityRows = async () => ({
      tutors: await db.tutor.findMany({ orderBy: { id: "asc" }, select: { id: true, historyIdentityRevision: true } }),
      tutees: await db.tutee.findMany({ orderBy: { id: "asc" }, select: { id: true, historyIdentityRevision: true } }),
    });
    const identityBefore = await identityRows();
    const selection = {
      sources: [user("owner"), user("other")],
      retainedUserId: "owner",
      retireDuplicateLogins: true,
    };
    expect((await previewPersonCombine(db, selection)).canRetireLogins).toBe(
      true,
    );
    expect(await combine(selection)).toMatchObject({
      retiredUserIds: ["other"],
    });
    expect(await credentials("owner")).toEqual(survivor);
    expect(await credentials("other")).toMatchObject({
      tutorId: null,
      studentId: null,
      mergedIntoId: "owner",
      passwordHash: null,
    });
    expect(await sourceRows()).toEqual(sourceBefore);
    expect(await identityRows()).toEqual({
      tutors: identityBefore.tutors.map((row) => ({ ...row, historyIdentityRevision: row.historyIdentityRevision + (kind !== "TUTOR" ? 0 : row.id === "archive" ? 3 : row.id === retainedProfile ? 1 : 0) })),
      tutees: identityBefore.tutees.map((row) => ({ ...row, historyIdentityRevision: row.historyIdentityRevision + (kind !== "TUTEE" ? 0 : row.id === "past" ? 3 : row.id === retainedProfile ? 1 : 0) })),
    });
    expect(await originals()).toEqual(before);
    if (kind === "TUTOR") {
      expect(
        await db.tutorProfileOwnership.findUnique({
          where: { tutorId: "archive" },
        }),
      ).toMatchObject({ userId: "owner" });
      expect(
        (await caller("owner", "STUDENT").tuteeHistory.myTutorRecords()).map(
          (row) => row.id,
        ),
      ).toContain("archive");
    } else {
      expect(
        await db.studentProfileOwnership.findUnique({
          where: { tuteeId: "past" },
        }),
      ).toMatchObject({ userId: "owner" });
      expect(
        (await caller("owner", "STUDENT").tuteeHistory.myRecords()).map(
          (row) => row.id,
        ),
      ).toContain("past");
    }
  },
);

it.each(["TUTOR", "TUTEE"] as const)(
  "blocks retirement of an archived %s with newly added current work and invalidates the old review",
  async (kind) => {
    await db.user.update({
      where: { id: "other" },
      data: kind === "TUTOR" ? { tutorId: "archive" } : { studentId: "past" },
    });
    const selection = {
      sources: [user("owner"), user("other")],
      retainedUserId: "owner",
      retireDuplicateLogins: true,
    };
    expect((await previewPersonCombine(db, selection)).canRetireLogins).toBe(
      true,
    );
    const reviewedBeforeAssignment = await reviewed(selection);
    const assignment = await currentAssignment(kind);
    const before = await credentials("other");
    await expect(
      combinePersonRecords(db, "head", reviewedBeforeAssignment),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const preview = await previewPersonCombine(db, selection);
    expect(preview.canRetireLogins).toBe(false);
    expect(preview.conflicts.join(" ")).toMatch(/current-period assignments/);
    await expect(combine(selection)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await credentials("other")).toEqual(before);
    expect(
      await db.pairing.findUnique({ where: { id: assignment.id } }),
    ).toEqual(assignment);
    expect(
      await combine({ ...selection, retireDuplicateLogins: false }),
    ).toMatchObject({ outcome: "REVIEW_REQUIRED", retiredUserIds: [] });
  },
);

it.each([false, true])(
  "grants mixed unowned archives only when two logins become one ready login (retirement=%s)",
  async (retireDuplicateLogins) => {
    const before = await originals();
    const survivor = await credentials("owner");
    const result = await combine({
      sources: [user("owner"), user("other"), tutor("archive"), tutee("past")],
      retainedUserId: "owner",
      retireDuplicateLogins,
    });
    expect(result).toMatchObject({
      outcome: retireDuplicateLogins ? "GROUPED" : "REVIEW_REQUIRED",
      retiredUserIds: retireDuplicateLogins ? ["other"] : [],
    });
    expect(await credentials("owner")).toEqual(survivor);
    expect(await originals()).toEqual(before);
    const tutorOwner = await db.tutorProfileOwnership.findUnique({
      where: { tutorId: "archive" },
    });
    const tuteeOwner = await db.studentProfileOwnership.findUnique({
      where: { tuteeId: "past" },
    });
    if (retireDuplicateLogins) {
      expect(tutorOwner).toMatchObject({ userId: "owner" });
      expect(tuteeOwner).toMatchObject({ userId: "owner" });
      expect(
        (await caller("owner", "STUDENT").tuteeHistory.myTutorRecords()).map(
          (row) => row.id,
        ),
      ).toContain("archive");
      expect(
        (await caller("owner", "STUDENT").tuteeHistory.myRecords()).map(
          (row) => row.id,
        ),
      ).toContain("past");
    } else {
      expect(tutorOwner).toBeNull();
      expect(tuteeOwner).toBeNull();
      for (const id of ["owner", "other"]) {
        expect(
          await caller(id, "STUDENT").tuteeHistory.myTutorRecords(),
        ).toEqual([]);
        expect(await caller(id, "STUDENT").tuteeHistory.myRecords()).toEqual(
          [],
        );
      }
    }
  },
);

it("requires Head for accountless archived records with current assignments", async () => {
  await currentAssignment("TUTOR");
  const preview = await previewPersonCombine(db, archives);
  expect(preview).toMatchObject({
    requiresHead: true,
    outcome: "REVIEW_REQUIRED",
  });
  await expect(combine(archives, "admin")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(await combine(archives)).toMatchObject({
    outcome: "REVIEW_REQUIRED",
    retiredUserIds: [],
  });
  expect(await db.studentProfileOwnership.count()).toBe(0);
  expect(await db.tutorProfileOwnership.count()).toBe(0);
});

it("rejects a stale record review and allows a fresh review", async () => {
  const input = await reviewed(archives);
  await db.tutor.update({
    where: { id: "archive" },
    data: { englishName: "Reviewed source changed" },
  });
  await expect(combinePersonRecords(db, "admin", input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect((await previewPersonCombine(db, archives)).alreadyTogether).toBe(
    false,
  );
  expect(await combine(archives, "admin")).toMatchObject({ ok: true });
});

it("returns one receipt on lost-response retry and rejects reuse for a different payload", async () => {
  const input = await reviewed(archives);
  const first = await combinePersonRecords(db, "admin", input);
  const repeat = await combinePersonRecords(db, "admin", input);
  expect(repeat).toEqual(first);
  await expect(
    combinePersonRecords(db, "admin", {
      ...input,
      reason: "Different reviewed identity evidence for another action",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("serializes identical concurrent submissions into one receipt", async () => {
  const input = await reviewed(archives);
  const [first, second] = await Promise.all([
    combinePersonRecords(db, "admin", input),
    combinePersonRecords(db, "admin", input),
  ]);
  expect(second).toEqual(first);
  expect((await previewPersonCombine(db, archives)).alreadyTogether).toBe(true);
});

it("rejects an overlapping stale group review after another transaction wins", async () => {
  const first = await reviewed(archives);
  const second = await reviewed({
    sources: [tutor("archive"), tutor("archive-two")],
  });
  const outcomes = await Promise.allSettled([
    combinePersonRecords(db, "admin", first),
    combinePersonRecords(db, "admin", second),
  ]);
  expect(
    outcomes.filter((outcome) => outcome.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    outcomes.find((outcome) => outcome.status === "rejected"),
  ).toMatchObject({ reason: { code: "CONFLICT" } });
  expect(await db.user.count()).toBe(6);
});

it.each([false, true])(
  "waits behind scheduling without a Tutor/Pairing lock inversion (new current assignment=%s)",
  async (newCurrentAssignment) => {
    const input = { ...(await reviewed(archives)), confirmPassword: password };
    const before = await originals();
    let releaseScheduler!: () => void;
    let signalLocked!: (pid: number) => void;
    let rejectLocked!: (error: unknown) => void;
    const release = new Promise<void>((resolve) => {
      releaseScheduler = resolve;
    });
    const locked = new Promise<number>((resolve, reject) => {
      signalLocked = resolve;
      rejectLocked = reject;
    });
    const scheduling = db.$transaction(
      async (tx) => {
        // Match upstream scheduling: period barrier, participant row, then
        // Pairing write. Bound SQL waits so a regression cannot strand fixtures.
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'");
        await lockEntity(tx, "program:period");
        await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id='archive' FOR UPDATE`;
        const backend = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid`;
        signalLocked(backend[0]!.pid);
        await release;
        return tx.pairing.update({
          where: { id: "original-pairing" },
          data: newCurrentAssignment
            ? { termId: "current-term" }
            : { subject: "Scheduled historical subject correction" },
        });
      },
      { timeout: 12000 },
    );
    void scheduling.catch(rejectLocked);
    const schedulerPid = await locked;
    const combining = caller().personCombine.combine(input);
    // Attach rejection handlers before releasing either contender. The real
    // database wait, not a sleep, establishes the contested lock ordering.
    const settled = Promise.allSettled([scheduling, combining]);
    let observedWait = false;
    let outcomes: Awaited<typeof settled>;
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const rows = await db.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE ${schedulerPid} = ANY(pg_blocking_pids(pid))
          ) AS waiting`;
        if (rows[0]?.waiting) {
          observedWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      releaseScheduler();
      outcomes = await settled;
    }
    expect(observedWait).toBe(true);
    expect(outcomes[0].status).toBe("fulfilled");
    if (newCurrentAssignment) {
      // Scheduling may change what staff reviewed while combine waits. Reject
      // that stale intent normally rather than failing with a database deadlock.
      expect(outcomes[1]).toMatchObject({
        status: "rejected",
        reason: { code: "CONFLICT" },
      });
      expect(await db.personCombineReceipt.count()).toBe(0);
      expect(await db.person.count()).toBe(0);
      expect((await previewPersonCombine(db, archives)).requiresHead).toBe(
        true,
      );
    } else {
      expect(outcomes[1]).toMatchObject({
        status: "fulfilled",
        value: { ok: true, outcome: "GROUPED" },
      });
      expect((await previewPersonCombine(db, archives)).alreadyTogether).toBe(
        true,
      );
    }
    expect(
      await db.pairing.findUnique({ where: { id: "original-pairing" } }),
    ).toMatchObject(
      newCurrentAssignment
        ? { termId: "current-term" }
        : { termId: "old", subject: "Scheduled historical subject correction" },
    );
    expect(await originals()).toEqual(before);
  },
  20000,
);

it("rolls back grouping and historical access when durable audit evidence cannot be written", async () => {
  const selection = {
    sources: [user("owner"), tutor("archive"), tutee("past")],
    retainedUserId: "owner",
  };
  const input = await reviewed(selection);
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_person_combine_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation LIKE 'personCombine.%' THEN RAISE EXCEPTION 'test person audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER fail_person_combine_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_person_combine_audit()',
  );
  try {
    await expect(combinePersonRecords(db, "admin", input)).rejects.toThrow();
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER fail_person_combine_audit ON "AuditLog"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION fail_person_combine_audit()");
  }
  expect((await previewPersonCombine(db, selection)).alreadyTogether).toBe(
    false,
  );
  expect(await db.studentProfileOwnership.count()).toBe(0);
  expect(await db.tutorProfileOwnership.count()).toBe(0);
  expect(await combinePersonRecords(db, "admin", input)).toMatchObject({
    ok: true,
  });
});

it("rolls back every identity write and receipt when a source assignment affects no row", async () => {
  const selection = {
    sources: [user("owner"), tutor("archive"), tutee("past")],
    retainedUserId: "owner",
  };
  const admin = caller("admin", "ADMIN");
  const preview = await admin.personCombine.preview(selection);
  const input = {
    ...selection,
    fingerprint: preview.fingerprint,
    reason,
    acknowledged: true as const,
    operationId: randomUUID(),
  };
  const before = await originals();
  const account = await db.user.findUniqueOrThrow({ where: { id: "owner" } });
  // PostgreSQL BEFORE triggers can suppress an UPDATE without throwing. This
  // reproduces an incomplete assignment after Person/User/Tutor writes succeed,
  // exercising the affected-row invariant through the real mutation middleware.
  await db.$executeRawUnsafe(
    `CREATE FUNCTION skip_person_source_assignment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = 'past' AND NEW."personId" IS DISTINCT FROM OLD."personId" THEN RETURN NULL; END IF; RETURN NEW; END $$`,
  );
  try {
    await db.$executeRawUnsafe(
      'CREATE TRIGGER skip_person_source_assignment BEFORE UPDATE OF "personId" ON "Tutee" FOR EACH ROW EXECUTE FUNCTION skip_person_source_assignment()',
    );
    await expect(admin.personCombine.combine(input)).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "Identity source assignment changed. Reload and review the records again.",
    });
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS skip_person_source_assignment ON "Tutee"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION skip_person_source_assignment()");
  }
  expect(await db.person.count()).toBe(0);
  expect(await db.personCombineReceipt.count()).toBe(0);
  expect(await db.tutorProfileOwnership.count()).toBe(0);
  expect(await db.studentProfileOwnership.count()).toBe(0);
  expect(await db.user.findUnique({ where: { id: "owner" } })).toEqual(account);
  expect(await db.tutor.findUnique({ where: { id: "archive" } })).toMatchObject(
    {
      personId: null,
    },
  );
  expect(await db.tutee.findUnique({ where: { id: "past" } })).toMatchObject({
    personId: null,
  });
  expect(await originals()).toEqual(before);
  expect(
    await db.auditLog.count({ where: { action: "Combined person records" } }),
  ).toBe(0);
  // A failed assignment must not poison the operation reference or stale its
  // original review; once the fault is gone the same intent can commit normally.
  expect(await admin.personCombine.combine(input)).toMatchObject({
    ok: true,
    receiptId: input.operationId,
  });
});

it("permits ordinary deletion of a lone initialized account without a Person foreign-key failure", async () => {
  const personId = await syncAccountPerson(db, "owner");
  const preview = await previewDeleteAccount(db, "head", "owner");
  expect(preview.blockers).toEqual([]);
  await deleteAccount(db, "head", {
    userId: "owner",
    fingerprint: preview.fingerprint,
    confirmPassword: password,
  });
  expect(await db.user.findUnique({ where: { id: "owner" } })).toBeNull();
  expect(await db.person.findUnique({ where: { id: personId } })).toMatchObject(
    { primaryUserId: null },
  );
});

it("marks a grouped identity for Head review when later provisioning attaches a second live login", async () => {
  const grouped = await combine({
    sources: [tutor("current-tutor"), tutee("current-tutee")],
  });
  await db.user.update({
    where: { id: "owner" },
    data: { tutorId: "current-tutor" },
  });
  expect(await syncAccountPerson(db, "owner")).toBe(grouped.personId);
  await db.user.update({
    where: { id: "other" },
    data: { studentId: "current-tutee" },
  });
  expect(await syncAccountPerson(db, "other")).toBe(grouped.personId);
  expect(
    await db.person.findUnique({ where: { id: grouped.personId } }),
  ).toMatchObject({
    resolutionState: "REVIEW_REQUIRED",
  });
  expect(await accountHistoryIds(db, "owner")).toEqual(["owner"]);
  expect(await accountHistoryIds(db, "other")).toEqual(["other"]);
  expect(await credentials("other")).toMatchObject({
    passwordHash,
    tuteeMember: false,
  });
});

it("keeps unresolved active participation visible after a historical sibling is linked into a login", async () => {
  const grouped = await combine({
    sources: [tutor("archive"), tutee("current-tutee")],
  });
  expect(grouped.outcome).toBe("REVIEW_REQUIRED");
  const pair = { tutorId: "archive", userId: "owner" };
  await linkTutorHistory(db, "admin", {
    ...pair,
    fingerprint: (await previewTutorHistory(db, pair)).fingerprint,
    reason,
    acknowledged: true,
  });
  const owner = await db.user.findUniqueOrThrow({ where: { id: "owner" } });
  expect(
    await db.person.findUnique({ where: { id: owner.personId! } }),
  ).toMatchObject({ resolutionState: "REVIEW_REQUIRED" });
  expect(
    await db.tutee.findUnique({ where: { id: "current-tutee" } }),
  ).toMatchObject({ personId: owner.personId, status: "ACTIVE" });
  expect(await db.studentProfileOwnership.count()).toBe(0);
  expect(await credentials("owner")).toMatchObject({
    studentId: null,
    tuteeMember: false,
  });
});

it("blocks deletion of a reviewed identity group even when it has no participant history", async () => {
  const result = await combine({
    sources: [user("owner"), user("other")],
    retainedUserId: "owner",
  });
  expect(await db.tutorProfileOwnership.count()).toBe(0);
  expect(await db.studentProfileOwnership.count()).toBe(0);
  const preview = await previewDeleteAccount(db, "head", "owner");
  expect(preview.blockers).toContain("combined");
  await expect(
    deleteAccount(db, "head", {
      userId: "owner",
      fingerprint: preview.fingerprint,
      confirmPassword: password,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.personCombineReceipt.findUnique({
      where: { id: result.receiptId },
    }),
  ).not.toBeNull();
  expect(await db.user.findUnique({ where: { id: "owner" } })).not.toBeNull();
});

it.each(["TUTOR", "TUTEE"] as const)(
  "keeps grouped siblings together on the first %s claim and moves only the corrected owned record",
  async (kind) => {
    const grouped = await combine(archives, "admin");
    const before = await originals();
    const link = async (userId: string, actorId: string) => {
      if (kind === "TUTOR") {
        const pair = { tutorId: "archive", userId };
        await linkTutorHistory(db, actorId, {
          ...pair,
          fingerprint: (await previewTutorHistory(db, pair)).fingerprint,
          reason,
          acknowledged: true,
          confirmPassword: password,
        });
      } else {
        const pair = { tuteeId: "past", userId };
        await linkTuteeHistory(db, actorId, {
          ...pair,
          fingerprint: (await previewHistoryLink(db, pair)).fingerprint,
          reason,
          acknowledged: true,
          confirmPassword: password,
        });
      }
    };
    await link("owner", "admin");
    const owner = await db.user.findUniqueOrThrow({ where: { id: "owner" } });
    const firstTutor = await db.tutor.findUniqueOrThrow({
      where: { id: "archive" },
    });
    const firstTutee = await db.tutee.findUniqueOrThrow({
      where: { id: "past" },
    });
    expect(firstTutor.personId).toBe(owner.personId);
    expect(firstTutee.personId).toBe(owner.personId);
    // Group membership is not a grant to the sibling historical role.
    expect(await db.tutorProfileOwnership.count()).toBe(
      kind === "TUTOR" ? 1 : 0,
    );
    expect(await db.studentProfileOwnership.count()).toBe(
      kind === "TUTEE" ? 1 : 0,
    );
    await link("other", "head");
    const other = await db.user.findUniqueOrThrow({ where: { id: "other" } });
    expect(other.personId).not.toBe(owner.personId);
    const correctedTutor = await db.tutor.findUniqueOrThrow({
      where: { id: "archive" },
    });
    const correctedTutee = await db.tutee.findUniqueOrThrow({
      where: { id: "past" },
    });
    expect(correctedTutor.personId).toBe(
      kind === "TUTOR" ? other.personId : owner.personId,
    );
    expect(correctedTutee.personId).toBe(
      kind === "TUTEE" ? other.personId : owner.personId,
    );
    expect(await accountHistoryIds(db, "owner")).toEqual(["owner"]);
    expect(await accountHistoryIds(db, "other")).toEqual(["other"]);
    expect(await originals()).toEqual(before);
    expect(
      await db.personCombineReceipt.findUnique({
        where: { id: grouped.receiptId },
      }),
    ).not.toBeNull();
  },
);

it("exposes a durable receipt only to the staff actor who accepted that intent", async () => {
  const result = await combine(archives, "admin");
  expect(
    await caller("admin", "ADMIN").personCombine.receipt({
      operationId: result.receiptId,
    }),
  ).toEqual(result);
  expect(
    await caller().personCombine.receipt({ operationId: result.receiptId }),
  ).toBeNull();
  await expect(
    caller("owner", "STUDENT").personCombine.receipt({
      operationId: result.receiptId,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it.each(["TUTOR", "TUTEE"] as const)(
  "requires Head before an unowned %s sibling can leave a group containing another live login",
  async (kind) => {
    await combine(archives, "admin");
    // Claim only the opposite role, leaving the tested source unowned in its group.
    if (kind === "TUTOR") {
      const pair = { tuteeId: "past", userId: "owner" };
      await linkTuteeHistory(db, "admin", {
        ...pair,
        fingerprint: (await previewHistoryLink(db, pair)).fingerprint,
        reason,
        acknowledged: true,
      });
    } else {
      const pair = { tutorId: "archive", userId: "owner" };
      await linkTutorHistory(db, "admin", {
        ...pair,
        fingerprint: (await previewTutorHistory(db, pair)).fingerprint,
        reason,
        acknowledged: true,
      });
    }
    const oldOwner = await db.user.findUniqueOrThrow({
      where: { id: "owner" },
    });
    if (kind === "TUTOR") {
      const pair = { tutorId: "archive", userId: "other" };
      const preview = await previewTutorHistory(db, pair);
      expect(preview.conflict).toBe(true);
      const input = {
        ...pair,
        fingerprint: preview.fingerprint,
        reason,
        acknowledged: true as const,
        confirmPassword: password,
      };
      await expect(linkTutorHistory(db, "admin", input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await linkTutorHistory(db, "head", input);
    } else {
      const pair = { tuteeId: "past", userId: "other" };
      const preview = await previewHistoryLink(db, pair);
      expect(preview.conflict).toBe(true);
      const input = {
        ...pair,
        fingerprint: preview.fingerprint,
        reason,
        acknowledged: true as const,
        confirmPassword: password,
      };
      await expect(linkTuteeHistory(db, "admin", input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await linkTuteeHistory(db, "head", input);
    }
    const newOwner = await db.user.findUniqueOrThrow({
      where: { id: "other" },
    });
    expect(newOwner.personId).not.toBe(oldOwner.personId);
    expect(
      await db.tutor.findUnique({ where: { id: "archive" } }),
    ).toMatchObject({
      personId: kind === "TUTOR" ? newOwner.personId : oldOwner.personId,
    });
    expect(await db.tutee.findUnique({ where: { id: "past" } })).toMatchObject({
      personId: kind === "TUTEE" ? newOwner.personId : oldOwner.personId,
    });
  },
);

it("keeps grouping authority out of archive exports and rejects imported person pointers", async () => {
  const result = await combine(archives, "admin");
  const exported = await caller().recordTransfer.export({});
  expect(
    exported.files.some((file) =>
      /^Person(?:CombineReceipt)?\.csv$/.test(file.name),
    ),
  ).toBe(false);
  for (const name of ["User.csv", "Tutor.csv", "Tutee.csv"]) {
    const file = exported.files.find((row) => row.name === name);
    expect(file).toBeDefined();
    expect(file!.text.split(/\r?\n/)[0]).not.toContain("personId");
  }
  await expect(
    caller().recordTransfer.preview({
      files: [
        {
          name: "Tutor.csv",
          text: recordCsv(
            ["id", "englishName", "personId"],
            [
              {
                id: "archive-two",
                englishName: "Same original name",
                personId: result.personId,
              },
            ],
          ),
        },
      ],
    }),
  ).rejects.toThrow(/personId|column/i);
  expect(
    await db.tutor.findUnique({ where: { id: "archive-two" } }),
  ).toMatchObject({ personId: null });
});

it.each(["password", "email", "forced-change"] as const)(
  "keeps an unfinished %s login selectable without granting archive access or completing credentials",
  async (missing) => {
    await db.user.update({
      where: { id: "owner" },
      data:
        missing === "password"
          ? { passwordHash: null }
          : missing === "email"
            ? { emailVerifiedAt: null }
            : { mustChangePassword: true },
    });
    const before = await credentials("owner");
    const selection = {
      sources: [user("owner"), tutor("archive")],
      retainedUserId: "owner",
    };
    const preview = await previewPersonCombine(db, selection);
    expect(
      preview.accounts.find((account) => account.id === "owner"),
    ).toMatchObject({ ready: false });
    expect(await combine(selection)).toMatchObject({
      outcome: "REVIEW_REQUIRED",
      retiredUserIds: [],
    });
    expect(await credentials("owner")).toEqual(before);
    expect(
      await db.tutorProfileOwnership.findUnique({
        where: { tutorId: "archive" },
      }),
    ).toBeNull();
  },
);

it("projects actionable participation IDs and deadlines without changing the review or exposing payloads", async () => {
  const grouped = await combine({ sources: [user("owner"), user("other")] });
  const dueAt = new Date("2099-10-01");
  await db.crewStatusRequest.create({ data: { userId: "other", kind: "OPT_OUT", reason: "private request content", eligibleAt: dueAt } });
  const before = await db.person.findUniqueOrThrow({ where: { id: grouped.personId } });
  const review = await caller().personCombine.review({ personId: grouped.personId, retainedUserId: "owner" });
  expect(review.personId).toBe(grouped.personId);
  expect(review.blockers).toEqual(expect.arrayContaining([
    expect.objectContaining({ reason: "MULTIPLE_LIVE_LOGINS", sources: [user("other"), user("owner")], blocksFinalization: true }),
    expect.objectContaining({ reason: "PENDING_CREW_REQUEST", destination: "/admin/crew", work: [expect.objectContaining({ kind: "CREW_REQUEST", dueAt: null, availableAt: dueAt })] }),
  ]));
  expect(JSON.stringify(review)).not.toContain("private request content");
  expect(await db.person.findUniqueOrThrow({ where: { id: grouped.personId } })).toEqual(before);
  expect(await db.personCombineReceipt.count()).toBe(1);
});

it("refuses remaining active work, then explicitly finalizes a fresh review without rewriting evidence", async () => {
  const assignment = await currentAssignment("TUTOR");
  const grouped = await combine(archives);
  const original = await originals();
  const selection = { personId: grouped.personId };
  const blocked = await reviewPersonParticipation(db, selection);
  expect(blocked.blockers).toEqual(expect.arrayContaining([
    expect.objectContaining({ reason: "CURRENT_ASSIGNMENT", work: [{ kind: "PAIRING", id: assignment.id, dueAt: null }], blocksFinalization: true }),
  ]));
  await expect(finalizePersonParticipation(db, "head", {
    ...selection, fingerprint: blocked.fingerprint, reason, acknowledged: true, operationId: randomUUID(), confirmPassword: password,
  })).rejects.toMatchObject({ code: "CONFLICT" });
  // Existing scheduling workflow resolves the work; a refresh alone cannot clear state.
  await db.pairing.delete({ where: { id: assignment.id } });
  const ready = await reviewPersonParticipation(db, selection);
  expect(ready.outcome).toBe("GROUPED");
  expect((await db.person.findUniqueOrThrow({ where: { id: grouped.personId } })).resolutionState).toBe("REVIEW_REQUIRED");
  const input = { ...selection, fingerprint: ready.fingerprint, reason, acknowledged: true as const, operationId: randomUUID() };
  const result = await caller("admin", "ADMIN").personCombine.finalize(input);
  expect(result).toMatchObject({ personId: grouped.personId, outcome: "GROUPED", retiredUserIds: [] });
  expect(await caller("admin", "ADMIN").personCombine.receipt({ operationId: input.operationId })).toEqual(result);
  expect(await caller("admin", "ADMIN").personCombine.finalize(input)).toEqual(result);
  // The domain decision is single-use; transport audit also records the retry
  // as NO_CHANGE without another finalization, ownership write, or receipt.
  expect(await db.auditLog.count({ where: { operation: "personCombine.finalize", entity: "Person" } })).toBe(1);
  expect(await db.auditLog.count({ where: { operation: "personCombine.finalize", entity: "personCombine", details: { path: ["outcome"], equals: "NO_CHANGE" } } })).toBe(1);
  expect(await originals()).toEqual(original);
});

it("requires explicit safe retirement and current Head authority while finalizing separate private logins", async () => {
  const grouped = await combine({ sources: [user("owner"), user("other")] });
  const selection = { personId: grouped.personId, retainedUserId: "owner", retireDuplicateLogins: true };
  const review = await reviewPersonParticipation(db, selection);
  const input = { ...selection, fingerprint: review.fingerprint, reason, acknowledged: true as const, operationId: randomUUID(), confirmPassword: password };
  await expect(finalizePersonParticipation(db, "admin", input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(finalizePersonParticipation(db, "head", { ...input, confirmPassword: "wrong" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await accountHistoryIds(db, "owner")).toEqual(["owner"]);
  const result = await finalizePersonParticipation(db, "head", input);
  expect(result).toMatchObject({ outcome: "GROUPED", retiredUserIds: ["other"] });
  expect((await accountHistoryIds(db, "owner")).sort()).toEqual(["other", "owner"]);
  expect(await finalizePersonParticipation(db, "head", input)).toEqual(result);
});

it("binds finalization to current membership and source revisions rather than a grouping fingerprint", async () => {
  const grouped = await combine({ sources: [user("owner"), user("other")] });
  const selection = { personId: grouped.personId, retainedUserId: "owner", retireDuplicateLogins: true };
  const oldReview = await reviewPersonParticipation(db, selection);
  await db.person.update({ where: { id: grouped.personId }, data: { revision: { increment: 1 } } });
  const input = { ...selection, reason, acknowledged: true as const, operationId: randomUUID(), confirmPassword: password };
  await expect(finalizePersonParticipation(db, "head", { ...input, fingerprint: oldReview.fingerprint })).rejects.toMatchObject({ code: "CONFLICT" });
  const grouping = await previewPersonCombine(db, { sources: [user("owner"), user("other")], retainedUserId: "owner", retireDuplicateLogins: true });
  await expect(finalizePersonParticipation(db, "head", { ...input, fingerprint: grouping.fingerprint })).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await db.person.findUniqueOrThrow({ where: { id: grouped.personId } })).resolutionState).toBe("REVIEW_REQUIRED");
  expect(await db.personCombineReceipt.count()).toBe(1);
});

it("rolls back finalization state, retirement and receipt when its audit fails", async () => {
  const grouped = await combine({ sources: [user("owner"), user("other")] });
  const selection = { personId: grouped.personId, retainedUserId: "owner", retireDuplicateLogins: true };
  const review = await reviewPersonParticipation(db, selection);
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_finalize_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation = 'personCombine.finalize' THEN RAISE EXCEPTION 'finalize audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER fail_finalize_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_finalize_audit()');
  try {
    await expect(finalizePersonParticipation(db, "head", { ...selection, fingerprint: review.fingerprint, reason, acknowledged: true, operationId: randomUUID(), confirmPassword: password })).rejects.toThrow();
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_finalize_audit ON "AuditLog"');
    await db.$executeRawUnsafe('DROP FUNCTION fail_finalize_audit()');
  }
  expect((await db.person.findUniqueOrThrow({ where: { id: grouped.personId } })).resolutionState).toBe("REVIEW_REQUIRED");
  expect((await db.user.findUniqueOrThrow({ where: { id: "other" } })).mergedIntoId).toBeNull();
  expect(await db.personCombineReceipt.count()).toBe(1);
});

it.each(["COORDINATOR", "STUDENT", "VIEWER"] as const)("denies %s review and finalization through the live authorization boundary", async (role) => {
  const grouped = await combine({ sources: [user("owner"), user("other")] });
  await db.user.update({ where: { id: "admin" }, data: { role } });
  // The claimed session remains ADMIN; procedures must consult the saved role.
  await expect(caller("admin", "ADMIN").personCombine.review({ personId: grouped.personId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller("admin", "ADMIN").personCombine.finalize({ personId: grouped.personId, fingerprint: "a".repeat(64), reason, acknowledged: true, operationId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await db.person.findUniqueOrThrow({ where: { id: grouped.personId } })).resolutionState).toBe("REVIEW_REQUIRED");
});

it("rejects newly introduced work after review and preserves the original request deadline", async () => {
  const grouped = await combine({ sources: [user("owner"), user("other")] });
  const selection = { personId: grouped.personId, retainedUserId: "owner", retireDuplicateLogins: true };
  const review = await reviewPersonParticipation(db, selection);
  const deadline = new Date("2099-10-01T00:00:00Z");
  const intake = await db.studentSurvey.create({ data: {
    email: "other@example.test", intakeTermId: "current-term", payload: { private: "do not expose" },
    policyRevision: "original", policySnapshot: {}, tokenHash: "operational-review-private-proof",
    verificationDueAt: deadline, expiresAt: deadline,
  } });
  await expect(finalizePersonParticipation(db, "head", { ...selection, fingerprint: review.fingerprint, reason, acknowledged: true, operationId: randomUUID(), confirmPassword: password })).rejects.toMatchObject({ code: "CONFLICT" });
  const fresh = await reviewPersonParticipation(db, selection);
  expect(fresh.blockers).toEqual(expect.arrayContaining([
    expect.objectContaining({ reason: "UNCONFIRMED_INTAKE", sources: [user("other")], blocksFinalization: true, work: [{ kind: "STUDENT_SURVEY", id: intake.id, dueAt: deadline }] }),
  ]));
  expect(JSON.stringify(fresh)).not.toContain("do not expose");
  expect(JSON.stringify(fresh)).not.toContain("operational-review-private-proof");
  expect(await db.studentSurvey.findUnique({ where: { id: intake.id } })).toEqual(intake);
});
