import { z } from "zod";

type Change = {
  entity: string;
  operation: string;
  changedFields: unknown;
  before: unknown;
  after: unknown;
};
const names = [
  "firstName",
  "lastName",
  "preferredName",
  "legacyName",
  "alternativeNames",
];
const preservedFields: Record<string, ReadonlySet<string>> = {
  User: new Set([
    ...names,
    "name",
    "username",
    "email",
    "profileVersion",
    "emailSecurity",
    "emailMessages",
    "emailInfo",
    "emailReviewRequests",
    "emailEventReminders",
    "emailSecondaryRecipients",
    "passwordHash",
    "sessionVersion",
    "mustChangePassword",
    "twoFactorEnabled",
    "emailVerifiedAt",
    "suspendedAt",
    "suspendedReason",
    "role",
    "canTranslate",
    "crewStatus",
    "affiliation",
  ]),
  Tutor: new Set([
    ...names,
    "englishName",
    "nameFieldsConfirmed",
    "username",
    "email",
    "updatedAt",
    "preferredAssignedBlocks",
    "workloadPreferenceVersion",
  ]),
  Tutee: new Set([
    ...names,
    "englishName",
    "email",
    "phone",
    "preferredContact",
    "updatedAt",
  ]),
  Person: new Set(["revision", "updatedAt"]),
};
const fields = z.array(z.string()).max(200);
const expiry = z.object({ expiresAt: z.string() });

/** This is preservation, never replay. Full changed-column coverage is required:
 * equal redacted snapshots cannot prove that an ownership or private field stayed put. */
export function preservedRecoveryChange(change: Change): boolean {
  const parsed = fields.safeParse(change.changedFields);
  if (!parsed.success) return false;
  // Delivery preferences belong to the account, not its admission. Journal
  // every write, but preserve these settings rather than compensating them.
  if (change.entity === "NotificationPreference") {
    const allowed = change.operation === "UPDATE"
      ? ["badgeEnabled", "emailEnabled"]
      : ["INSERT", "DELETE"].includes(change.operation)
        ? ["userId", "category", "badgeEnabled", "emailEnabled"] : [];
    return allowed.length > 0 && parsed.data.length > 0 && parsed.data.every((field) => allowed.includes(field));
  }
  if (change.operation !== "UPDATE") return false;
  if (change.entity === "User" && parsed.data.includes("role")) {
    const after = z
      .object({
        role: z.enum(["ADMIN", "HEAD", "COORDINATOR", "VIEWER", "CREW"]),
      })
      .safeParse(change.after);
    if (!after.success) return false;
  }
  const allowed = preservedFields[change.entity];
  if (allowed && parsed.data.every((field) => allowed.has(field))) return true;
  if (
    change.entity !== "RegistrationCode" ||
    parsed.data.some(
      (field) =>
        ![
          "expiresAt",
          "emailCodeHash",
          "emailCodeExpiresAt",
          "emailVerifiedAt",
        ].includes(field),
    )
  )
    return false;
  const before = expiry.safeParse(change.before);
  const after = expiry.safeParse(change.after);
  // A separate revocation remains effective. Extending/rebinding authorization
  // is a different decision and must not be silently adopted by this adapter.
  return (
    before.success &&
    after.success &&
    Date.parse(after.data.expiresAt) <= Date.parse(before.data.expiresAt)
  );
}

export function preservedRecoveryEvent(changes: Change[]): boolean {
  return changes.length > 0 && changes.every(preservedRecoveryChange);
}
