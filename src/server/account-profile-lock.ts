import { lockUsernameNamespace } from "~/server/auth/username-namespace";
import { lockEntity, type TransactionDb } from "~/server/transactions";

/** Account writes share one order: username namespace, account lock, User row,
 * then linked roster rows. The namespace belongs here because callers may retain
 * this lock across nested name/handle writes; acquiring it later creates a cycle
 * with reviewed policies that fence every live identity before refreshing labels. */
export async function lockAccountProfile(tx: TransactionDb, userId: string) {
  await lockUsernameNamespace(tx);
  await lockEntity(tx, `account-profile:${userId}`);
  // Email/credential writers already lock User through UPDATE. Take the same row first,
  // so a profile edit never holds Tutor while waiting behind an email change on User.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}
