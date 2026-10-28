import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import superjson from "superjson";
import type { Prisma } from "../../../generated/prisma";
import type * as NotificationModule from "~/server/notifications/create";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/notifications/create", async (importOriginal) => ({
  ...await importOriginal<typeof NotificationModule>(),
  notifyAdmins: vi.fn(),
  notifyUsers: vi.fn(),
}));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn().mockResolvedValue(undefined) },
  isEmailDeliveryAvailable: () => true,
  isEmailConfigured: () => true,
}));
vi.mock("~/server/rate-limit", () => ({ rateLimit: () => ({ ok: true }) }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  DEFAULT_NAME_FIELDS,
  NAME_FIELD_KEYS,
  type NameFieldStates,
  type NameAccountType,
} from "~/lib/name-field-policy";
import { updateAccountProfile } from "~/server/account-profile";
import { configuredNewNames } from "~/server/program/name-fields";
import {
  startViewerSignup,
  verifyViewerCode,
  completeViewerSignup,
} from "~/server/auth/viewer-signup";
import {
  registrationCompletionProof,
  completeRegistration,
  setEmailVerification,
  confirmEmailCode,
} from "~/server/auth/registration";
import { hashPassword } from "~/server/auth/password";
import { promoteApplicantToTutor } from "~/server/tutors/promote";
import { currentPolicy } from "~/server/policy-acceptance";
import {
  submitSurvey,
  surveyInput,
  confirmSurvey,
} from "~/server/student-survey";
import { emailSender } from "~/server/email/sender";
import { stageCrewVerification } from "~/server/crew/signup";
import { issueRegistrationCode } from "~/server/auth/registration";
import { fingerprint, queueProposal } from "~/server/approvals";

/** Reconstruct an old Admin request without calling today's direct mutation. */
async function legacyCalendarProposal(operation: string, input: unknown) {
  const request = await queueProposal({ user: { id: "program-review-ADMIN", name: "Original Admin" }, role: "ADMIN", tutorId: null, expires: "2099-01-01" }, operation, input);
  const targets = request.targets as Record<string, Prisma.InputJsonValue>;
  delete targets.reviewPolicyVersion;
  targets.reviewAuthority = { category: "SIGNIFICANT_SETTING", directRoles: ["HEAD"], requesterRoles: ["ADMIN", "HEAD"], reviewerRoles: ["HEAD"] };
  return db.approvalRequest.update({ where: { id: request.id }, data: { targets, fingerprint: fingerprint(targets) } });
}

// Guard during module evaluation, before any destructive fixture or teardown is registered.
assertIsolatedTestDatabase(process.env.DATABASE_URL);
const caller = (
  role: Session["role"] = "HEAD",
  id = `program-review-${role}`,
  tutorId: string | null = null,
) =>
  createCaller({
    db,
    headers: new Headers(),
    session: { user: { id, name: role }, role, tutorId, expires: "2099-01-01" },
  });
const hidden = Object.fromEntries(
  NAME_FIELD_KEYS.map((key) => [key, "hidden"]),
) as NameFieldStates;
const setNames = async (
  accountType: NameAccountType,
  states: NameFieldStates,
) => {
  const policy = await caller().program.nameFieldSettings();
  return caller().program.setNameFields({
    accountType,
    states,
    expectedVersion: policy.version,
  });
};
beforeEach(async () => {
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  for (const role of [
    "HEAD",
    "ADMIN",
    "COORDINATOR",
    "STUDENT",
    "VIEWER",
  ] as const)
    await db.user.create({
      data: {
        id: `program-review-${role}`,
        role,
        name: role,
        username: `review${role.toLowerCase()}`,
        email: `${role}@example.test`,
      },
    });
  await db.term.create({
    data: {
      id: "program-review-term",
      active: true,
      schoolYear: "26-27",
      quarter: "Q1",
      name: "Review Q1",
    },
  });
});
afterAll(() => db.$disconnect());

it("keeps tutoring notices independent from school days and prevents stale delete/recreate writes", async () => {
  await db.schoolCalendarDay.create({
    data: { date: "2026-10-12", isSchoolDay: true, note: "Appeal school day" },
  });
  const first = await caller().program.setCalendarDay({
    date: "2026-10-12",
    reason: "Exam preparation",
    expectedVersion: 0,
  });
  await caller().program.removeCalendarDay({
    date: first.date,
    expectedVersion: first.version,
  });
  await expect(
    caller().program.setCalendarDay({
      date: first.date,
      reason: "Stale",
      expectedVersion: 0,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await caller().program.setCalendarDay({
    date: first.date,
    reason: "Updated notice",
    expectedVersion: 2,
  });
  expect(await caller("STUDENT").program.calendar()).toEqual([
    { date: first.date, endDate: first.date, reason: "Updated notice" },
  ]);
  expect(
    await db.schoolCalendarDay.findUnique({ where: { date: first.date } }),
  ).toMatchObject({ isSchoolDay: true, note: "Appeal school day" });
  await expect(
    caller().program.setCalendarDay({
      date: "2026-02-30",
      reason: "Invalid",
      expectedVersion: 0,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller().program.setCalendarDay({
      date: "2026-02-28",
      reason: " ",
      expectedVersion: 0,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
it("stores inclusive ranges as independent notices and versions endpoint changes", async () => {
  const first = await caller().program.setCalendarDay({
    date: "2026-10-12",
    endDate: "2026-10-16",
    reason: "Exam week",
    expectedVersion: 0,
  });
  await caller().program.setCalendarDay({
    date: "2026-10-14",
    endDate: "2026-10-18",
    reason: "Campus closure",
    expectedVersion: 0,
  });
  expect(await caller("STUDENT").program.calendar()).toEqual([
    { date: "2026-10-12", endDate: "2026-10-16", reason: "Exam week" },
    { date: "2026-10-14", endDate: "2026-10-18", reason: "Campus closure" },
  ]);
  expect(await db.schoolCalendarDay.count()).toBe(0);
  const updated = await caller().program.setCalendarDay({
    date: first.date,
    endDate: "2026-10-20",
    reason: first.reason,
    expectedVersion: first.version,
  });
  expect(updated).toMatchObject({
    endDate: "2026-10-20",
    version: first.version + 1,
  });
  await expect(
    caller().program.setCalendarDay({
      date: first.date,
      endDate: "2026-10-19",
      reason: first.reason,
      expectedVersion: first.version,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    caller().program.setCalendarDay({
      date: first.date,
      endDate: "2026-10-11",
      reason: first.reason,
      expectedVersion: updated.version,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await caller().program.removeCalendarDay({
    date: first.date,
    expectedVersion: updated.version,
  });
  expect(await caller("STUDENT").program.calendar()).toHaveLength(1);
  await expect(
    caller().program.setCalendarDay({
      date: first.date,
      endDate: "2026-10-20",
      reason: first.reason,
      expectedVersion: 0,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const recreated = await caller().program.setCalendarDay({
    date: first.date,
    endDate: "2026-10-21",
    reason: first.reason,
    expectedVersion: updated.version + 1,
  });
  expect(recreated).toMatchObject({
    active: true,
    endDate: "2026-10-21",
    version: updated.version + 2,
  });
});

it("requires Admin review for Coordinator ranges and refuses a changed range proposal", async () => {
  await expect(
    caller("COORDINATOR").program.setCalendarDay({
      date: "2026-10-12",
      endDate: "2026-10-16",
      reason: "Exam week",
      expectedVersion: 0,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const request = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "program.setCalendarDay" },
  });
  expect(await caller("STUDENT").program.calendar()).toEqual([]);
  await caller("ADMIN").approval.decide({
    id: request.id,
    approve: true,
    note: "Reviewed dates",
  });
  const first = await db.programCalendarDay.findUniqueOrThrow({
    where: { date: "2026-10-12" },
  });
  expect(first.endDate).toBe("2026-10-16");
  await expect(
    caller("COORDINATOR").program.setCalendarDay({
      date: first.date,
      endDate: "2026-10-17",
      reason: first.reason,
      expectedVersion: first.version,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const pending = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "program.setCalendarDay", state: "PENDING" },
  });
  await caller().program.setCalendarDay({
    date: first.date,
    endDate: "2026-10-18",
    reason: first.reason,
    expectedVersion: first.version,
  });
  await expect(
    caller().approval.decide({
      id: pending.id,
      approve: true,
      note: "Reviewed dates",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("applies an unchanged legacy queued single-day edit after the additive range migration", async () => {
  const first = await caller().program.setCalendarDay({
    date: "2026-10-12",
    reason: "Original notice",
    expectedVersion: 0,
  });
  const legacyInput = {
    date: first.date,
    reason: "Legacy reviewed notice",
    expectedVersion: first.version,
  };
  const request = await legacyCalendarProposal("program.setCalendarDay", legacyInput);
  // Recreate the stored pre-migration payload. Its immutable target evidence has
  // the old row shape, even though the migrated database now has an endpoint.
  expect(request.targets).toMatchObject({
    programCalendar: [{ date: first.date }],
  });
  expect(
    (request.targets as { programCalendar: unknown[] }).programCalendar[0],
  ).not.toHaveProperty("endDate");
  await db.approvalRequest.update({
    where: { id: request.id },
    data: {
      payload: superjson.serialize(
        legacyInput,
      ) as unknown as Prisma.InputJsonValue,
    },
  });
  await caller().approval.decide({
    id: request.id,
    approve: true,
    note: "Legacy notice checked",
  });
  expect(await caller("STUDENT").program.calendar()).toEqual([
    { date: first.date, endDate: first.date, reason: legacyInput.reason },
  ]);
});
it("applies an unchanged legacy queued removal and retains the range tombstone", async () => {
  const first = await caller().program.setCalendarDay({
    date: "2026-10-12",
    reason: "Legacy removal",
    expectedVersion: 0,
  });
  const request = await legacyCalendarProposal("program.removeCalendarDay", {
      date: first.date,
      expectedVersion: first.version,
  });
  // Removal payloads never gained an endpoint; unchanged single-day target
  // evidence must remain valid across deployment, just like legacy edit evidence.
  expect(
    (request.targets as { programCalendar: unknown[] }).programCalendar[0],
  ).not.toHaveProperty("endDate");
  await caller().approval.decide({
    id: request.id,
    approve: true,
    note: "Legacy removal checked",
  });
  expect(await caller("STUDENT").program.calendar()).toEqual([]);
  expect(
    await db.programCalendarDay.findUniqueOrThrow({
      where: { date: first.date },
    }),
  ).toMatchObject({
    date: first.date,
    endDate: first.date,
    active: false,
    version: first.version + 1,
  });
});
it("queues Coordinator notices, denies participant writes and rejects a proposal after the notice changes", async () => {
  await expect(
    caller("STUDENT").program.setCalendarDay({
      date: "2026-10-12",
      reason: "No authority",
      expectedVersion: 0,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller("COORDINATOR").program.setCalendarDay({
      date: "2026-10-12",
      reason: "Proposed",
      expectedVersion: 0,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await caller("STUDENT").program.calendar()).toEqual([]);
  const proposal = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "program.setCalendarDay" },
  });
  await caller().program.setCalendarDay({
    date: "2026-10-12",
    reason: "Head's applied notice",
    expectedVersion: 0,
  });
  await expect(
    caller().approval.decide({
      id: proposal.id,
      approve: true,
      note: "Reviewed notice",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await caller("STUDENT").program.calendar())[0]?.reason).toBe(
    "Head's applied notice",
  );
});
it("persists program room order for 20+ rooms while keeping patrol order independent", async () => {
  for (let index = 0; index < 22; index++)
    await caller("ADMIN").admin.createRoom({
      name: `Room ${String(index).padStart(2, "0")}`,
    });
  const before = await caller("ADMIN").admin.rooms();
  await db.room.update({
    where: { id: before[0]!.id },
    data: { patrolOrder: 99 },
  });
  const ids = before.map((room) => room.id).reverse();
  await caller("ADMIN").admin.reorderRooms({
    ids,
    expectedIds: before.map((room) => room.id),
  });
  expect((await caller("VIEWER").admin.rooms()).map((room) => room.id)).toEqual(
    ids,
  );
  expect(
    (await db.room.findUniqueOrThrow({ where: { id: before[0]!.id } }))
      .patrolOrder,
  ).toBe(99);
  const appended = await caller("ADMIN").admin.createRoom({
    name: "Alphabetically earlier",
  });
  expect((await caller("ADMIN").admin.rooms()).at(-1)?.id).toBe(appended.id);
  await expect(
    caller("VIEWER").admin.reorderRooms({ ids, expectedIds: ids }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller("ADMIN").admin.reorderRooms({ ids, expectedIds: ids }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("serializes competing complete room orders and rejects duplicate/missing catalog IDs", async () => {
  const a = await caller("ADMIN").admin.createRoom({ name: "A" });
  const b = await caller("ADMIN").admin.createRoom({ name: "B" });
  const c = await caller("ADMIN").admin.createRoom({ name: "C" });
  const expectedIds = [a.id, b.id, c.id];
  await expect(
    caller("ADMIN").admin.reorderRooms({
      ids: [a.id, a.id, c.id],
      expectedIds,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller("ADMIN").admin.reorderRooms({ ids: [a.id, b.id], expectedIds }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const races = await Promise.allSettled([
    caller("ADMIN").admin.reorderRooms({
      ids: [b.id, a.id, c.id],
      expectedIds,
    }),
    caller("ADMIN").admin.reorderRooms({
      ids: [c.id, b.id, a.id],
      expectedIds,
    }),
  ]);
  expect(races.filter((result) => result.status === "fulfilled")).toHaveLength(
    1,
  );
  expect(races.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
});
it("captures one complete room order for Coordinator review and rejects stale requests before queuing", async () => {
  const a = await caller("ADMIN").admin.createRoom({ name: "Original Alpha" });
  const b = await caller("ADMIN").admin.createRoom({ name: "Original Beta" });
  await expect(
    caller("COORDINATOR").admin.reorderRooms({
      ids: [b.id, a.id],
      expectedIds: [a.id, b.id],
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const proposal = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "admin.reorderRooms" },
  });
  expect((await caller("ADMIN").admin.rooms()).map((room) => room.id)).toEqual([
    a.id,
    b.id,
  ]);
  await caller("ADMIN").admin.reorderRooms({
    ids: [b.id, a.id],
    expectedIds: [a.id, b.id],
  });
  await expect(
    caller("COORDINATOR").admin.reorderRooms({
      ids: [b.id, a.id],
      expectedIds: [a.id, b.id],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    caller().approval.decide({
      id: proposal.id,
      approve: true,
      note: "Reviewed",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.approvalRequest.count({
      where: { operation: "admin.reorderRooms" },
    }),
  ).toBe(1);
});
it("retains original hidden names, enforces the current role and reserves neutral nameless handles", async () => {
  const tutor = await db.tutor.create({
    data: {
      firstName: "Original",
      lastName: "Tutor",
      englishName: "Original Tutor",
      username: "linkedhandle",
    },
  });
  const user = await db.user.create({
    data: {
      id: "mixed-role",
      role: "STUDENT",
      email: "mixed@example.test",
      firstName: "Original",
      lastName: "Person",
      preferredName: "Alias",
      name: "Original Person",
      tutorId: tutor.id,
      crewStatus: "ACTIVE",
    },
  });
  await setNames("TUTOR", { ...DEFAULT_NAME_FIELDS, lastName: "required" });
  await setNames("STUDENT", hidden);
  const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(stored).toMatchObject({
    firstName: "Original",
    lastName: "Person",
    preferredName: "Alias",
    username: "linkedhandle",
    name: "linkedhandle",
  });
  expect(
    await caller("STUDENT", user.id, tutor.id).program.nameFieldsForProfile({}),
  ).toMatchObject({ accountType: "STUDENT", states: hidden });
  await updateAccountProfile(db, user.id, {
    firstName: "Forged",
    lastName: "Forged",
    preferredName: "Forged",
    alternativeNames: "Forged",
    expectedProfileVersion: stored.profileVersion,
  });
  const unchanged = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(unchanged).toMatchObject({
    firstName: "Original",
    lastName: "Person",
    preferredName: "Alias",
    name: "linkedhandle",
  });
  await updateAccountProfile(
    db,
    user.id,
    { firstName: "Reviewed", expectedProfileVersion: unchanged.profileVersion },
    { management: true },
  );
  expect(
    await db.user.findUniqueOrThrow({ where: { id: user.id } }),
  ).toMatchObject({ firstName: "Reviewed", name: "linkedhandle" });
  const noNames = await configuredNewNames(
    db,
    {
      firstName: "非拉丁",
      lastName: "Posted",
      preferredName: "Alias",
      alternativeNames: "原始",
    },
    "STUDENT",
  );
  expect(noNames).toMatchObject({
    firstName: "",
    lastName: "",
    preferredName: null,
  });
});
it("refreshes linked labels when a management account is inserted onto a Tutor with different role policy", async () => {
  await setNames("TUTOR", hidden);
  const tutor = await db.tutor.create({
    data: {
      firstName: "Lena",
      lastName: "Chen",
      englishName: "Lena Chen",
      username: "lenahandle",
    },
  });
  expect(tutor.englishName).toBe("lenahandle");
  await db.user.create({
    data: {
      role: "ADMIN",
      email: "linked-admin@example.test",
      username: "lenahandle",
      tutorId: tutor.id,
      firstName: "Lena",
      lastName: "Chen",
      name: "Lena Chen",
    },
  });
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: tutor.id } })).englishName,
  ).toBe("Lena Chen");
});
it("requires new last/preferred fields on later legacy profile edits without guessing a split", async () => {
  const legacy = await db.user.create({
    data: {
      role: "STUDENT",
      name: "张小明",
      legacyName: "张小明",
      email: "legacy@example.test",
      username: "legacyhandle",
    },
  });
  await updateAccountProfile(db, legacy.id, {
    alternativeNames: "保留原始名字",
  });
  await setNames("STUDENT", {
    ...DEFAULT_NAME_FIELDS,
    lastName: "required",
    preferredName: "required",
  });
  await expect(
    updateAccountProfile(db, legacy.id, { alternativeNames: "仍然保留" }),
  ).rejects.toMatchObject({ message: "PROFILE_NAME_FIELDS_REQUIRED" });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: legacy.id } }),
  ).toMatchObject({
    firstName: null,
    legacyName: "张小明",
    alternativeNames: "保留原始名字",
  });
});
it("does not classify a preferred-only structured identity as an unsplit legacy exception", async () => {
  const user = await db.user.create({
    data: {
      role: "STUDENT",
      email: "preferred-only@example.test",
      username: "preferredhandle",
      preferredName: "Alias",
      legacyName: "Original alias",
    },
  });
  await expect(
    updateAccountProfile(db, user.id, { alternativeNames: "原始别名" }),
  ).rejects.toMatchObject({ message: "PROFILE_NAME_FIELDS_REQUIRED" });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: user.id } }),
  ).toMatchObject({
    firstName: null,
    preferredName: "Alias",
    alternativeNames: null,
  });
});
it("grandfathers a previously accepted Viewer intake through tightening and applies new requirements to later edits", async () => {
  const stage = await startViewerSignup(
    {
      email: "accepted@example.test",
      name: "Ada",
      firstName: "Ada",
      lastName: "",
      affiliation: "School",
    },
    db,
  );
  if (!stage.ok) throw new Error("Expected staged Viewer intake");
  await setNames("VIEWER", { ...DEFAULT_NAME_FIELDS, lastName: "required" });
  await verifyViewerCode("accepted@example.test", stage.code);
  const source = await db.viewerSignup.findUniqueOrThrow({
    where: { email: "accepted@example.test" },
  });
  const proof = registrationCompletionProof(
    "viewer",
    source.id,
    source.codeHash,
    source.verifiedAt!,
  );
  await expect(
    completeViewerSignup(source.email, "TestPassword123", proof, db),
  ).resolves.toMatchObject({ ok: true });
  const user = await db.user.findUniqueOrThrow({
    where: { email: source.email },
  });
  expect(user).toMatchObject({ firstName: "Ada", lastName: "" });
  await expect(
    updateAccountProfile(db, user.id, { firstName: "Ada", lastName: "" }),
  ).rejects.toMatchObject({ message: "PROFILE_NAME_FIELDS_REQUIRED" });
});
it("allocates a unique nameless Viewer handle at creation without inventing original names", async () => {
  await setNames("VIEWER", hidden);
  await db.user.create({
    data: {
      role: "ADMIN",
      name: "Existing member handle",
      email: "taken@example.test",
      username: "member",
    },
  });
  const stage = await startViewerSignup(
    {
      email: "nameless@example.test",
      name: "",
      firstName: "",
      lastName: "",
      affiliation: "School",
    },
    db,
  );
  if (!stage.ok) throw new Error("Expected staged Viewer intake");
  await verifyViewerCode("nameless@example.test", stage.code);
  const source = await db.viewerSignup.findUniqueOrThrow({
    where: { email: "nameless@example.test" },
  });
  await completeViewerSignup(
    source.email,
    "TestPassword123",
    registrationCompletionProof(
      "viewer",
      source.id,
      source.codeHash,
      source.verifiedAt!,
    ),
    db,
  );
  const user = await db.user.findUniqueOrThrow({
    where: { email: source.email },
  });
  expect(user.username).toBe("memberb");
  expect(user.name).toBe("memberb");
  expect(user.firstName).toBe("");
  expect(user.legacyName).toBeNull();
});
it("refreshes detached and relinked rosters under their resulting policies", async () => {
  await setNames("TUTOR", hidden);
  await setNames("STUDENT", hidden);
  const a = await db.tutor.create({
    data: { firstName: "First", englishName: "First", username: "firsthandle" },
  });
  const b = await db.tutor.create({
    data: {
      firstName: "Second",
      englishName: "Second",
      username: "secondhandle",
    },
  });
  const tutee = await db.tutee.create({
    data: { firstName: "Student", englishName: "Student" },
  });
  const owner = await db.user.create({
    data: {
      role: "ADMIN",
      email: "roster-owner@example.test",
      username: "ownerhandle",
      firstName: "Owner",
      tutorId: a.id,
      studentId: tutee.id,
    },
  });
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: a.id } })).englishName,
  ).toBe("First");
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: tutee.id } })).englishName,
  ).toBe("Student");
  await db.user.update({
    where: { id: owner.id },
    data: { tutorId: b.id, studentId: null },
  });
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: a.id } })).englishName,
  ).toBe("firsthandle");
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: b.id } })).englishName,
  ).toBe("Second");
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: tutee.id } }),
  ).toMatchObject({ englishName: "", firstName: "Student" });
  await db.user.delete({ where: { id: owner.id } });
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: b.id } })).englishName,
  ).toBe("secondhandle");
});
it("reserves fallback handles atomically on a role change and both sides of leadership transfer", async () => {
  const password = "ReviewTestPassword42";
  await db.user.update({
    where: { id: "program-review-HEAD" },
    data: { passwordHash: hashPassword(password) },
  });
  await setNames("ADMIN", hidden);
  await setNames("HEAD", hidden);
  const legacy = await db.user.create({
    data: { role: "VIEWER", name: "Legacy", email: "legacy-role@example.test" },
  });
  expect(legacy.username).toBeNull();
  await caller().admin.setUserRole({
    userId: legacy.id,
    role: "ADMIN",
    confirmPassword: password,
  });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: legacy.id } }),
  ).toMatchObject({ username: "member", name: "member", legacyName: "Legacy" });
  // A preexisting account created while its role still displayed names needs a handle only on promotion.
  await setNames("COORDINATOR", DEFAULT_NAME_FIELDS);
  const next = await db.user.create({
    data: {
      role: "COORDINATOR",
      firstName: "Next",
      name: "Next",
      email: "next-head@example.test",
    },
  });
  await caller().admin.transferHead({
    userId: next.id,
    confirmPassword: password,
  });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: next.id } }),
  ).toMatchObject({
    role: "HEAD",
    username: "memberb",
    name: "memberb",
    firstName: "Next",
  });
});
it("preserves accepted tutor names through hidden-policy redemption and rejects posted replacement identities", async () => {
  const app = await db.tutorApplication.create({
    data: {
      name: "Accepted Person",
      firstName: "Accepted",
      lastName: "Person",
      alternativeNames: "原始名字",
      email: "accepted-tutor@example.test",
      type: "INITIAL",
      status: "ACCEPTED",
    },
  });
  await promoteApplicantToTutor(app.id);
  const row = await db.registrationCode.findFirstOrThrow({
    where: { applicationId: app.id },
  });
  await setNames("TUTOR", hidden);
  const staged = await setEmailVerification(
    { ...row, code: row.code! },
    row.email!,
  );
  if (!staged.ok) throw Error("Expected challenge");
  const challenged = await db.registrationCode.findUniqueOrThrow({
    where: { id: row.id },
  });
  const verified = await confirmEmailCode(
    { ...challenged, code: challenged.code! },
    staged.emailCode,
  );
  if (!verified.ok) throw Error("Expected verified invitation");
  const live = await db.registrationCode.findUniqueOrThrow({
    where: { id: row.id },
  });
  await completeRegistration(
    { ...live, code: live.code! },
    {
      completionProof: verified.completionProof,
      firstName: "Forged",
      lastName: "Replacement",
      alternativeNames: "Forged",
      password: "TestPassword123",
    },
  );
  expect(
    await db.user.findUniqueOrThrow({ where: { email: row.email! } }),
  ).toMatchObject({
    firstName: "Accepted",
    lastName: "Person",
    alternativeNames: "原始名字",
    name: "aperson",
  });
  expect(
    await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } }),
  ).toMatchObject({
    name: "Accepted Person",
    firstName: "Accepted",
    lastName: "Person",
  });
});
it.each(["TUTOR", "CREW"] as const)(
  "grandfathers accepted %s source through a newly Required last name at redemption",
  async (kind) => {
    const email = `accepted-${kind.toLowerCase()}-required@example.test`;
    const source =
      kind === "TUTOR"
        ? await db.tutorApplication.create({
            data: {
              name: "Accepted",
              firstName: "Accepted",
              lastName: "",
              email,
              status: "ACCEPTED",
            },
          })
        : await db.crewApplication.create({
            data: {
              name: "Accepted",
              firstName: "Accepted",
              lastName: "",
              email,
              status: "ACCEPTED",
            },
          });
    const issued = await issueRegistrationCode(
      {
        kind,
        email,
        ...(kind === "TUTOR"
          ? { applicationId: source.id }
          : { crewApplicationId: source.id }),
      },
      db,
    );
    await setNames(kind, { ...DEFAULT_NAME_FIELDS, lastName: "required" });
    let row = await db.registrationCode.findUniqueOrThrow({
      where: { id: issued.id },
    });
    const staged = await setEmailVerification(
      { ...row, code: row.code! },
      email,
    );
    if (!staged.ok) throw Error("Expected challenge");
    row = await db.registrationCode.findUniqueOrThrow({
      where: { id: issued.id },
    });
    const verified = await confirmEmailCode(
      { ...row, code: row.code! },
      staged.emailCode,
    );
    if (!verified.ok) throw Error("Expected verified invitation");
    row = await db.registrationCode.findUniqueOrThrow({
      where: { id: issued.id },
    });
    await expect(
      completeRegistration(
        { ...row, code: row.code! },
        {
          completionProof: verified.completionProof,
          firstName: "Replacement",
          lastName: "Posted",
          password: "TestPassword123",
        },
      ),
    ).resolves.toMatchObject({ ok: true });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ firstName: "Accepted", lastName: "" });
    await expect(
      updateAccountProfile(db, user.id, {
        firstName: "Accepted",
        lastName: "",
      }),
    ).rejects.toMatchObject({ message: "PROFILE_NAME_FIELDS_REQUIRED" });
  },
);
it("grandfathers accepted student survey identity through a Required/Hidden change without replacing signature evidence", async () => {
  await db.subject.create({
    data: { id: "accepted-survey-subject", name: "Math" },
  });
  await db.timeSlot.create({
    data: {
      id: "accepted-survey-slot",
      label: "After school",
      dayOfWeek: 1,
      startMin: 960,
      endMin: 1020,
    },
  });
  await db.policyDocument.create({
    data: {
      slug: "tutee-policy",
      locale: "en",
      title: "Policy",
      body: "Accepted policy.",
    },
  });
  await submitSurvey(
    db,
    surveyInput.parse({
      englishName: "Accepted",
      firstName: "Accepted",
      lastName: "",
      alternativeNames: "原始名字",
      email: "accepted-survey@example.test",
      preferredContact: "email",
      firstChoiceId: "accepted-survey-subject",
      slotIds: ["accepted-survey-slot"],
      signatureName: "Original signature",
      agreed: true,
      policyRevision: (await currentPolicy(db, "tutee-policy")).revision,
    }),
  );
  // The service mock preserves the real recipient proof/token generation.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const message = vi.mocked(emailSender.send).mock.calls.at(-1)?.[0];
  const token = /token=([a-f0-9]{64})/.exec(message?.text ?? "")?.[1];
  if (!token) throw Error("Expected emailed survey token");
  const original = await db.studentSurvey.findFirstOrThrow({
    where: { email: "accepted-survey@example.test" },
  });
  await setNames("STUDENT", {
    ...DEFAULT_NAME_FIELDS,
    lastName: "required",
    alternativeNames: "hidden",
  });
  await expect(
    confirmSurvey(db, token, "TestPassword123"),
  ).resolves.toBeDefined();
  const user = await db.user.findUniqueOrThrow({
    where: { email: original.email },
  });
  expect(user).toMatchObject({
    firstName: "Accepted",
    lastName: "",
    alternativeNames: "原始名字",
  });
  expect(
    (await db.studentSurvey.findUniqueOrThrow({ where: { id: original.id } }))
      .payload,
  ).toEqual(original.payload);
  await expect(
    updateAccountProfile(db, user.id, { firstName: "Accepted", lastName: "" }),
  ).rejects.toMatchObject({ message: "PROFILE_NAME_FIELDS_REQUIRED" });
});
it("promotes nameless accepted applicants with a neutral handle and never treats an existing fallback as an original name", async () => {
  await setNames("TUTOR", hidden);
  const app = await db.tutorApplication.create({
    data: {
      name: "",
      firstName: "",
      lastName: "",
      email: "nameless-app@example.test",
      type: "INITIAL",
      status: "ACCEPTED",
    },
  });
  await promoteApplicantToTutor(app.id);
  expect(
    await db.tutor.findUniqueOrThrow({ where: { email: app.email } }),
  ).toMatchObject({
    englishName: "member",
    username: "member",
    legacyName: null,
    firstName: "",
  });
  await setNames("STUDENT", hidden);
  const owner = await db.user.create({
    data: {
      role: "STUDENT",
      username: "existinghandle",
      firstName: "",
      lastName: "",
      name: "existinghandle",
      email: "existing-nameless@example.test",
      emailVerifiedAt: new Date(),
    },
  });
  const next = await db.tutorApplication.create({
    data: {
      name: "Historical Applicant",
      firstName: "Historical",
      lastName: "Applicant",
      email: owner.email,
      type: "INITIAL",
      status: "ACCEPTED",
    },
  });
  await promoteApplicantToTutor(next.id);
  expect(
    await db.tutor.findUniqueOrThrow({ where: { email: owner.email } }),
  ).toMatchObject({
    englishName: "existinghandle",
    username: "existinghandle",
    firstName: "",
    lastName: "",
    legacyName: null,
  });
});
it("applies hidden and newly required policies at new student, tutor and crew intake boundaries", async () => {
  await db.subject.create({ data: { id: "policy-subject", name: "Math" } });
  await db.timeSlot.create({
    data: {
      id: "policy-slot",
      label: "After school",
      dayOfWeek: 1,
      startMin: 960,
      endMin: 1020,
    },
  });
  for (const slug of ["tutee-policy", "tutor-policy"])
    await db.policyDocument.create({
      data: { slug, locale: "en", title: "Policy", body: "Accepted policy." },
    });
  const student = {
    englishName: "",
    firstName: "",
    lastName: "",
    email: "new-student@example.test",
    preferredContact: "email",
    firstChoiceId: "policy-subject",
    slotIds: ["policy-slot"],
    signatureName: "Signed evidence",
    agreed: true as const,
    policyRevision: (await currentPolicy(db, "tutee-policy")).revision,
  };
  const tutor = {
    name: "",
    firstName: "",
    lastName: "",
    email: "new-tutor@example.test",
    agreed: true as const,
    policyRevision: (await currentPolicy(db, "tutor-policy")).revision,
    preferredContact: "email",
    subjects: [
      {
        subjectId: "policy-subject",
        taken: false,
        hasApScore: false,
        selfStudied: false,
      },
    ],
  };
  const crew = {
    name: "",
    firstName: "",
    lastName: "",
    email: "new-crew@example.test",
  };
  for (const type of ["STUDENT", "TUTOR", "CREW"] as const)
    await setNames(type, hidden);
  await submitSurvey(db, surveyInput.parse(student));
  await caller().application.submit(tutor);
  await stageCrewVerification(db, crew.email, crew);
  expect(
    (
      await db.studentSurvey.findFirstOrThrow({
        where: { email: student.email },
      })
    ).payload,
  ).toMatchObject({
    englishName: "",
    firstName: "",
    signatureName: "Signed evidence",
  });
  expect(
    await db.tutorApplication.findFirstOrThrow({
      where: { email: tutor.email },
    }),
  ).toMatchObject({ name: "", firstName: "" });
  expect(
    (
      await db.crewSignupVerification.findUniqueOrThrow({
        where: { email: crew.email },
      })
    ).draft,
  ).toMatchObject({ name: "", firstName: "" });
  for (const type of ["STUDENT", "TUTOR", "CREW"] as const)
    await setNames(type, { ...DEFAULT_NAME_FIELDS, lastName: "required" });
  await expect(
    submitSurvey(
      db,
      surveyInput.parse({
        ...student,
        email: "required-student@example.test",
        firstName: "Given",
      }),
    ),
  ).rejects.toMatchObject({ message: "PROFILE_NAME_FIELDS_REQUIRED" });
  await expect(
    caller().application.submit({
      ...tutor,
      email: "required-tutor@example.test",
      firstName: "Given",
    }),
  ).rejects.toMatchObject({ message: "PROFILE_NAME_FIELDS_REQUIRED" });
  await expect(
    stageCrewVerification(db, "required-crew@example.test", {
      ...crew,
      email: "required-crew@example.test",
      firstName: "Given",
    }),
  ).rejects.toMatchObject({ message: "PROFILE_NAME_FIELDS_REQUIRED" });
});
