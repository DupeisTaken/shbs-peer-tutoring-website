/** Web convenience wrapper; DB-only callers import username-core explicitly. */
import { db } from "~/server/db";
import type { DomainDb } from "~/server/transactions";
import { ensureUserUsername as ensureUserUsernameWithClient } from "./username-core";
export {
  defaultUsername,
  lockUsernameNamespace,
  splitDisplayName,
  ensureUniqueUsername,
  canonicalUsername,
  backfillStudentUsernames,
} from "./username-core";

/** Preserve the web API while every core username operation requires its DB. */
export async function ensureUserUsername(
  userId: string,
  client: DomainDb = db,
  options: Parameters<typeof ensureUserUsernameWithClient>[2] = {},
): Promise<string> {
  return ensureUserUsernameWithClient(userId, client, options);
}
