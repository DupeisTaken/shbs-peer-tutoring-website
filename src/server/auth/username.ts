/**
 * Username generation for tutors and login accounts.
 *
 * The default username is first initial + last name + 2-digit graduation year, lowercased and
 * stripped of anything that isn't a letter or digit — e.g. "John" + "Smith", class of 2027 ->
 * "jsmith27". (Without a known grad year it's just "jsmith".) Usernames are an alternate sign-in
 * identifier (sign in with username OR email), so they must be unique. To keep a single global
 * handle space, uniqueness is enforced across BOTH `Tutor.username` and `User.username`
 * (`ensureUniqueUsername` appends a letter, then a counter, on collision). `ensureUserUsername`
 * guarantees a given login has one, mirroring its linked tutor's handle when present.
 *
 * Node runtime only (touches the database).
 */
import { db } from "~/server/db";

/** Keep only [a-z0-9], lowercased. */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Split a single display string ("Alice Chen", "Madonna", "Mary Jane Watson") into name parts
 * for a Tutor record. The FIRST token is the first name and the REST is the last name — a
 * single-token name keeps an empty last name (never duplicate it into "Madonna Madonna"). The
 * `englishName` is the parts rejoined (or the raw string when it has no usable tokens).
 */
export function splitDisplayName(display: string): {
  firstName: string;
  lastName: string;
  englishName: string;
} {
  const raw = display.trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? raw;
  const lastName = parts.slice(1).join(" ");
  const englishName = [firstName, lastName].filter(Boolean).join(" ") || raw;
  return { firstName, lastName, englishName };
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
 * Resolve a unique username from a desired base, skipping collisions in BOTH the `Tutor` and
 * `User` handle spaces (so a tutor and an admin can never share a sign-in handle). Pass
 * `excludeTutorId` / `excludeUserId` when editing an existing row so its own username isn't
 * counted as a clash.
 */
export async function ensureUniqueUsername(
  base: string,
  opts: { excludeTutorId?: string; excludeUserId?: string } = {},
): Promise<string> {
  const root = slug(base) || "tutor";
  for (const candidate of usernameCandidates(root)) {
    const [tutor, user] = await Promise.all([
      db.tutor.findUnique({ where: { username: candidate }, select: { id: true } }),
      db.user.findUnique({ where: { username: candidate }, select: { id: true } }),
    ]);
    const tutorClash = tutor && tutor.id !== opts.excludeTutorId;
    const userClash = user && user.id !== opts.excludeUserId;
    if (!tutorClash && !userClash) return candidate;
  }
  return root; // unreachable — the counter tier is infinite
}

/**
 * Ensure a login account has a username, assigning one if missing. For a linked tutor it mirrors
 * the tutor's handle; otherwise it derives one from the display name (falling back to the email
 * local-part). Idempotent — returns the existing username untouched when already set. Used to
 * uphold the "every account has a username" invariant on sign-in, creation, and backfill.
 */
export async function ensureUserUsername(userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      role: true,
      name: true,
      email: true,
      tutor: { select: { username: true } },
    },
  });
  if (!user) return "";
  if (user.username) return user.username;
  // Viewers (read-only VIEWER, no tutor) may be username-less — they sign in by email.
  if (user.role === "VIEWER" && !user.tutor) return "";

  let base = user.tutor?.username ?? "";
  if (!base) {
    const parts = (user.name ?? "").trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      base = defaultUsername(parts[0]!, parts.slice(1).join(" "));
    } else if (parts.length === 1) {
      base = slug(parts[0]!);
    }
  }
  if (!base) base = slug(user.email.split("@")[0] ?? "");

  const username = await ensureUniqueUsername(base, { excludeUserId: user.id });
  await db.user.update({ where: { id: user.id }, data: { username } });
  return username;
}
