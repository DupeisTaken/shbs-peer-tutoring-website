import {
  configuredNewNames,
  ensureNameFallbackForRole,
} from "~/server/program/name-fields";
import { requireSchoolParticipation } from "~/server/school-departure";
import { fullPersonName } from "~/lib/person-name";
import {
  applyAcademicIntake,
  synchronizeAcademicMirrors,
  accountAcademics,
} from "~/server/academics";
import {
  lockAccountProfile,
  updateAccountProfile,
} from "~/server/account-profile";
/**
 * Self-registration via a mixed five-character authorization key (RegistrationCode).
 *
 * Admins/coordinators issue a single-use code (optionally bound to an email and/or an existing
 * roster Tutor, or generated when an application is accepted) and hand it to the intended person.
 * The registrant then, at /register: (1) enters the code, (2) verifies their email with a second
 * emailed four-digit code, and (3) sets their name / grade / password — which creates (or links) a
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
import {
  isManagementCode,
  type RegistrationKind,
} from "~/lib/registration-kind";
import { TRPCError } from "@trpc/server";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
} from "~/server/transactions";
import type { TransactionDb } from "~/server/transactions";

import { env } from "~/env";
import { db } from "~/server/db";
import { approvalScope } from "~/server/db-scope";
import { hashPassword } from "./password";
import {
  generateRegistrationCode,
  generateEmailVerificationCode,
  normalizeRegCode,
} from "./code";
import {
  defaultUsername,
  ensureUniqueUsername,
  canonicalUsername,
  ensureUserUsername,
  lockUsernameNamespace,
} from "./username";
import {
  assertPrimaryName,
  assertOfferedGrade,
} from "~/server/program/profile-policy";
import { needsAcademicConfirmationForParticipation } from "~/lib/academics";
import { graduationYear } from "~/lib/period";
import { preserveHistoricalAcademics } from "~/server/historical-academics";
import { getFeatures } from "~/server/program/features";
import { initializePersonSource } from "~/server/person-source-initialization";
import { registrationRecoveryAction, captureRegistrationBefore, recoveryAccountSelect, trackRecoveryEntity } from "~/server/recovery/capture";

/** Registration codes stay valid for one week — long enough to distribute and use. */
export const CODE_TTL_DAYS = 7;
/** The emailed email-verification code is short-lived. */
export const EMAIL_CODE_TTL_MINUTES = 15;
/** Hard caps on guesses before a code/email-code is burned (defence in depth atop rate limiting). */
export const MAX_CODE_ATTEMPTS = 10;
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
 * first so entry and lookup share one identity. Numeric digits are preserved;
 * mixed five-character codes retain O→0/1→I aliases. */
export function hashCode(code: string): string {
  return createHmac("sha256", secret())
    .update(normalizeRegCode(code))
    .digest("hex");
}

/** Short OTPs can repeat by chance. Resampling keeps the previous delivered value
 * invalid after replacement; bounded retries fail closed if the RNG is faulty. */
export function freshEmailCode(
  previousHashes: (string | null | undefined)[],
): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateEmailVerificationCode();
    if (!previousHashes.includes(hashCode(code))) return code;
  }
  throw new Error("Could not generate a fresh email verification code.");
}

/** Completion grants are high-entropy, purpose-bound proofs returned only after an OTP succeeds.
 * The exact challenge hash and verification timestamp invalidate grants on resend/reverification.
 * Expiry and single use are enforced by the account-write transaction, not by browser state. */
export function registrationCompletionProof(
  purpose: "viewer" | "invitation" | "history" | "crew",
  id: string,
  codeHash: string,
  verifiedAt: Date,
): string {
  return createHmac("sha256", secret())
    .update(
      JSON.stringify([
        "registration-completion",
        purpose,
        id,
        codeHash,
        verifiedAt.toISOString(),
      ]),
    )
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
 * in the shared five-character invitation namespace it retries.
 */
export async function issueRegistrationCode(
  opts: IssueCodeOptions,
  client: DomainDb = db,
): Promise<{ id: string; code: string; expiresAt: Date }> {
  return inTransaction(client, async (tx) => {
    // Share the database fence with displayed invitations, even for callers that
    // issue participation codes outside a surrounding transaction.
    await lockUsernameNamespace(tx);
    // Management invitations are durable Head authorization. Check the issuer even
    // when called outside the admin router, and never attach participation records.
    if (isManagementCode(opts.kind ?? "TUTOR")) {
      if (opts.issuedById)
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${opts.issuedById} FOR SHARE`;
      const issuer = opts.issuedById
        ? await tx.user.findUnique({ where: { id: opts.issuedById } })
        : null;
      if (issuer?.role !== "HEAD" || issuer.suspendedAt)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only Head may issue management invitations.",
        });
      if (opts.tutorId || opts.applicationId || opts.crewApplicationId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Management invitations cannot grant participation.",
        });
    }
    await assertTutorRegistrationSource(tx, opts);
    return createRegistrationCode(opts, tx);
  });
}

async function createRegistrationCode(
  opts: IssueCodeOptions,
  client: TransactionDb,
) {
  const expiresAt = new Date(Date.now() + CODE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const email = opts.email?.trim() ? opts.email.trim().toLowerCase() : null;
  const crewChallenge = opts.crewApplicationId
    ? await client.crewSignupVerification.findFirst({
        where: {
          applicationId: opts.crewApplicationId,
          codeExpiresAt: { gt: new Date() },
        },
        select: { codeHash: true },
      })
    : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRegistrationCode();
    if (crewChallenge?.codeHash === hashCode(code)) continue;
    const clash = await client.registrationCode.findUnique({
      where: { code },
      select: { id: true },
    });
    if (clash) continue;
    const displayed = await client.accountInvitation.findFirst({
      where: { displayedCode: true, codeHash: hashCode(code) },
      select: { id: true },
    });
    if (displayed) continue;
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
    const issuer = opts.issuedById
      ? await client.user.findUnique({
          where: { id: opts.issuedById },
          select: { id: true, role: true, name: true },
        })
      : null;
    await client.auditLog.create({
      data: {
        userId: issuer?.id ?? null,
        userName: issuer?.name ?? "System",
        entity: "RegistrationCode",
        entityId: row.id,
        operation: "registration.issue",
        action: "Issued registration invitation",
        approvalId: approvalScope.getStore(),
        details: {
          actorRole: issuer?.role ?? "SYSTEM",
          outcome: "APPLIED",
          before: { issued: false },
          after: { issued: true },
          kind: opts.kind ?? "TUTOR",
          issuedById: opts.issuedById ?? null,
          tutorId: opts.tutorId ?? null,
          applicationId: opts.applicationId ?? null,
          crewApplicationId: opts.crewApplicationId ?? null,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });
    return { id: row.id, code, expiresAt };
  }
  throw new Error("Could not generate a unique registration code.");
}

/** Public-application grants remain bound to their live approval and module.
 * Manual crew keys without an application retain their existing authorization. */
export async function assertCrewRegistrationSource(
  client: DomainDb,
  row: { kind: string; crewApplicationId: string | null },
) {
  if (row.kind !== "CREW" || !row.crewApplicationId) return;
  if (!(await getFeatures(client)).CREW)
    throw new TRPCError({ code: "FORBIDDEN", message: "CREW_DISABLED" });
  await client.$queryRaw`SELECT id FROM "CrewApplication" WHERE id = ${row.crewApplicationId} FOR UPDATE`;
  const application = await client.crewApplication.findUnique({
    where: { id: row.crewApplicationId },
    select: { status: true },
  });
  if (application?.status !== "ACCEPTED")
    throw new TRPCError({ code: "BAD_REQUEST", message: "INVITATION_INVALID" });
}

/** An unfinished application grant shares the flag's lock through its credential write.
 * Staff review details never become part of a public invitation error. Independent
 * manual grants have no application source, and completed invitation receipts skip this check. */
export async function assertTutorRegistrationSource(
  client: TransactionDb,
  row: { applicationId?: string | null },
) {
  if (!row.applicationId) return;
  await lockEntity(client, `interview:${row.applicationId}`);
  // Approval callers can already own a Serializable snapshot. A row lock makes
  // a later committed flag abort that stale snapshot instead of reading past it.
  await client.$queryRaw`SELECT id FROM "TutorApplication" WHERE id = ${row.applicationId} FOR UPDATE`;
  const application = await client.tutorApplication.findUnique({
    where: { id: row.applicationId },
    select: { invalidatedAt: true, status: true },
  });
  if (!application || application.invalidatedAt || application.status !== "ACCEPTED")
    throw new TRPCError({ code: "BAD_REQUEST", message: "INVITATION_INVALID" });
}

type CodeRow = NonNullable<Awaited<ReturnType<typeof loadCode>>>;

/** Keep invitation evidence useful without copying its plaintext code, email or proof. */
async function recordRedemption(
  tx: TransactionDb,
  row: CodeRow,
  userId: string,
  rankChange?: { before: string; after: string },
) {
  const recipient = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, role: true },
  });
  const issuance = await tx.auditLog.findFirst({
    where: {
      entity: "RegistrationCode",
      entityId: row.id,
      operation: "registration.issue",
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  await tx.auditLog.create({
    data: {
      userId,
      userName: recipient.name,
      entity: "RegistrationCode",
      entityId: row.id,
      operation: "registration.complete",
      kind: "ACTION",
      action: `Redeemed ${row.kind} registration invitation`,
      details: {
        actorRole: recipient.role,
        outcome: "APPLIED",
        kind: row.kind,
        issuedById: row.issuedById,
        recipientId: userId,
        before: {
          used: false,
          ...(rankChange ? { role: rankChange.before } : {}),
        },
        after: {
          used: true,
          ...(rankChange ? { role: rankChange.after } : {}),
        },
        originalActionId: issuance?.id ?? null,
        originalEvidence: issuance ? "RECORDED" : "LEGACY_UNAVAILABLE",
      },
    },
  });
}

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
  // This read only drives prefill. Every subsequent write rechecks under the
  // interview lock so a flag applied after this response cannot grant access.
  if (row.applicationId) {
    const application = await db.tutorApplication.findUnique({
      where: { id: row.applicationId },
      select: { invalidatedAt: true },
    });
    if (!application || application.invalidatedAt)
      return { ok: false, error: "not-found" };
  }
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
export async function codePrefill(row: CodeRow, client: DomainDb = db) {
  // Only explicit name parts prefill the four-field editor; old full names remain visible context.
  const source = row.applicationId
    ? await client.tutorApplication.findUnique({
        where: { id: row.applicationId },
      })
    : row.crewApplicationId
      ? await client.crewApplication.findUnique({
          where: { id: row.crewApplicationId },
        })
      : row.tutorId
        ? await client.tutor.findUnique({ where: { id: row.tutorId } })
        : null;
  // A returning roster keeps its established identity during promotion. Prefill
  // must describe that exact invitation-bound roster too, rather than suggesting
  // a request-local correction that account creation will correctly refuse to adopt.
  const names = row.applicationId && row.tutorId
    ? (await client.tutor.findUnique({ where: { id: row.tutorId } })) ?? source
    : source;
  return {
    boundEmail: row.email?.toLowerCase() ?? null,
    firstName: names?.firstName ?? "",
    lastName: names?.lastName ?? "",
    preferredName: names?.preferredName ?? "",
    alternativeNames: names?.alternativeNames ?? "",
    // A stored null means there is no unsplit original. A live roster label
    // may consist only of alternate names or the username fallback.
    legacyName: names
      ? "englishName" in names
        ? names.legacyName
        : names.name
      : null,
    gradeLevel: source && "gradeLevel" in source ? source.gradeLevel : null,
    gradeSchoolYear:
      source && "gradeSchoolYear" in source ? source.gradeSchoolYear : null,
  };
}

/**
 * Stage the email-verification step: store the email + a hashed four-digit code (and its
 * expiry) on the code row. Returns the plaintext email code so the caller can send it. Enforces
 * any email binding on the code.
 */
export async function setEmailVerification(
  row: CodeRow,
  email: string,
  client: DomainDb = db,
): Promise<
  { ok: true; emailCode: string } | { ok: false; error: "email-mismatch" }
> {
  return inTransaction(
    client,
    async (tx): ReturnType<typeof setEmailVerification> => {
      await lockUsernameNamespace(tx);
      await assertTutorRegistrationSource(tx, row);
      const normalized = email.trim().toLowerCase();
      if (row.email && row.email.toLowerCase() !== normalized) {
        return { ok: false, error: "email-mismatch" };
      }
      // A staff-visible key and the preceding challenge must not become mailbox proof.
      const emailCode = freshEmailCode([
        row.code ? hashCode(row.code) : null,
        row.emailCodeHash,
      ]);
      const changed = await tx.registrationCode.updateMany({
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
    },
  );
}

/** Verify the emailed four-digit code; on success stamp emailVerifiedAt on the code row. */
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
  return inTransaction(db, async (tx): ReturnType<typeof confirmEmailCode> => {
    await lockUsernameNamespace(tx);
    await assertTutorRegistrationSource(tx, row);
    if (!row.emailCodeHash || !row.pendingEmail || !row.emailCodeExpiresAt) {
      return { ok: false, error: "no-pending" };
    }
    if (row.emailCodeExpiresAt < new Date())
      return { ok: false, error: "expired" };
    if (row.emailCodeAttempts >= MAX_EMAIL_CODE_ATTEMPTS) {
      return { ok: false, error: "too-many-attempts" };
    }
    if (hashCode(emailCode) !== row.emailCodeHash) {
      await tx.registrationCode.updateMany({
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
    const verified = await tx.registrationCode.updateMany({
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
      ? {
          ok: true,
          completionProof: registrationCompletionProof(
            "invitation",
            row.id,
            row.emailCodeHash,
            verifiedAt,
          ),
        }
      : { ok: false, error: "mismatch" };
  });
}

export interface CompleteRegistrationInput {
  completionProof: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  alternativeNames?: string | null;
  gradeLevel?: number | null;
  preferredLatinName?: string;
  gradeSchoolYear?: string | null;
  password?: string;
  /** Recipient-authenticated account, checked again while holding its profile lock. */
  authenticatedUserId?: string;
}

/**
 * Finish registration: create or link a Tutor and a fully-verified login, then burn the code.
 * Requires the code's email to be verified (emailVerifiedAt + pendingEmail set). The email is the
 * verified pendingEmail (or the bound email). Returns the resolved username.
 */
export async function completeRegistration(
  row: CodeRow,
  input: CompleteRegistrationInput,
  client: DomainDb = db,
): ReturnType<typeof completeRegistrationLocked> {
  return inTransaction(client, async (tx) => {
    await lockUsernameNamespace(tx);
    return completeRegistrationLocked(row, input, tx);
  });
}
async function completeRegistrationLocked(
  row: CodeRow,
  input: CompleteRegistrationInput,
  client: DomainDb = db,
): Promise<
  | { ok: true; username: string; academicConfirmationRequired?: boolean }
  | { ok: false; error: "email-unverified" | "email-taken" }
> {
  if (
    !row.emailVerifiedAt ||
    !row.pendingEmail ||
    !row.emailCodeHash ||
    !row.emailCodeExpiresAt ||
    row.emailCodeExpiresAt <= new Date() ||
    input.completionProof !==
      registrationCompletionProof(
        "invitation",
        row.id,
        row.emailCodeHash,
        row.emailVerifiedAt,
      )
  ) {
    return { ok: false, error: "email-unverified" };
  }
  // Primary and verified secondary addresses identify the same canonical account.
  const owner = await client.user.findFirst({
    where: {
      OR: [
        { email: row.pendingEmail },
        {
          emails: {
            some: { email: row.pendingEmail, verifiedAt: { not: null } },
          },
        },
      ],
    },
  });
  if (
    owner &&
    (owner.mergedIntoId ||
      owner.suspendedAt ||
      input.authenticatedUserId !== owner.id)
  )
    return { ok: false, error: "email-taken" };
  const acceptedSource =
    !owner && (row.applicationId || row.crewApplicationId || row.tutorId)
      ? row.applicationId
        ? row.tutorId
          ? await client.tutor.findUniqueOrThrow({
              where: { id: row.tutorId },
            })
          : await client.tutorApplication.findUniqueOrThrow({
              where: { id: row.applicationId },
            })
        : row.crewApplicationId
          ? await client.crewApplication.findUniqueOrThrow({
              where: { id: row.crewApplicationId },
            })
          : await client.tutor.findUniqueOrThrow({
              where: { id: row.tutorId! },
            })
      : null;
  // Promotion has already selected the exact bound roster identity: a returning
  // tutor keeps that identity even if its new application was corrected. Redemption
  // must use the same source as prefill; canonical account ownership still wins and
  // Crew applications retain their existing precedence over a generic tutor link.
  // Newly hidden form fields and posted replacements cannot erase accepted values.
  const preservedIdentity = owner ?? acceptedSource;
  if (preservedIdentity)
    input = {
      ...input,
      firstName: preservedIdentity.firstName ?? "",
      lastName: preservedIdentity.lastName ?? "",
      preferredName: preservedIdentity.preferredName,
      alternativeNames: preservedIdentity.alternativeNames,
    };
  if (!owner) {
    // Accepted roster/application identity is grandfathered through redemption. A fresh
    // staff invitation is new intake and obeys its own invited account type's current policy.
    if (!acceptedSource)
      input = {
        ...input,
        ...(await configuredNewNames(client, input, row.kind)),
      };
    // Stored source was validated when submitted. Tightening is applied only to
    // subsequent profile edits, with source spelling and legacy nulls retained.
  }
  const sourceIdentity = acceptedSource
    ? {
        firstName: acceptedSource.firstName,
        lastName: acceptedSource.lastName,
        preferredName: acceptedSource.preferredName,
        alternativeNames: acceptedSource.alternativeNames,
        // Preserve the null sentinel; materialized roster labels are not originals.
        legacyName:
          "legacyName" in acceptedSource
            ? acceptedSource.legacyName
            : acceptedSource.name,
      }
    : null;
  const preferredName = input.preferredName?.trim()
    ? input.preferredName.trim()
    : null;
  const email = owner?.email ?? (row.email ?? row.pendingEmail).toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const explicitName = fullPersonName({ firstName, lastName });
  const acceptedRoster = acceptedSource && "englishName" in acceptedSource;
  const alternativeNames = acceptedSource
    ? acceptedSource.alternativeNames
    : input.alternativeNames?.trim()
      ? input.alternativeNames.trim()
      : null;
  // Existing canonical academics are not a new report. Adding participation never
  // silently reconfirms an old grade in the current year or adopts posted profile edits.
  const gradeLevel =
    owner?.gradeLevel ?? (owner ? null : (input.gradeLevel ?? null));

  // A login may already exist on this email (e.g. a roster tutor invited earlier). Guard against
  // hijacking a DIFFERENT person's account: only reuse it when it's unlinked or links this tutor.
  const existingUser = await client.user.findUnique({
    where: { email },
    select: {
      id: true,
      tutorId: true,
      role: true,
      username: true,
      mergedIntoId: true,
    },
  });
  if (
    row.kind === "TUTOR" &&
    row.tutorId &&
    existingUser?.tutorId &&
    existingUser.tutorId !== row.tutorId
  ) {
    return { ok: false, error: "email-taken" };
  }

  if (existingUser?.mergedIntoId) return { ok: false, error: "email-taken" };

  if (!owner?.passwordHash && !input.password)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a password to finish account setup.",
    });
  const passwordHash = owner?.passwordHash ?? hashPassword(input.password!);

  // A Head-issued management invitation also upgrades its verified existing recipient.
  // Rank only increases; credentials and independent participation remain intact.
  if (isManagementCode(row.kind)) {
    const role = row.kind;
    return inTransaction(client, async (tx) => {
      await lockEntity(tx, "program:period");
      const term = await tx.term.findFirst({
        where: { active: true },
        select: { schoolYear: true },
      });
      const gradYear =
        gradeLevel != null && term
          ? graduationYear(gradeLevel, term.schoolYear)
          : null;
      await assertPrimaryName(
        tx,
        owner?.name?.trim()
          ? owner.name
          : [firstName, lastName].filter(Boolean).join(" "),
        owner?.name,
      );

      if (!existingUser) {
        await assertOfferedGrade(tx, gradeLevel);
        if (gradeLevel != null && !term)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "PROFILE_NO_CURRENT_YEAR",
          });
      }
      await lockUsernameNamespace(tx);
      await tx.$executeRaw`LOCK TABLE "User", "AccountEmail", "Tutor" IN SHARE ROW EXCLUSIVE MODE`;
      const recipient = await tx.user.findFirst({
        where: {
          OR: [
            { email: { equals: email, mode: "insensitive" } },
            {
              emails: {
                some: { email: { equals: email, mode: "insensitive" } },
              },
            },
          ],
        },
      });
      if (recipient) {
        if (
          recipient.id !== input.authenticatedUserId ||
          recipient.mergedIntoId ||
          recipient.suspendedAt
        )
          return { ok: false as const, error: "email-taken" as const };
        await lockAccountProfile(tx, recipient.id);
        await claimRegistration(tx, row);
        const rank = { HEAD: 3, ADMIN: 2, COORDINATOR: 1 };
        const currentRank =
          recipient.role in rank
            ? rank[recipient.role as keyof typeof rank]
            : 0;
        const nextRole = currentRank >= rank[role] ? recipient.role : role;
        await ensureNameFallbackForRole(tx, recipient.id, nextRole);
        await tx.user.update({
          where: { id: recipient.id },
          data: { role: nextRole },
        });
        await tx.registrationCode.update({
          where: { id: row.id },
          data: { usedByUserId: recipient.id },
        });
        await recordRedemption(tx, row, recipient.id, {
          before: recipient.role,
          after: nextRole,
        });
        return {
          ok: true as const,
          username: await ensureUserUsername(recipient.id, tx),
        };
      }
      await claimRegistration(tx, row);
      const username = await ensureUniqueUsername(
        defaultUsername(
          firstName,
          lastName,
          gradYear,
          input.preferredLatinName,
        ),
        {},
        tx,
      );
      const user = await tx.user.create({
        data: {
          email,
          username,
          firstName,
          lastName,
          preferredName,
          name: explicitName,
          alternativeNames,
          role,
          gradeLevel,
          passwordHash,
          emailVerifiedAt: new Date(),
          mustChangePassword: false,
        },
      });
      await initializePersonSource(tx, { kind: "USER", id: user.id });
      await applyAcademicIntake(
        tx,
        user.id,
        gradeLevel,
        term?.schoolYear ?? null,
        new Date(),
        "REGISTRATION",
      );
      await tx.registrationCode.update({
        where: { id: row.id },
        data: { usedByUserId: user.id },
      });
      await recordRedemption(tx, row, user.id);
      return { ok: true as const, username };
    });
  }

  // ---- Crew-only registration (no Tutor) -----------------------------------
  if (row.kind === "CREW") {
    const result = await inTransaction(client, async (tx) => {
      await lockEntity(tx, "program:period");
      await lockUsernameNamespace(tx);
      await assertCrewRegistrationSource(tx, row);
      const term = await tx.term.findFirst({
        where: { active: true },
        select: { schoolYear: true },
      });
      const gradYear =
        gradeLevel != null && term
          ? graduationYear(gradeLevel, term.schoolYear)
          : null;
      const existingUser = await tx.user.findUnique({ where: { email } });
      await assertPrimaryName(
        tx,
        existingUser?.name?.trim()
          ? existingUser.name
          : [firstName, lastName].filter(Boolean).join(" "),
        existingUser?.name,
      );
      // Crew invitations keep an existing account identity; only new accounts adopt input.

      if (!existingUser) {
        await assertOfferedGrade(tx, gradeLevel);
        if (gradeLevel != null && !term)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "PROFILE_NO_CURRENT_YEAR",
          });
      }
      // Namespace locking serializes this check with account combination. Retired identities
      // reserve their email; an invitation must never attach fresh membership to their history.
      if (existingUser?.mergedIntoId)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Account membership changed. Ask Head to review this invitation.",
        });
      await claimRegistration(tx, row);
      if (existingUser) {
        await lockAccountProfile(tx, existingUser.id);
        await requireSchoolParticipation(tx, existingUser.id);
        if (existingUser.suspendedAt || existingUser.crewStatus === "INACTIVE")
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Ask Head to review suspended participation.",
          });
        const priorCrewStatus = (
          await tx.user.findUniqueOrThrow({
            where: { id: existingUser.id },
            select: { crewStatus: true },
          })
        ).crewStatus;
        // A login already exists for this verified email — grant crew access after academic review.
        // Existing credentials/role are left untouched (we don't overwrite a tutor/admin's account).
        if (existingUser.role === "VIEWER")
          await ensureNameFallbackForRole(tx, existingUser.id, "CREW");
        await tx.user.update({
          where: { id: existingUser.id },
          data: {
            // An invitation grants missing access; it cannot undo an applied opt-out.
            crewStatus:
              priorCrewStatus === "OPTED_OUT" ? "OPTED_OUT" : "ACTIVE",
            ...(existingUser.role === "VIEWER"
              ? { role: "CREW" as const }
              : {}),
            ...(!existingUser.passwordHash
              ? {
                  passwordHash,
                  mustChangePassword: false,
                  emailVerifiedAt: new Date(),
                }
              : {}),
          },
        });
        await tx.registrationCode.update({
          where: { id: row.id },
          data: { usedAt: new Date(), usedByUserId: existingUser.id },
        });
        await synchronizeAcademicMirrors(tx, existingUser.id);
        const academicConfirmationRequired =
          needsAcademicConfirmationForParticipation(
            (await accountAcademics(tx, existingUser.id)).academic,
          );
        // Crew has no pending state: retain staff suspension, otherwise use its existing reentry flow.
        if (academicConfirmationRequired)
          await tx.user.update({
            where: { id: existingUser.id },
            data: {
              crewStatus:
                priorCrewStatus === "INACTIVE" ? "INACTIVE" : "OPTED_OUT",
            },
          });
        await recordRedemption(tx, row, existingUser.id);
        return {
          username: await ensureUserUsername(existingUser.id, tx, {
            preferredLatinName: input.preferredLatinName,
          }),
          ...(academicConfirmationRequired
            ? { academicConfirmationRequired: true }
            : {}),
        };
      }
      const desiredUsername = await ensureUniqueUsername(
        defaultUsername(
          firstName,
          lastName,
          gradYear,
          input.preferredLatinName,
        ),
        {},
        tx,
      );
      const created = await tx.user.create({
        data: {
          email,
          username: desiredUsername,
          firstName,
          lastName,
          preferredName,
          name: explicitName,
          alternativeNames,
          role: "CREW",
          ...(sourceIdentity
            ? {
                ...sourceIdentity,
                name: sourceIdentity.legacyName,
              }
            : {}),
          gradeLevel,
          crewStatus: "ACTIVE",
          passwordHash,
          mustChangePassword: false,
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      });
      await initializePersonSource(tx, { kind: "USER", id: created.id });
      await tx.registrationCode.update({
        where: { id: row.id },
        data: { usedAt: new Date(), usedByUserId: created.id },
      });
      await applyAcademicIntake(
        tx,
        created.id,
        gradeLevel,
        term?.schoolYear ?? null,
        new Date(),
        "REGISTRATION",
      );
      const academicConfirmationRequired =
        needsAcademicConfirmationForParticipation(
          (await accountAcademics(tx, created.id)).academic,
        );
      if (academicConfirmationRequired)
        await tx.user.update({
          where: { id: created.id },
          data: { crewStatus: "OPTED_OUT" },
        });
      await recordRedemption(tx, row, created.id);
      return {
        username: desiredUsername,
        ...(academicConfirmationRequired
          ? { academicConfirmationRequired: true }
          : {}),
      };
    });
    return { ok: true, ...result };
  }

  const result = await inTransaction(client, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await assertTutorRegistrationSource(tx, row);
    const recoveryActionId = await registrationRecoveryAction(tx, row.applicationId, row.id);
    const term = await tx.term.findFirst({
      where: { active: true },
      select: { schoolYear: true },
    });
    const gradYear =
      gradeLevel != null && term
        ? graduationYear(gradeLevel, term.schoolYear)
        : null;
    let existingUser = await tx.user.findUnique({ where: { email } });
    if (existingUser) {
      await lockAccountProfile(tx, existingUser.id);
      await requireSchoolParticipation(tx, existingUser.id);
      // The unchanged-name exemption must use the current locked identity. A profile
      // edit may have committed while registration was waiting for the account lock.
      existingUser = await tx.user.findUniqueOrThrow({
        where: { id: existingUser.id },
      });
      if (
        existingUser.suspendedAt ||
        (existingUser.tutorId && existingUser.tutorAccessRevoked &&
          !(existingUser.recoveryVoidedAt && recoveryActionId))
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Ask Head to review suspended or revoked participation.",
        });
    }
    if (!existingUser) {
      await assertOfferedGrade(tx, gradeLevel);
      if (gradeLevel != null && !term)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "PROFILE_NO_CURRENT_YEAR",
        });
    }
    if (
      existingUser?.mergedIntoId ||
      (row.tutorId &&
        existingUser?.tutorId &&
        existingUser.tutorId !== row.tutorId)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Account membership changed. Ask Head to review this invitation.",
      });
    if (recoveryActionId) await captureRegistrationBefore(tx, recoveryActionId,
      existingUser ? await tx.user.findUnique({ where: { id: existingUser.id }, select: recoveryAccountSelect }) : null);
    if (existingUser?.recoveryVoidedAt && recoveryActionId)
      await tx.$queryRaw`SELECT set_config('shbs.recovery_reauthorize', ${recoveryActionId}, true)`;
    await claimRegistration(tx, row);
    // A generic grant for an already-linked tutor is idempotent. It must not
    // reactivate an opted-out/historical record or replay academic/profile intake.
    if (existingUser?.tutorId && !row.tutorId) {
      await tx.registrationCode.update({
        where: { id: row.id },
        data: { usedByUserId: existingUser.id },
      });
      await recordRedemption(tx, row, existingUser.id);
      return { username: await ensureUserUsername(existingUser.id, tx) };
    }
    const retainedAcademic = existingUser
      ? (await accountAcademics(tx, existingUser.id)).academic
      : null;
    const usernameGradYear = existingUser
      ? retainedAcademic?.confirmedAt
        ? retainedAcademic.expectedGraduationYear
        : null
      : gradYear;
    // Resolve (or create) the Tutor.
    let tutorId: string;
    if (row.tutorId) {
      tutorId = row.tutorId;
    } else if (existingUser?.tutorId) {
      tutorId = existingUser.tutorId;
    } else {
      // Reuse an existing tutor on this email if present, else create one.
      const byEmail = await tx.tutor.findUnique({
        where: { email },
        select: { id: true },
      });
      tutorId = byEmail?.id ?? "";
    }

    const rosterTutor = tutorId
      ? await tx.tutor.findUniqueOrThrow({ where: { id: tutorId } })
      : null;
    // An invited roster is already an identity too. Preserve its unchanged name when
    // creating its first login, while any existing canonical account takes precedence.
    // The namespace lock serializes edits to provisional roster names.
    await assertPrimaryName(
      tx,
      existingUser?.name?.trim()
        ? existingUser.name
        : [firstName, lastName].filter(Boolean).join(" "),
      existingUser ? existingUser.name : rosterTutor?.englishName,
    );

    // Account ownership wins; a genuinely new account adopts its roster's provisional handle.
    const desiredUsername = await canonicalUsername(
      tx,
      defaultUsername(
        firstName,
        lastName,
        usernameGradYear,
        input.preferredLatinName,
      ),
      {
        excludeTutorId: tutorId || undefined,
        excludeUserId: existingUser?.id,
        userUsername: existingUser?.username,
        tutorUsername: rosterTutor?.username,
      },
    );

    if (tutorId) {
      await preserveHistoricalAcademics(tx, "TUTOR", tutorId);
      await tx.tutor.update({
        where: { id: tutorId },
        data: {
          firstName,
          lastName,
          preferredName,
          // A bound roster already has the accepted originals. Leave its live
          // label as the trigger's unchanged input; writing a derived alternate
          // label or blank here could recapture it as a new legacy original.
          ...(!acceptedRoster
            ? {
                englishName: existingUser?.name?.trim()
                  ? existingUser.name
                  : sourceIdentity?.legacyName ?? explicitName,
              }
            : {}),
          alternativeNames,
          gradeLevel,
          email,
          username: desiredUsername,
          // Existing lifecycle decisions require their Head-reviewed restoration flow.
          status:
            rosterTutor &&
            ["OPTED_OUT", "ARCHIVED", "GRADUATED", "TRANSFERRED"].includes(
              rosterTutor.status,
            )
              ? rosterTutor.status
              : "ACTIVE",
          ...(sourceIdentity ?? {}),
        },
      });
    } else {
      const created = await tx.tutor.create({
        data: {
          firstName,
          lastName,
          preferredName,
          englishName: existingUser?.name?.trim()
            ? existingUser.name
            : explicitName,
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
          ...(existingUser.recoveryVoidedAt && recoveryActionId ? { recoveryVoidedAt: null } : {}),
          ...(existingUser.role === "VIEWER" ? { role: "TUTOR" as const } : {}),
          username: desiredUsername,
          ...(!existingUser.passwordHash
            ? {
                passwordHash,
                mustChangePassword: false,
                emailVerifiedAt: new Date(),
              }
            : {}),
          // Tutor capability comes from the new tutor link; retain the established role.
        },
      });
      userId = existingUser.id;
    } else {
      const createdUser = await tx.user.create({
        data: {
          email,
          username: desiredUsername,
          firstName,
          lastName,
          preferredName,
          name: explicitName,
          role: "TUTOR",
          ...(sourceIdentity
            ? {
                ...sourceIdentity,
                // Null is evidence that no unsplit original exists. The name
                // trigger derives the live label from fields/policy/username.
                name: sourceIdentity.legacyName,
              }
            : {}),
          // Seed the already-validated legal name so unchanged roster values are preserved.
          alternativeNames,
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

    // Creation already adopted the validated new intake or accepted source.
    // Mirror that canonical identity without treating redemption as a later
    // profile edit under requirements that may have tightened after intake.
    await updateAccountProfile(tx, userId);

    // Repair legacy divergence without treating the roster alias as a second account identity.
    if (
      existingUser?.username &&
      rosterTutor &&
      rosterTutor.username !== desiredUsername
    )
      await tx.auditLog.create({
        data: {
          userId,
          entity: "User",
          entityId: userId,
          operation: "identity.reconcileUsername",
          kind: "ACTION",
          action: "Synchronized tutor username to account",
          details: {
            username: desiredUsername,
            oldTutorUsername: rosterTutor.username,
            tutorId,
          },
        },
      });
    if (!existingUser)
      await applyAcademicIntake(
        tx,
        userId,
        gradeLevel,
        term?.schoolYear ?? null,
        new Date(),
        "REGISTRATION",
      );

    await synchronizeAcademicMirrors(tx, userId);
    // Completing credentials is safe even when an invitation contradicts retained academics.
    // The normal activation gate remains available after the participant reviews the report.
    const academicConfirmationRequired =
      needsAcademicConfirmationForParticipation(
        (await accountAcademics(tx, userId)).academic,
      );
    if (
      academicConfirmationRequired &&
      (!rosterTutor || ["ACTIVE", "PENDING"].includes(rosterTutor.status))
    )
      await tx.tutor.update({
        where: { id: tutorId },
        data: { status: "PENDING" },
      });

    // Burn the code.
    await tx.registrationCode.update({
      where: { id: row.id },
      data: { usedAt: new Date(), usedByUserId: userId },
    });
    if (recoveryActionId) await trackRecoveryEntity(tx, recoveryActionId, "User", userId);
    await recordRedemption(tx, row, userId);
    return {
      username: desiredUsername,
      ...(academicConfirmationRequired
        ? { academicConfirmationRequired: true }
        : {}),
    };
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
