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
import { hashCode, registrationCompletionProof } from "./registration";
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
): Promise<{ ok: true; completionProof: string } | { ok: false; error: "not-found" | "expired" | "too-many-attempts" | "mismatch" }> {
  const row = await db.viewerSignup.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!row || row.usedAt) return { ok: false, error: "not-found" };
  if (row.codeExpiresAt < new Date()) return { ok: false, error: "expired" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "too-many-attempts" };
  if (hashCode(code) !== row.codeHash) {
    await db.viewerSignup.updateMany({ where: { id: row.id, codeHash: row.codeHash, usedAt: null, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: "mismatch" };
  }
  // A resend or competing verification must not turn stale evidence into a fresh grant.
  const verifiedAt = new Date();
  const verified = await db.viewerSignup.updateMany({
    where: { id: row.id, codeHash: row.codeHash, usedAt: null, attempts: { lt: MAX_ATTEMPTS }, codeExpiresAt: { gt: verifiedAt } },
    data: { verifiedAt },
  });
  return verified.count === 1
    ? { ok: true, completionProof: registrationCompletionProof("viewer", row.id, row.codeHash, verifiedAt) }
    : { ok: false, error: "mismatch" };
}

/** Finish: create a verified VIEWER login from a verified signup, then burn the row. */
export async function completeViewerSignup(
  email: string,
  password: string,
  completionProof: string,
): Promise<{ ok: true } | { ok: false; error: "not-found" | "email-unverified" | "email-taken" }> {
  const e = email.trim().toLowerCase();
  const row = await db.viewerSignup.findUnique({ where: { email: e } });
  if (!row || row.usedAt) return { ok: false, error: "not-found" };
  if (!row.verifiedAt || row.codeExpiresAt <= new Date() ||
      completionProof !== registrationCompletionProof("viewer", row.id, row.codeHash, row.verifiedAt))
    return { ok: false, error: "email-unverified" };

  const existing = await db.user.findUnique({ where: { email: e }, select: { id: true } });
  if (existing) return { ok: false, error: "email-taken" };

  const passwordHash = hashPassword(password);
  return db.$transaction(async (tx) => {
    // Reserve the exact verified challenge before creating credentials. A resend, expiry,
    // or concurrent completion invalidates the grant and leaves account data untouched.
    const claimed = await tx.viewerSignup.updateMany({
      where: { id: row.id, usedAt: null, codeHash: row.codeHash, verifiedAt: row.verifiedAt, codeExpiresAt: { gt: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) return { ok: false as const, error: "email-unverified" as const };
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
    return { ok: true as const };
  });
}
