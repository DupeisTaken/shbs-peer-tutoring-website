import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
const mail = vi.hoisted(() => ({ send: vi.fn<() => Promise<void>>() }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mail.send },
  isEmailDeliveryAvailable: () => true,
}));

import { db } from "./db";
import { createCaller } from "./api/root";
import { hashPassword } from "./auth/password";
import { accountHistoryIds } from "./account-history";
import { ownedTutorHistory } from "./personal-tutor-history";
import { ownedStudentIds } from "./student-ownership";
import type { PersonSource } from "./person-identity";
import {
  partitionPersonRecords,
  personPartitionReceipt,
  personPartitionSources,
  previewPersonPartition,
} from "./person-partition";
import {
  claimExactHistory,
  inspectExactHistoryClaim,
  inviteExactHistory,
  previewExactHistoryInvitation,
} from "./exact-history-invitations";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const password = "Synthetic-partition-review-460!";
const passwordHash = hashPassword(password);
const reason = "Reviewed original evidence and corrected the mistaken directory grouping";
const personId = "mistaken-group";
const user = (id: string) => ({ kind: "USER" as const, id });
const tutor = (id: string) => ({ kind: "TUTOR" as const, id });
const tutee = (id: string) => ({ kind: "TUTEE" as const, id });

/** This file owns only the guarded disposable test database during its serial run. */
async function clearFixture(client: Pick<typeof db, "$queryRaw" | "$executeRawUnsafe"> = db) {
  const tables = await client.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await client.$executeRawUnsafe(
    "TRUNCATE " + tables.map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE",
  );
}

beforeEach(async () => {
  (globalThis as { rateLimitStore?: Map<string, unknown> }).rateLimitStore?.clear();
  vi.stubEnv("AUTH_URL", "https://partition.example.test");
  mail.send.mockReset().mockResolvedValue(undefined);
  // Commit the complete starting state before exercising the real client in each test.
  await db.$transaction(async (tx) => {
    await clearFixture(tx);
    await tx.user.createMany({
      data: ([["head", "HEAD"], ["admin", "ADMIN"], ["coord", "COORDINATOR"], ["viewer", "VIEWER"]] as const).map(([id, role]) => ({
        id, role, name: id, username: id, email: `${id}@example.test`,
        passwordHash, emailVerifiedAt: new Date("2026-10-01T00:00:00Z"),
      })),
    });
    await tx.person.create({ data: { id: personId } });
    await tx.term.createMany({ data: [
      { id: "past-term", name: "Original term", schoolYear: "24-25", quarter: "Q1", active: false },
      { id: "current-term", name: "Current term", schoolYear: "26-27", quarter: "Q1", active: true },
    ] });
    await tx.tutor.createMany({ data: [
      { id: "tutor-a", personId, englishName: "Same original name", status: "ARCHIVED", gradeLevel: 9, gradeSchoolYear: "24-25" },
      { id: "tutor-b", personId, englishName: "Same original name", status: "GRADUATED", gradeLevel: 10, gradeSchoolYear: "25-26" },
    ] });
    await tx.tutee.create({ data: {
      id: "tutee-a", personId, englishName: "Same original name", status: "INACTIVE", intakeTermId: "past-term",
      gradeLevel: "9", signupSubmittedAt: new Date("2024-09-01T00:00:00Z"),
      signatureName: "Original synthetic signature", signedAt: new Date("2024-09-01T00:00:00Z"), signedRulebook: true,
    } });
    await tx.pairing.create({ data: {
      id: "original-pairing", tutorId: "tutor-a", termId: "past-term", subject: "Mathematics", dayOfWeek: 2, startMin: 600, endMin: 630,
    } });
    await tx.session.create({ data: {
      id: "original-session", pairingId: "original-pairing", tutorId: "tutor-a", date: new Date("2024-10-01T00:00:00Z"),
      startMin: 600, endMin: 630, durationMin: 30, shCount: 2, shFactor: 2, month: "2024-10", schoolYear: "24-25", quarter: "Q1",
    } });
    await tx.sessionTutee.create({ data: { sessionId: "original-session", tuteeId: "tutee-a", status: "PRESENT" } });
    await tx.serviceHourAdjustment.create({ data: {
      id: "original-adjustment", tutorId: "tutor-a", month: "2024-10", schoolYear: "24-25", quarter: "Q1", type: "EXTRA", amount: 0.5, reason: "Original synthetic amendment",
    } });
  }, { timeout: 30_000 });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await clearFixture();
  await db.$disconnect();
});

async function liveAccount(id: string) {
  return db.user.create({ data: {
    id, personId, name: "Same original name", username: id, email: `${id}@example.test`, role: "STUDENT",
    passwordHash, emailVerifiedAt: new Date("2026-10-01T00:00:00Z"), tuteeMember: false, tutorAccessRevoked: true,
  } });
}

async function reviewed(sources: PersonSource[] = [tutor("tutor-a")]) {
  const selection = { personId, sources };
  return {
    ...selection,
    fingerprint: (await previewPersonPartition(db, selection)).fingerprint,
    reason, acknowledged: true as const, operationId: randomUUID(), confirmPassword: password,
  };
}

const identitySnapshot = async () => ({
  persons: await db.person.findMany({ orderBy: { id: "asc" } }),
  users: await db.user.findMany({ orderBy: { id: "asc" } }),
  tutors: await db.tutor.findMany({ orderBy: { id: "asc" } }),
  tutees: await db.tutee.findMany({ orderBy: { id: "asc" } }),
  tutorOwners: await db.tutorProfileOwnership.findMany({ orderBy: { tutorId: "asc" } }),
  tuteeOwners: await db.studentProfileOwnership.findMany({ orderBy: { tuteeId: "asc" } }),
  receipts: await db.personPartitionReceipt.findMany({ orderBy: { id: "asc" } }),
});

/** Exclude only directory metadata and its dedicated revision, never original edit versions. */
const originalEvidence = async () => ({
  users: (await db.user.findMany({ orderBy: { id: "asc" } })).map(({ personId: _personId, ...row }) => {
    void _personId;
    return row;
  }),
  tutors: (await db.tutor.findMany({ orderBy: { id: "asc" } })).map(({ personId: _personId, historyIdentityRevision: _revision, ...row }) => {
    void _personId;
    void _revision;
    return row;
  }),
  tutees: (await db.tutee.findMany({ orderBy: { id: "asc" } })).map(({ personId: _personId, historyIdentityRevision: _revision, ...row }) => {
    void _personId;
    void _revision;
    return row;
  }),
  pairings: await db.pairing.findMany({ orderBy: { id: "asc" } }),
  sessions: await db.session.findMany({ orderBy: { id: "asc" } }),
  attendance: await db.sessionTutee.findMany({ orderBy: { sessionId: "asc" } }),
  adjustments: await db.serviceHourAdjustment.findMany({ orderBy: { id: "asc" } }),
  departures: await db.schoolDeparture.findMany({ orderBy: { userId: "asc" } }),
  departureEvents: await db.schoolDepartureEvent.findMany({ orderBy: { id: "asc" } }),
  tutorOwners: await db.tutorProfileOwnership.findMany({ orderBy: { tutorId: "asc" } }),
  tuteeOwners: await db.studentProfileOwnership.findMany({ orderBy: { tuteeId: "asc" } }),
  policies: await db.policyAcceptance.findMany({ orderBy: { id: "asc" } }),
});

it("previews exact source partitions without splitting same-name records or changing state", async () => {
  const before = await identitySnapshot();
  const preview = await previewPersonPartition(db, { personId, sources: [tutor("tutor-a")] });
  expect(preview).toMatchObject({ personId, canSplit: true, blockers: [], moving: [{ ref: tutor("tutor-a"), name: "Same original name" }] });
  expect(preview.remaining.map((row) => row.ref)).toEqual(expect.arrayContaining([tutor("tutor-b"), tutee("tutee-a")]));
  expect(preview.remaining).toHaveLength(2);
  expect(await identitySnapshot()).toEqual(before);
  expect(await db.auditLog.count()).toBe(0);
});

it("offers every original login in a retirement component without exposing credential fields", async () => {
  await liveAccount("owner-a");
  await db.user.create({ data: { id: "retired-source", personId, mergedIntoId: "owner-a", email: "retired-source@example.test", name: "Original retired source" } });
  const before = await identitySnapshot();
  const sources = await personPartitionSources(db, personId);
  expect(sources.map((row) => row.ref)).toContainEqual(user("retired-source"));
  expect(sources.map((row) => row.ref)).toContainEqual(user("owner-a"));
  for (const source of sources) expect(Object.keys(source).sort()).toEqual(["name", "ref"]);
  expect(await identitySnapshot()).toEqual(before);
});

it.each(["admin", "head"])("allows %s to separate accountless records without credentials, consent or evidence changes", async (actorId) => {
  const before = await originalEvidence();
  const input = await reviewed();
  const result = await partitionPersonRecords(db, actorId, input);
  expect(result).toMatchObject({ ok: true, receiptId: input.operationId, personId, sources: input.sources });
  expect(result.newPersonId).not.toBe(personId);
  expect(await db.person.findUniqueOrThrow({ where: { id: personId } })).toMatchObject({ mergedIntoId: null, primaryUserId: null, resolutionState: "REVIEW_REQUIRED" });
  expect(await db.person.findUniqueOrThrow({ where: { id: result.newPersonId } })).toMatchObject({ mergedIntoId: null, primaryUserId: null, resolutionState: "REVIEW_REQUIRED" });
  expect(await db.tutor.findUniqueOrThrow({ where: { id: "tutor-a" } })).toMatchObject({ personId: result.newPersonId });
  expect(await db.tutor.findUniqueOrThrow({ where: { id: "tutor-b" } })).toMatchObject({ personId });
  expect(await db.tutee.findUniqueOrThrow({ where: { id: "tutee-a" } })).toMatchObject({ personId });
  expect(await originalEvidence()).toEqual(before);
  expect(await db.personPartitionReceipt.count()).toBe(1);
});

it("separates independent live ownership components without changing private readers or active work", async () => {
  await liveAccount("owner-a");
  await liveAccount("owner-b");
  await db.user.update({ where: { id: "owner-a" }, data: { tutorId: "tutor-a" } });
  await db.user.update({ where: { id: "owner-b" }, data: { tutorId: "tutor-b" } });
  await db.studentProfileOwnership.create({ data: { userId: "owner-a", tuteeId: "tutee-a" } });
  await db.policyAcceptance.create({ data: { userId: "owner-a", slug: "tutee-policy", revision: "original-policy", snapshot: { text: "Original synthetic accepted policy" }, signature: "Original synthetic signature" } });
  await db.person.update({ where: { id: personId }, data: { primaryUserId: "owner-a", resolutionState: "REVIEW_REQUIRED" } });
  await db.tutor.update({ where: { id: "tutor-a" }, data: { status: "ACTIVE" } });
  await db.pairing.create({ data: {
    id: "current-pairing", tutorId: "tutor-a", termId: "current-term", subject: "Mathematics", dayOfWeek: 3, startMin: 600, endMin: 630,
  } });
  const before = await originalEvidence();
  const histories = await Promise.all([ownedTutorHistory(db, "owner-a"), ownedTutorHistory(db, "owner-b"), ownedStudentIds(db, "owner-a"), ownedStudentIds(db, "owner-b")]);
  const result = await partitionPersonRecords(db, "admin", await reviewed([user("owner-a"), tutor("tutor-a"), tutee("tutee-a")]));
  expect(await db.user.findUniqueOrThrow({ where: { id: "owner-a" } })).toMatchObject({ personId: result.newPersonId });
  expect(await db.user.findUniqueOrThrow({ where: { id: "owner-b" } })).toMatchObject({ personId });
  expect(await db.person.findUniqueOrThrow({ where: { id: result.newPersonId } })).toMatchObject({ primaryUserId: "owner-a", resolutionState: "REVIEW_REQUIRED" });
  // The former primary moved with its component; separation does not choose a
  // different login for the original group without a fresh operational review.
  expect(await db.person.findUniqueOrThrow({ where: { id: personId } })).toMatchObject({ primaryUserId: null, resolutionState: "REVIEW_REQUIRED" });
  expect(await Promise.all([ownedTutorHistory(db, "owner-a"), ownedTutorHistory(db, "owner-b"), ownedStudentIds(db, "owner-a"), ownedStudentIds(db, "owner-b")])).toEqual(histories);
  expect(await originalEvidence()).toEqual(before);
});

it.each(["TUTOR", "TUTEE"] as const)("rejects a partition cutting a direct %s owner edge", async (kind) => {
  await liveAccount("owner-a");
  await db.user.update({ where: { id: "owner-a" }, data: kind === "TUTOR" ? { tutorId: "tutor-a" } : { studentId: "tutee-a" } });
  const source = kind === "TUTOR" ? tutor("tutor-a") : tutee("tutee-a");
  const selection = { personId, sources: [source] };
  const preview = await previewPersonPartition(db, selection);
  expect(preview.canSplit).toBe(false);
  const blocker = preview.blockers.find((row) => row.reason === "CURRENT_OWNER");
  expect(blocker?.sources).toHaveLength(2);
  expect(blocker?.sources).toContainEqual(source);
  expect(blocker?.sources).toContainEqual(user("owner-a"));
  const before = await identitySnapshot();
  await expect(partitionPersonRecords(db, "admin", await reviewed([source]))).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await identitySnapshot()).toEqual(before);
});

it.each(["TUTOR", "TUTEE"] as const)("rejects a partition cutting a retained %s ownership grant", async (kind) => {
  await liveAccount("owner-a");
  if (kind === "TUTOR") await db.tutorProfileOwnership.create({ data: { tutorId: "tutor-a", userId: "owner-a" } });
  else await db.studentProfileOwnership.create({ data: { tuteeId: "tutee-a", userId: "owner-a" } });
  const source = kind === "TUTOR" ? tutor("tutor-a") : tutee("tutee-a");
  const preview = await previewPersonPartition(db, { personId, sources: [source] });
  expect(preview.canSplit).toBe(false);
  const blocker = preview.blockers.find((row) => row.reason === "RETAINED_OWNER");
  expect(blocker?.sources).toHaveLength(2);
  expect(blocker?.sources).toContainEqual(source);
  expect(blocker?.sources).toContainEqual(user("owner-a"));
  const before = await identitySnapshot();
  await expect(partitionPersonRecords(db, "admin", await reviewed([source]))).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await identitySnapshot()).toEqual(before);
});

it("rejects a retired-family cut but permits moving its complete immutable component", async () => {
  await liveAccount("owner-a");
  // Build the real temporal chain: child retires into a live parent, then the
  // parent retires into owner-a. New retirement cannot target a retired login.
  await db.user.create({ data: { id: "retired-parent", email: "retired-parent@example.test", personId } });
  await db.user.create({ data: { id: "retired-child", email: "retired-child@example.test", personId, mergedIntoId: "retired-parent" } });
  await db.user.update({ where: { id: "retired-parent" }, data: { mergedIntoId: "owner-a" } });
  await db.tutorProfileOwnership.create({ data: { tutorId: "tutor-a", userId: "owner-a" } });
  const partial = await previewPersonPartition(db, { personId, sources: [user("retired-child")] });
  expect(partial).toMatchObject({ canSplit: false });
  const blocker = partial.blockers.find((row) => row.reason === "RETIRED_FAMILY");
  expect(blocker?.sources).toHaveLength(2);
  expect(blocker?.sources).toContainEqual(user("retired-child"));
  // Current history ownership follows the live reader; the credential chain
  // remains child -> parent -> owner-a and must not be rewritten by partition.
  expect(blocker?.sources).toContainEqual(user("owner-a"));
  const before = await originalEvidence();
  await expect(partitionPersonRecords(db, "head", await reviewed([user("retired-child")]))).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.personPartitionReceipt.count()).toBe(0);
  const family = await accountHistoryIds(db, "owner-a");
  expect([...family].sort()).toEqual(["owner-a", "retired-child", "retired-parent"].sort());
  const result = await partitionPersonRecords(db, "head", await reviewed([user("owner-a"), user("retired-parent"), user("retired-child"), tutor("tutor-a")]));
  expect(await accountHistoryIds(db, "owner-a")).toEqual(family);
  expect(await db.user.findUniqueOrThrow({ where: { id: "retired-child" } })).toMatchObject({ personId: result.newPersonId, mergedIntoId: "retired-parent", passwordHash: null });
  expect(await db.user.findUniqueOrThrow({ where: { id: "retired-parent" } })).toMatchObject({ personId: result.newPersonId, mergedIntoId: "owner-a", passwordHash: null });
  expect(await originalEvidence()).toEqual(before);
});

it.each(["suspended", "departed", "returned"])("retains %s account restrictions and departure evidence while correcting metadata", async (state) => {
  await liveAccount("owner-a");
  await db.user.update({ where: { id: "owner-a" }, data: { tutorId: "tutor-a", ...(state === "suspended" ? { suspendedAt: new Date("2026-10-01T00:00:00Z"), suspendedReason: "Existing synthetic restriction" } : {}) } });
  if (state !== "suspended") {
    await db.schoolDeparture.create({ data: { userId: "owner-a", reason: state === "departed" ? "TRANSFERRED" : null, observerRevoked: true, tutorDerived: true, source: "HEAD", revision: 2 } });
    await db.schoolDepartureEvent.createMany({ data: [
      { userId: "owner-a", action: "TRANSFERRED", source: "HEAD", explanation: "Original synthetic departure", revision: 1 },
      { userId: "owner-a", action: state === "departed" ? "REVOKE" : "RETURN", source: "HEAD", explanation: "Retained synthetic decision", revision: 2 },
    ] });
  }
  const before = await originalEvidence();
  const result = await partitionPersonRecords(db, "admin", await reviewed([user("owner-a"), tutor("tutor-a")]));
  expect(await db.person.findUniqueOrThrow({ where: { id: result.newPersonId } })).toMatchObject({ resolutionState: "REVIEW_REQUIRED" });
  expect(await originalEvidence()).toEqual(before);
});

it.each([
  ["empty", []],
  ["all", [tutor("tutor-a"), tutor("tutor-b"), tutee("tutee-a")]],
  ["duplicate", [tutor("tutor-a"), tutor("tutor-a")]],
  ["missing", [tutor("missing-source")]],
] as const)("rejects a %s partition without writes", async (_label, sources) => {
  const before = await identitySnapshot();
  await expect(previewPersonPartition(db, { personId, sources: [...sources] })).rejects.toThrow();
  expect(await identitySnapshot()).toEqual(before);
});

it("rejects redirected, missing and cross-group source selections", async () => {
  await db.person.create({ data: { id: "redirect", mergedIntoId: personId } });
  await db.person.create({ data: { id: "unrelated" } });
  await db.tutor.create({ data: { id: "unrelated-tutor", personId: "unrelated", englishName: "Same original name", status: "ARCHIVED" } });
  const before = await identitySnapshot();
  await expect(previewPersonPartition(db, { personId: "redirect", sources: [tutor("tutor-a")] })).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(previewPersonPartition(db, { personId: "missing", sources: [tutor("tutor-a")] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(previewPersonPartition(db, { personId, sources: [tutor("unrelated-tutor")] })).rejects.toThrow();
  expect(await identitySnapshot()).toEqual(before);
});

it("refuses contradictory ownership reaching another group instead of expanding the correction", async () => {
  await db.person.create({ data: { id: "unrelated" } });
  await db.user.create({ data: { id: "external-owner", personId: "unrelated", email: "external-owner@example.test", role: "STUDENT" } });
  await db.tutorProfileOwnership.create({ data: { tutorId: "tutor-a", userId: "external-owner" } });
  const before = await identitySnapshot();
  await expect(previewPersonPartition(db, { personId, sources: [tutor("tutor-b")] })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await identitySnapshot()).toEqual(before);
});

it("does not revive a stale review after source membership moves away and back", async () => {
  const input = await reviewed();
  await db.person.create({ data: { id: "temporary-group" } });
  await db.$executeRaw`UPDATE "Tutor" SET "personId"='temporary-group' WHERE id='tutor-a'`;
  await db.$executeRaw`UPDATE "Tutor" SET "personId"=${personId} WHERE id='tutor-a'`;
  const before = await identitySnapshot();
  await expect(partitionPersonRecords(db, "admin", input)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await identitySnapshot()).toEqual(before);
  const fresh = await reviewed();
  expect(fresh.fingerprint).not.toBe(input.fingerprint);
  expect(await partitionPersonRecords(db, "admin", fresh)).toMatchObject({ ok: true });
});

it("does not revive a stale review after retained ownership moves away and back", async () => {
  await liveAccount("owner-a");
  await liveAccount("owner-b");
  await db.tutorProfileOwnership.create({ data: { tutorId: "tutor-a", userId: "owner-a" } });
  const input = await reviewed([user("owner-a"), tutor("tutor-a")]);
  await db.tutorProfileOwnership.update({ where: { tutorId: "tutor-a" }, data: { userId: "owner-b" } });
  await db.tutorProfileOwnership.update({ where: { tutorId: "tutor-a" }, data: { userId: "owner-a" } });
  const before = await identitySnapshot();
  await expect(partitionPersonRecords(db, "admin", input)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await identitySnapshot()).toEqual(before);
});

it("recovers one accepted intent without repeating writes, even after later directory changes", async () => {
  const input = await reviewed();
  const result = await partitionPersonRecords(db, "admin", input);
  const accepted = await db.personPartitionReceipt.findUniqueOrThrow({ where: { id: input.operationId } });
  await db.person.update({ where: { id: result.newPersonId }, data: { revision: { increment: 1 } } });
  const before = await identitySnapshot();
  const audits = await db.auditLog.count();
  expect(await personPartitionReceipt(db, "admin", input.operationId)).toEqual(result);
  expect(await partitionPersonRecords(db, "admin", input)).toEqual(result);
  expect(await identitySnapshot()).toEqual(before);
  expect(await db.auditLog.count()).toBe(audits);
  expect(await db.personPartitionReceipt.findUniqueOrThrow({ where: { id: input.operationId } })).toEqual(accepted);
  expect(JSON.stringify(accepted)).not.toContain(password);
  await expect(partitionPersonRecords(db, "admin", { ...input, reason: "A different reviewed correction must have its own operation reference" })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await personPartitionReceipt(db, "head", input.operationId)).toBeNull();
  await expect(partitionPersonRecords(db, "head", input)).rejects.toMatchObject({ code: "CONFLICT" });
});

it("recovers an identical source set in a different order and preserves the immutable receipt", async () => {
  const input = await reviewed([tutor("tutor-b"), tutor("tutor-a")]);
  const result = await partitionPersonRecords(db, "admin", input);
  const accepted = await db.personPartitionReceipt.findUniqueOrThrow({ where: { id: result.receiptId } });
  expect(await partitionPersonRecords(db, "admin", { ...input, sources: [...input.sources].reverse() })).toEqual(result);
  await expect(db.personPartitionReceipt.update({ where: { id: result.receiptId }, data: { actorId: "head" } })).rejects.toThrow();
  await expect(db.personPartitionReceipt.delete({ where: { id: result.receiptId } })).rejects.toThrow();
  expect(await db.personPartitionReceipt.findUniqueOrThrow({ where: { id: result.receiptId } })).toEqual(accepted);
});

it("serializes identical concurrent submissions into one new identity and receipt", async () => {
  const input = await reviewed();
  const [first, second] = await Promise.all([partitionPersonRecords(db, "admin", input), partitionPersonRecords(db, "admin", input)]);
  expect(second).toEqual(first);
  expect(await db.person.count()).toBe(2);
  expect(await db.personPartitionReceipt.count()).toBe(1);
  expect(await db.auditLog.count({ where: { entity: "Person" } })).toBe(1);
});

it("rejects the stale loser of competing group partitions without another new identity", async () => {
  const first = await reviewed([tutor("tutor-a")]);
  const second = await reviewed([tutor("tutor-b")]);
  const results = await Promise.allSettled([partitionPersonRecords(db, "admin", first), partitionPersonRecords(db, "head", second)]);
  expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  const rejected = results.filter((row) => row.status === "rejected");
  expect(rejected).toHaveLength(1);
  const failure: unknown = rejected[0]?.reason;
  expect(failure).toMatchObject({ code: "CONFLICT" });
  expect(await db.person.count()).toBe(2);
  expect(await db.personPartitionReceipt.count()).toBe(1);
});

it.each(["coord", "viewer", "missing-manager"])("denies %s without changing source identities", async (actorId) => {
  const input = await reviewed();
  const before = await identitySnapshot();
  await expect(partitionPersonRecords(db, actorId, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await identitySnapshot()).toEqual(before);
});

it("requires the current password and rechecks management authority on receipts and retries", async () => {
  const input = await reviewed();
  const initial = await identitySnapshot();
  await expect(partitionPersonRecords(db, "admin", { ...input, confirmPassword: "incorrect" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Password is incorrect." });
  expect(await identitySnapshot()).toEqual(initial);
  expect(await db.personPartitionReceipt.count()).toBe(0);
  const fresh = { ...await reviewed(), reason: input.reason };
  const result = await partitionPersonRecords(db, "admin", fresh);
  await db.user.update({ where: { id: "admin" }, data: { role: "VIEWER" } });
  const before = await identitySnapshot();
  await expect(personPartitionReceipt(db, "admin", result.receiptId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(partitionPersonRecords(db, "admin", fresh)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await identitySnapshot()).toEqual(before);
});

it("rejects a stale Admin session at every partition router boundary after demotion", async () => {
  const input = await reviewed();
  const session: Session = { user: { id: "admin" }, role: "ADMIN", tutorId: null, expires: "2099-01-01" };
  const caller = createCaller({ db, headers: new Headers(), session });
  await db.user.update({ where: { id: "admin" }, data: { role: "COORDINATOR" } });
  const before = await identitySnapshot();
  await expect(caller.personCombine.partitionPreview({ personId, sources: input.sources })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller.personCombine.partition(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller.personCombine.partitionReceipt({ operationId: input.operationId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await identitySnapshot()).toEqual(before);
});

it.each(["suspended", "retired", "voided"])("denies a %s manager even when their saved role is Admin", async (state) => {
  const input = await reviewed();
  await db.user.update({ where: { id: "admin" }, data: state === "suspended"
    ? { suspendedAt: new Date(), suspendedReason: "Synthetic manager restriction" }
    : state === "retired" ? { mergedIntoId: "head", passwordHash: null } : { recoveryVoidedAt: new Date(), passwordHash: null } });
  const before = await identitySnapshot();
  await expect(partitionPersonRecords(db, "admin", input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await identitySnapshot()).toEqual(before);
});

it("rolls back both groups, source revisions and the receipt when durable audit fails", async () => {
  const input = await reviewed();
  const before = await identitySnapshot();
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_partition_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity = 'Person' THEN RAISE EXCEPTION 'synthetic partition audit failure'; END IF; RETURN NEW; END $$`);
  try {
    await db.$executeRawUnsafe('CREATE TRIGGER fail_partition_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_partition_audit()');
    await expect(partitionPersonRecords(db, "admin", input)).rejects.toThrow();
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_partition_audit ON "AuditLog"');
    await db.$executeRawUnsafe('DROP FUNCTION fail_partition_audit()');
  }
  expect(await identitySnapshot()).toEqual(before);
  expect(await db.auditLog.count()).toBe(0);
  expect(await partitionPersonRecords(db, "admin", input)).toMatchObject({ ok: true });
});

it.each(["TUTOR", "TUTEE", "USER"] as const)("rolls back a split when a %s assignment trigger silently skips its selected row", async (kind) => {
  if (kind === "USER") await liveAccount("owner-a");
  const source = kind === "TUTOR" ? tutor("tutor-a") : kind === "TUTEE" ? tutee("tutee-a") : user("owner-a");
  const table = kind === "TUTOR" ? "Tutor" : kind === "TUTEE" ? "Tutee" : "User";
  const input = await reviewed([source]);
  const before = await identitySnapshot();
  // Table/source identifiers come only from this test's fixed allowlist.
  await db.$executeRawUnsafe(`CREATE FUNCTION skip_partition_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${source.id}' AND NEW."personId" IS DISTINCT FROM OLD."personId" THEN RETURN NULL; END IF; RETURN NEW; END $$`);
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER skip_partition_source BEFORE UPDATE OF "personId" ON "${table}" FOR EACH ROW EXECUTE FUNCTION skip_partition_source()`);
    await expect(partitionPersonRecords(db, "admin", input)).rejects.toMatchObject({ code: "CONFLICT" });
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS skip_partition_source ON "${table}"`);
    await db.$executeRawUnsafe('DROP FUNCTION skip_partition_source()');
  }
  expect(await identitySnapshot()).toEqual(before);
  expect(await db.auditLog.count()).toBe(0);
});

it("invalidates old exact-invitation review generations without admitting or sending another invitation", async () => {
  const selection = { sources: [tutor("tutor-a")], email: "future-owner@example.test" };
  const preview = await previewExactHistoryInvitation(db, "admin", selection);
  expect(preview.canInvite).toBe(true);
  await partitionPersonRecords(db, "admin", await reviewed());
  expect((await previewExactHistoryInvitation(db, "admin", selection)).fingerprint).not.toBe(preview.fingerprint);
  await expect(inviteExactHistory(db, "admin", { ...selection, fingerprint: preview.fingerprint, reason, operationId: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.historicalRecordInvitationAttempt.count()).toBe(0);
  expect(mail.send).not.toHaveBeenCalled();
});

it("invalidates a previously published exact claim without altering its frozen invitation or granting ownership", async () => {
  await db.user.create({ data: { id: "recipient", email: "recipient@example.test", role: "STUDENT", passwordHash, emailVerifiedAt: new Date(), tuteeMember: false, tutorAccessRevoked: true } });
  const selection = { sources: [tutor("tutor-a")], email: "recipient@example.test" };
  const preview = await previewExactHistoryInvitation(db, "admin", selection);
  expect(preview.canInvite).toBe(true);
  const delivery = await inviteExactHistory(db, "admin", { ...selection, fingerprint: preview.fingerprint, reason, operationId: randomUUID() });
  expect(delivery.status).toBe("PUBLISHED");
  const invitation = await db.historicalRecordInvitation.findFirstOrThrow();
  expect(await inspectExactHistoryClaim(db, "recipient", invitation.tokenHash)).toMatchObject({ claimed: false });
  await partitionPersonRecords(db, "admin", await reviewed());
  await expect(inspectExactHistoryClaim(db, "recipient", invitation.tokenHash)).rejects.toThrow();
  await expect(claimExactHistory(db, "recipient", invitation.tokenHash)).rejects.toThrow();
  expect(await db.historicalRecordInvitation.findUniqueOrThrow({ where: { scopeKey: invitation.scopeKey } })).toEqual(invitation);
  expect(await db.tutorProfileOwnership.count()).toBe(0);
  expect(await db.studentProfileOwnership.count()).toBe(0);
  expect(await db.historicalRecordClaimReceipt.count()).toBe(0);
  expect(mail.send).toHaveBeenCalledTimes(1);
});
