import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { TRPCError } from "@trpc/server";
import { lockEntity, type TransactionDb } from "~/server/transactions";

export const APPLICATION_EMAIL_MAX = 5;
export const APPLICATION_EMAIL_WINDOW_MS = 24 * 60 * 60_000;
// A school can share one public address. Keep its allowance much larger than one applicant's.
export const APPLICATION_IP_MAX = 500;
export const APPLICATION_IP_WINDOW_MS = 60 * 60_000;

/** Proxy headers are only a network abuse signal, never proof of applicant identity.
 * The deployment's reverse proxy must replace client-supplied forwarding headers. */
export function applicationClientIp(headers: Headers): string {
  const value = (
    headers.get("x-forwarded-for")?.split(",")[0] ??
    headers.get("x-real-ip") ??
    ""
  ).trim();
  if (isIP(value) === 4) return value;
  if (isIP(value) === 6) {
    // Zone identifiers belong to local interfaces, not forwarded public client addresses.
    // Node accepts them as IPv6, but URL parsing does not; group them with invalid headers.
    if (value.includes("%")) return "unknown";
    // URL parsing canonicalizes equivalent IPv6 spellings. The /64 bucket also bounds
    // rotating privacy addresses on the same school network.
    const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const [left = "", right = ""] = canonical.split("::");
    const head = left ? left.split(":") : [];
    const tail = right ? right.split(":") : [];
    const expanded = canonical.includes("::")
      ? [
          ...head,
          ...Array<string>(8 - head.length - tail.length).fill("0"),
          ...tail,
        ]
      : head;
    // IPv4-mapped addresses share the same bucket as their ordinary IPv4 form.
    if (
      expanded.slice(0, 5).every((part) => Number.parseInt(part, 16) === 0) &&
      expanded[5] === "ffff"
    ) {
      const bytes = expanded.slice(6).flatMap((part) => {
        const value = Number.parseInt(part, 16);
        return [value >> 8, value & 255];
      });
      return bytes.join(".");
    }
    return `${expanded
      .slice(0, 4)
      .map((part) => Number.parseInt(part, 16).toString(16))
      .join(":")}::/64`;
  }
  return "unknown";
}

export function applicationLimitKey(
  scope: "email" | "ip",
  value: string,
): string {
  return `${scope}:${createHash("sha256").update(value).digest("hex")}`;
}

/** Reserve capacity in the same transaction as the accepted application and notifications.
 * Counters survive restarts/replicas. Failed writes roll back; duplicates consume no capacity. */
async function reserveApplicationCapacity(
  tx: TransactionDb,
  email: string,
  headers: Headers,
): Promise<void> {
  const now = new Date();
  const limits = [
    {
      key: applicationLimitKey("email", email),
      max: APPLICATION_EMAIL_MAX,
      windowMs: APPLICATION_EMAIL_WINDOW_MS,
    },
    {
      key: applicationLimitKey("ip", applicationClientIp(headers)),
      max: APPLICATION_IP_MAX,
      windowMs: APPLICATION_IP_WINDOW_MS,
    },
  ].sort((a, b) => a.key.localeCompare(b.key));
  for (const limit of limits)
    await lockEntity(tx, `public-intake-limit:${limit.key}`);
  for (const limit of limits) {
    const bucket = await tx.publicApplicationRateLimit.findUnique({
      where: { key: limit.key },
    });
    if (bucket && bucket.resetsAt > now && bucket.count >= limit.max)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message:
          "Too many applications were submitted recently. Please try again later or contact the program team.",
      });
    const active = bucket && bucket.resetsAt > now;
    await tx.publicApplicationRateLimit.upsert({
      where: { key: limit.key },
      create: {
        key: limit.key,
        count: 1,
        resetsAt: new Date(now.getTime() + limit.windowMs),
      },
      update: active
        ? { count: { increment: 1 } }
        : { count: 1, resetsAt: new Date(now.getTime() + limit.windowMs) },
    });
  }
  // New submissions opportunistically prune old hashed counter keys in bounded batches.
  // SKIP LOCKED avoids waiting for other intake transactions while pruning unrelated keys.
  await tx.$executeRaw`DELETE FROM "PublicApplicationRateLimit" WHERE "key" IN (
    SELECT "key" FROM "PublicApplicationRateLimit" WHERE "resetsAt" < ${new Date(now.getTime() - 7 * 24 * 60 * 60_000)}
    LIMIT 100 FOR UPDATE SKIP LOCKED
  )`;
}

/** A pending initial application is idempotent by normalized address, across browser/IP changes.
 * Preserve the first submission and return the same public success response, without revealing
 * whether another submission exists or replacing somebody else's application details. */
export async function acceptPublicApplication(
  tx: TransactionDb,
  input: { kind: "tutor" | "crew"; email: string; headers: Headers },
  create: (email: string) => Promise<void>,
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  await lockEntity(tx, `public-application:${input.kind}:${email}`);
  const pending =
    input.kind === "tutor"
      ? await tx.tutorApplication.findFirst({
          where: {
            email: { equals: email, mode: "insensitive" },
            type: "INITIAL",
            status: { in: ["PENDING", "INTERVIEW"] },
          },
          select: { id: true },
        })
      : await tx.crewApplication.findFirst({
          where: {
            email: { equals: email, mode: "insensitive" },
            status: "PENDING",
          },
          select: { id: true },
        });
  if (pending) return;
  await reserveApplicationCapacity(tx, email, input.headers);
  await create(email);
}
