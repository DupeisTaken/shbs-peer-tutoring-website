import {
  assertPrimaryName,
  parsePersonNames,
} from "~/server/program/profile-policy";
/** Viewer mailbox staging; universal invitation redemption owns credential creation.
 * Existing recipients follow exactly the same public response and retain their role. */
import { db } from "~/server/db";
import { hashPassword } from "./password";
import { hashCode, registrationCompletionProof } from "./registration";
import { generateRegistrationCode } from "./code";
import { inTransaction, type DomainDb } from "~/server/transactions";

export const VIEWER_CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 6;

/**
 * Stage a new mailbox challenge for either a prospective Viewer or an existing account.
 */
export async function startViewerSignup(
  input: {
    email: string;
    name: string;
    firstName?: string;
    lastName?: string;
    preferredName?: string | null;
    alternativeNames?: string | null;
    affiliation: string;
  },
  client: DomainDb = db,
): Promise<{ ok: true; code: string } | { ok: false; error: "email-taken" }> {
  const email = input.email.trim().toLowerCase();
  // The public response is identical for new and established addresses. After proof,
  // an established account receives sign-in access only, never an exclusive Viewer role.

  await assertPrimaryName(client, input.name);
  if (
    input.firstName !== undefined ||
    input.lastName !== undefined ||
    input.preferredName !== undefined
  )
    input = {
      ...input,
      ...parsePersonNames({ ...input, lastName: input.lastName ?? "" }),
    };
  const code = generateRegistrationCode();
  const data = {
    firstName: input.firstName,
    lastName: input.lastName,
    preferredName: input.preferredName,
    alternativeNames: input.alternativeNames,
    name: input.name.trim(),
    affiliation: input.affiliation.trim(),
    codeHash: hashCode(code),
    codeExpiresAt: new Date(Date.now() + VIEWER_CODE_TTL_MINUTES * 60 * 1000),
    attempts: 0,
    verifiedAt: null,
    usedAt: null,
  };
  await client.viewerSignup.upsert({
    where: { email },
    update: data,
    create: { email, ...data },
  });
  return { ok: true, code };
}

/** Verify the emailed code; on success stamp verifiedAt. */
export async function verifyViewerCode(
  email: string,
  code: string,
): Promise<
  | { ok: true; completionProof: string }
  | {
      ok: false;
      error: "not-found" | "expired" | "too-many-attempts" | "mismatch";
    }
> {
  return inTransaction(db, async (tx) => {
    const normalized = email.trim().toLowerCase();
    await tx.$queryRaw`SELECT id FROM "ViewerSignup" WHERE email = ${normalized} FOR UPDATE`;
    const row = await tx.viewerSignup.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!row || row.usedAt) return { ok: false, error: "not-found" } as const;
    if (row.codeExpiresAt < new Date())
      return { ok: false, error: "expired" } as const;
    if (row.attempts >= MAX_ATTEMPTS)
      return { ok: false, error: "too-many-attempts" } as const;
    if (hashCode(code) !== row.codeHash) {
      await tx.viewerSignup.updateMany({
        where: {
          id: row.id,
          codeHash: row.codeHash,
          usedAt: null,
          attempts: { lt: MAX_ATTEMPTS },
        },
        data: { attempts: { increment: 1 } },
      });
      return { ok: false, error: "mismatch" } as const;
    }
    // A resend or competing verification must not turn stale evidence into a fresh grant.
    const verifiedAt = row.verifiedAt ?? new Date();
    const verified = await tx.viewerSignup.updateMany({
      where: {
        id: row.id,
        codeHash: row.codeHash,
        usedAt: null,
        attempts: { lt: MAX_ATTEMPTS },
        codeExpiresAt: { gt: verifiedAt },
      },
      // First verification starts the distinct invitation's review window. Stable retry
      // evidence cannot keep extending it by replaying the initial mailbox code.
      data: {
        verifiedAt,
        ...(!row.verifiedAt
          ? {
              codeExpiresAt: new Date(
                +verifiedAt + VIEWER_CODE_TTL_MINUTES * 60_000,
              ),
            }
          : {}),
      },
    });
    return verified.count === 1
      ? {
          ok: true as const,
          completionProof: registrationCompletionProof(
            "viewer",
            row.id,
            row.codeHash,
            verifiedAt,
          ),
        }
      : { ok: false as const, error: "mismatch" as const };
  });
}

/** Finish: create a verified VIEWER login from a verified signup, then burn the row. */
export async function completeViewerSignup(
  email: string,
  password: string,
  completionProof: string,
  client: DomainDb = db,
): Promise<
  | { ok: true }
  | { ok: false; error: "not-found" | "email-unverified" | "email-taken" }
> {
  const e = email.trim().toLowerCase();
  const row = await client.viewerSignup.findUnique({ where: { email: e } });
  if (!row || row.usedAt) return { ok: false, error: "not-found" };
  if (
    !row.verifiedAt ||
    row.codeExpiresAt <= new Date() ||
    completionProof !==
      registrationCompletionProof(
        "viewer",
        row.id,
        row.codeHash,
        row.verifiedAt,
      )
  )
    return { ok: false, error: "email-unverified" };

  const existing = await client.user.findFirst({
    where: {
      OR: [
        { email: e },
        { emails: { some: { email: e, verifiedAt: { not: null } } } },
      ],
    },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "email-taken" };

  const passwordHash = hashPassword(password);
  return inTransaction(client, async (tx) => {
    // Reserve the exact verified challenge before creating credentials. A resend, expiry,
    // or concurrent completion invalidates the grant and leaves account data untouched.
    const claimed = await tx.viewerSignup.updateMany({
      where: {
        id: row.id,
        usedAt: null,
        codeHash: row.codeHash,
        verifiedAt: row.verifiedAt,
        codeExpiresAt: { gt: new Date() },
        attempts: { lt: MAX_ATTEMPTS },
      },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1)
      return { ok: false as const, error: "email-unverified" as const };
    // Recheck at the actual identity write: a verified challenge may predate a
    // policy change. Rejection rolls back the claim so the signup is not consumed.
    await assertPrimaryName(tx, row.name);
    if (row.firstName !== null)
      parsePersonNames({ ...row, lastName: row.lastName ?? "" });
    await tx.user.create({
      data: {
        email: e,
        // No username: viewers sign in by email; ensureUserUsername also skips VIEWER accounts.
        firstName: row.firstName,
        lastName: row.lastName,
        preferredName: row.preferredName,
        alternativeNames: row.alternativeNames,
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
