/**
 * Public viewer self-registration (read-only VIEWER accounts) — the ONE open account-creation
 * path (everything else is admin-gated). Gated only by email validation: a visitor enters their
 * name + affiliation + email, verifies an emailed 6-digit code, then sets a password, which creates
 * a fully-verified VIEWER login. The program values transparency, so viewers see the same
 * read-only, PII-masked admin views as the internal VIEWER role.
 *
 * Abuse controls: rate-limited at the router (per IP + per email), a single-use ViewerSignup row
 * per email, a short code expiry + attempt cap, and admins can suspend a suspicious account.
 * The verification code is HMAC-hashed at rest (reuses `hashCode`, keyed with AUTH_SECRET).
 * Node runtime only.
 */
import { db } from "~/server/db";
import { hashPassword } from "./password";
import { hashCode } from "./registration";
import { generateRegistrationCode } from "./code";

export const VIEWER_CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 6;

/**
 * Stage (or restage) an viewer signup and return a fresh emailed code. Fails if a login already
 * exists for the email (they should sign in / reset instead).
 */
export async function startViewerSignup(input: {
  email: string;
  name: string;
  affiliation: string;
}): Promise<{ ok: true; code: string } | { ok: false; error: "email-taken" }> {
  const email = input.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { ok: false, error: "email-taken" };

  const code = generateRegistrationCode();
  const data = {
    name: input.name.trim(),
    affiliation: input.affiliation.trim(),
    codeHash: hashCode(code),
    codeExpiresAt: new Date(Date.now() + VIEWER_CODE_TTL_MINUTES * 60 * 1000),
    attempts: 0,
    verifiedAt: null,
    usedAt: null,
  };
  await db.viewerSignup.upsert({ where: { email }, update: data, create: { email, ...data } });
  return { ok: true, code };
}

/** Verify the emailed code; on success stamp verifiedAt. */
export async function verifyViewerCode(
  email: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: "not-found" | "expired" | "too-many-attempts" | "mismatch" }> {
  const row = await db.viewerSignup.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!row || row.usedAt) return { ok: false, error: "not-found" };
  if (row.codeExpiresAt < new Date()) return { ok: false, error: "expired" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "too-many-attempts" };
  if (hashCode(code) !== row.codeHash) {
    await db.viewerSignup.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: "mismatch" };
  }
  await db.viewerSignup.update({ where: { id: row.id }, data: { verifiedAt: new Date() } });
  return { ok: true };
}

/** Finish: create a verified VIEWER login from a verified signup, then burn the row. */
export async function completeViewerSignup(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: "not-found" | "email-unverified" | "email-taken" }> {
  const e = email.trim().toLowerCase();
  const row = await db.viewerSignup.findUnique({ where: { email: e } });
  if (!row || row.usedAt) return { ok: false, error: "not-found" };
  if (!row.verifiedAt) return { ok: false, error: "email-unverified" };

  const existing = await db.user.findUnique({ where: { email: e }, select: { id: true } });
  if (existing) return { ok: false, error: "email-taken" };

  const passwordHash = hashPassword(password);
  await db.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        email: e,
        // No username: viewers sign in by email; ensureUserUsername also skips VIEWER accounts.
        name: row.name,
        affiliation: row.affiliation,
        role: "VIEWER",
        passwordHash,
        mustChangePassword: false,
        emailVerifiedAt: new Date(),
      },
    });
    await tx.viewerSignup.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  });
  return { ok: true };
}
