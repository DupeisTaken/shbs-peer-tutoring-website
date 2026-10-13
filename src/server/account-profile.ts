import { assertPrimaryName } from "~/server/program/profile-policy";
import { fullPersonName } from "~/lib/person-name";
import {
  configuredProfileNames,
  getNameFieldPolicy,
} from "~/server/program/name-fields";
import {
  lockUsernameNamespace,
  ensureUserUsername,
} from "~/server/auth/username";
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
  options: { management?: boolean } = {},
) {
  return inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    await lockAccountProfile(tx, userId);
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const nameStates = (await getNameFieldPolicy(tx)).policies[current.role];
    const shouldWriteName = (
      key: "firstName" | "lastName" | "preferredName" | "alternativeNames",
    ) =>
      input[key] !== undefined &&
      (options.management === true || nameStates[key] !== "hidden") &&
      (input[key]?.trim() ?? "") !== (current[key]?.trim() ?? "");
    const latinEdited = (
      ["firstName", "lastName", "preferredName"] as const
    ).some(shouldWriteName);
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
      input.preferredName !== undefined ||
      input.alternativeNames !== undefined
        ? await configuredProfileNames(
            tx,
            {
              ...current,
              ...input,
              firstName: input.firstName ?? current.firstName ?? "",
              lastName: input.lastName ?? current.lastName ?? "",
            },
            current,
            current.role,
            options.management,
          )
        : null;
    let name =
      explicit && latinEdited
        ? fullPersonName(explicit)
        : (input.name?.trim() ?? current.legacyName ?? current.name);
    if (!name?.trim() && !current.username) {
      name = await ensureUserUsername(userId, tx, { namelessIdentity: true });
    }
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

    const alternative =
      explicit?.alternativeNames?.trim() ??
      input.alternativeNames?.trim() ??
      "";
    const alternativeNames = !shouldWriteName("alternativeNames")
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
              firstName: shouldWriteName("firstName")
                ? explicit.firstName
                : current.firstName,
              lastName: shouldWriteName("lastName")
                ? explicit.lastName
                : current.lastName,
              preferredName: shouldWriteName("preferredName")
                ? (explicit.preferredName ?? null)
                : current.preferredName,
            }
          : {}),
        profileVersion: { increment: 1 },
      },
    });
    if (name || explicit) {
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
            englishName: updated.name ?? updated.username ?? "",
            ...identity,
            ...(latinEdited ? { nameFieldsConfirmed: true } : {}),
          },
        });
      if (current.studentId)
        await tx.tutee.update({
          where: { id: current.studentId },
          data: {
            englishName: updated.name ?? updated.username ?? "",
            ...identity,
          },
        });
    }
    return updated;
  });
}
