import { lockEntity, type TransactionDb } from "../transactions";
import {
  isSerializationFailure,
  UsernameSnapshotConflict,
} from "./username-snapshot";

/** Shared CLI/server lock: do not import application config or the global client.
 * Acquire BEFORE account/profile/row writes and hold through persistence. */
export async function lockUsernameNamespace(tx: TransactionDb): Promise<void> {
  await lockEntity(tx, "identity:username-namespace");
  try {
    // Advisory locks serialize writers, but cannot refresh an old Serializable snapshot.
    // Updating one persistent tuple makes PostgreSQL reject that stale snapshot BEFORE
    // it can select a handle. Upsert also recreates the fence after isolated test resets.
    await tx.$executeRaw`INSERT INTO "UsernameNamespaceGuard" (id, revision) VALUES (1, 1)
      ON CONFLICT (id) DO UPDATE SET revision = "UsernameNamespaceGuard".revision + 1`;
  } catch (error) {
    if (isSerializationFailure(error))
      throw new UsernameSnapshotConflict(error);
    throw error;
  }
}
