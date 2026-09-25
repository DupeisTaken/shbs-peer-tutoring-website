import { academicSummary } from "~/lib/academics";
/** Stable canonical account handles and one transaction-scoped User/Tutor namespace. */
import { TRPCError } from "@trpc/server";
import { db } from "~/server/db";
import { lockAccountProfile } from "~/server/account-profile";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import { defaultUsername, usernameCandidates } from "~/lib/username";
import { isSerializationFailure, UsernameSnapshotConflict } from "./username-snapshot";
export { defaultUsername } from "~/lib/username";

/** Acquire BEFORE account/profile/row writes and hold through persistence. No process-local lock. */
export async function lockUsernameNamespace(tx: TransactionDb): Promise<void> {
  await lockEntity(tx, "identity:username-namespace");
  try {
    // Advisory locks serialize writers, but cannot refresh an old Serializable snapshot.
    // Updating one persistent tuple makes PostgreSQL reject that stale snapshot BEFORE
    // it can select a handle. Upsert also recreates the fence after isolated test resets.
    await tx.$executeRaw`INSERT INTO "UsernameNamespaceGuard" (id, revision) VALUES (1, 1)
      ON CONFLICT (id) DO UPDATE SET revision = "UsernameNamespaceGuard".revision + 1`;
  } catch (error) {
    if (isSerializationFailure(error)) throw new UsernameSnapshotConflict(error);
    throw error;
  }
}

/**
 * Split a single display string ("Alice Chen", "Madonna", "Mary Jane Watson") into name parts
 * for a Tutor record. The FIRST token is the first name and the REST is the last name — a
 * single-token name keeps an empty last name (never duplicate it into "Madonna Madonna"). The
 * `englishName` is the parts rejoined (or the raw string when it has no usable tokens).
 */
export function splitDisplayName(display: string): {
  firstName: string;
  lastName: string;
  englishName: string;
} {
  const raw = display.trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? raw;
  const lastName = parts.slice(1).join(" ");
  const englishName = [firstName, lastName].filter(Boolean).join(" ") || raw;
  return { firstName, lastName, englishName };
}

type UsernameOwner = { excludeTutorId?: string; excludeUserId?: string };

async function usernameTaken(
  tx: TransactionDb,
  username: string,
  owner: UsernameOwner,
) {
  const [user, tutor] = await Promise.all([
    tx.user.findFirst({
      where: {
        username: { equals: username, mode: "insensitive" },
        ...(owner.excludeUserId ? { id: { not: owner.excludeUserId } } : {}),
      },
      select: { id: true },
    }),
    tx.tutor.findFirst({
      where: {
        username: { equals: username, mode: "insensitive" },
        ...(owner.excludeTutorId ? { id: { not: owner.excludeTutorId } } : {}),
      },
      select: { id: true },
    }),
  ]);
  return user !== null || tutor !== null;
}

/** A required transaction client prevents accidentally releasing the lock before saving. */
export async function ensureUniqueUsername(
  base: string,
  opts: UsernameOwner,
  tx: TransactionDb,
): Promise<string> {
  // Recent Prisma transactions support nested $transaction, but never root $connect.
  if ("$connect" in tx) throw new Error("Username allocation requires an active transaction.");
  await lockUsernameNamespace(tx);
  for (const candidate of usernameCandidates(base)) {
    if (!(await usernameTaken(tx, candidate, opts))) return candidate;
  }
  throw new Error("Username namespace exhausted.");
}

/** Existing identity handles are never silently suffixed, normalized or renamed on collision. */
export async function canonicalUsername(
  tx: TransactionDb,
  base: string,
  owner: UsernameOwner & {
    userUsername?: string | null;
    tutorUsername?: string | null;
  },
): Promise<string> {
  await lockUsernameNamespace(tx);
  const established = [owner.userUsername, owner.tutorUsername].find((value) => value != null && value.length > 0);
  if (!established) return ensureUniqueUsername(base, owner, tx);
  if (await usernameTaken(tx, established, owner))
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This established username belongs to another identity. Ask Head to reconcile the accounts.",
    });
  return established;
}

/** Reconcile linked mirrors under the account-owned handle; allocate students only on explicit enrollment/backfill. */
export async function ensureUserUsername(
  userId: string,
  client: DomainDb = db,
  options: {
    verifiedStudent?: boolean;
    preferredLatinName?: string;
    graduationYear?: number | null;
  } = {},
): Promise<string> {
  return inTransaction(client, async (tx) => {
    await lockUsernameNamespace(tx);
    await lockAccountProfile(tx, userId);
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        role: true,
        name: true,
        emailVerifiedAt: true,
        academicProfile: true,
        tutor: { select: { id: true, username: true } },
      },
    });
    if (!user) return "";
    if (
      !user.tutor &&
      (user.role === "VIEWER" ||
        (user.role === "STUDENT" &&
          (!options.verifiedStudent || !user.emailVerifiedAt)))
    )
      return user.username ?? "";
    // Canonical academic evidence wins over creation hints, including after a rejected intake
    // correction. Unknown legacy reports never acquire an invented graduation suffix.
    const graduationYear = user.academicProfile
      ? user.academicProfile.confirmedAt ? academicSummary(user.academicProfile).expectedGraduationYear : null
      : options.graduationYear;
    const names = splitDisplayName(user.name ?? "");
    const username = await canonicalUsername(
      tx,
      defaultUsername(
        names.firstName,
        names.lastName,
        graduationYear,
        options.preferredLatinName,
      ),
      {
        excludeUserId: user.id,
        excludeTutorId: user.tutor?.id,
        userUsername: user.username,
        tutorUsername: user.tutor?.username,
      },
    );
    if (user.username !== username)
      await tx.user.update({
        where: { id: user.id },
        data: { username, profileVersion: { increment: 1 } },
      });
    if (user.tutor && user.tutor.username !== username) {
      await tx.tutor.update({
        where: { id: user.tutor.id },
        data: { username },
      });
      // Preserve a trace when repairing old divergence; historical names/signatures remain untouched.
      await tx.auditLog.create({
        data: {
          userId: user.id,
          entity: "User",
          entityId: user.id,
          operation: "identity.reconcileUsername",
          kind: "ACTION",
          action: "Synchronized tutor username to account",
          details: {
            username,
            oldTutorUsername: user.tutor.username,
            tutorId: user.tutor.id,
          },
        },
      });
    }
    return username;
  });
}

/** Head chooses an explicit bounded set; page reads never assign old student identities. */
export async function backfillStudentUsernames(
  client: DomainDb,
  actorId: string,
  userIds: string[],
) {
  if (
    userIds.length < 1 ||
    userIds.length > 100 ||
    new Set(userIds).size !== userIds.length
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select between 1 and 100 distinct student accounts.",
    });
  return inTransaction(client, async (tx) => {
    await lockUsernameNamespace(tx);
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (actor.role !== "HEAD" || actor.suspendedAt)
      throw new TRPCError({ code: "FORBIDDEN" });
    const results = [];
    for (const id of userIds) {
      const user = await tx.user.findUnique({ where: { id } });
      if (user?.role !== "STUDENT" || !user.emailVerifiedAt)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Backfill requires verified student accounts.",
        });
      const username = await ensureUserUsername(id, tx, {
        verifiedStudent: true,
      });
      results.push({ id, username });
      if (!user.username)
        await tx.auditLog.create({
          data: {
            userId: actorId,
            entity: "User",
            entityId: id,
            operation: "admin.backfillStudentUsernames",
            kind: "ACTION",
            action: "Assigned verified student username",
            details: { username },
          },
        });
    }
    return results;
  });
}
