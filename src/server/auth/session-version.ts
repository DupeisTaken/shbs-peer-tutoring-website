import type { DomainDb } from "~/server/transactions";
import { TRPCError } from "@trpc/server";
import { hashPassword } from "./password";

/** Both Auth.js and the HTTP cookie-cleanup boundary use the same fail-closed comparison.
 * A missing version is a pre-migration session, not generation zero. Never cache this check. */
export async function isSessionCurrent(
  db: Pick<DomainDb, "user">,
  token: { sub?: string; sessionVersion?: unknown },
): Promise<boolean> {
  if (!token.sub || !Number.isSafeInteger(token.sessionVersion)) return false;
  const user = await db.user.findUnique({ where: { id: token.sub }, select: { sessionVersion: true } });
  return !!user && user.sessionVersion === token.sessionVersion;
}

/** A verified current password authorizes exactly one password update. The conditional write
 * prevents a request paused after verification from overwriting a later reset/change. The DB
 * trigger advances sessionVersion in the same write, including for other password writers. */
export async function changeVerifiedPassword(
  db: Pick<DomainDb, "user">,
  userId: string,
  verifiedHash: string,
  newPassword: string,
) {
  const changed = await db.user.updateMany({
    where: { id: userId, passwordHash: verifiedHash },
    data: { passwordHash: hashPassword(newPassword), mustChangePassword: false },
  });
  if (changed.count !== 1)
    throw new TRPCError({ code: "CONFLICT", message: "Your credentials changed. Sign in again before changing your password." });
}
