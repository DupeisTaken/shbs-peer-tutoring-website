import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
const mail = vi.hoisted(() => ({ send: vi.fn(), available: vi.fn(() => true) }));
vi.mock("~/server/email/sender", () => ({ emailSender: { send: mail.send }, isEmailDeliveryAvailable: mail.available }));

import { db } from "./db";
import { createCaller } from "./api/root";
import { hashPassword } from "./auth/password";
import { startHistoryAccount, verifyHistoryAccount, completeHistoryAccount } from "./history-account-setup";
import { issueHistoryAccountInvitation, redeemAccountInvitation } from "./auth/account-invitations";
import { historyTokenDigest } from "./tutee-history";
import { databaseScope } from "./db-scope";
import { inviteExactHistory, type ExactHistorySource } from "./exact-history-invitations";
import { previewTutorHistory, linkTutorHistory } from "./tutor-history";

const sources: ExactHistorySource[] = [{ kind: "TUTOR", id: "tutor" }, { kind: "TUTEE", id: "tutee" }];
const email = "archive-recipient@example.test";
const password = "Synthetic-history-password-460!";
const reason = "Reviewed exact archived participant identity with original source evidence";
let actorId: string;
const caller = (id = actorId, role: Session["role"] = "ADMIN") => createCaller({ db, headers: new Headers(), session: { user: { id }, role, tutorId: null, expires: "2099-01-01" } });
const preview = (scope = sources, recipient = email) => caller().tuteeHistory.previewExactInvitation({ sources: scope, email: recipient });
async function input(scope = sources, recipient = email) {
  return { sources: scope, email: recipient, fingerprint: (await preview(scope, recipient)).fingerprint, reason, operationId: randomUUID() };
}
async function invite(scope = sources, recipient = email) {
  const payload = await input(scope, recipient);
  return { receipt: await caller().tuteeHistory.inviteExact(payload), payload };
}
function token() {
  const message = mail.send.mock.calls.findLast((call) => (call[0] as { text: string }).text.includes("token="))?.[0] as { text: string } | undefined;
  const value = message?.text.match(/token=([a-f0-9]{64})/)?.[1];
  if (!value) throw new Error("Missing synthetic invitation token");
  return value;
}
const grant = () => db.historicalRecordInvitation.findFirstOrThrow();
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}
async function entered(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic SMTP did not start")), 4000); })]); }
  finally { clearTimeout(timer); }
}

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  // These accounts are recreated per test; their in-memory request budgets must
  // follow the same isolation without disabling the actual limiter under test.
  const limits = (globalThis as { rateLimitStore?: Map<string, unknown> }).rateLimitStore;
  for (const id of ["recipient", "other"]) limits?.delete(`history-link:${id}`);
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map((r) => '"' + r.tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  actorId = `exact-manager-${randomUUID()}`;
  vi.stubEnv("AUTH_URL", "https://history.example.test");
  mail.send.mockReset().mockResolvedValue(undefined);
  mail.available.mockReturnValue(true);
  await db.user.createMany({ data: [
    { id: actorId, email: `${actorId}@example.test`, name: "Archive Manager", role: "ADMIN", emailVerifiedAt: new Date(), passwordHash: hashPassword(password) },
    { id: "recipient", email, name: "Archive Recipient", role: "STUDENT", tuteeMember: false, tutorAccessRevoked: true, emailVerifiedAt: new Date(), passwordHash: hashPassword(password) },
    { id: "other", email: "other@example.test", name: "Other Account", role: "STUDENT", emailVerifiedAt: new Date(), passwordHash: hashPassword(password) },
  ] });
  await db.person.create({ data: { id: "archive-group" } });
  await db.term.createMany({ data: [
    { id: "past", name: "Archive", schoolYear: "24-25", quarter: "Q1", active: false },
    { id: "current", name: "Current", schoolYear: "26-27", quarter: "Q1", active: true },
  ] });
  await db.tutor.create({ data: { id: "tutor", personId: "archive-group", englishName: "Original Tutor", status: "GRADUATED" } });
  await db.tutee.create({ data: { id: "tutee", personId: "archive-group", englishName: "Original Learner", status: "INACTIVE", intakeTermId: "past", signedRulebook: false } });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => db.$disconnect());

it("claims only the frozen Tutor/Tutee sources and recovers a consumed claim by read without adding participation or consent", async () => {
  const beforeUser = await db.user.findUniqueOrThrow({ where: { id: "recipient" } });
  const originalTutor = await db.tutor.findUniqueOrThrow({ where: { id: "tutor" } });
  const originalTutee = await db.tutee.findUniqueOrThrow({ where: { id: "tutee" } });
  expect(await preview()).toMatchObject({ canInvite: true, blocked: [] });
  const { receipt } = await invite();
  expect(receipt.status).toBe("PUBLISHED");
  const claimToken = token();
  expect(await caller("recipient", "STUDENT").tuteeHistory.inspectClaim({ token: claimToken })).toMatchObject({ claimed: false, sources: expect.arrayContaining([{ kind: "TUTOR", id: "tutor", name: "Original Tutor" }, { kind: "TUTEE", id: "tutee", name: "Original Learner" }]) });
  await expect(caller("other", "STUDENT").tuteeHistory.inspectClaim({ token: claimToken })).rejects.toThrow("HISTORY_EMAIL_MISMATCH");
  await caller("recipient", "STUDENT").tuteeHistory.claim({ token: claimToken });
  expect(await db.tutorProfileOwnership.findUnique({ where: { tutorId: "tutor" } })).toMatchObject({ userId: "recipient" });
  expect(await db.studentProfileOwnership.findUnique({ where: { tuteeId: "tutee" } })).toMatchObject({ userId: "recipient" });
  expect(await caller("recipient", "STUDENT").tuteeHistory.inspectClaim({ token: claimToken })).toMatchObject({ claimed: true, sources: expect.any(Array) });
  const auditCount = await db.auditLog.count({ where: { operation: "tuteeHistory.claimExact" } });
  await caller("recipient", "STUDENT").tuteeHistory.claim({ token: claimToken });
  expect(await db.auditLog.count({ where: { operation: "tuteeHistory.claimExact" } })).toBe(auditCount);
  expect(await db.policyAcceptance.count()).toBe(0);
  expect(await db.user.findUnique({ where: { id: "recipient" } })).toMatchObject({ role: beforeUser.role, studentId: null, tutorId: null, tuteeMember: false, tutorAccessRevoked: true, passwordHash: beforeUser.passwordHash, emailVerifiedAt: beforeUser.emailVerifiedAt });
  expect(await db.tutor.findUnique({ where: { id: "tutor" } })).toMatchObject({ updatedAt: originalTutor.updatedAt, englishName: originalTutor.englishName, status: originalTutor.status });
  expect(await db.tutee.findUnique({ where: { id: "tutee" } })).toMatchObject({ updatedAt: originalTutee.updatedAt, englishName: originalTutee.englishName, status: originalTutee.status, signedRulebook: false, signupSubmittedAt: originalTutee.signupSubmittedAt });
  expect(mail.send).toHaveBeenCalledTimes(1);
});

it("creates missing history-only credentials through the existing separate email proof and account envelope, then explicitly claims", async () => {
  const recipient = "new-history@example.test";
  await invite([{ kind: "TUTOR", id: "tutor" }], recipient);
  const claimToken = token();
  await startHistoryAccount(db, { token: claimToken, email: recipient });
  const code = (mail.send.mock.calls.at(-1)![0] as { text: string }).text.match(/ is ([0-9]{4})/)![1]!;
  await expect(verifyHistoryAccount(db, { token: claimToken, email: recipient, code: "wrong" })).rejects.toThrow("HISTORY_CODE_MISMATCH");
  const verified = await verifyHistoryAccount(db, { token: claimToken, email: recipient, code });
  const envelope = await issueHistoryAccountInvitation(db, { token: claimToken, email: recipient, ...verified }, true);
  await redeemAccountInvitation(db, { invitationId: envelope.invitationId, proof: envelope.proof!, firstName: "", lastName: "", password, reviewed: true });
  const created = await db.user.findUniqueOrThrow({ where: { email: recipient } });
  await completeHistoryAccount(db, { token: claimToken, email: recipient, ...verified, password: "Retry-must-not-replace-password-460!" });
  expect((await db.user.findUniqueOrThrow({ where: { id: created.id } })).passwordHash).toBe(created.passwordHash);
  expect(created).toMatchObject({ role: "STUDENT", studentId: null, tutorId: null, tuteeMember: false, tutorAccessRevoked: true, personId: expect.any(String) });
  expect(await db.tutorProfileOwnership.count()).toBe(0);
  expect(await db.studentProfileOwnership.count()).toBe(0);
  await caller(created.id, "STUDENT").tuteeHistory.claim({ invitationId: envelope.invitationId });
  expect(await db.tutorProfileOwnership.findUnique({ where: { tutorId: "tutor" } })).toMatchObject({ userId: created.id });
  expect(await db.studentProfileOwnership.count()).toBe(0);
  expect(await caller(created.id, "STUDENT").tuteeHistory.myRecords()).toEqual([]);
  await expect(caller(created.id, "STUDENT").tuteeHistory.myDetails({ tuteeId: "tutee", page: 0 })).rejects.toThrow("HISTORY_NOT_FOUND");
  const claimed = await db.tutor.findUniqueOrThrow({ where: { id: "tutor" } });
  await db.tutor.create({ data: { id: "later-tutor", englishName: "Later Group Member", status: "GRADUATED", personId: claimed.personId } });
  expect((await caller(created.id, "STUDENT").tuteeHistory.myTutorRecords()).map((row) => row.id)).toEqual(["tutor"]);
  await expect(caller(created.id, "STUDENT").tuteeHistory.myTutorDetails({ tutorId: "later-tutor", page: 0 })).rejects.toThrow("HISTORY_NOT_FOUND");
  expect(await db.policyAcceptance.count()).toBe(0);
});

it("keeps original Tutee invitations and in-flight attempts usable through the explicit legacy adapter", async () => {
  const legacyToken = "e".repeat(64);
  const record = await db.tutee.findUniqueOrThrow({ where: { id: "tutee" } });
  await db.tuteeHistoryInvitation.create({ data: { tuteeId: record.id, tokenHash: historyTokenDigest(legacyToken), email, expectedUpdatedAt: record.updatedAt, issuedById: actorId, reason, expiresAt: new Date(Date.now() + 86400000) } });
  await invite([{ kind: "TUTOR", id: "tutor" }]);
  expect(await caller("recipient", "STUDENT").tuteeHistory.inspectClaim({ token: legacyToken })).toMatchObject({ sources: [{ kind: "TUTEE", id: "tutee", name: "Original Learner" }], claimed: false });
  await caller("recipient", "STUDENT").tuteeHistory.claim({ token: legacyToken });
  const recovered = await caller("recipient", "STUDENT").tuteeHistory.inspectClaim({ token: legacyToken });
  expect(recovered).toMatchObject({ claimed: true, sources: [{ kind: "TUTEE", id: "tutee", name: "Original Learner" }] });
  await expect(caller("recipient", "STUDENT").tuteeHistory.claim({ token: legacyToken })).rejects.toThrow("HISTORY_INVITATION_INVALID");
  await expect(caller("recipient", "STUDENT").tuteeHistory.inspectClaim({ token: token() })).rejects.toThrow("HISTORY_STALE");
  await db.studentProfileOwnership.update({ where: { tuteeId: "tutee" }, data: { userId: "other", revision: { increment: 1 } } });
  await expect(caller("recipient", "STUDENT").tuteeHistory.inspectClaim({ token: legacyToken })).rejects.toThrow("HISTORY_INVITATION_INVALID");
});

it("reports stable reasons for unrelated groups, current work, nonhistorical records and conflicting or incomplete accounts", async () => {
  await db.person.create({ data: { id: "other-group" } });
  await db.tutee.update({ where: { id: "tutee" }, data: { personId: "other-group" } });
  expect((await preview()).blocked).toContain("GROUP_REVIEW_REQUIRED");
  await db.tutee.update({ where: { id: "tutee" }, data: { personId: "archive-group", status: "ACTIVE", intakeTermId: "current" } });
  expect((await preview()).blocked).toContain("NOT_HISTORICAL");
  await db.pairing.create({ data: { tutorId: "tutor", termId: "current", subject: "Math", dayOfWeek: 1, startMin: 600, endMin: 630 } });
  expect((await preview()).blocked).toContain("CURRENT_WORK");
  await db.tutorProfileOwnership.create({ data: { tutorId: "tutor", userId: "other" } });
  expect((await preview()).blocked).toContain("ACCOUNT_CONFLICT");
  await db.user.update({ where: { id: "recipient" }, data: { mustChangePassword: true } });
  expect((await preview()).blocked).toContain("ACCOUNT_NOT_READY");
  const pending = await input();
  await expect(caller().tuteeHistory.inviteExact(pending)).rejects.toThrow("HISTORY_");
  expect(mail.send).not.toHaveBeenCalled();
});

it("keeps a pending qualification with its original domain and blocks historical setup until resolved", async () => {
  await db.tutorApplication.create({ data: { id: "qualification", requestedTutorId: "tutor", type: "ADDITIONAL_SUBJECT", name: "Original Tutor", email: "archive@example.test", status: "PENDING" } });
  expect((await preview([{ kind: "TUTOR", id: "tutor" }])).blocked).toContain("CURRENT_WORK");
  expect(await db.tutorApplication.findUnique({ where: { id: "qualification" } })).toMatchObject({ status: "PENDING", requestedTutorId: "tutor" });
  expect(mail.send).not.toHaveBeenCalled();
});

it("preserves school departure and revoked participant/observer capabilities when granting historical reads", async () => {
  const departure = await db.schoolDeparture.create({ data: { userId: "recipient", reason: "GRADUATED", source: "HEAD", observerRevoked: true, effectiveAt: new Date("2025-06-01") } });
  await invite();
  await caller("recipient", "STUDENT").tuteeHistory.claim({ token: token() });
  expect(await db.schoolDeparture.findUnique({ where: { userId: "recipient" } })).toEqual(departure);
  expect(await db.user.findUnique({ where: { id: "recipient" } })).toMatchObject({ tuteeMember: false, tutorAccessRevoked: true, tutorId: null, studentId: null });
  expect(await db.policyAcceptance.count()).toBe(0);
});

it.each(["member-add", "member-remove", "member-add-remove", "owner-roundtrip", "source-group-roundtrip", "recipient-password", "issuer-password", "issuer-demotion", "recipient-email"] as const)("invalidates frozen authority after %s without changing ownership", async (change) => {
  if (change === "member-remove") await db.tutee.create({ data: { id: "sibling", englishName: "Original sibling", status: "INACTIVE", personId: "archive-group" } });
  await invite();
  const claimToken = token();
  if (change === "member-add-remove" || change === "member-add") {
    await db.tutee.create({ data: { id: "sibling", englishName: "Later sibling", status: "INACTIVE", personId: "archive-group" } });
  }
  if (change === "member-add-remove" || change === "member-remove") {
    await db.tutee.delete({ where: { id: "sibling" } });
  }
  if (change === "owner-roundtrip") {
    await db.tutorProfileOwnership.create({ data: { tutorId: "tutor", userId: "other" } });
    await db.tutorProfileOwnership.delete({ where: { tutorId: "tutor" } });
  }
  if (change === "source-group-roundtrip") {
    await db.$executeRaw`UPDATE "Tutor" SET "personId"=NULL WHERE id='tutor'`;
    await db.$executeRaw`UPDATE "Tutor" SET "personId"='archive-group' WHERE id='tutor'`;
  }
  if (change === "recipient-password" || change === "issuer-password") {
    const accountId = change === "recipient-password" ? "recipient" : actorId;
    const account = await db.user.findUniqueOrThrow({ where: { id: accountId } });
    await db.user.update({ where: { id: accountId }, data: { passwordHash: hashPassword("Changed-password-460!") } });
    await db.user.update({ where: { id: accountId }, data: { passwordHash: account.passwordHash } });
  }
  if (change === "issuer-demotion") await db.user.update({ where: { id: actorId }, data: { role: "STUDENT" } });
  if (change === "recipient-email") await db.user.update({ where: { id: "recipient" }, data: { email: "changed@example.test" } });
  await expect(caller("recipient", "STUDENT").tuteeHistory.claim({ token: claimToken })).rejects.toBeDefined();
  expect(await db.tutorProfileOwnership.count()).toBe(0);
  expect(await db.studentProfileOwnership.count()).toBe(0);
});

it("accepts a verified secondary address for its reviewed owner and rejects an unverified alias", async () => {
  const alias = "verified-alias@example.test";
  await db.accountEmail.create({ data: { email: alias, userId: "recipient", verifiedAt: new Date() } });
  await invite(sources, alias);
  await caller("recipient", "STUDENT").tuteeHistory.claim({ token: token() });
  await db.accountEmail.create({ data: { email: "unverified@example.test", userId: "other", verifiedAt: null } });
  expect((await preview([{ kind: "TUTOR", id: "tutor" }], "unverified@example.test")).blocked).toContain("ACCOUNT_NOT_READY");
});

it("keeps a recipient's multiple live logins in reviewed combine even when imported metadata says grouped", async () => {
  await db.person.create({ data: { id: "recipient-group", primaryUserId: "recipient", resolutionState: "GROUPED" } });
  await db.user.updateMany({ where: { id: { in: ["recipient", "other"] } }, data: { personId: "recipient-group" } });
  expect((await preview()).blocked).toContain("ACCOUNT_CONFLICT");
  expect(mail.send).not.toHaveBeenCalled();
});

it("keeps a published predecessor and its setup challenge intact when replacement delivery fails", async () => {
  await invite();
  const priorToken = token();
  await startHistoryAccount(db, { token: priorToken, email });
  const prior = await grant();
  mail.send.mockRejectedValueOnce(new Error("Synthetic SMTP failure"));
  const replacement = await invite(sources, "replacement@example.test");
  expect(replacement.receipt.status).toBe("DELIVERY_FAILED");
  expect(await grant()).toEqual(prior);
  expect(await caller("recipient", "STUDENT").tuteeHistory.inspectClaim({ token: priorToken })).toMatchObject({ claimed: false });
});

it("denies claimed-token receipt reads after exact retained ownership is corrected", async () => {
  await invite([{ kind: "TUTOR", id: "tutor" }]);
  const claimToken = token();
  await caller("recipient", "STUDENT").tuteeHistory.claim({ token: claimToken });
  await db.tutorProfileOwnership.update({ where: { tutorId: "tutor" }, data: { userId: "other", revision: { increment: 1 } } });
  await expect(caller("recipient", "STUDENT").tuteeHistory.inspectClaim({ token: claimToken })).rejects.toThrow("HISTORY_INVITATION_INVALID");
  await expect(caller("recipient", "STUDENT").tuteeHistory.claim({ token: claimToken })).rejects.toThrow("HISTORY_INVITATION_INVALID");
});

it("keeps exact claim read recovery durable after a later invitation replaces its mutable grant", async () => {
  await invite();
  const claimToken = token();
  await caller("recipient", "STUDENT").tuteeHistory.claim({ token: claimToken });
  await invite();
  expect(await caller("recipient", "STUDENT").tuteeHistory.inspectClaim({ token: claimToken })).toMatchObject({ claimed: true });
  expect(await db.historicalRecordClaimReceipt.count()).toBe(1);
  expect((await grant()).tokenHash).not.toBe(historyTokenDigest(claimToken));
});

it("retains the predecessor when source evidence changes during accepted delivery", async () => {
  await invite();
  const prior = await grant();
  mail.send.mockImplementationOnce(async () => { await db.person.update({ where: { id: "archive-group" }, data: { revision: { increment: 1 } } }); });
  const replacement = await invite();
  expect(replacement.receipt.status).toBe("SUPERSEDED");
  expect(await grant()).toEqual(prior);
});

it("recovers actor-bound receipts after later replacements and never resends an admitted operation", async () => {
  const first = await invite();
  const second = await invite();
  expect(first.receipt.status).toBe("PUBLISHED");
  expect(second.receipt.status).toBe("PUBLISHED");
  expect(await caller().tuteeHistory.exactInvitationReceipt({ operationId: first.payload.operationId })).toMatchObject({ status: "SUPERSEDED", email });
  expect(await caller().tuteeHistory.inviteExact(first.payload)).toMatchObject({ status: "SUPERSEDED" });
  await db.user.update({ where: { id: "other" }, data: { role: "ADMIN" } });
  expect(await caller("other").tuteeHistory.exactInvitationReceipt({ operationId: first.payload.operationId })).toBeNull();
  expect(await caller().tuteeHistory.exactInvitationReceipt({ operationId: randomUUID() })).toBeNull();
  expect(mail.send).toHaveBeenCalledTimes(2);
  await expect(caller().tuteeHistory.inviteExact({ ...first.payload, reason: "Different operation payload must be rejected" })).rejects.toThrow("HISTORY_STALE");
});

it("lets a newer failed intent supersede a slow accepted send while preserving the published predecessor", async () => {
  await invite();
  const before = await grant();
  const started = gate();
  const release = gate();
  mail.send.mockImplementationOnce(async () => { started.open(); await release.promise; });
  const older = invite();
  const settled = Promise.allSettled([older]);
  try {
    await entered(started.promise);
    mail.send.mockRejectedValueOnce(new Error("Newer synthetic rejection"));
    expect((await invite()).receipt.status).toBe("DELIVERY_FAILED");
  } finally { release.open(); await settled; }
  expect((await older).receipt.status).toBe("SUPERSEDED");
  expect(await grant()).toEqual(before);
  expect(mail.send).toHaveBeenCalledTimes(3);
});

it("cancels a first in-flight delivery before it can publish", async () => {
  const started = gate();
  const release = gate();
  mail.send.mockImplementationOnce(async () => { started.open(); await release.promise; });
  const pending = invite();
  const settled = Promise.allSettled([pending]);
  try {
    await entered(started.promise);
    const displayed = await caller().tuteeHistory.exactInvitationStatus({ sources });
    expect(displayed).toMatchObject({ invitation: null, attempt: { status: "UNCERTAIN" } });
    await caller().tuteeHistory.cancelExactInvitation({ sources, revision: displayed!.revision });
  } finally { release.open(); await settled; }
  expect((await pending).receipt.status).toBe("SUPERSEDED");
  expect(await db.historicalRecordInvitation.count()).toBe(0);
});

it("serializes simultaneous claims into one exact ownership transaction", async () => {
  await invite();
  const claimToken = token();
  await Promise.all([
    caller("recipient", "STUDENT").tuteeHistory.claim({ token: claimToken }),
    caller("recipient", "STUDENT").tuteeHistory.claim({ token: claimToken }),
  ]);
  expect(await db.auditLog.count({ where: { operation: "tuteeHistory.claimExact" } })).toBe(1);
  expect(await db.tutorProfileOwnership.count()).toBe(1);
  expect(await db.studentProfileOwnership.count()).toBe(1);
});

it("serializes claim against exact staff ownership correction without granting both accounts access", async () => {
  const scope: ExactHistorySource[] = [{ kind: "TUTOR", id: "tutor" }];
  await invite(scope);
  const claimToken = token();
  const reviewed = await previewTutorHistory(db, { tutorId: "tutor", userId: "other" });
  const results = await Promise.allSettled([
    caller("recipient", "STUDENT").tuteeHistory.claim({ token: claimToken }),
    linkTutorHistory(db, actorId, { tutorId: "tutor", userId: "other", fingerprint: reviewed.fingerprint, reason, acknowledged: true }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const owner = await db.tutorProfileOwnership.findUniqueOrThrow({ where: { tutorId: "tutor" } });
  expect(["recipient", "other"]).toContain(owner.userId);
  const excluded = owner.userId === "recipient" ? "other" : "recipient";
  await expect(caller(excluded, "STUDENT").tuteeHistory.myTutorDetails({ tutorId: "tutor", page: 0 })).rejects.toThrow("HISTORY_NOT_FOUND");
  expect(await db.studentProfileOwnership.count()).toBe(0);
});

it("rejects stale cancellation and cancels only the displayed grant without deleting any account", async () => {
  await invite();
  const oldStatus = await caller().tuteeHistory.exactInvitationStatus({ sources });
  await invite();
  await expect(caller().tuteeHistory.cancelExactInvitation({ sources, revision: oldStatus!.revision })).rejects.toThrow("HISTORY_STALE");
  const status = await caller().tuteeHistory.exactInvitationStatus({ sources });
  expect(await caller().tuteeHistory.cancelExactInvitation({ sources, revision: status!.revision })).toEqual({ cancelled: true });
  expect(await db.historicalRecordInvitation.count()).toBe(0);
  expect(await db.user.count()).toBe(3);
  expect(await db.tutorProfileOwnership.count()).toBe(0);
});

it("rolls back final publication atomically when audit fails and read recovery does not replay SMTP", async () => {
  await invite();
  const before = await grant();
  await db.$executeRawUnsafe(`CREATE FUNCTION exact_history_publication_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='tuteeHistory.inviteExactDelivery' AND NEW.details->>'outcome'='PUBLISHED' THEN RAISE EXCEPTION 'Injected publication failure'; END IF; RETURN NEW; END $$`);
  let result: Awaited<ReturnType<typeof invite>>;
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER exact_history_publication_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION exact_history_publication_failure()`);
    try { result = await invite(); }
    finally { await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS exact_history_publication_failure ON "AuditLog"`); }
  } finally { await db.$executeRawUnsafe(`DROP FUNCTION exact_history_publication_failure()`); }
  expect(result!.receipt.status).toBe("UNCERTAIN");
  expect(await grant()).toEqual(before);
  expect(await caller().tuteeHistory.exactInvitationReceipt({ operationId: result!.payload.operationId })).toMatchObject({ status: "UNCERTAIN" });
  expect(mail.send).toHaveBeenCalledTimes(2);
});

it("rolls back the entire exact claim when its audit fails", async () => {
  await invite();
  const before = await grant();
  await db.$executeRawUnsafe(`CREATE FUNCTION exact_history_claim_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='tuteeHistory.claimExact' THEN RAISE EXCEPTION 'Injected claim failure'; END IF; RETURN NEW; END $$`);
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER exact_history_claim_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION exact_history_claim_failure()`);
    try { await expect(caller("recipient", "STUDENT").tuteeHistory.claim({ token: token() })).rejects.toBeDefined(); }
    finally { await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS exact_history_claim_failure ON "AuditLog"`); }
  } finally { await db.$executeRawUnsafe(`DROP FUNCTION exact_history_claim_failure()`); }
  expect(await db.tutorProfileOwnership.count()).toBe(0);
  expect(await db.studentProfileOwnership.count()).toBe(0);
  expect(await grant()).toEqual(before);
  expect(await db.historicalRecordClaimReceipt.count()).toBe(0);
});

it("requires an actual commit owner before admitting delivery from a caller-owned transaction", async () => {
  const payload = await input();
  await expect(db.$transaction(async (tx) => databaseScope.run(tx, () => inviteExactHistory(tx, actorId, payload)))).rejects.toThrow("HISTORY_DELIVERY_COMMIT_REQUIRED");
  expect(mail.send).not.toHaveBeenCalled();
  expect(await db.historicalRecordInvitationAttempt.count()).toBe(0);
});

it("denies Coordinator mutation and recipient reads of another source even with its public ID", async () => {
  await db.user.update({ where: { id: "other" }, data: { role: "COORDINATOR" } });
  const payload = await input();
  await expect(caller("other", "COORDINATOR").tuteeHistory.inviteExact(payload)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller("recipient", "STUDENT").tuteeHistory.myTutorDetails({ tutorId: "tutor", page: 0 })).rejects.toBeDefined();
  expect(await db.historicalRecordInvitationAttempt.count()).toBe(0);
});
