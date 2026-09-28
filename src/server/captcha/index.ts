import "server-only";
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PrismaClient } from "../../../generated/prisma";
import { captchaScene, type CaptchaAction } from "~/lib/captcha";
import { aliyunProvider } from "./aliyun";
import {
  reserveSignupQuotas,
  signupBurst,
  signupConfig,
  signupKey,
  signupMetric,
  signupNetwork,
  withSignupAdmission,
  withSignupLease,
} from "../signup-admission";

export async function captchaStatus(db: Pick<PrismaClient, "programSettings">) {
  const settings = await db.programSettings.findUnique({
    where: { id: "program" },
    select: { captchaEnabled: true, captchaVersion: true },
  });
  return {
    enabled: settings?.captchaEnabled ?? false,
    version: settings?.captchaVersion ?? 0,
  };
}
export async function publicCaptcha(db: PrismaClient) {
  const status = await captchaStatus(db);
  // Disabled means no SDK import, credentials check, script config or external calls.
  if (!status.enabled) return { ...status, ready: false, config: null };
  const provider = aliyunProvider();
  return {
    ...status,
    ready: !!provider,
    config: provider?.publicConfig ?? null,
  };
}
function fail(
  message:
    | "CAPTCHA_REQUIRED"
    | "CAPTCHA_REJECTED"
    | "CAPTCHA_UNAVAILABLE"
    | "CAPTCHA_CONFIG",
): never {
  throw new TRPCError({
    code:
      message === "CAPTCHA_REJECTED" ? "BAD_REQUEST" : "PRECONDITION_FAILED",
    message,
  });
}

const v2Proof = z
  .object({
    sceneId: z.string().max(128),
    certifyId: z.string().min(1).max(256),
    deviceToken: z.string().min(1),
    data: z.string().min(1),
  })
  .passthrough();

/** Admission is reserved here, before any paid check. The only returned authorization is
 * an opaque 2-minute grant bound to action, normalized email, scene and settings version.
 * The proof ledger claims certifyId before the provider call; even concurrent alternate JSON
 * encodings cannot replay it. Aliyun independently rejects expired/reused V2 evidence. */
export async function verifySignupCaptcha(
  db: PrismaClient,
  headers: Headers,
  input: { action: CaptchaAction; email: string; proof: string },
) {
  const status = await captchaStatus(db);
  if (!status.enabled) return { grant: null };
  const provider = aliyunProvider();
  if (!provider) fail("CAPTCHA_CONFIG");
  const scene = captchaScene(provider.publicConfig, input.action);
  let proof: z.infer<typeof v2Proof>;
  try {
    proof = v2Proof.parse(JSON.parse(input.proof));
  } catch {
    fail("CAPTCHA_REJECTED");
  }
  if (proof.sceneId !== scene) fail("CAPTCHA_REJECTED");
  return withSignupAdmission(db, headers, "mail", input.email, () =>
    withSignupLease(
      db,
      "captcha",
      async () => {
        try {
          await reserveSignupQuotas(db, [
            {
              key: "captcha:quarter-hour",
              max: signupConfig("CAPTCHA_BUDGET_15_MIN", 300),
              windowMs: 900_000,
            },
            {
              key: "captcha:day",
              max: signupConfig("CAPTCHA_BUDGET_DAY", 1000),
              windowMs: 86_400_000,
            },
          ]);
        } catch {
          signupMetric("captcha-budget");
          fail("CAPTCHA_UNAVAILABLE");
        }
        await db.$executeRaw`DELETE FROM "CaptchaProof" WHERE "key" IN (SELECT "key" FROM "CaptchaProof" WHERE "expiresAt" <= NOW() LIMIT 100)`;
        await db.$executeRaw`DELETE FROM "CaptchaGrant" WHERE "tokenHash" IN (SELECT "tokenHash" FROM "CaptchaGrant" WHERE "expiresAt" <= NOW() LIMIT 100)`;
        const claimed =
          await db.$executeRaw`INSERT INTO "CaptchaProof" ("key", "expiresAt") VALUES (${signupKey(`${scene}:${proof.certifyId}`)}, NOW() + INTERVAL '24 hours') ON CONFLICT DO NOTHING`;
        if (!claimed) fail("CAPTCHA_REJECTED");
        const outcome = await provider.verify(input.proof, scene);
        signupMetric(`captcha-${outcome}`);
        if (outcome !== "accepted")
          fail(
            outcome === "rejected" ? "CAPTCHA_REJECTED" : "CAPTCHA_UNAVAILABLE",
          );
        const current = await captchaStatus(db);
        if (!current.enabled) return { grant: null };
        if (current.version !== status.version) fail("CAPTCHA_REQUIRED");
        const grant = randomBytes(32).toString("hex");
        await db.captchaGrant.create({
          data: {
            tokenHash: signupKey(grant),
            action: input.action,
            identityHash: signupKey(input.email.trim().toLowerCase()),
            scene,
            version: status.version,
            expiresAt: new Date(Date.now() + 120_000),
          },
        });
        return { grant };
      },
      signupConfig("CAPTCHA_CONCURRENCY", 4, 8),
    ),
  );
}

/** The mutation boundary checks today's setting, including old open forms. A grant already
 * paid the #181 admission charge; atomically burn it before writes/mail, with no reusable flag.
 * Invalid proofs cannot enter business work, and completion never calls this helper. */
export async function withProtectedSignup<T>(
  db: PrismaClient,
  headers: Headers,
  action: CaptchaAction,
  email: string,
  grant: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const status = await captchaStatus(db);
  if (!status.enabled)
    return withSignupAdmission(db, headers, "mail", email, () =>
      deliverWithCooldown(db, email, work),
    );
  signupBurst("mail", signupNetwork(headers));
  const provider = aliyunProvider();
  if (!provider) fail("CAPTCHA_CONFIG");
  if (!grant) fail("CAPTCHA_REQUIRED");
  return withSignupLease(db, "mail", () =>
    withSignupLease(
      db,
      `mail-identity:${signupKey(email.trim().toLowerCase())}`,
      async () => {
        const used = await db.captchaGrant.deleteMany({
          where: {
            tokenHash: signupKey(grant),
            action,
            identityHash: signupKey(email.trim().toLowerCase()),
            scene: captchaScene(provider.publicConfig, action),
            version: status.version,
            expiresAt: { gt: new Date() },
          },
        });
        if (used.count !== 1) fail("CAPTCHA_REQUIRED");
        return deliverWithCooldown(db, email, work);
      },
      1,
    ),
  );
}

/** Grants can be held for two minutes. Enforce the resend interval again at actual business
 * execution, so separately admitted grants cannot be banked and redeemed in a mail burst.
 * The same gate covers disabled mode, including transitions during an outage. */
async function deliverWithCooldown<T>(
  db: PrismaClient,
  email: string,
  work: () => Promise<T>,
) {
  await reserveSignupQuotas(db, [
    {
      key: `mail:delivery-cooldown:${signupKey(email.trim().toLowerCase())}`,
      max: 1,
      windowMs: signupConfig("SIGNUP_RESEND_SECONDS", 60, 3600) * 1000,
    },
  ]);
  return work();
}
