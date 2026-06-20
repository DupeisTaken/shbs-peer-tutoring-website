/**
 * Tutor username generation.
 *
 * The default username is the first initial + full last name, lowercased and stripped of
 * anything that isn't a letter or digit — e.g. "John" + "Smith" -> "jsmith". Usernames are
 * an alternate sign-in identifier (a tutor may sign in with username OR email), so they must
 * be unique; `ensureUniqueUsername` appends a numeric suffix on collision.
 *
 * Node runtime only (touches the database).
 */
import { db } from "~/server/db";

/** Keep only [a-z0-9], lowercased. */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The default username for a tutor: first initial + last name (e.g. "jsmith").
 * Returns "" when neither name part yields any usable characters.
 */
export function defaultUsername(firstName: string, lastName: string): string {
  const first = slug(firstName);
  const last = slug(lastName);
  if (!first && !last) return "";
  return `${first.slice(0, 1)}${last}`;
}

/**
 * Resolve a unique username from a desired base, skipping `Tutor.username` collisions by
 * appending 2, 3, … . Pass `excludeTutorId` when editing an existing tutor so its own
 * current username doesn't count as a conflict.
 */
export async function ensureUniqueUsername(
  base: string,
  excludeTutorId?: string,
): Promise<string> {
  const root = slug(base) || "tutor";
  for (let n = 0; ; n++) {
    const candidate = n === 0 ? root : `${root}${n + 1}`;
    const existing = await db.tutor.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!existing || existing.id === excludeTutorId) return candidate;
  }
}
