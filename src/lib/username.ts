import { z } from "zod";

/** Generated and Head-edited handles share this public, ASCII-only sign-in contract. */
export const USERNAME_MAX_LENGTH = 64;
// Reserve eight digits for collisions, keeping the name/year stem stable across candidates.
const USERNAME_BASE_LENGTH = USERNAME_MAX_LENGTH - 8;
export const accountUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(USERNAME_MAX_LENGTH)
  .regex(/^[a-z0-9]+$/, "Use only letters and numbers for the username.");
export const preferredLatinNameSchema = z.string().trim().max(160).optional();

/** Normalize decomposable accents; never guess transliterations for other scripts. */
export function usernameSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function hasLatinName(value: string): boolean {
  return /[a-z]/.test(usernameSlug(value));
}

/** Optional spelling is used only when the display name has no usable Latin letters. */
export function usernameNameParts(
  firstName: string,
  lastName: string,
  preferredLatinName?: string,
) {
  const display = `${firstName} ${lastName}`;
  if (hasLatinName(display) || !preferredLatinName?.trim())
    return { firstName, lastName };
  const [first = "", ...rest] = preferredLatinName.trim().split(/\s+/);
  return { firstName: first, lastName: rest.join(" ") };
}

/** A single token is retained in full; a neutral fallback keeps a confirmed year suffix. */
export function defaultUsername(
  firstName: string,
  lastName: string,
  gradYear?: number | null,
  preferredLatinName?: string,
): string {
  const names = usernameNameParts(firstName, lastName, preferredLatinName);
  const first = usernameSlug(names.firstName);
  const last = usernameSlug(names.lastName);
  const stem = hasLatinName(`${names.firstName} ${names.lastName}`)
    ? (last ? `${first.slice(0, 1)}${last}` : first) || "member"
    : "member";
  const year =
    gradYear == null
      ? ""
      : String(((gradYear % 100) + 100) % 100).padStart(2, "0");
  return `${stem.slice(0, USERNAME_BASE_LENGTH - year.length)}${year}`;
}

/** Reserve suffix space before concatenating, including the dense-collision counter tier. */
export function* usernameCandidates(base: string): Generator<string> {
  const root = (usernameSlug(base) || "member").slice(0, USERNAME_BASE_LENGTH);
  yield root.slice(0, USERNAME_MAX_LENGTH);
  for (const suffix of "bcdefghijklmnopqrstuvwxyz")
    yield `${root.slice(0, USERNAME_MAX_LENGTH - 1)}${suffix}`;
  for (let n = 2; n <= 99_999_999; n++) {
    const suffix = String(n);
    yield `${root.slice(0, USERNAME_MAX_LENGTH - suffix.length)}${suffix}`;
  }
}
