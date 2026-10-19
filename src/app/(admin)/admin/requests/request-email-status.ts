export type RequestEmailOwner = {
  email?: string | null;
  emailVerifiedAt?: Date | null;
};

/** A contact address is verified only by evidence for that exact owned address.
 * Missing account metadata (including older response shapes) is unknown, not a
 * negative verification flag. A different primary address proves nothing about
 * the roster contact, which may be an unprojected secondary or historical email.
 */
export function requestEmailStatus(
  email: string | null | undefined,
  owner: RequestEmailOwner | null | undefined,
): "verified" | "unverified" | "unknown" | null {
  const address = email?.trim().toLowerCase();
  if (!address) return null;
  if (
    owner?.email?.trim().toLowerCase() !== address ||
    owner?.emailVerifiedAt === undefined
  ) {
    return "unknown";
  }
  return owner.emailVerifiedAt ? "verified" : "unverified";
}
