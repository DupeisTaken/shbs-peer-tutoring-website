import { applyAcademicIntake, synchronizeAcademicMirrors, accountAcademics } from "~/server/academics";
import {
  lockAccountProfile,
  updateAccountProfile,
} from "~/server/account-profile";
/**
 * Self-registration via a 6-digit security key (RegistrationCode).
 *
 * Admins/coordinators issue a single-use code (optionally bound to an email and/or an existing
 * roster Tutor, or generated when an application is accepted) and hand it to the intended person.
 * The registrant then, at /register: (1) enters the code, (2) verifies their email with a second
 * emailed 6-digit code, and (3) sets their name / grade / password — which creates (or links) a
 * Tutor and a fully-verified login. This guarantees every account has a validated email and
 * self-set credentials.
 *
 * Security notes:
 *  - The registration code is stored in plaintext so admins can re-display it on the codes menu.
 *    It's a weak secret deliberately: single-use, a short (7-day) expiry, and per-IP + per-code
 *    rate limiting bound its value, so a DB-at-rest concern is limited to short-lived invites.
 *  - The separate emailed email-verification code IS stored hashed (HMAC keyed with AUTH_SECRET)
 *    since it's never re-displayed; see `setEmailVerification`/`confirmEmailCode`.
 *
 * Node runtime only (touches the database + Node crypto).
 */
import { createHmac } from "crypto";
import { isManagementCode, type RegistrationKind } from "~/lib/registration-kind";
import { TRPCError } from "@trpc/server";
import { inTransaction, lockEntity, type DomainDb } from "~/server/transactions";
import type { TransactionDb } from "~/server/transactions";

import { env } from "~/env";
import { db } from "~/server/db";
import { hashPassword } from "./password";
import { generateRegistrationCode, normalizeRegCode } from "./code";
import { defaultUsername, ensureUniqueUsername, canonicalUsername, ensureUserUsername, lockUsernameNamespace } from "./username";
import { assertPrimaryName, assertOfferedGrade } from "~/server/program/profile-policy";
import { needsAcademicConfirmationForParticipation } from "~/lib/academics";
import { graduationYear } from "~/lib/period";

/** Registration codes stay valid for one week — long enough to distribute and use. */
export const CODE_TTL_DAYS = 7;
/** The emailed email-verification code is short-lived. */
export const EMAIL_CODE_TTL_MINUTES = 15;
/** Hard caps on guesses before a code/email-code is burned (defence in depth atop rate limiting). */
const MAX_CODE_ATTEMPTS = 10;
const MAX_EMAIL_CODE_ATTEMPTS = 6;

function secret(): string {
  if (env.AUTH_SECRET) return env.AUTH_SECRET;
  // Fail closed in production even if env validation was skipped (e.g. SKIP_ENV_VALIDATION):
  // the dev fallback must never hash real OTPs/registration codes. Dev/test only.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET must be set in production (it keys OTP and registration-code hashing).",
    );
  }
  return "dev-insecure-registration-secret";
}

/** Keyed (HMAC) hash of a code — deterministic for lookup, not offline-brute-forceable. Normalizes
 *  first (uppercase, strip separators) so the 5-char Steam-format OTPs compare case-insensitively. */
export function hashCode(code: string): string {
  return createHmac("sha256", secret())
    .update(normalizeRegCode(code))
    .digest("hex");
}

/** Completion grants are high-entropy, purpose-bound proofs returned only after an OTP succeeds.
 * The exact challenge hash and verification timestamp invalidate grants on resend/reverification.
 * Expiry and single use are enforced by the account-write transaction, not by browser state. */
export function registrationCompletionProof(
  purpose: "viewer" | "invitation",
  id: string,
  codeHash: string,
  verifiedAt: Date,
): string {
  return createHmac("sha256", secret())
    .update(JSON.stringify(["registration-completion", purpose, id, codeHash, verifiedAt.toISOString()]))
    .digest("hex");
}

export interface IssueCodeOptions {
  email?: string | null;
  tutorId?: string | null;
  applicationId?: string | null;
  /** The CrewApplication this code was issued for (revoking the code reverts it to PENDING). */
  crewApplicationId?: string | null;
  label?: string | null;
  issuedById?: string | null;
  issuedByName?: string | null;
  /** Participation codes create Tutor/Crew access; management kinds create only their rank. */
  kind?: RegistrationKind;
}

/**
 * Issue a new registration code. Returns the plaintext code plus the row id. On the rare collision
 * (same 6-digit code already outstanding) it retries.
 */
export async function issueRegistrationCode(
  opts: IssueCodeOptions,
  client: DomainDb = db,
): Promise<{ id: string; code: string; expiresAt: Date }> {
  // Management invitations are durable Head authorization. Check the issuer even
  // when called outside the admin router, and never attach participation records.
  if (isManagementCode(opts.kind ?? "TUTOR")) {
    return inTransaction(client, async (tx) => {
      if (opts.issuedById) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${opts.issuedById} FOR SHARE`;
      const issuer = opts.issuedById ? await tx.user.findUnique({ where: { id: opts.issuedById } }) : null;
      if (issuer?.role !== "HEAD" || issuer.suspendedAt)
        throw new TRPCError({ code: "FORBIDDEN", message: "Only Head may issue management invitations." });
      if (opts.tutorId || opts.applicationId || opts.crewApplicationId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Management invitations cannot grant participation." });
      return createRegistrationCode(opts, tx);
    });
  }
  return createRegistrationCode(opts, client);
}

async function createRegistrationCode(opts: IssueCodeOptions, client: DomainDb) {
  const expiresAt = new Date(Date.now() + CODE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const email = opts.email?.trim() ? opts.email.trim().toLowerCase() : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRegistrationCode();
    const clash = await client.registrationCode.findUnique({
      where: { code },
      select: { id: true },
    });
    if (clash) continue;
    const row = await client.registrationCode.create({
      data: {
        code,
        kind: opts.kind ?? "TUTOR",
        email,
        tutorId: opts.tutorId ?? null,
        applicationId: opts.applicationId ?? null,
        crewApplicationId: opts.crewApplicationId ?? null,
        label: opts.label?.trim() ? opts.label.trim() : null,
        issuedById: opts.issuedById ?? null,
        issuedByName: opts.issuedByName ?? null,
        expiresAt,
      },
      select: { id: true },
    });
    return { id: row.id, code, expiresAt };
  }
  throw new Error("Could not generate a unique registration code.");
}

type CodeRow = NonNullable<Awaited<ReturnType<typeof loadCode>>>;

/** Load a code row by its plaintext value (no validity checks). */
async function loadCode(code: string) {
  return db.registrationCode.findUnique({ where: { code } });
}

export type CodeError = "not-found" | "expired" | "used" | "too-many-attempts";

/** Resolve a usable (unused, unexpired, under attempt cap) code, or an error reason. */
export async function resolveUsableCode(
  code: string,
): Promise<{ ok: true; row: CodeRow } | { ok: false; error: CodeError }> {
  const row = await loadCode(code);
  if (!row) return { ok: false, error: "not-found" };
  if (row.usedAt) return { ok: false, error: "used" };
  if (row.expiresAt < new Date()) return { ok: false, error: "expired" };
  if (row.attempts >= MAX_CODE_ATTEMPTS)
    return { ok: false, error: "too-many-attempts" };
  return { ok: true, row };
}

/** Count a failed guess against a code. */
export async function bumpCodeAttempt(id: string): Promise<void> {
  await db.registrationCode.update({
    where: { id },
    data: { attempts: { increment: 1 } },
  });
}

/**
 * Prefill / binding info for the registration form: any bound email, and (when the code links an
 * existing roster Tutor or an accepted application) the known name + grade so the form starts
 * pre-populated.
 */
export async function codePrefill(row: CodeRow): Promise<{
  boundEmail: string | null;
  firstName: string;
  lastName: string;
  alternativeNames: string;
  gradeLevel: number | null;
  gradeSchoolYear: string | null;
}> {
  let firstName = "";
  let lastName = "";
  let alternativeNames = "";
  let gradeLevel: number | null = null;
  let gradeSchoolYear: string | null = null;

  if (row.tutorId) {
    const tutor = await db.tutor.findUnique({
      where: { id: row.tutorId },
      select: {
        firstName: true,
        lastName: true,
        englishName: true,
        alternativeNames: true,
        gradeLevel: true,
        gradeSchoolYear: true,
      },
    });
    if (tutor) {
      const [efirst, ...erest] = tutor.englishName.trim().split(/\s+/);
      firstName = tutor.firstName ?? efirst ?? "";
      lastName = tutor.lastName ?? erest.join(" ");
      alternativeNames = tutor.alternativeNames ?? "";
      gradeLevel = tutor.gradeLevel;
      gradeSchoolYear = tutor.gradeSchoolYear;
    }
  } else if (row.applicationId) {
    const app = await db.tutorApplication.findUnique({
      where: { id: row.applicationId },
      select: { name: true },
    });
    if (app) {
      const [afirst, ...arest] = app.name.trim().split(/\s+/);
      firstName = afirst ?? app.name.trim();
      lastName = arest.join(" ");
    }
  }
  if (row.crewApplicationId) {
    const application = await db.crewApplication.findUnique({ where: { id: row.crewApplicationId }, select: { name: true, gradeLevel: true } });
    if (application) {
      const [first, ...rest] = application.name.trim().split(/\s+/);
      firstName = first ?? "";
      lastName = rest.join(" ");
      gradeLevel = application.gradeLevel;
      // A historical application has no academic reference year; the registrant confirms it.
    }
  }
  return {
    boundEmail: row.email?.toLowerCase() ?? null,
    firstName,
    lastName,
    alternativeNames,
    gradeLevel,
    gradeSchoolYear,
  };
}

/**
 * Stage the email-verification step: store the email + a hashed 6-digit email code (and its
 * expiry) on the code row. Returns the plaintext email code so the caller can send it. Enforces
 * any email binding on the code.
 */
export async function setEmailVerification(
  row: CodeRow,
  email: string,
): Promise<
  { ok: true; emailCode: string } | { ok: false; error: "email-mismatch" }
> {
  const normalized = email.trim().toLowerCase();
  if (row.email && row.email.toLowerCase() !== normalized) {
    return { ok: false, error: "email-mismatch" };
  }
  const emailCode = generateRegistrationCode();
  const changed = await db.registrationCode.updateMany({
    where: {
      id: row.id,
      usedAt: null,
      expiresAt: { gt: new Date() },
      pendingEmail: row.pendingEmail,
      emailCodeHash: row.emailCodeHash,
    },
    data: {
      pendingEmail: normalized,
      emailCodeHash: hashCode(emailCode),
      emailCodeExpiresAt: new Date(
        Date.now() + EMAIL_CODE_TTL_MINUTES * 60 * 1000,
      ),
      emailCodeAttempts: 0,
      emailVerifiedAt: null,
    },
  });
  if (changed.count !== 1) return { ok: false, error: "email-mismatch" };
  return { ok: true, emailCode };
}

/** Verify the emailed 6-digit code; on success stamp emailVerifiedAt on the code row. */
export async function confirmEmailCode(
  row: CodeRow,
  emailCode: string,
): Promise<
  | { ok: true; completionProof: string }
  | {
      ok: false;
      error: "no-pending" | "expired" | "too-many-attempts" | "mismatch";
    }
> {
  if (!row.emailCodeHash || !row.pendingEmail || !row.emailCodeExpiresAt) {
    return { ok: false, error: "no-pending" };
  }
  if (row.emailCodeExpiresAt < new Date())
    return { ok: false, error: "expired" };
  if (row.emailCodeAttempts >= MAX_EMAIL_CODE_ATTEMPTS) {
    return { ok: false, error: "too-many-attempts" };
  }
  if (hashCode(emailCode) !== row.emailCodeHash) {
    await db.registrationCode.updateMany({
      where: {
        id: row.id,
        usedAt: null,
        emailCodeHash: row.emailCodeHash,
        emailCodeAttempts: { lt: MAX_EMAIL_CODE_ATTEMPTS },
      },
      data: { emailCodeAttempts: { increment: 1 } },
    });
    return { ok: false, error: "mismatch" };
  }
  const verifiedAt = new Date();
  const verified = await db.registrationCode.updateMany({
    where: {
      id: row.id,
      usedAt: null,
      pendingEmail: row.pendingEmail,
      emailCodeHash: row.emailCodeHash,
      emailCodeAttempts: { lt: MAX_EMAIL_CODE_ATTEMPTS },
      emailCodeExpiresAt: { gt: new Date() },
    },
    data: { emailVerifiedAt: verifiedAt },
  });
  return verified.count === 1
    ? { ok: true, completionProof: registrationCompletionProof("invitation", row.id, row.emailCodeHash, verifiedAt) }
    : { ok: false, error: "mismatch" };
}

export interface CompleteRegistrationInput {
  completionProof: string;
  firstName: string;
  lastName: string;
  alternativeNames?: string | null;
  gradeLevel?: number | null;
  preferredLatinName?: string;
  gradeSchoolYear?: string | null;
  password: string;
}

/**
 * Finish registration: create or link a Tutor and a fully-verified login, then burn the code.
 * Requires the code's email to be verified (emailVerifiedAt + pendingEmail set). The email is the
 * verified pendingEmail (or the bound email). Returns the resolved username.
 */
export async function completeRegistration(
  row: CodeRow,
  input: CompleteRegistrationInput,
): Promise<
  | { ok: true; username: string; academicConfirmationRequired?: boolean }
  | { ok: false; error: "email-unverified" | "email-taken" }
> {
  if (!row.emailVerifiedAt || !row.pendingEmail || !row.emailCodeHash ||
      !row.emailCodeExpiresAt || row.emailCodeExpiresAt <= new Date() ||
      input.completionProof !== registrationCompletionProof("invitation", row.id, row.emailCodeHash, row.emailVerifiedAt)) {
    return { ok: false, error: "email-unverified" };
  }
  const email = (row.email ?? row.pendingEmail).toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const alternativeNames = input.alternativeNames?.trim()
    ? input.alternativeNames.trim()
    : null;
  const gradeLevel = input.gradeLevel ?? null;

  // A login may already exist on this email (e.g. a roster tutor invited earlier). Guard against
  // hijacking a DIFFERENT person's account: only reuse it when it's unlinked or links this tutor.
  const existingUser = await db.user.findUnique({
    where: { email },
    select: { id: true, tutorId: true, role: true, username: true },
  });
  if (
    row.kind !== "CREW" &&
    existingUser?.tutorId &&
    existingUser.tutorId !== row.tutorId
  ) {
    return { ok: false, error: "email-taken" };
  }

  if (existingUser?.role === "VIEWER") return { ok: false, error: "email-taken" };

  const passwordHash = hashPassword(input.password);

  // Elevated codes only create new accounts. Existing primary/secondary email owners
  // must use Head's profile workflow; redemption never resets credentials or ranks.
  if (isManagementCode(row.kind)) {
    const role = row.kind;
    return db.$transaction(async (tx) => {
      await lockEntity(tx, "program:period");
      const term = await tx.term.findFirst({ where: { active: true }, select: { schoolYear: true } });
      const gradYear = gradeLevel != null && term ? graduationYear(gradeLevel, term.schoolYear) : null;
      await assertPrimaryName(tx, [firstName, lastName].filter(Boolean).join(" "));
      await assertOfferedGrade(tx, gradeLevel);
      if (gradeLevel != null && !term) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PROFILE_NO_CURRENT_YEAR" });
      await lockUsernameNamespace(tx);
      await tx.$executeRaw`LOCK TABLE "User", "AccountEmail", "Tutor" IN SHARE ROW EXCLUSIVE MODE`;
      const owner = await tx.user.findFirst({ where: { OR: [
        { email: { equals: email, mode: "insensitive" } },
        { emails: { some: { email: { equals: email, mode: "insensitive" } } } },
      ] } });
      if (owner) return { ok: false as const, error: "email-taken" as const };
      await claimRegistration(tx, row);
      const username = await ensureUniqueUsername(defaultUsername(firstName, lastName, gradYear, input.preferredLatinName), {}, tx);
      const user = await tx.user.create({ data: {
        email, username, name: `${firstName} ${lastName}`, alternativeNames, role, gradeLevel,
        passwordHash, emailVerifiedAt: new Date(), mustChangePassword: false,
      } });
      await applyAcademicIntake(tx, user.id, gradeLevel, term?.schoolYear ?? null, new Date(), "REGISTRATION");
      await tx.registrationCode.update({ where: { id: row.id }, data: { usedByUserId: user.id } });
      await tx.auditLog.create({ data: {
        userId: user.id, userName: user.name, entity: "RegistrationCode", entityId: row.id,
        operation: "registration.complete", kind: "ACTION", action: `Redeemed ${role} registration code`,
        details: { role, issuedById: row.issuedById, recipientId: user.id },
      } });
      return { ok: true as const, username };
    });
  }

  // ---- Crew-only registration (no Tutor) -----------------------------------
  if (row.kind === "CREW") {
    const result = await db.$transaction(async (tx) => {
      await lockEntity(tx, "program:period");
      await lockUsernameNamespace(tx);
      const term = await tx.term.findFirst({ where: { active: true }, select: { schoolYear: true } });
      const gradYear = gradeLevel != null && term
        ? graduationYear(gradeLevel, term.schoolYear) : null;
      const existingUser = await tx.user.findUnique({ where: { email } });
      await assertPrimaryName(tx, existingUser?.name ?? [firstName, lastName].filter(Boolean).join(" "), existingUser?.name);
      await assertOfferedGrade(tx, gradeLevel);
      if (gradeLevel != null && !term) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PROFILE_NO_CURRENT_YEAR" });
      if (existingUser?.role === "VIEWER")
        throw new TRPCError({ code: "CONFLICT", message: "Account membership changed. Ask Head to review this invitation." });
      await claimRegistration(tx, row);
      if (existingUser) {
        await lockAccountProfile(tx, existingUser.id);
        const priorCrewStatus = (await tx.user.findUniqueOrThrow({ where: { id: existingUser.id }, select: { crewStatus: true } })).crewStatus;
        // A login already exists for this verified email — grant crew access after academic review.
        // Existing credentials/role are left untouched (we don't overwrite a tutor/admin's account).
        await tx.user.update({
          where: { id: existingUser.id },
          data: { crewStatus: "ACTIVE", gradeLevel },
        });
        await tx.registrationCode.update({
          where: { id: row.id },
          data: { usedAt: new Date(), usedByUserId: existingUser.id },
        });
        await applyAcademicIntake(tx, existingUser.id, gradeLevel, term?.schoolYear ?? null, new Date(), "REGISTRATION");
        await synchronizeAcademicMirrors(tx, existingUser.id);
        const academicConfirmationRequired = needsAcademicConfirmationForParticipation((await accountAcademics(tx, existingUser.id)).academic);
        // Crew has no pending state: retain staff suspension, otherwise use its existing reentry flow.
        if (academicConfirmationRequired) await tx.user.update({
          where: { id: existingUser.id },
          data: { crewStatus: priorCrewStatus === "INACTIVE" ? "INACTIVE" : "OPTED_OUT" },
        });
        return { username: await ensureUserUsername(existingUser.id, tx, { preferredLatinName: input.preferredLatinName }),
          ...(academicConfirmationRequired ? { academicConfirmationRequired: true } : {}) };
      }
      const desiredUsername = await ensureUniqueUsername(
        defaultUsername(firstName, lastName, gradYear, input.preferredLatinName),
        {},
        tx,
      );
      const created = await tx.user.create({
        data: {
          email,
          username: desiredUsername,
          name: `${firstName} ${lastName}`,
          alternativeNames,
          role: "CREW",
          gradeLevel,
          crewStatus: "ACTIVE",
          passwordHash,
          mustChangePassword: false,
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      });
      await tx.registrationCode.update({
        where: { id: row.id },
        data: { usedAt: new Date(), usedByUserId: created.id },
      });
      await applyAcademicIntake(tx, created.id, gradeLevel, term?.schoolYear ?? null, new Date(), "REGISTRATION");
      const academicConfirmationRequired = needsAcademicConfirmationForParticipation((await accountAcademics(tx, created.id)).academic);
      if (academicConfirmationRequired) await tx.user.update({ where: { id: created.id }, data: { crewStatus: "OPTED_OUT" } });
      return { username: desiredUsername, ...(academicConfirmationRequired ? { academicConfirmationRequired: true } : {}) };
    });
    return { ok: true, ...result };
  }

  const result = await db.$transaction(async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    const term = await tx.term.findFirst({ where: { active: true }, select: { schoolYear: true } });
    const gradYear = gradeLevel != null && term
      ? graduationYear(gradeLevel, term.schoolYear) : null;
    let existingUser = await tx.user.findUnique({ where: { email } });
    if (existingUser) {
      await lockAccountProfile(tx, existingUser.id);
      // The unchanged-name exemption must use the current locked identity. A profile
      // edit may have committed while registration was waiting for the account lock.
      existingUser = await tx.user.findUniqueOrThrow({ where: { id: existingUser.id } });
    }
    await assertOfferedGrade(tx, gradeLevel);
    if (gradeLevel != null && !term) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PROFILE_NO_CURRENT_YEAR" });
    if (existingUser?.role === "VIEWER" || (existingUser?.tutorId && existingUser.tutorId !== row.tutorId))
      throw new TRPCError({ code: "CONFLICT", message: "Account membership changed. Ask Head to review this invitation." });
    await claimRegistration(tx, row);
    if (existingUser) {
      // Resolve academic ownership before allocating a first handle. Conflicting invitation
      // input cannot stamp the rejected grade onto an account that did not yet have a handle.
      await applyAcademicIntake(tx, existingUser.id, gradeLevel, term?.schoolYear ?? null, new Date(), "REGISTRATION");
    }
    const retainedAcademic = existingUser ? (await accountAcademics(tx, existingUser.id)).academic : null;
    const usernameGradYear = existingUser
      ? retainedAcademic?.confirmedAt ? retainedAcademic.expectedGraduationYear : null
      : gradYear;
    // Resolve (or create) the Tutor.
    let tutorId: string;
    if (row.tutorId) {
      tutorId = row.tutorId;
    } else {
      // Reuse an existing tutor on this email if present, else create one.
      const byEmail = await tx.tutor.findUnique({
        where: { email },
        select: { id: true },
      });
      tutorId = byEmail?.id ?? "";
    }

    const rosterTutor = tutorId ? await tx.tutor.findUniqueOrThrow({ where: { id: tutorId } }) : null;
    // An invited roster is already an identity too. Preserve its unchanged name when
    // creating its first login, while any existing canonical account takes precedence.
    // The namespace lock serializes edits to provisional roster names.
    await assertPrimaryName(tx, [firstName, lastName].filter(Boolean).join(" "),
      existingUser ? existingUser.name : rosterTutor?.englishName);
    // Account ownership wins; a genuinely new account adopts its roster's provisional handle.
    const desiredUsername = await canonicalUsername(tx,
      defaultUsername(firstName, lastName, usernameGradYear, input.preferredLatinName), {
        excludeTutorId: tutorId || undefined, excludeUserId: existingUser?.id,
        userUsername: existingUser?.username, tutorUsername: rosterTutor?.username,
      });

    if (tutorId) {
      await tx.tutor.update({
        where: { id: tutorId },
        data: {
          firstName,
          lastName,
          englishName: `${firstName} ${lastName}`,
          alternativeNames,
          gradeLevel,
          email,
          username: desiredUsername,
          status: "ACTIVE",
        },
      });
    } else {
      const created = await tx.tutor.create({
        data: {
          firstName,
          lastName,
          englishName: `${firstName} ${lastName}`,
          alternativeNames,
          gradeLevel,
          email,
          username: desiredUsername,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      tutorId = created.id;
    }

    // Create or update the login (verified, password set, onboarding cleared).
    let userId: string;
    if (existingUser) {
      await tx.user.update({
        where: { id: existingUser.id },
        data: {
          tutorId,
          tutorAccessRevoked: false,
          username: desiredUsername,
          name: `${firstName} ${lastName}`,
          passwordHash,
          mustChangePassword: false,
          emailVerifiedAt: new Date(),
          // Auto-merge: a crew-only login that completes a tutor code becomes a tutor (keeping crew).
          ...(existingUser.role === "CREW"
            ? { role: "TUTOR" as const }
            : {}),
        },
      });
      userId = existingUser.id;
    } else {
      const createdUser = await tx.user.create({
        data: {
          email,
          username: desiredUsername,
          name: `${firstName} ${lastName}`,
          role: "TUTOR",
          tutorId,
          tutorAccessRevoked: false,
          passwordHash,
          mustChangePassword: false,
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      });
      userId = createdUser.id;
    }

    await updateAccountProfile(tx, userId, {
      name: `${firstName} ${lastName}`,
      alternativeNames,
    });

    // Repair legacy divergence without treating the roster alias as a second account identity.
    if (existingUser?.username && rosterTutor && rosterTutor.username !== desiredUsername)
      await tx.auditLog.create({ data: {
        userId, entity: "User", entityId: userId, operation: "identity.reconcileUsername",
        kind: "ACTION", action: "Synchronized tutor username to account",
        details: { username: desiredUsername, oldTutorUsername: rosterTutor.username, tutorId },
      } });
    if (!existingUser) await applyAcademicIntake(tx, userId, gradeLevel, term?.schoolYear ?? null, new Date(), "REGISTRATION");

    await synchronizeAcademicMirrors(tx, userId);
    // Completing credentials is safe even when an invitation contradicts retained academics.
    // The normal activation gate remains available after the participant reviews the report.
    const academicConfirmationRequired = needsAcademicConfirmationForParticipation((await accountAcademics(tx, userId)).academic);
    if (academicConfirmationRequired) await tx.tutor.update({ where: { id: tutorId }, data: { status: "PENDING" } });

    // Burn the code.
    await tx.registrationCode.update({
      where: { id: row.id },
      data: { usedAt: new Date(), usedByUserId: userId },
    });
    return { username: desiredUsername, ...(academicConfirmationRequired ? { academicConfirmationRequired: true } : {}) };
  });

  return { ok: true, ...result };
}

/** Atomically reserve the exact verified invitation inside the account-write transaction. */
async function claimRegistration(
  tx: TransactionDb,
  row: CodeRow,
): Promise<void> {
  const claimed = await tx.registrationCode.updateMany({
    where: {
      id: row.id,
      usedAt: null,
      expiresAt: { gt: new Date() },
      attempts: { lt: MAX_CODE_ATTEMPTS },
      pendingEmail: row.pendingEmail,
      emailVerifiedAt: row.emailVerifiedAt,
      emailCodeHash: row.emailCodeHash,
      emailCodeExpiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This invitation changed, expired or was already used.",
    });
}
