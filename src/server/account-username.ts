import { TRPCError } from "@trpc/server";
import { accountUsernameSchema } from "~/lib/username";
import { lockUsernameNamespace } from "./auth/username";
export { accountUsernameSchema } from "~/lib/username";
import { lockAccountProfile } from "./account-profile";
import { inTransaction, type DomainDb } from "./transactions";
import { staleConflict } from "./concurrency";

export async function updateAccountUsername(database: DomainDb, actorId: string, input: {
  userId: string; username: string; expectedProfileVersion: number;
}) {
  const username = accountUsernameSchema.parse(input.username);
  return inTransaction(database, async (tx) => {
    // The namespace spans two tables. Serialize against all existing writers, including
    // automatic username allocation, before checking either table or locking a profile.
    await lockUsernameNamespace(tx);
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (actor?.role !== "HEAD" || actor.suspendedAt)
      throw new TRPCError({ code: "FORBIDDEN", message: "Only Head may edit usernames." });
    await lockAccountProfile(tx, input.userId);
    const current = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
    if (current.profileVersion !== input.expectedProfileVersion) staleConflict();
    const [userClash, tutorClash] = await Promise.all([
      tx.user.findFirst({ where: { username: { equals: username, mode: "insensitive" }, id: { not: current.id } } }),
      tx.tutor.findFirst({ where: { username: { equals: username, mode: "insensitive" }, ...(current.tutorId ? { id: { not: current.tutorId } } : {}) } }),
    ]);
    if (userClash || tutorClash)
      throw new TRPCError({ code: "CONFLICT", message: "That username is already taken." });
    const tutor = current.tutorId ? await tx.tutor.findUniqueOrThrow({ where: { id: current.tutorId } }) : null;
    if (current.username === username && (!tutor || tutor.username === username)) return current;
    const updated = await tx.user.update({ where: { id: current.id }, data: { username, profileVersion: { increment: 1 } } });
    if (tutor) await tx.tutor.update({ where: { id: tutor.id }, data: { username } });
    await tx.auditLog.create({ data: {
      userId: actor.id, userName: actor.name ?? actor.username, entity: "User", entityId: current.id,
      operation: "admin.updateAccountUsername", kind: "ACTION", action: "Updated account username",
      details: { oldUsername: current.username, newUsername: username, tutorId: current.tutorId, oldTutorUsername: tutor?.username ?? null },
    } });
    return updated;
  });
}
