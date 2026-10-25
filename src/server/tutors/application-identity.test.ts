import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { approvalScope, databaseScope } from "~/server/db-scope";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { codePrefill, completeRegistration, confirmEmailCode, setEmailVerification } from "~/server/auth/registration";
import { promoteApplicantToTutor } from "./promote";
import {
  applicationIdentityCorrectionInput,
  applicationIdentitySnapshot,
  applicationIdentitySummaries,
  applicationPromotionReadiness,
  correctApplicationIdentity,
  validateApplicationIdentityCorrection,
  type ApplicationIdentityCorrectionInput,
} from "./application-identity";

const head = { id: "identity-head" };
const acceptedAt = new Date("2026-08-19T09:11:12.123Z");
const fixture = (name = "王小明") => db.tutorApplication.create({ data: {
  name, email: "candidate@example.test", preferredContact: "Original contact instructions",
  policyRevision: "original-policy-revision", policySnapshot: { body: "Original signed policy" },
  policyAcceptedAt: acceptedAt,
} });
async function qualificationFixture(type: "ADDITIONAL_SUBJECT" | "HIGHER_LEVEL") {
  const tutor = await db.tutor.create({ data: {
    englishName: "Qualification Tutor", email: "tutor@example.test",
    user: { connect: { id: "identity-tutor" } },
  } });
  const subject = await db.subject.create({ data: { name: "Qualification Mathematics" } });
  return db.tutorApplication.create({ data: {
    name: "Qualification Tutor", email: "tutor@example.test", type,
    requestedTutorId: tutor.id, requestedSubjectId: subject.id,
    qualificationReason: "Requesting review of additional subject evidence.",
  } });
}
const correction = (app: { id: string; updatedAt: Date },
  fields: Partial<ApplicationIdentityCorrectionInput> = {}): ApplicationIdentityCorrectionInput => ({
  id: app.id, expectedUpdatedAt: app.updatedAt, clientKey: randomUUID(),
  firstName: "Xiaoming", lastName: "Wang", preferredName: "Ming", alternativeNames: "王小明",
  reason: "Applicant confirmed the explicit spelling and name parts.", ...fields,
});
const setPolicy = (states: Record<string, string>) => db.programSettings.upsert({
  where: { id: "program" }, create: { id: "program", nameFields: { TUTOR: states }, nameFieldsVersion: 1 },
  update: { nameFields: { TUTOR: states }, nameFieldsVersion: { increment: 1 } },
});
const fetchApplication = (id: string) => db.tutorApplication.findUniqueOrThrow({ where: { id } });
/** Exercise actual mailbox proof creation rather than forging registration sub-state. */
async function verifiedInvitation(id: string, email: string) {
  let row = await db.registrationCode.findUniqueOrThrow({ where: { id } });
  const challenge = await setEmailVerification(row, email);
  if (!challenge.ok) throw new Error("Expected an invitation mailbox challenge");
  row = await db.registrationCode.findUniqueOrThrow({ where: { id } });
  const verification = await confirmEmailCode(row, challenge.emailCode);
  if (!verification.ok) throw new Error("Expected verified invitation mailbox proof");
  return { row: await db.registrationCode.findUniqueOrThrow({ where: { id } }),
    completionProof: verification.completionProof };
}
const forgedRegistrationProfile = {
  firstName: "Posted", lastName: "Replacement", preferredName: "Forged", alternativeNames: "替换姓名",
  password: "SyntheticRegistrationPassword42!",
};

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Use the serial shbs_shipping_test database");
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  // Full isolated resets deliberately use TRUNCATE: operational DELETE must retain audit evidence.
  await db.$executeRawUnsafe("TRUNCATE " + tables
    .map((table) => '"' + table.tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  for (const role of ["HEAD", "ADMIN", "COORDINATOR", "VIEWER", "TUTOR", "STUDENT", "CREW"] as const)
    await db.user.create({ data: { id: `identity-${role.toLowerCase()}`, role,
      name: `Synthetic ${role}`, username: `identity-${role.toLowerCase()}`,
      email: `${role.toLowerCase()}@example.test`, emailVerifiedAt: new Date() } });
});
afterAll(() => db.$disconnect());

it("captures immutable originals and appends corrections without altering contact, consent or lifecycle", async () => {
  const app = await fixture();
  const first = await applicationIdentitySnapshot(db, app.id);
  expect(first.original).toEqual({ name: "王小明", firstName: null, lastName: null,
    preferredName: null, alternativeNames: null });
  expect(first.readiness).toMatchObject({ ready: false, reason: "PROFILE_LATIN_NAME_REQUIRED" });
  expect(await correctApplicationIdentity(db, correction(app), head)).toMatchObject({ revision: 1, replayed: false });
  const after = await fetchApplication(app.id);
  expect(after).toMatchObject({ name: "Xiaoming Wang", firstName: "Xiaoming", lastName: "Wang",
    preferredName: "Ming", alternativeNames: "王小明", identityRevision: 1,
    email: app.email, preferredContact: app.preferredContact, createdAt: app.createdAt,
    policyRevision: app.policyRevision, policySnapshot: app.policySnapshot, policyAcceptedAt: acceptedAt,
    status: "PENDING", decidedAt: null, interviewCompletedAt: null, promotedTutorId: null });
  expect(after.updatedAt.getTime()).toBeGreaterThan(app.updatedAt.getTime());
  await correctApplicationIdentity(db, correction(after, { preferredName: "Xiao" }), head);
  const snapshot = await applicationIdentitySnapshot(db, app.id);
  expect(snapshot.original).toEqual(first.original);
  expect(snapshot.history.map((row) => row.revision)).toEqual([2, 1]);
  expect(snapshot.history[0]).toMatchObject({ actorName: "Synthetic HEAD", reason: correction(app).reason,
    before: { preferredName: "Ming" }, after: { preferredName: "Xiao" } });
  expect(await db.auditLog.count({ where: { operation: "admin.correctApplicationIdentity" } })).toBe(2);
  expect(await db.auditLog.findFirst({ where: { operation: "admin.correctApplicationIdentity" },
    orderBy: { createdAt: "desc" } })).toMatchObject({ details: {
      before: { identityRevision: 1 }, after: { identityRevision: 2 },
    } });
  expect(await db.registrationCode.count()).toBe(0);
  expect(await db.notification.count()).toBe(0);
});

it("keeps audit and same-intent receipts after operational deletion and rejects evidence rewrites", async () => {
  const app = await fixture();
  const input = correction(app);
  const result = await correctApplicationIdentity(db, input, head);
  await db.tutorApplication.delete({ where: { id: app.id } });
  expect(await db.applicationIdentityOriginal.count({ where: { applicationId: app.id } })).toBe(1);
  expect(await db.applicationIdentityCorrection.count({ where: { applicationId: app.id } })).toBe(1);
  await expect(correctApplicationIdentity(db, input, head)).resolves.toEqual({ ...result, replayed: true });
  await expect(db.applicationIdentityOriginal.update({ where: { applicationId: app.id },
    data: { original: { name: "tampered" } } })).rejects.toThrow();
  await expect(db.applicationIdentityCorrection.deleteMany({ where: { applicationId: app.id } })).rejects.toThrow();
  await expect(db.applicationIdentityOriginal.delete({ where: { applicationId: app.id } })).rejects.toThrow();
});

it.each(["lastName", "preferredName"])("preserves legacy nulls on alternate-only edits when %s later becomes required", async (required) => {
  const app = await fixture();
  await setPolicy({ firstName: "required", [required]: "required" });
  await correctApplicationIdentity(db, { id: app.id, expectedUpdatedAt: app.updatedAt,
    clientKey: randomUUID(), alternativeNames: "小明 / Мин", reason: "Additional-language spelling confirmed." }, head);
  expect(await fetchApplication(app.id)).toMatchObject({ name: "王小明", firstName: null,
    lastName: null, preferredName: null, alternativeNames: "小明 / Мин", policyAcceptedAt: acceptedAt });
  expect((await applicationIdentitySnapshot(db, app.id)).readiness).toMatchObject({
    ready: false, reason: "PROFILE_NAME_FIELDS_REQUIRED" });
  await expect(promoteApplicantToTutor(app.id)).rejects.toMatchObject({ message: "PROFILE_NAME_FIELDS_REQUIRED" });
});

it.each([
  { firstName: "Élodie", lastName: "Dvořák", preferredName: "Élo", alternativeNames: "艾洛蒂" },
  { firstName: "Madonna", lastName: "", preferredName: "", alternativeNames: "" },
])("accepts explicit accented Latin and optional blank components: $firstName", async (fields) => {
  const app = await fixture("Мария");
  await correctApplicationIdentity(db, correction(app, fields), head);
  const saved = await fetchApplication(app.id);
  expect(saved.firstName).toBe(fields.firstName);
  expect(saved.lastName).toBe(fields.lastName);
  // Deliberately blank supplied parts remain distinct from the original nulls.
  expect(saved.preferredName).toBe(fields.preferredName);
  expect(saved.alternativeNames).toBe(fields.alternativeNames);
  expect((await applicationIdentitySnapshot(db, app.id)).original.preferredName).toBeNull();
  expect((await applicationPromotionReadiness(db, saved)).ready).toBe(true);
});

it.each(["Аlice", "Alice123", "Alice🙂", "Ali\u200bce", "王小明"])(
  "rejects deliberate invalid Latin replacement %s atomically", async (firstName) => {
    const app = await fixture();
    await expect(correctApplicationIdentity(db, correction(app, { firstName }), head))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "PROFILE_LATIN_NAME_REQUIRED" });
    expect(await fetchApplication(app.id)).toEqual(app);
    expect(await db.applicationIdentityCorrection.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  },
);

it("rejects forged contact/status/qualification fields and reasonless edits at the transport boundary", async () => {
  const app = await fixture();
  for (const forbidden of [{ email: "other@example.test" }, { status: "ACCEPTED" },
    { policySnapshot: {} }, { requestedSubjectId: "fake" }])
    expect(applicationIdentityCorrectionInput.safeParse({ ...correction(app), ...forbidden }).success).toBe(false);
  expect(applicationIdentityCorrectionInput.safeParse(correction(app, { reason: "   " })).success).toBe(false);
});

it("allows Admin validated capture but only current Head application", async () => {
  const app = await fixture();
  const input = correction(app);
  await expect(validateApplicationIdentityCorrection(db, input, { id: "identity-admin" }))
    .resolves.toMatchObject({ revision: 0, next: { firstName: "Xiaoming" } });
  await expect(correctApplicationIdentity(db, input, { id: "identity-admin" }))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.user.update({ where: { id: head.id }, data: { role: "ADMIN" } });
  await expect(correctApplicationIdentity(db, input, head)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await fetchApplication(app.id)).toEqual(app);
});

it.each(["coordinator", "viewer", "tutor", "student", "crew"])("denies %s before proposal capture as well as direct application", async (role) => {
  const app = await fixture();
  const actor = { id: `identity-${role}` };
  await expect(validateApplicationIdentityCorrection(db, correction(app), actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(correctApplicationIdentity(db, correction(app), actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.applicationIdentityCorrection.count()).toBe(0);
});

it.each(["ACCEPTED", "REJECTED"] as const)("denies terminal %s applications", async (status) => {
  const app = await fixture();
  const closed = await db.tutorApplication.update({ where: { id: app.id }, data: { status } });
  await expect(correctApplicationIdentity(db, correction(closed), head))
    .rejects.toMatchObject({ message: "APPLICATION_IDENTITY_NOT_OPEN" });
});

it.each(["ADDITIONAL_SUBJECT", "HIGHER_LEVEL"] as const)("denies %s qualification requests", async (type) => {
  const request = await qualificationFixture(type);
  await expect(correctApplicationIdentity(db, correction(request), head))
    .rejects.toMatchObject({ message: "APPLICATION_IDENTITY_NOT_INITIAL" });
  expect(await fetchApplication(request.id)).toEqual(request);
  expect(await db.applicationIdentityCorrection.count()).toBe(0);
});

it("denies a recalled qualification request while retaining its recall evidence", async () => {
  // Recall belongs to qualification requests; INITIAL + RECALLED is forbidden by
  // the database itself, so use the real retained-request shape for this boundary.
  const request = await qualificationFixture("ADDITIONAL_SUBJECT");
  const recalled = await db.tutorApplication.update({ where: { id: request.id }, data: {
    status: "RECALLED", recalledAt: new Date(), recalledById: "identity-tutor",
  } });
  await expect(correctApplicationIdentity(db, correction(recalled), head))
    .rejects.toMatchObject({ message: "APPLICATION_IDENTITY_NOT_INITIAL" });
  expect(await fetchApplication(request.id)).toEqual(recalled);
  expect(await db.applicationIdentityCorrection.count()).toBe(0);
});

it.each(["decision", "completion", "promotion", "invitation"] as const)("rejects already provisioned/final evidence: %s", async (state) => {
  const app = await fixture();
  const request = await db.tutorApplication.update({ where: { id: app.id }, data: {
    ...(state === "decision" ? { decidedAt: new Date() } : {}),
    ...(state === "completion" ? { interviewCompletedAt: new Date() } : {}),
    ...(state === "promotion" ? { promotedTutorId: "previous-tutor" } : {}),
  } });
  if (state === "invitation") await db.registrationCode.create({ data: {
    applicationId: app.id, email: app.email, expiresAt: new Date(0),
  } });
  await expect(correctApplicationIdentity(db, correction(request), head))
    .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.applicationIdentityCorrection.count()).toBe(0);
});

it("corrects flagged open names without clearing invalidity or permitting promotion", async () => {
  const app = await fixture();
  const flagged = await db.tutorApplication.update({ where: { id: app.id }, data: {
    invalidatedAt: new Date(), invalidReason: "Review contact evidence", invalidatedById: head.id,
    invalidatedByName: "Synthetic HEAD", invalidityVersion: 4,
  } });
  await correctApplicationIdentity(db, correction(flagged), head);
  expect(await fetchApplication(app.id)).toMatchObject({
    invalidatedAt: flagged.invalidatedAt, invalidReason: flagged.invalidReason,
    invalidatedById: head.id, invalidatedByName: "Synthetic HEAD", invalidityVersion: 4,
  });
  await expect(promoteApplicantToTutor(app.id)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.registrationCode.count()).toBe(0);
});

it("recovers same-intent retries once and rejects a reused key with different names or reason", async () => {
  const app = await fixture();
  const input = correction(app);
  const first = await correctApplicationIdentity(db, input, head);
  await expect(correctApplicationIdentity(db, input, head)).resolves.toEqual({ ...first, replayed: true });
  for (const change of [{ firstName: "Other" }, { reason: "Different intent" }])
    await expect(correctApplicationIdentity(db, { ...input, ...change }, head))
      .rejects.toMatchObject({ code: "CONFLICT", message: "APPLICATION_IDENTITY_RETRY_CHANGED" });
  expect(await db.applicationIdentityCorrection.count()).toBe(1);
  expect(await db.auditLog.count()).toBe(1);
});

it("separates approval receipt ownership from the Head and other Admin approvals", async () => {
  const app = await fixture();
  const input = correction(app);
  await correctApplicationIdentity(db, input, head);
  const second = correction(await fetchApplication(app.id), { clientKey: input.clientKey, firstName: "Ming" });
  const approved = await approvalScope.run("approval-one", () => correctApplicationIdentity(db, second, head));
  await expect(approvalScope.run("approval-one", () => correctApplicationIdentity(db, second, head)))
    .resolves.toEqual({ ...approved, replayed: true });
  const third = correction(await fetchApplication(app.id), { clientKey: input.clientKey, firstName: "Xiao" });
  await approvalScope.run("approval-two", () => correctApplicationIdentity(db, third, head));
  expect((await db.applicationIdentityCorrection.findMany({ orderBy: { revision: "asc" } }))
    .map((row) => row.receiptOwner)).toEqual([`actor:${head.id}`, "approval:approval-one", "approval:approval-two"]);
});

it("serializes competing corrections and refuses a stale version without partial evidence", async () => {
  const app = await fixture();
  const results = await Promise.allSettled([
    correctApplicationIdentity(db, correction(app, { firstName: "First" }), head),
    correctApplicationIdentity(db, correction(app, { firstName: "Second" }), head),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
  expect(await db.applicationIdentityCorrection.count()).toBe(1);
  expect((await fetchApplication(app.id)).identityRevision).toBe(1);
});

it("concurrent copies of the same intent create one revision and one audit", async () => {
  const app = await fixture();
  const input = correction(app);
  const results = await Promise.all([
    correctApplicationIdentity(db, input, head),
    correctApplicationIdentity(db, input, head),
  ]);
  expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
  expect(results[0].revision).toBe(results[1].revision);
  expect(await db.applicationIdentityCorrection.count()).toBe(1);
  expect(await db.auditLog.count()).toBe(1);
});

it("rolls back projection, append-only evidence, audit and receipt with an outer transaction failure", async () => {
  const app = await fixture();
  const input = correction(app);
  await expect(db.$transaction((tx) => databaseScope.run(tx, async () => {
    await correctApplicationIdentity(db, input, head);
    throw new Error("Synthetic downstream failure");
  }))).rejects.toThrow("Synthetic downstream failure");
  expect(await fetchApplication(app.id)).toEqual(app);
  expect(await db.applicationIdentityCorrection.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
  await expect(correctApplicationIdentity(db, input, head)).resolves.toMatchObject({ revision: 1, replayed: false });
});

it("an actual audit insertion failure also rolls back the correction receipt and application projection", async () => {
  const app = await fixture();
  const input = correction(app);
  // The deliberately failing trigger lives only in this transaction. PostgreSQL
  // rolls it back with the rejected audit, so no shared test fixture is modified.
  await expect(db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE FUNCTION test_identity_audit_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic identity audit failure'; END; $$`);
    await tx.$executeRawUnsafe(`CREATE TRIGGER test_identity_audit_failure BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION test_identity_audit_failure()`);
    await correctApplicationIdentity(tx, input, head);
  })).rejects.toThrow();
  expect(await fetchApplication(app.id)).toEqual(app);
  expect(await db.applicationIdentityCorrection.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
  await expect(correctApplicationIdentity(db, input, head)).resolves.toMatchObject({ revision: 1 });
});

it("rechecks changed requiredness, while hidden policy permits explicit staff correction without erasing retained fields", async () => {
  const app = await fixture();
  const input = correction(app, { lastName: "" });
  await validateApplicationIdentityCorrection(db, input, { id: "identity-admin" });
  await setPolicy({ firstName: "required", lastName: "required" });
  await expect(correctApplicationIdentity(db, input, head)).rejects.toMatchObject({ message: "PROFILE_NAME_FIELDS_REQUIRED" });
  await setPolicy({ firstName: "hidden", lastName: "hidden", preferredName: "hidden", alternativeNames: "hidden" });
  await correctApplicationIdentity(db, correction(app), head);
  expect(await fetchApplication(app.id)).toMatchObject({ firstName: "Xiaoming", lastName: "Wang", alternativeNames: "王小明" });
});

it("retains an unsplit Latin legacy name and does not infer its components", async () => {
  const app = await fixture("Mary Jane Watson");
  expect(await applicationPromotionReadiness(db, app)).toMatchObject({ ready: true,
    identity: { name: "Mary Jane Watson", firstName: null, lastName: null } });
  const summaries = await applicationIdentitySummaries(db, [app]);
  expect(summaries.get(app.id)?.needsReview).toBe(false);
  await setPolicy({ lastName: "required" });
  expect((await applicationPromotionReadiness(db, app)).ready).toBe(false);
});

it("honors verified-account and existing-roster precedence without rewriting either identity", async () => {
  const app = await fixture();
  const account = await db.user.create({ data: { email: app.email, username: "stablehandle", role: "STUDENT",
    firstName: "Verified", lastName: "Owner", name: "Verified Owner", emailVerifiedAt: new Date() } });
  await correctApplicationIdentity(db, correction(app), head);
  const corrected = await fetchApplication(app.id);
  expect(await applicationPromotionReadiness(db, corrected)).toMatchObject({ ready: true,
    source: "VERIFIED_ACCOUNT", identity: { firstName: "Verified", lastName: "Owner" } });
  expect(await db.user.findUnique({ where: { id: account.id } })).toEqual(account);
  await promoteApplicantToTutor(app.id);
  expect(await db.tutor.findUnique({ where: { email: app.email } })).toMatchObject({
    firstName: "Verified", lastName: "Owner", username: "stablehandle" });
  expect(await db.user.findUnique({ where: { id: account.id } })).toMatchObject({
    firstName: account.firstName, lastName: account.lastName,
    preferredName: account.preferredName, alternativeNames: account.alternativeNames,
    username: "stablehandle",
  });
  expect(await db.registrationCode.count()).toBe(0);
});

it("does not treat an unverified login as authoritative and grandfathers an existing roster", async () => {
  const app = await fixture();
  await db.user.create({ data: { email: app.email, name: "Unverified Name", role: "STUDENT" } });
  expect(await applicationPromotionReadiness(db, app)).toMatchObject({ ready: false, source: "APPLICATION" });
  const tutor = await db.tutor.create({ data: { email: app.email, englishName: "旧名", status: "ARCHIVED" } });
  expect(await applicationPromotionReadiness(db, app)).toMatchObject({ ready: true, source: "EXISTING_ROSTER" });
  await correctApplicationIdentity(db, correction(app), head);
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toEqual(tutor);
});

it("returning-roster prefill and full registration retain its established identity and stable handle", async () => {
  const app = await fixture();
  const roster = await db.tutor.create({ data: { email: app.email, firstName: "Roster", lastName: "Owner",
    preferredName: "Ro", alternativeNames: "原名", englishName: "Roster Owner", username: "retainedhandle", status: "ARCHIVED" } });
  await correctApplicationIdentity(db, correction(app, { firstName: "Changed", lastName: "Applicant" }), head);
  await db.tutorApplication.update({ where: { id: app.id }, data: { status: "ACCEPTED", decidedAt: new Date() } });
  await promoteApplicantToTutor(app.id);
  const after = await db.tutor.findUniqueOrThrow({ where: { id: roster.id } });
  expect(after).toMatchObject({ firstName: roster.firstName, lastName: roster.lastName,
    preferredName: roster.preferredName, alternativeNames: roster.alternativeNames,
    username: "retainedhandle", status: "ACTIVE" });
  const code = await db.registrationCode.findFirstOrThrow({ where: { applicationId: app.id } });
  expect(await codePrefill(code, db)).toMatchObject({ firstName: "Roster", lastName: "Owner",
    preferredName: "Ro", alternativeNames: "原名" });
  expect((await applicationIdentitySnapshot(db, app.id)).current).toMatchObject({ firstName: "Changed", lastName: "Applicant" });
  const verified = await verifiedInvitation(code.id, app.email);
  expect(await completeRegistration(verified.row, {
    ...forgedRegistrationProfile, completionProof: verified.completionProof,
  }, db)).toMatchObject({ ok: true, username: "retainedhandle" });
  const canonical = await db.user.findUniqueOrThrow({ where: { email: app.email } });
  const expected = { firstName: "Roster", lastName: "Owner", preferredName: "Ro",
    alternativeNames: "原名", username: "retainedhandle" };
  expect(canonical).toMatchObject({ ...expected, tutorId: roster.id });
  expect(await db.tutor.findUniqueOrThrow({ where: { id: roster.id } })).toMatchObject(expected);
  const redeemedCode = await db.registrationCode.findUniqueOrThrow({ where: { id: code.id } });
  expect(redeemedCode.usedByUserId).toBe(canonical.id);
  expect(redeemedCode.usedAt).toBeInstanceOf(Date);
  expect((await applicationIdentitySnapshot(db, app.id)).current).toMatchObject({ firstName: "Changed", lastName: "Applicant" });
});

it("retains an unsplit returning-roster original through registration without inventing name parts", async () => {
  const app = await fixture();
  const roster = await db.tutor.create({ data: { email: app.email, englishName: "旧名",
    alternativeNames: "原始姓名", username: "legacyhandle", status: "ARCHIVED" } });
  await correctApplicationIdentity(db, correction(app), head);
  await db.tutorApplication.update({ where: { id: app.id }, data: { status: "ACCEPTED", decidedAt: new Date() } });
  await promoteApplicantToTutor(app.id);
  const code = await db.registrationCode.findFirstOrThrow({ where: { applicationId: app.id } });
  expect(await codePrefill(code, db)).toMatchObject({ firstName: "", lastName: "",
    preferredName: "", alternativeNames: "原始姓名", legacyName: "旧名" });
  const verified = await verifiedInvitation(code.id, app.email);
  expect(await completeRegistration(verified.row, {
    ...forgedRegistrationProfile, completionProof: verified.completionProof,
  }, db)).toMatchObject({ ok: true, username: "legacyhandle" });
  const expected = { firstName: null, lastName: null, preferredName: null,
    alternativeNames: "原始姓名", legacyName: "旧名", username: "legacyhandle" };
  expect(await db.user.findUniqueOrThrow({ where: { email: app.email } })).toMatchObject({
    ...expected, tutorId: roster.id,
  });
  expect(await db.tutor.findUniqueOrThrow({ where: { id: roster.id } })).toMatchObject(expected);
  expect((await applicationIdentitySnapshot(db, app.id)).current.firstName).toBe("Xiaoming");
});

it.each(["Other", null])("preserves alternate-only or nameless returning identity through completion: %s", async (alternativeNames) => {
  await db.programSettings.create({ data: {
    id: "program", showAlternateNames: true,
    nameFields: { TUTOR: { firstName: "optional", lastName: "optional",
      preferredName: "optional", alternativeNames: "optional" } },
  } });
  const app = await fixture();
  // Empty input label permits the database formatter to show the alternate name
  // or handle while preserving the absence of an original unsplit Latin name.
  const roster = await db.tutor.create({ data: { email: app.email, englishName: "",
    firstName: null, lastName: null, preferredName: null, legacyName: null,
    alternativeNames, username: "member", status: "ARCHIVED" } });
  const retained = { firstName: null, lastName: null, preferredName: null,
    legacyName: null, alternativeNames, username: "member" };
  expect(roster).toMatchObject({ ...retained, englishName: alternativeNames ?? "member" });
  await correctApplicationIdentity(db, correction(app), head);
  await db.tutorApplication.update({ where: { id: app.id }, data: { status: "ACCEPTED", decidedAt: new Date() } });
  await promoteApplicantToTutor(app.id);
  const code = await db.registrationCode.findFirstOrThrow({ where: { applicationId: app.id } });
  expect(await codePrefill(code, db)).toMatchObject({ firstName: "", lastName: "", preferredName: "",
    alternativeNames: alternativeNames ?? "", legacyName: null });
  const verified = await verifiedInvitation(code.id, app.email);
  expect(await completeRegistration(verified.row, {
    ...forgedRegistrationProfile, completionProof: verified.completionProof,
  }, db)).toMatchObject({ ok: true, username: "member" });
  const canonical = await db.user.findUniqueOrThrow({ where: { email: app.email } });
  expect(canonical).toMatchObject({ ...retained, tutorId: roster.id, name: alternativeNames ?? "member" });
  expect(await db.tutor.findUniqueOrThrow({ where: { id: roster.id } }))
    .toMatchObject({ ...retained, englishName: alternativeNames ?? "member" });

  // Hiding alternate display must reveal only the stable handle. If redemption
  // invented a legacy original, it would persist visibly after this policy change.
  await db.programSettings.update({ where: { id: "program" }, data: { showAlternateNames: false } });
  expect(await db.user.findUniqueOrThrow({ where: { id: canonical.id } }))
    .toMatchObject({ ...retained, name: "member" });
  expect(await db.tutor.findUniqueOrThrow({ where: { id: roster.id } }))
    .toMatchObject({ ...retained, englishName: "member" });
  expect(await codePrefill(code, db)).toMatchObject({ legacyName: null });
  expect((await applicationIdentitySnapshot(db, app.id)).current.firstName).toBe("Xiaoming");
});

it("corrected application readiness cannot restore Head-revoked access and explicit restoration keeps canonical identity", async () => {
  await db.term.create({ data: { name: "Correction Q1", schoolYear: "26-27", quarter: "Q1", active: true } });
  const panel = [head.id, "identity-admin", "identity-tutor"];
  for (const id of panel) {
    await db.tutor.create({ data: { id: `${id}-tutor`, englishName: "Synthetic Panelist" } });
    await db.user.update({ where: { id }, data: { tutorId: `${id}-tutor` } });
  }
  await db.subject.create({ data: { id: "identity-math", name: "Synthetic Mathematics" } });
  await db.tutorQualification.create({ data: { tutorId: "identity-tutor-tutor", subjectId: "identity-math",
    approvedById: head.id, grants: { create: { subjectId: "identity-math" } } } });
  const app = await db.tutorApplication.create({ data: { name: "王小明", email: "candidate@example.test", status: "INTERVIEW",
    policyRevision: "signed-policy", policySnapshot: { body: "Signed original" }, policyAcceptedAt: acceptedAt,
    subjectIntents: { create: { subjectId: "identity-math", taken: true, grade: "A" } },
    interviewers: { create: panel.map((id) => ({ tutorId: `${id}-tutor`, isHead: id === head.id })) },
    votes: { create: panel.map((id) => ({ tutorId: `${id}-tutor`, accept: true, comment: "Original vote" })) },
  } });
  const canonicalNames = { firstName: "Canonical", lastName: "Owner", preferredName: "Cano",
    alternativeNames: "原有姓名", username: "retainedowner" };
  const roster = await db.tutor.create({ data: { ...canonicalNames, englishName: "Canonical Owner", email: app.email } });
  const account = await db.user.create({ data: { ...canonicalNames, name: "Canonical Owner", email: app.email,
    role: "TUTOR", tutorId: roster.id, emailVerifiedAt: new Date() } });
  const session: Session = { user: { id: head.id, name: "Synthetic HEAD", email: "head@example.test" },
    role: "HEAD", tutorId: `${head.id}-tutor`, expires: "2099-01-01" };
  const caller = createCaller({ db, headers: new Headers(), session });
  const input = correction(app, { firstName: "Mary Jane", lastName: "Watson", preferredName: "MJ" });
  const receipt = await correctApplicationIdentity(db, input, head);
  await caller.admin.setUserCanTutor({ userId: account.id, canTutor: false });
  const corrected = await fetchApplication(app.id);
  expect(await applicationPromotionReadiness(db, corrected)).toMatchObject({ ready: true,
    source: "VERIFIED_ACCOUNT", identity: { firstName: "Canonical", lastName: "Owner" } });

  // Name readiness is independent from Head's membership restriction. Even a Head
  // chair cannot turn a valid request-local correction into implicit restoration.
  const decision = { applicationId: app.id, accept: true, comment: "Panel admission",
    expectedUpdatedAt: corrected.updatedAt, completion: { completedAt: new Date("2026-09-15T04:00:00Z"),
      durationMin: 45, attendedTutorIds: panel.map((id) => `${id}-tutor`) } };
  const persistedState = async () => ({
    app: await fetchApplication(app.id),
    account: await db.user.findUniqueOrThrow({ where: { id: account.id } }),
    tutors: await db.tutor.findMany({ orderBy: { id: "asc" } }),
    votes: await db.interviewVote.findMany({ where: { applicationId: app.id }, orderBy: { tutorId: "asc" } }),
    codes: await db.registrationCode.findMany({ orderBy: { id: "asc" } }),
    notices: await db.notification.findMany({ orderBy: { id: "asc" } }),
    hours: await db.serviceHourAdjustment.findMany({ orderBy: { id: "asc" } }),
    academics: await db.academicProfile.findMany({ orderBy: { userId: "asc" } }),
    history: await db.historicalAcademicRecord.findMany({ orderBy: { id: "asc" } }),
    original: await db.applicationIdentityOriginal.findUniqueOrThrow({ where: { applicationId: app.id } }),
    corrections: await db.applicationIdentityCorrection.findMany({ where: { applicationId: app.id }, orderBy: { revision: "asc" } }),
    correctionAudit: await db.auditLog.findMany({ where: { operation: "admin.correctApplicationIdentity", entityId: app.id },
      orderBy: { id: "asc" } }),
  });
  const before = await persistedState();
  expect(before.account).toMatchObject({ ...canonicalNames, tutorId: roster.id, tutorAccessRevoked: true });
  expect(before.tutors.find((tutor) => tutor.id === roster.id)).toMatchObject({ ...canonicalNames, status: "ARCHIVED" });
  expect(before.app).toMatchObject({ status: "INTERVIEW", promotedTutorId: null, interviewCompletedAt: null });
  expect(before.codes).toEqual([]);
  expect(before.notices).toEqual([]);
  expect(before.hours).toEqual([]);
  await expect(caller.tutor.decideInterview(decision)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await persistedState()).toEqual(before);
  await expect(correctApplicationIdentity(db, input, head)).resolves.toEqual({ ...receipt, replayed: true });

  // Only the separate Head action restores membership. Fresh approval then keeps
  // the established account/roster identity while preserving the corrected request.
  await caller.admin.setUserCanTutor({ userId: account.id, canTutor: true });
  const current = await fetchApplication(app.id);
  await expect(caller.tutor.decideInterview({ ...decision, expectedUpdatedAt: current.updatedAt }))
    .resolves.toEqual({ ok: true });
  expect(await fetchApplication(app.id)).toMatchObject({ status: "ACCEPTED", promotedTutorId: roster.id,
    firstName: "Mary Jane", lastName: "Watson", preferredName: "MJ", identityRevision: 1,
    policyRevision: app.policyRevision, policySnapshot: app.policySnapshot, policyAcceptedAt: acceptedAt });
  expect(await db.user.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({
    ...canonicalNames, tutorId: roster.id, tutorAccessRevoked: false });
  expect(await db.tutor.findUniqueOrThrow({ where: { id: roster.id } })).toMatchObject({
    ...canonicalNames, status: "ACTIVE" });
  expect(await db.tutor.count()).toBe(4);
  expect(await db.registrationCode.count()).toBe(0);
  expect(await db.serviceHourAdjustment.count()).toBe(3);
  const after = await persistedState();
  expect(after.original).toEqual(before.original);
  expect(after.corrections).toEqual(before.corrections);
  expect(after.correctionAudit).toEqual(before.correctionAudit);
  const snapshot = await applicationIdentitySnapshot(db, app.id);
  expect(snapshot.original.name).toBe("王小明");
  expect(snapshot.history).toHaveLength(1);
  expect(snapshot.history[0]).toMatchObject({ before: { name: "王小明" },
    after: { firstName: "Mary Jane", lastName: "Watson" } });
  await expect(correctApplicationIdentity(db, input, head)).resolves.toEqual({ ...receipt, replayed: true });
});

it("normal chair approval uses corrected explicit names for roster and invitation and keeps atomic service", async () => {
  await db.term.create({ data: { name: "Correction Q1", schoolYear: "26-27", quarter: "Q1", active: true } });
  const panel = [head.id, "identity-admin", "identity-tutor"];
  for (const id of panel) {
    await db.tutor.create({ data: { id: `${id}-tutor`, englishName: "Synthetic Panelist" } });
    await db.user.update({ where: { id }, data: { tutorId: `${id}-tutor` } });
  }
  await db.subject.create({ data: { id: "identity-math", name: "Synthetic Mathematics" } });
  await db.tutorQualification.create({ data: { tutorId: "identity-tutor-tutor", subjectId: "identity-math",
    approvedById: head.id, grants: { create: { subjectId: "identity-math" } } } });
  const app = await db.tutorApplication.create({ data: { name: "王小明", email: "candidate@example.test", status: "INTERVIEW",
    policyRevision: "signed-policy", policySnapshot: { body: "Signed original" }, policyAcceptedAt: acceptedAt,
    subjectIntents: { create: { subjectId: "identity-math", taken: true, grade: "A" } },
    interviewers: { create: panel.map((id) => ({ tutorId: `${id}-tutor`, isHead: id === head.id })) },
    votes: { create: panel.map((id) => ({ tutorId: `${id}-tutor`, accept: true, comment: "Original vote" })) },
  } });
  const session: Session = { user: { id: head.id, name: "Synthetic HEAD", email: "head@example.test" },
    role: "HEAD", tutorId: `${head.id}-tutor`, expires: "2099-01-01" };
  const caller = createCaller({ db, headers: new Headers(), session });
  const decision = { applicationId: app.id, accept: true, comment: "Panel admission",
    expectedUpdatedAt: app.updatedAt, completion: { completedAt: new Date("2026-09-15T04:00:00Z"),
      durationMin: 45, attendedTutorIds: panel.map((id) => `${id}-tutor`) } };
  await correctApplicationIdentity(db, correction(app, { firstName: "Mary Jane", lastName: "Watson", preferredName: "MJ" }), head);
  await expect(caller.tutor.decideInterview(decision)).rejects.toMatchObject({ code: "CONFLICT" });
  const updated = await fetchApplication(app.id);
  await caller.tutor.decideInterview({ ...decision, expectedUpdatedAt: updated.updatedAt });
  const admitted = await fetchApplication(app.id);
  expect(admitted).toMatchObject({ status: "ACCEPTED", interviewDurationMin: 45,
    policyRevision: app.policyRevision, policySnapshot: app.policySnapshot, policyAcceptedAt: acceptedAt });
  expect(await db.tutor.findUnique({ where: { id: admitted.promotedTutorId! } })).toMatchObject({
    firstName: "Mary Jane", lastName: "Watson", preferredName: "MJ", username: "mwatson" });
  const codes = await db.registrationCode.findMany({ where: { applicationId: app.id } });
  expect(codes).toHaveLength(1);
  expect(await codePrefill(codes[0]!, db)).toMatchObject({ firstName: "Mary Jane", lastName: "Watson",
    preferredName: "MJ", alternativeNames: "王小明", boundEmail: app.email });
  expect(await db.interviewVote.count({ where: { applicationId: app.id } })).toBe(3);
  expect(await db.serviceHourAdjustment.count()).toBe(3);
  expect((await applicationIdentitySnapshot(db, app.id)).original.name).toBe("王小明");
  await caller.tutor.decideInterview({ ...decision, expectedUpdatedAt: updated.updatedAt });
  expect(await db.registrationCode.count({ where: { applicationId: app.id } })).toBe(1);
  expect(await db.serviceHourAdjustment.count()).toBe(3);
  const verified = await verifiedInvitation(codes[0]!.id, app.email);
  expect(await completeRegistration(verified.row, {
    ...forgedRegistrationProfile, completionProof: verified.completionProof,
  }, db)).toMatchObject({ ok: true, username: "mwatson" });
  const canonical = await db.user.findUniqueOrThrow({ where: { email: app.email } });
  const expected = { firstName: "Mary Jane", lastName: "Watson", preferredName: "MJ",
    alternativeNames: "王小明", username: "mwatson" };
  expect(canonical).toMatchObject({ ...expected, tutorId: admitted.promotedTutorId });
  expect(await db.tutor.findUniqueOrThrow({ where: { id: admitted.promotedTutorId! } })).toMatchObject(expected);
  const redeemedCode = await db.registrationCode.findUniqueOrThrow({ where: { id: codes[0]!.id } });
  expect(redeemedCode.usedByUserId).toBe(canonical.id);
  expect(redeemedCode.usedAt).toBeInstanceOf(Date);
  expect((await applicationIdentitySnapshot(db, app.id)).original.name).toBe("王小明");
  expect(await db.user.count({ where: { email: app.email } })).toBe(1);
  expect(await db.serviceHourAdjustment.count()).toBe(3);
});
