import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "../../generated/prisma";
import { applicationClientIp } from "./public-application-intake";
import { lockEntity } from "./transactions";

export type SignupLane = "mail" | "complete" | "read";
export class SignupRetry extends Error {
  constructor(public retryAfterSeconds: number) {
    super("SIGNUP_RETRY");
  }
}
export function signupRejected(seconds = 60): never {
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: "SIGNUP_RETRY",
    cause: new SignupRetry(seconds),
  });
}

// Fixed categories, no participant identifiers or proofs in operational telemetry.
const metrics = new Map<string, { count: number; loggedAt: number }>();
export function signupMetric(
  event:
    | "throttled"
    | "busy"
    | "delivery-failed"
    | "captcha-accepted"
    | "captcha-rejected"
    | "captcha-unavailable"
    | "captcha-budget",
) {
  const entry = metrics.get(event) ?? { count: 0, loggedAt: 0 };
  entry.count++;
  if (Date.now() - entry.loggedAt >= 60_000) {
    console.warn(
      JSON.stringify({ component: "signup", event, count: entry.count }),
    );
    entry.count = 0;
    entry.loggedAt = Date.now();
  }
  metrics.set(event, entry);
}

export function signupConfig(
  name: string,
  fallback: number,
  ceiling = 100_000,
): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > ceiling)
    throw new Error(`Invalid ${name}`);
  return parsed;
}

/** Trust exactly the header Caddy overwrites, only when the private proxy boundary is enabled.
 * X-Forwarded-For and X-Real-IP from the public client are never used by signup. */
export function signupNetwork(headers: Headers) {
  const address =
    process.env.SIGNUP_TRUST_PROXY === "true"
      ? headers.get("x-signup-client-ip")
      : null;
  return address && !address.includes(",")
    ? applicationClientIp(new Headers({ "x-real-ip": address }))
    : "unknown";
}

export function signupKey(value: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for signup accounting");
  return createHmac("sha256", secret).update(value).digest("hex");
}

/** Separate tiny fixed-window stores: new submissions cannot evict confirmation capacity.
 * Refuse unknown keys at the cap, rather than evicting live counters during an attack. */
const bursts: Record<
  SignupLane,
  Map<string, { count: number; until: number }>
> = {
  mail: new Map(),
  complete: new Map(),
  read: new Map(),
};
export function signupBurst(
  lane: SignupLane,
  network: string,
  now = Date.now(),
) {
  const store = bursts[lane];
  for (const [key, value] of store) if (value.until <= now) store.delete(key);
  for (const [key, max] of [
    ["global", 600],
    [signupKey(network), 240],
  ] as const) {
    const entry = store.get(key) ?? { count: 0, until: now + 60_000 };
    if ((!store.has(key) && store.size >= 2048) || entry.count >= max) {
      signupMetric("throttled");
      signupRejected(Math.max(1, Math.ceil((entry.until - now) / 1000)));
    }
    entry.count++;
    store.set(key, entry);
  }
}

export type SignupQuota = { key: string; max: number; windowMs: number };
/** Independent committed accounting: later validation/transaction failures never refund attempts.
 * One short admission lock makes the multi-key allowance atomic across processes. Global quotas
 * are checked before inserting identities, bounding cardinality even with rotating addresses. */
export async function reserveSignupQuotas(
  db: PrismaClient,
  quotas: SignupQuota[],
) {
  const rejection = await db.$transaction(
    async (tx) => {
      await lockEntity(tx, "signup:admission");
      const now = new Date();
      await tx.$executeRaw`DELETE FROM "SignupQuota" WHERE "key" IN (
      SELECT "key" FROM "SignupQuota" WHERE "expiresAt" <= ${now} LIMIT 100 FOR UPDATE SKIP LOCKED
    )`;
      await tx.$executeRaw`DELETE FROM "SignupLease" WHERE "slot" IN (SELECT "slot" FROM "SignupLease" WHERE "expiresAt" <= NOW() LIMIT 100 FOR UPDATE SKIP LOCKED)`;
      const rows = await tx.$queryRaw<
        { key: string; count: number; expiresAt: Date }[]
      >`
      SELECT * FROM "SignupQuota" WHERE "key" = ANY(${quotas.map((q) => q.key)}::text[])`;
      for (const quota of quotas) {
        const row = rows.find((row) => row.key === quota.key);
        if (row && row.expiresAt > now && row.count >= quota.max)
          return Math.max(
            1,
            Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000),
          );
      }
      for (const quota of quotas) {
        const expires = new Date(now.getTime() + quota.windowMs);
        await tx.$executeRaw`INSERT INTO "SignupQuota" ("key", "count", "expiresAt") VALUES (${quota.key}, 1, ${expires})
        ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "SignupQuota"."expiresAt" <= ${now} THEN 1 ELSE "SignupQuota"."count" + 1 END,
        "expiresAt" = CASE WHEN "SignupQuota"."expiresAt" <= ${now} THEN ${expires} ELSE "SignupQuota"."expiresAt" END`;
      }
      return 0;
    },
    { maxWait: 1000, timeout: 3000 },
  );
  if (rejection) {
    signupMetric("throttled");
    signupRejected(rejection);
  }
}

/** Durable, fixed-slot leases have no unbounded queue. Separate lanes reserve completion work.
 * Crash recovery expires a lease after 120 seconds; SMTP has a much shorter transport timeout.
 * A random owner prevents a late finally from releasing a newer process's lease. */
export async function withSignupLease<T>(
  db: PrismaClient,
  lane: string,
  work: () => Promise<T>,
  slots = 8,
): Promise<T> {
  const owner = randomUUID();
  // Serialize only allocation, never the protected work. Without this lock, two
  // concurrent snapshots choose the same empty slot and reject despite spare capacity.
  const leases = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`signup-lease:${lane}`}, 0))`;
    return tx.$queryRaw<
    { slot: string }[]
  >`INSERT INTO "SignupLease" ("slot", "owner", "expiresAt")
    SELECT ${lane} || ':' || n::text, ${owner}, NOW() + INTERVAL '120 seconds'
    FROM generate_series(1, ${slots}) n
    WHERE NOT EXISTS (SELECT 1 FROM "SignupLease" l WHERE l."slot" = ${lane} || ':' || n::text AND l."expiresAt" > NOW())
    ORDER BY n LIMIT 1
    ON CONFLICT ("slot") DO UPDATE SET "owner" = EXCLUDED."owner", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "SignupLease"."expiresAt" <= NOW()
    RETURNING "slot"`;
  }, { maxWait: 1000, timeout: 3000 });
  const slot = leases[0]?.slot;
  if (!slot) {
    signupMetric("busy");
    signupRejected(5);
  }
  try {
    return await work();
  } finally {
    await db.$executeRaw`DELETE FROM "SignupLease" WHERE "slot" = ${slot} AND "owner" = ${owner}`;
  }
}

export async function withSignupAdmission<T>(
  db: PrismaClient,
  headers: Headers,
  lane: SignupLane,
  identity: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const network = signupNetwork(headers);
  signupBurst(lane, network);
  const windowMs = 15 * 60_000;
  const quotas: SignupQuota[] = [
    {
      key: `${lane}:global`,
      max: signupConfig(
        `SIGNUP_${lane.toUpperCase()}_GLOBAL`,
        lane === "mail" ? 400 : lane === "complete" ? 2000 : 6000,
      ),
      windowMs,
    },
    {
      key: `${lane}:network:${signupKey(network)}`,
      max: signupConfig(
        `SIGNUP_${lane.toUpperCase()}_NETWORK`,
        lane === "mail" ? 300 : lane === "complete" ? 1200 : 3000,
      ),
      windowMs,
    },
  ];
  if (identity) {
    const key = signupKey(identity.trim().toLowerCase());
    quotas.push({
      key: `${lane}:identity:${key}`,
      max: lane === "mail" ? 6 : 20,
      windowMs,
    });
    if (lane === "mail")
      quotas.push({
        key: `mail:cooldown:${key}`,
        max: 1,
        windowMs: signupConfig("SIGNUP_RESEND_SECONDS", 60, 3600) * 1000,
      });
  }
  return withSignupLease(db, lane, async () => {
    await reserveSignupQuotas(db, quotas);
    return lane === "mail" && identity
      ? withSignupLease(
          db,
          `mail-identity:${signupKey(identity.trim().toLowerCase())}`,
          work,
          1,
        )
      : work();
  });
}
