import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { NAME_FIELD_KEYS, missingPersonNames, type NameFieldStates } from "~/lib/name-field-policy";
import { fullPersonName, nameDraft, optionalPersonNameFields, unsplitLegacyName } from "~/lib/person-name";
import { isLatinPrimaryName } from "~/lib/profile-policy";
import { lockUsernameNamespace } from "~/server/auth/username";
import { staleConflict } from "~/server/concurrency";
import { approvalScope } from "~/server/db-scope";
import { recordAudit } from "~/server/audit/log";
import { configuredProfileNames, getNameFieldPolicy } from "~/server/program/name-fields";
import { parsePersonNames } from "~/server/program/profile-policy";
import { lockApplicationReview } from "~/server/request-invalidity";
import { inTransaction, type DomainDb, type TransactionDb } from "~/server/transactions";

/** A deliberately small transport: contact, qualifications, consent and status are never writable here. */
export const applicationIdentityCorrectionInput = z.object({
  id: z.string().min(1).max(128),
  expectedUpdatedAt: z.coerce.date(),
  clientKey: z.string().uuid(),
  ...optionalPersonNameFields,
  reason: z.string().trim().min(1).max(1000),
}).strict();
export type ApplicationIdentityCorrectionInput = z.infer<typeof applicationIdentityCorrectionInput>;

const identitySchema = z.object({
  name: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  preferredName: z.string().nullable(),
  alternativeNames: z.string().nullable(),
});
export type ApplicationIdentityNames = z.infer<typeof identitySchema>;
type ApplicationIdentitySource = ApplicationIdentityNames & { id: string; email: string };
type IdentityActor = { id: string };
type NamePolicy = { states: NameFieldStates; version: number };
const identity = (row: ApplicationIdentityNames): ApplicationIdentityNames => ({
  name: row.name,
  firstName: row.firstName,
  lastName: row.lastName,
  preferredName: row.preferredName,
  alternativeNames: row.alternativeNames,
});
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function promotionContext(db: DomainDb, applications: ApplicationIdentitySource[]) {
  const emails = [...new Set(applications.map((app) => app.email.trim().toLowerCase()).filter(Boolean))];
  const [accounts, tutors, policy] = await Promise.all([
    db.user.findMany({ where: { email: { in: emails } }, select: {
      id: true, email: true, name: true, legacyName: true, firstName: true, lastName: true,
      preferredName: true, alternativeNames: true, emailVerifiedAt: true, tutorId: true,
      profileVersion: true, role: true, tutorAccessRevoked: true,
    } }),
    db.tutor.findMany({ where: { email: { in: emails } }, select: {
      id: true, email: true, englishName: true, firstName: true, lastName: true,
      preferredName: true, alternativeNames: true, updatedAt: true,
    } }),
    getNameFieldPolicy(db),
  ]);
  return {
    accounts: new Map(accounts.map((account) => [account.email, account])),
    tutors: new Map(tutors.map((tutor) => [tutor.email!, tutor])),
    policy: { states: policy.policies.TUTOR, version: policy.version },
  };
}

function readinessFor(app: ApplicationIdentitySource, context: Awaited<ReturnType<typeof promotionContext>>) {
  const email = app.email.trim().toLowerCase();
  const account = context.accounts.get(email);
  const tutor = context.tutors.get(email);
  const source = account?.emailVerifiedAt ? "VERIFIED_ACCOUNT" as const
    : tutor ? "EXISTING_ROSTER" as const : "APPLICATION" as const;
  // Account names and returning roster identities outrank request-local corrections.
  // No display string is split into invented first/last name boundaries.
  const chosen = source === "VERIFIED_ACCOUNT" ? identity({
    ...account!, name: account!.firstName != null
      ? fullPersonName({ firstName: account!.firstName, lastName: account!.lastName })
      : account!.legacyName ?? "",
  }) : source === "EXISTING_ROSTER" ? identity({ ...tutor!, name: tutor!.englishName }) : identity(app);
  let reason: string | null = email ? null : "APPLICATION_IDENTITY_EMAIL_REQUIRED";
  if (!reason && source === "APPLICATION") {
    const legacy = unsplitLegacyName(app);
    const missing = missingPersonNames(nameDraft(app), context.policy.states)
      .filter((key) => !(key === "firstName" && legacy?.trim()));
    if (missing.length) reason = "PROFILE_NAME_FIELDS_REQUIRED";
    else if (legacy?.trim() && !isLatinPrimaryName(legacy)) reason = "PROFILE_LATIN_NAME_REQUIRED";
    else {
      try { parsePersonNames(nameDraft(app)); }
      catch (error) { reason = error instanceof TRPCError ? error.message : "PROFILE_LATIN_NAME_REQUIRED"; }
    }
  }
  return { ready: !reason, source, reason, identity: chosen,
    accountId: account?.id ?? null, tutorId: tutor?.id ?? null };
}

/** Promotion and staff warnings share precedence and current requiredness without allocating anything. */
export async function applicationPromotionReadiness(db: DomainDb, app: ApplicationIdentitySource) {
  return readinessFor(app, await promotionContext(db, [app]));
}

/** Lists fetch policy/accounts/rosters once, avoiding correction-history reads for every row. */
export async function applicationIdentitySummaries(db: DomainDb, applications: ApplicationIdentitySource[]) {
  const context = await promotionContext(db, applications);
  return new Map(applications.map((app) => {
    const readiness = readinessFor(app, context);
    return [app.id, { needsReview: !readiness.ready, readiness }] as const;
  }));
}

function ineligibleReason(app: {
  type: string; status: string; recalledAt: Date | null; decidedAt: Date | null;
  decidedByTutorId: string | null; interviewCompletedAt: Date | null;
  promotedTutorId: string | null; qualificationDecidedById: string | null;
}, invitations: number) {
  if (app.type !== "INITIAL") return "APPLICATION_IDENTITY_NOT_INITIAL";
  if (!["PENDING", "INTERVIEW"].includes(app.status) || app.recalledAt)
    return "APPLICATION_IDENTITY_NOT_OPEN";
  if (app.decidedAt || app.decidedByTutorId || app.interviewCompletedAt || app.qualificationDecidedById)
    return "APPLICATION_IDENTITY_DECIDED";
  if (app.promotedTutorId || invitations) return "APPLICATION_IDENTITY_PROVISIONED";
  return null;
}

/** Read-only recovery never invents evidence or alters a draft's version. */
export async function applicationIdentitySnapshot(db: DomainDb, applicationId: string) {
  // A reader must not pair pre-correction effective names with post-correction
  // history. Locked writers reuse their enclosing transaction; standalone reads
  // get one consistent snapshot without acquiring a write lock.
  return inTransaction(db, (tx) => readIdentitySnapshot(tx, applicationId), {
    isolationLevel: "RepeatableRead",
  });
}

async function readIdentitySnapshot(db: DomainDb, applicationId: string) {
  const app = await db.tutorApplication.findUnique({ where: { id: applicationId } });
  if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "APPLICATION_IDENTITY_NOT_FOUND" });
  const [saved, history, invitationCount, context] = await Promise.all([
    db.applicationIdentityOriginal.findUnique({ where: { applicationId } }),
    db.applicationIdentityCorrection.findMany({ where: { applicationId }, orderBy: { revision: "desc" }, select: {
      revision: true, actorId: true, actorName: true, reason: true, before: true, after: true,
      createdAt: true, approvalId: true,
    } }),
    db.registrationCode.count({ where: { applicationId } }),
    promotionContext(db, [app]),
  ]);
  if (!saved) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "APPLICATION_IDENTITY_ORIGINAL_MISSING" });
  const email = app.email.trim().toLowerCase();
  const account = context.accounts.get(email);
  const provisioning = { accountId: account?.id ?? null,
    verifiedAccount: !!account?.emailVerifiedAt, existingTutorId: context.tutors.get(email)?.id ?? null,
    invitationCount, account: account ?? null, existingTutor: context.tutors.get(email) ?? null };
  const unavailable = ineligibleReason(app, invitationCount);
  return {
    id: app.id, expectedUpdatedAt: app.updatedAt,
    original: identitySchema.parse(saved.original), current: identity(app), revision: app.identityRevision,
    history, eligible: !unavailable, ineligibleReason: unavailable,
    readiness: readinessFor(app, context), policy: context.policy, provisioning,
  };
}

async function lockedActor(tx: TransactionDb, actor: IdentityActor, apply: boolean) {
  // A role loss cannot commit between authorization and the receipt/evidence write.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: {
    id: true, name: true, username: true, role: true, suspendedAt: true, mergedIntoId: true,
  } });
  if (!current || current.suspendedAt || current.mergedIntoId ||
    (apply ? current.role !== "HEAD" : !["HEAD", "ADMIN"].includes(current.role)))
    throw new TRPCError({ code: "FORBIDDEN", message: "APPLICATION_IDENTITY_AUTHORITY_REQUIRED" });
  return { id: current.id, name: current.name ?? current.username ?? current.id, role: current.role };
}

async function correctedNames(db: DomainDb, current: ApplicationIdentityNames,
  input: ApplicationIdentityCorrectionInput, policy: NamePolicy) {
  const posted = { ...current };
  for (const key of NAME_FIELD_KEYS) if (input[key] !== undefined) posted[key] = input[key] ?? null;
  const originalDraft = nameDraft(current);
  const draft = nameDraft(posted);
  const legacy = unsplitLegacyName(current);
  const retainsUnsplit = !!legacy && (["firstName", "lastName", "preferredName"] as const)
    .every((key) => originalDraft[key].trim() === draft[key].trim());
  if (retainsUnsplit) {
    // A spelling in another language does not claim to resolve missing Latin parts.
    // Retain every null legacy part even when later policy requires Last/Preferred;
    // readiness still exposes that unresolved requirement before a new promotion.
    if (policy.states.alternativeNames === "required" && !draft.alternativeNames.trim())
      throw new TRPCError({ code: "BAD_REQUEST", message: "PROFILE_NAME_FIELDS_REQUIRED" });
    if (draft.alternativeNames.trim() !== originalDraft.alternativeNames.trim())
      parsePersonNames({ firstName: "", lastName: "", alternativeNames: draft.alternativeNames });
    return { ...current, alternativeNames: input.alternativeNames === undefined
      ? current.alternativeNames : input.alternativeNames?.trim() ?? null };
  }
  const currentProfile = { ...current, legacyName: legacy };
  const parsed = await configuredProfileNames(db, draft,
    currentProfile, "TUTOR", true);
  const next = { ...current };
  // Preserve unchanged null versus empty evidence; normalize only deliberate edits.
  for (const key of NAME_FIELD_KEYS) {
    if (input[key] === undefined || (!legacy && draft[key].trim() === originalDraft[key].trim())) continue;
    next[key] = parsed[key] ?? null;
  }
  next.name = fullPersonName({ firstName: next.firstName ?? "", lastName: next.lastName });
  return next;
}

async function validateLocked(tx: TransactionDb, input: ApplicationIdentityCorrectionInput) {
  const snapshot = await applicationIdentitySnapshot(tx, input.id);
  if (!snapshot.eligible) throw new TRPCError({ code: "PRECONDITION_FAILED", message: snapshot.ineligibleReason! });
  if (snapshot.expectedUpdatedAt.getTime() !== input.expectedUpdatedAt.getTime()) staleConflict();
  const next = await correctedNames(tx, snapshot.current, input, snapshot.policy);
  if (JSON.stringify(next) === JSON.stringify(snapshot.current))
    throw new TRPCError({ code: "BAD_REQUEST", message: "APPLICATION_IDENTITY_NO_CHANGE" });
  return { ...snapshot, next };
}

/** Capture must validate the same draft under the same locks before Admin proposal interception. */
export async function validateApplicationIdentityCorrection(db: DomainDb,
  raw: ApplicationIdentityCorrectionInput, actor: IdentityActor) {
  const input = applicationIdentityCorrectionInput.parse(raw);
  return inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    await lockApplicationReview(tx, input.id);
    await lockedActor(tx, actor, false);
    return validateLocked(tx, input);
  });
}

/** The correction, projection, audit and retry receipt commit together; acceptance is a separate workflow. */
export async function correctApplicationIdentity(db: DomainDb,
  raw: ApplicationIdentityCorrectionInput, actor: IdentityActor) {
  const input = applicationIdentityCorrectionInput.parse(raw);
  const inputHash = digest({ id: input.id, expectedUpdatedAt: input.expectedUpdatedAt.toISOString(),
    fields: Object.fromEntries(NAME_FIELD_KEYS.filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]])), reason: input.reason });
  return inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    await lockApplicationReview(tx, input.id);
    const applyingActor = await lockedActor(tx, actor, true);
    const approvalId = approvalScope.getStore();
    const receiptOwner = approvalId ? `approval:${approvalId}` : `actor:${applyingActor.id}`;
    const receipt = await tx.applicationIdentityCorrection.findUnique({
      where: { receiptOwner_clientKey: { receiptOwner, clientKey: input.clientKey } },
    });
    if (receipt) {
      if (receipt.inputHash !== inputHash)
        throw new TRPCError({ code: "CONFLICT", message: "APPLICATION_IDENTITY_RETRY_CHANGED" });
      return { ok: true as const, revision: receipt.revision, updatedAt: receipt.appliedUpdatedAt, replayed: true };
    }
    const snapshot = await validateLocked(tx, input);
    const revision = snapshot.revision + 1;
    // Always advance the optimistic token even if a very fast edit shares a millisecond.
    const updatedAt = new Date(Math.max(Date.now(), snapshot.expectedUpdatedAt.getTime() + 1));
    await tx.tutorApplication.update({ where: { id: input.id, updatedAt: input.expectedUpdatedAt },
      data: { ...snapshot.next, identityRevision: revision, updatedAt } });
    await tx.applicationIdentityCorrection.create({ data: {
      applicationId: input.id, revision, actorId: applyingActor.id, actorName: applyingActor.name,
      reason: input.reason, before: snapshot.current, after: snapshot.next,
      policy: snapshot.policy, approvalId, receiptOwner, clientKey: input.clientKey,
      inputHash, appliedUpdatedAt: updatedAt,
    } });
    await recordAudit({ userId: applyingActor.id, userName: applyingActor.name, role: applyingActor.role,
      operation: "admin.correctApplicationIdentity", entity: "TutorApplication", entityId: input.id,
      action: "Corrected pending tutor application names", reason: input.reason,
      before: { ...snapshot.current, identityRevision: snapshot.revision },
      after: { ...snapshot.next, identityRevision: revision },
      effects: { originalIdentityPreserved: true, consentPreserved: true, invalidityPreserved: true,
        qualificationsPreserved: true, accountIdentityPreserved: true },
    }, tx);
    return { ok: true as const, revision, updatedAt, replayed: false };
  });
}
