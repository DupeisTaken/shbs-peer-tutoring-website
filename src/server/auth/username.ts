/**
 * Tutor username generation.
 *
 * The default username is first initial + last name + 2-digit graduation year, lowercased and
 * stripped of anything that isn't a letter or digit — e.g. "John" + "Smith", class of 2027 ->
 * "jsmith27". (Without a known grad year it's just "jsmith".) Usernames are an alternate sign-in
 * identifier (a tutor may sign in with username OR email), so they must be unique;
 * `ensureUniqueUsername` appends a letter, then a counter, on collision.
 *
 * Node runtime only (touches the database).
 */
import { db } from "~/server/db";

/** Keep only [a-z0-9], lowercased. */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Two-digit form of a class-of year (2027 -> "27"), or "" when none is known. */
function gradSuffix(gradYear?: number | null): string {
  if (gradYear == null) return "";
  return String(((gradYear % 100) + 100) % 100).padStart(2, "0");
}

/**
 * The default username for a tutor: first initial + last name + graduation year
 * (e.g. "jsmith27"). Pass `gradYear` (the class-of year — see `graduationYear` in
 * src/lib/period.ts); omit it to fall back to the bare "jsmith". Returns "" when neither
 * name part yields any usable characters.
 */
export function defaultUsername(
  firstName: string,
  lastName: string,
  gradYear?: number | null,
): string {
  const first = slug(firstName);
  const last = slug(lastName);
  if (!first && !last) return "";
  return `${first.slice(0, 1)}${last}${gradSuffix(gradYear)}`;
}

/**
 * Candidate usernames for a base, in priority order:
 *   1. the bare base            (jsmith27)
 *   2. base + a letter          (jsmith27b, jsmith27c, …)
 *   3. base + a counter         (jsmith272, jsmith273, …)  — final fallback, guarantees termination
 * The base already carries the grad year, so a letter suffix disambiguates same-name classmates
 * without producing an opaque number.
 */
function* usernameCandidates(root: string): Generator<string> {
  yield root;
  for (const c of "bcdefghijklmnopqrstuvwxyz") yield `${root}${c}`;
  for (let n = 2; ; n++) yield `${root}${n}`;
}

/**
 * Resolve a unique username from a desired base, skipping `Tutor.username` collisions. Pass
 * `excludeTutorId` when editing an existing tutor so its own username isn't counted as a clash.
 */
export async function ensureUniqueUsername(
  base: string,
  opts: { excludeTutorId?: string } = {},
): Promise<string> {
  const root = slug(base) || "tutor";
  for (const candidate of usernameCandidates(root)) {
    const existing = await db.tutor.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!existing || existing.id === opts.excludeTutorId) return candidate;
  }
  return root; // unreachable — the counter tier is infinite
}
