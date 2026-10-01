import {
  assertPrimaryName,
  parsePersonNames,
} from "~/server/program/profile-policy";
import { fullPersonName } from "~/lib/person-name";
import { TRPCError } from "@trpc/server";
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
    firstName?: string;
    lastName?: string;
    preferredName?: string | null;
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
    const explicit =
      input.firstName !== undefined ||
      input.lastName !== undefined ||
      input.preferredName !== undefined
        ? parsePersonNames({
            ...current,
            ...input,
            firstName: input.firstName ?? current.firstName ?? "",
            lastName: input.lastName ?? current.lastName ?? "",
          })
        : null;
    const name = explicit
      ? fullPersonName(explicit)
      : (input.name?.trim() ?? current.legacyName ?? current.name);
    // A full display string cannot safely replace structured fields (it may include
    // a preferred name or another script). Require the current editor for that change.
    if (
      !explicit &&
      current.firstName &&
      input.name !== undefined &&
      input.name.trim() !== current.name
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Update the first and last name fields to change this profile.",
      });
    // Validate each intentional name change independently against the locked profile.
    if (
      input.name !== undefined &&
      !explicit &&
      input.name.trim() !== current.name?.trim()
    )
      // A display label may append another script. The original unsplit name is
      // also an unchanged identity, not an intentional replacement of that label.
      await assertPrimaryName(
        tx,
        input.name,
        current.firstName ? current.name : (current.legacyName ?? current.name),
      );

    const alternative = input.alternativeNames?.trim() ?? "";
    const alternativeNames =
      input.alternativeNames === undefined
        ? current.alternativeNames
        : alternative.length === 0
          ? null
          : alternative;
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        name,
        alternativeNames,
        ...(explicit
          ? {
              firstName: explicit.firstName,
              lastName: explicit.lastName,
              preferredName: explicit.preferredName ?? null,
            }
          : {}),
        profileVersion: { increment: 1 },
      },
    });
    if (name) {
      // Mirror explicit fields directly; a display label can contain a preferred name
      // and a second script and must never be split back into identity fields.
      const identity = {
        firstName: updated.firstName,
        lastName: updated.lastName,
        preferredName: updated.preferredName,
        alternativeNames: updated.alternativeNames,
        legacyName: updated.legacyName,
      };
      if (current.tutorId)
        await tx.tutor.update({
          where: { id: current.tutorId },
          data: {
            englishName: name,
            ...identity,
            ...(explicit ? { nameFieldsConfirmed: true } : {}),
          },
        });
      if (current.studentId)
        await tx.tutee.update({
          where: { id: current.studentId },
          data: { englishName: name, ...identity },
        });
    }
    return updated;
  });
}
