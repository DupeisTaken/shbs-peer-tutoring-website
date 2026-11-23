import "server-only";
import { z } from "zod";

// Direct Mail's one-time free allowance has a published daily cap of 200.
export const DAILY_FREE_EMAIL_LIMIT = 200;

type EmailQuota = {
  dailyRemaining: number | null;
  balanceRemaining: number | null;
};

const responseSchema = z.object({
  statusCode: z.literal(200),
  body: z.object({
    DailyRemainFreeQuota: z.int().min(0).max(DAILY_FREE_EMAIL_LIMIT).optional(),
    RemainFreeQuota: z.int().nonnegative().optional(),
  }),
});

let snapshot:
  { expiresAt: number; value: Promise<EmailQuota | null> } | undefined;

function credentials() {
  return {
    accessKeyId: process.env.ALIYUN_DM_ACCESS_KEY_ID?.trim(),
    accessKeySecret: process.env.ALIYUN_DM_ACCESS_KEY_SECRET?.trim(),
  };
}

export function aliyunQuotaEnabled() {
  const { accessKeyId, accessKeySecret } = credentials();
  return Boolean(accessKeyId) || Boolean(accessKeySecret);
}

export function aliyunQuotaResetTime() {
  const time = process.env.ALIYUN_DM_QUOTA_RESET_TIME_UTC?.trim();
  // Aliyun does not publish a reset time in this API. Use only operator-confirmed input.
  return time && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
    ? new Date(`2000-01-01T${time}:00Z`)
    : null;
}

/** Share one short-lived result, including failures, across dashboard requests. */
export async function getAliyunEmailQuota(): Promise<EmailQuota | null> {
  const { accessKeyId, accessKeySecret } = credentials();
  if (!accessKeyId || !accessKeySecret) return null;

  const now = Date.now();
  if (snapshot && snapshot.expiresAt > now) return snapshot.value;
  const value = readAccountSummary(accessKeyId, accessKeySecret);
  snapshot = { expiresAt: now + 60_000, value };
  return value;
}

async function readAccountSummary(
  accessKeyId: string,
  accessKeySecret: string,
) {
  try {
    const [{ default: sdkDefault, $OpenApiUtil }, { RuntimeOptions }] =
      await Promise.all([
        import("@alicloud/openapi-core"),
        import("@darabonba/typescript"),
      ]);
    // Native Node ESM wraps the SDK's CommonJS default. Next may already unwrap it.
    const exported = sdkDefault as
      typeof sdkDefault | { default: typeof sdkDefault };
    const Client = typeof exported === "function" ? exported : exported.default;
    const client = new Client(
      new $OpenApiUtil.Config({
        accessKeyId,
        accessKeySecret,
        type: "access_key",
        regionId: "cn-hangzhou",
        endpoint: "dm.aliyuncs.com",
        protocol: "HTTPS",
      }),
    );
    const response = responseSchema.safeParse(
      await client.callApi(
        new $OpenApiUtil.Params({
          action: "DescAccountSummary",
          version: "2015-11-23",
          protocol: "HTTPS",
          pathname: "/",
          method: "POST",
          authType: "AK",
          style: "RPC",
          reqBodyType: "formData",
          bodyType: "json",
        }),
        new $OpenApiUtil.OpenApiRequest({}),
        new RuntimeOptions({
          autoretry: false,
          maxAttempts: 1,
          connectTimeout: 2_000,
          readTimeout: 3_000,
        }),
      ),
    );
    if (!response.success) return null;

    const { DailyRemainFreeQuota, RemainFreeQuota } = response.data.body;
    if (DailyRemainFreeQuota === undefined && RemainFreeQuota === undefined)
      return null;

    return {
      // Aliyun reports the daily and cumulative allowances independently.
      dailyRemaining:
        DailyRemainFreeQuota === undefined
          ? null
          : Math.min(
              DailyRemainFreeQuota,
              RemainFreeQuota ?? DailyRemainFreeQuota,
            ),
      balanceRemaining: RemainFreeQuota ?? null,
    };
  } catch {
    // Provider failures are isolated from dashboard reads and SMTP delivery.
    return null;
  }
}
