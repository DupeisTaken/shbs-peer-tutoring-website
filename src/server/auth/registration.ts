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
import { createHmac, randomInt } from "crypto";

import { env } from "~/env";
import { db } from "~/server/db";
import { hashPassword } from "./password";
import { generateRegistrationCode } from "./code";
import { defaultUsername, ensureUniqueUsername } from "./username";
import { graduationYear } from "~/lib/period";

/** Registration codes stay valid for one week — long enough to distribute and use. */
export const CODE_TTL_DAYS = 7;
/** The emailed email-verification code is short-lived. */
export const EMAIL_CODE_TTL_MINUTES = 15;
/** Hard caps on guesses before a code/email-code is burned (defence in depth atop rate limiting). */
const MAX_CODE_ATTEMPTS = 10;
const MAX_EMAIL_CODE_ATTEMPTS = 6;

function secret(): string {
  // AUTH_SECRET is required in production; the dev fallback only affects local runs.
  return env.AUTH_SECRET ?? "dev-insecure-registration-secret";
}

/** Keyed (HMAC) hash of a code — deterministic for lookup, not offline-brute-forceable. */
export function hashCode(code: string): string {
  return createHmac("sha256", secret()).update(code.trim()).digest("hex");
}

/** A cryptographically-random 6-digit numeric code — used for the emailed email-verification OTP. */
export function generateNumericCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
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
  /** TUTOR (default) creates a tutor login; CREW creates a crew-only login. */
  kind?: "TUTOR" | "CREW";
}

/**
 * Issue a new registration code. Returns the plaintext code plus the row id. On the rare collision
 * (same 6-digit code already outstanding) it retries.
 */
export async function issueRegistrationCode(
  opts: IssueCodeOptions,
): Promise<{ id: string; code: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + CODE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const email = opts.email?.trim() ? opts.email.trim().toLowerCase() : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRegistrationCode();
    const clash = await db.registrationCode.findUnique({ where: { code }, select: { id: true } });
    if (clash) continue;
    const row = await db.registrationCode.create({
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
  if (row.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, error: "too-many-attempts" };
  return { ok: true, row };
}

/** Count a failed guess against a code. */
export async function bumpCodeAttempt(id: string): Promise<void> {
  await db.registrationCode.update({ where: { id }, data: { attempts: { increment: 1 } } });
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
}> {
  let firstName = "";
  let lastName = "";
  let alternativeNames = "";
  let gradeLevel: number | null = null;

  if (row.tutorId) {
    const tutor = await db.tutor.findUnique({
      where: { id: row.tutorId },
      select: { firstName: true, lastName: true, englishName: true, alternativeNames: true, gradeLevel: true },
    });
    if (tutor) {
      const [efirst, ...erest] = tutor.englishName.trim().split(/\s+/);
      firstName = tutor.firstName ?? efirst ?? "";
      lastName = tutor.lastName ?? erest.join(" ");
      alternativeNames = tutor.alternativeNames ?? "";
      gradeLevel = tutor.gradeLevel;
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
  return { boundEmail: row.email?.toLowerCase() ?? null, firstName, lastName, alternativeNames, gradeLevel };
}

/**
 * Stage the email-verification step: store the email + a hashed 6-digit email code (and its
 * expiry) on the code row. Returns the plaintext email code so the caller can send it. Enforces
 * any email binding on the code.
 */
export async function setEmailVerification(
  row: CodeRow,
  email: string,
): Promise<{ ok: true; emailCode: string } | { ok: false; error: "email-mismatch" }> {
  const normalized = email.trim().toLowerCase();
  if (row.email && row.email.toLowerCase() !== normalized) {
    return { ok: false, error: "email-mismatch" };
  }
  const emailCode = generateNumericCode();
  await db.registrationCode.update({
    where: { id: row.id },
    data: {
      pendingEmail: normalized,
      emailCodeHash: hashCode(emailCode),
      emailCodeExpiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MINUTES * 60 * 1000),
      emailCodeAttempts: 0,
      emailVerifiedAt: null,
    },
  });
  return { ok: true, emailCode };
}

/** Verify the emailed 6-digit code; on success stamp emailVerifiedAt on the code row. */
export async function confirmEmailCode(
  row: CodeRow,
  emailCode: string,
): Promise<{ ok: true } | { ok: false; error: "no-pending" | "expired" | "too-many-attempts" | "mismatch" }> {
  if (!row.emailCodeHash || !row.pendingEmail || !row.emailCodeExpiresAt) {
    return { ok: false, error: "no-pending" };
  }
  if (row.emailCodeExpiresAt < new Date()) return { ok: false, error: "expired" };
  if (row.emailCodeAttempts >= MAX_EMAIL_CODE_ATTEMPTS) {
    return { ok: false, error: "too-many-attempts" };
  }
  if (hashCode(emailCode) !== row.emailCodeHash) {
    await db.registrationCode.update({
      where: { id: row.id },
      data: { emailCodeAttempts: { increment: 1 } },
    });
    return { ok: false, error: "mismatch" };
  }
  await db.registrationCode.update({
    where: { id: row.id },
    data: { emailVerifiedAt: new Date() },
  });
  return { ok: true };
}

export interface CompleteRegistrationInput {
  firstName: string;
  lastName: string;
  alternativeNames?: string | null;
  gradeLevel?: number | null;
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
): Promise<{ ok: true; username: string } | { ok: false; error: "email-unverified" | "email-taken" }> {
  if (!row.emailVerifiedAt || !row.pendingEmail) {
    return { ok: false, error: "email-unverified" };
  }
  const email = (row.email ?? row.pendingEmail).toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const alternativeNames = input.alternativeNames?.trim() ? input.alternativeNames.trim() : null;
  const gradeLevel = input.gradeLevel ?? null;

  // Class-of year for the username suffix, from the self-reported grade + active school year.
  const term = await db.term.findFirst({ where: { active: true }, select: { schoolYear: true } });
  const gradYear = gradeLevel != null && term ? graduationYear(gradeLevel, term.schoolYear) : null;

  // A login may already exist on this email (e.g. a roster tutor invited earlier). Guard against
  // hijacking a DIFFERENT person's account: only reuse it when it's unlinked or links this tutor.
  const existingUser = await db.user.findUnique({
    where: { email },
    select: { id: true, tutorId: true, role: true, username: true },
  });
  if (existingUser?.tutorId && existingUser.tutorId !== row.tutorId) {
    return { ok: false, error: "email-taken" };
  }

  const passwordHash = hashPassword(input.password);

  // ---- Crew-only registration (no Tutor) -----------------------------------
  if (row.kind === "CREW") {
    const username = await db.$transaction(async (tx) => {
      if (existingUser) {
        // A login already exists for this verified email — just grant (re)activate crew access.
        // Existing credentials/role are left untouched (we don't overwrite a tutor/admin's account).
        await tx.user.update({
          where: { id: existingUser.id },
          data: { crewStatus: "ACTIVE", gradeLevel },
        });
        await tx.registrationCode.update({
          where: { id: row.id },
          data: { usedAt: new Date(), usedByUserId: existingUser.id },
        });
        return existingUser.username ?? "";
      }
      const desiredUsername = await ensureUniqueUsername(
        defaultUsername(firstName, lastName, gradYear),
        {},
      );
      const created = await tx.user.create({
        data: {
          email,
          username: desiredUsername,
          name: `${firstName} ${lastName}`,
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
      return desiredUsername;
    });
    return { ok: true, username };
  }

  const username = await db.$transaction(async (tx) => {
    // Resolve (or create) the Tutor.
    let tutorId: string;
    if (row.tutorId) {
      tutorId = row.tutorId;
    } else {
      // Reuse an existing tutor on this email if present, else create one.
      const byEmail = await tx.tutor.findUnique({ where: { email }, select: { id: true } });
      tutorId = byEmail?.id ?? "";
    }

    const desiredUsername = await ensureUniqueUsername(defaultUsername(firstName, lastName, gradYear), {
      ...(tutorId ? { excludeTutorId: tutorId } : {}),
      ...(existingUser ? { excludeUserId: existingUser.id } : {}),
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
          username: desiredUsername,
          name: `${firstName} ${lastName}`,
          passwordHash,
          mustChangePassword: false,
          emailVerifiedAt: new Date(),
          // Auto-merge: a crew-only login that completes a tutor code becomes a tutor (keeping crew).
          ...(existingUser.role === "CREW" ? { role: "TUTOR" as const } : {}),
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
          passwordHash,
          mustChangePassword: false,
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      });
      userId = createdUser.id;
    }

    // Burn the code.
    await tx.registrationCode.update({
      where: { id: row.id },
      data: { usedAt: new Date(), usedByUserId: userId },
    });
    return desiredUsername;
  });

  return { ok: true, username };
}
