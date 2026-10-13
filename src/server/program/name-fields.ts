import { TRPCError } from "@trpc/server";
import {
  nameFieldPolicies,
  missingPersonNames,
  normalizeNewNames,
  hasDisplayableName,
  type NameAccountType,
  type NameFieldPolicies,
  type NameFieldStates,
} from "~/lib/name-field-policy";
import { nameDraft } from "~/lib/person-name";
import { parsePersonNames, getProfilePolicy } from "./profile-policy";
import {
  lockUsernameNamespace,
  ensureUserUsername,
  ensureUniqueUsername,
} from "~/server/auth/username";
import {
  inTransaction,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";

export async function getNameFieldPolicy(db: DomainDb) {
  const settings = await db.programSettings.findUnique({
    where: { id: "program" },
    select: { nameFields: true, nameFieldsVersion: true },
  });
  return {
    policies: nameFieldPolicies(settings?.nameFields),
    version: settings?.nameFieldsVersion ?? 0,
  };
}
/** Role grants are explicit identity writes. Reserve a neutral handle before the
 * database applies the destination policy, including old email-only accounts. */
export async function ensureNameFallbackForRole(
  tx: TransactionDb,
  userId: string,
  role: NameAccountType,
) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      username: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      alternativeNames: true,
      legacyName: true,
    },
  });
  if (user.username) return;
  const { policies } = await getNameFieldPolicy(tx);
  const display = await getProfilePolicy(tx);
  if (
    !hasDisplayableName(
      {
        ...nameDraft(user),
        legacyName: user.legacyName,
        legacyIdentity:
          user.firstName == null &&
          user.lastName == null &&
          user.preferredName == null,
      },
      policies[role],
      display.usePreferredNames,
      display.showAlternateNames,
    )
  )
    await ensureUserUsername(userId, tx, { namelessIdentity: true });
}
/** Explicit reviewed settings writes allocate only identities whose resulting live label needs a handle. */
export async function allocateNameFallbacks(
  tx: TransactionDb,
  policies: NameFieldPolicies,
  display: { usePreferredNames: boolean; showAlternateNames: boolean },
  accountType?: NameAccountType,
) {
  let afterId: string | undefined;
  for (;;) {
    // Bound memory to 100 rows. All pages share the same reviewed transaction: a late
    // allocation failure rolls back the setting and every earlier allocation together.
    const users = await tx.user.findMany({
      where: {
        username: null,
        ...(accountType ? { role: accountType } : {}),
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      take: 100,
      orderBy: { id: "asc" },
      select: {
        id: true,
        role: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        alternativeNames: true,
        legacyName: true,
      },
    });
    for (const user of users)
      if (
        !hasDisplayableName(
          {
            ...nameDraft(user),
            legacyName: user.legacyName,
            legacyIdentity:
              user.firstName == null &&
              user.lastName == null &&
              user.preferredName == null,
          },
          policies[user.role],
          display.usePreferredNames,
          display.showAlternateNames,
        )
      )
        await ensureUserUsername(user.id, tx, { namelessIdentity: true });
    if (users.length < 100) break;
    afterId = users.at(-1)!.id;
  }
  if (accountType && accountType !== "TUTOR") return;
  afterId = undefined;
  for (;;) {
    const tutors: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      preferredName: string | null;
      alternativeNames: string | null;
      legacyName: string | null;
      nameFieldsConfirmed: boolean;
    }[] = await tx.tutor.findMany({
      where: {
        username: null,
        user: null,
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      take: 100,
      orderBy: { id: "asc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        alternativeNames: true,
        legacyName: true,
        nameFieldsConfirmed: true,
      },
    });
    for (const tutor of tutors) {
      const draft = tutor.nameFieldsConfirmed
        ? nameDraft(tutor)
        : nameDraft({ alternativeNames: tutor.alternativeNames });
      if (
        !hasDisplayableName(
          {
            ...draft,
            legacyName: tutor.legacyName,
            legacyIdentity:
              !tutor.nameFieldsConfirmed ||
              (tutor.firstName == null &&
                tutor.lastName == null &&
                tutor.preferredName == null),
          },
          policies.TUTOR,
          display.usePreferredNames,
          display.showAlternateNames,
        )
      )
        await tx.tutor.update({
          where: { id: tutor.id },
          data: {
            username: await ensureUniqueUsername(
              "member",
              { excludeTutorId: tutor.id },
              tx,
            ),
          },
        });
    }
    if (tutors.length < 100) return;
    afterId = tutors.at(-1)!.id;
  }
}
/** Public intake validates the current configuration and ignores newly posted hidden values. */
export async function configuredNewNames(
  db: DomainDb,
  input: unknown,
  type: NameAccountType,
  management = false,
) {
  const states = (await getNameFieldPolicy(db)).policies[type];
  const draft = management
    ? nameDraft(input as Parameters<typeof nameDraft>[0])
    : normalizeNewNames(
        nameDraft(input as Parameters<typeof nameDraft>[0]),
        states,
      );
  if (missingPersonNames(draft, states).length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "PROFILE_NAME_FIELDS_REQUIRED",
    });
  return parsePersonNames(draft);
}
/** Old clients may provide an unsplit name under the original first-name-only rule.
 * They cannot use that compatibility route to bypass a newly required component or a hidden part. */
export async function configuredLegacyIntakeName(
  db: DomainDb,
  label: string,
  type: NameAccountType,
) {
  const states = (await getNameFieldPolicy(db)).policies[type];
  const hiddenPart = (["firstName", "lastName", "preferredName"] as const).some(
    (key) => states[key] === "hidden",
  );
  if (
    (states.firstName === "required" && (!label.trim() || hiddenPart)) ||
    (["lastName", "preferredName", "alternativeNames"] as const).some(
      (key) => states[key] === "required",
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "PROFILE_NAME_FIELDS_REQUIRED",
    });
  return hiddenPart ? "" : label.trim();
}
/** Existing hidden values survive even a forged participant payload. Staff may explicitly edit retained fields. */
export async function configuredProfileNames(
  db: DomainDb,
  input: unknown,
  current: Parameters<typeof nameDraft>[0],
  type: NameAccountType,
  management = false,
) {
  const states = (await getNameFieldPolicy(db)).policies[type];
  const posted = nameDraft(input as Parameters<typeof nameDraft>[0]);
  const original = nameDraft(current);
  const draft = { ...posted };
  for (const key of [
    "firstName",
    "lastName",
    "preferredName",
    "alternativeNames",
  ] as const)
    if (states[key] === "hidden" && !management) draft[key] = original[key];
  const legacy =
    current &&
    current.firstName == null &&
    current.lastName == null &&
    current.preferredName == null &&
    "legacyName" in current &&
    typeof current.legacyName === "string" &&
    !!current.legacyName.trim() &&
    (["firstName", "lastName", "preferredName"] as const).every(
      (key) => draft[key].trim() === original[key].trim(),
    );
  if (
    missingPersonNames(draft, states).some(
      (key) => !legacy || key !== "firstName",
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "PROFILE_NAME_FIELDS_REQUIRED",
    });
  const shadow = { ...draft };
  // Unchanged original values are evidence, including old script spellings; validate only intentional replacements.
  for (const key of [
    "firstName",
    "lastName",
    "preferredName",
    "alternativeNames",
  ] as const)
    if (draft[key].trim() === original[key].trim()) shadow[key] = "";
  const parsed = parsePersonNames(shadow);
  return {
    ...parsed,
    ...Object.fromEntries(
      (["firstName", "lastName", "preferredName", "alternativeNames"] as const)
        .filter((key) => draft[key].trim() === original[key].trim())
        .map((key) => [key, original[key]]),
    ),
  };
}
/** Policy changes fence every identity writer before the live labels refresh; original fields remain intact. */
export async function saveNameFieldPolicy(
  db: DomainDb,
  input: {
    accountType: NameAccountType;
    states: NameFieldStates;
    expectedVersion: number;
  },
) {
  return inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    const before = await getNameFieldPolicy(tx);
    if (before.version !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message: "NAME_FIELD_POLICY_CHANGED",
      });
    await tx.$executeRaw`LOCK TABLE "User", "Tutor", "Tutee" IN EXCLUSIVE MODE`;
    // Bounded explicit backfill happens only in this reviewed policy write, never in a read.
    // Allocate before labels refresh; retained original fields are untouched.
    const display = await getProfilePolicy(tx);
    const policies = { ...before.policies, [input.accountType]: input.states };
    await allocateNameFallbacks(tx, policies, display, input.accountType);
    const result = await tx.programSettings.upsert({
      where: { id: "program" },
      create: { id: "program", nameFields: policies, nameFieldsVersion: 1 },
      update: { nameFields: policies, nameFieldsVersion: { increment: 1 } },
    });
    return { policies, version: result.nameFieldsVersion };
  });
}
