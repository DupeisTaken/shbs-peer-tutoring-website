import { staleConflict } from "~/server/concurrency";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";

/** All profile writers take the account lock before touching a linked roster row. */
export async function lockAccountProfile(tx: TransactionDb, userId: string) {
  await lockEntity(tx, `account-profile:${userId}`);
  // Email/credential writers already lock User through UPDATE. Take the same row first,
  // so a profile edit never holds Tutor while waiting behind an email change on User.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

/** The account owns identity; mirrors are compatibility fields, never evidence of ownership.
 * Historical signatures, submissions and audit actor snapshots deliberately do not change. */
export async function updateAccountProfile(
  db: DomainDb,
  userId: string,
  input: {
    name?: string;
    alternativeNames?: string | null;
    expectedProfileVersion?: number;
    expectedTutorId?: string;
    expectedStudentId?: string;
  } = {},
) {
  return inTransaction(db, async (tx) => {
    await lockAccountProfile(tx, userId);
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (
      input.expectedProfileVersion !== undefined &&
      current.profileVersion !== input.expectedProfileVersion
    )
      staleConflict();
    if (
      (input.expectedTutorId && current.tutorId !== input.expectedTutorId) ||
      (input.expectedStudentId && current.studentId !== input.expectedStudentId)
    )
      staleConflict();
    const name = input.name?.trim() ?? current.name;
    const alternative = input.alternativeNames?.trim() ?? "";
    const alternativeNames =
      input.alternativeNames === undefined
        ? current.alternativeNames
        : alternative.length === 0
          ? null
          : alternative;
    const updated = await tx.user.update({
      where: { id: userId },
      data: { name, alternativeNames, profileVersion: { increment: 1 } },
    });
    if (name) {
      const [firstName, ...rest] = name.split(/\s+/);
      if (current.tutorId)
        await tx.tutor.update({
          where: { id: current.tutorId },
          data: {
            englishName: name,
            firstName,
            lastName: rest.length === 0 ? null : rest.join(" "),
            alternativeNames,
          },
        });
      if (current.studentId)
        await tx.tutee.update({
          where: { id: current.studentId },
          data: { englishName: name, alternativeNames },
        });
    }
    return updated;
  });
}
