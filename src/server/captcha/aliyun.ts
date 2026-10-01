import "server-only";
import { z } from "zod";
import type { CaptchaProvider } from "./provider";

const configSchema = z
  .object({
    provider: z.literal("aliyun-v2"),
    region: z.literal("cn-shanghai"),
    prefix: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    tutee: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    viewer: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    accessKeyId: z.string().min(8).max(256),
    accessKeySecret: z.string().min(16).max(256),
    securityToken: z.string().min(1).max(8192).optional(),
  })
  .refine((value) => value.tutee !== value.viewer);

export function aliyunConfiguration() {
  return configSchema.safeParse({
    provider: process.env.CAPTCHA_PROVIDER,
    region: process.env.ALIYUN_CAPTCHA_REGION ?? "cn-shanghai",
    prefix: process.env.ALIYUN_CAPTCHA_PREFIX,
    tutee: process.env.ALIYUN_CAPTCHA_TUTEE_SCENE,
    viewer: process.env.ALIYUN_CAPTCHA_VIEWER_SCENE,
    accessKeyId: process.env.ALIYUN_CAPTCHA_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_CAPTCHA_ACCESS_KEY_SECRET,
    securityToken:
      process.env.ALIYUN_CAPTCHA_SECURITY_TOKEN === ""
        ? undefined
        : process.env.ALIYUN_CAPTCHA_SECURITY_TOKEN,
  });
}

/** V2, mainland only. No configurable URL, test-pass key or client-selected trusted scene.
 * T005 (provider console test-pass mode) is deliberately rejected even in local development. */
export function aliyunProvider(): CaptchaProvider | null {
  const parsed = aliyunConfiguration();
  if (!parsed.success) return null;
  const settings = parsed.data;
  return {
    publicConfig: {
      provider: "aliyun-v2",
      region: "cn",
      prefix: settings.prefix,
      scenes: { tutee: settings.tutee, viewer: settings.viewer },
    },
    async verify(proof, scene) {
      try {
        const [
          { default: sdkDefault, VerifyIntelligentCaptchaRequest },
          { $OpenApiUtil },
          { RuntimeOptions },
        ] = await Promise.all([
          import("@alicloud/captcha20230305"),
          import("@alicloud/openapi-core"),
          import("@darabonba/typescript"),
        ]);
        // Native Node ESM wraps this CommonJS default; bundlers may already unwrap it.
        const exported = sdkDefault as unknown as
          typeof sdkDefault | { default: typeof sdkDefault };
        const Client =
          typeof exported === "function" ? exported : exported.default;
        const client = new Client(
          new $OpenApiUtil.Config({
            accessKeyId: settings.accessKeyId,
            accessKeySecret: settings.accessKeySecret,
            securityToken: settings.securityToken,
            type: settings.securityToken ? "sts" : "access_key",
            regionId: "cn-shanghai",
            endpoint: "captcha.cn-shanghai.aliyuncs.com",
            protocol: "HTTPS",
            connectTimeout: 2000,
            readTimeout: 3000,
          }),
        );
        const response = await client.verifyIntelligentCaptchaWithOptions(
          new VerifyIntelligentCaptchaRequest({
            captchaVerifyParam: proof,
            sceneId: scene,
          }),
          new RuntimeOptions({
            autoretry: false,
            maxAttempts: 1,
            connectTimeout: 2000,
            readTimeout: 3000,
          }),
        );
        const body = response.body;
        if (
          response.statusCode !== 200 ||
          !body ||
          typeof body.result?.verifyCode !== "string" ||
          body.success !== true ||
          body.code !== "Success" ||
          typeof body.result?.verifyResult !== "boolean"
        )
          return "unavailable";
        return body.result.verifyResult === true &&
          body.result.verifyCode === "T001"
          ? "accepted"
          : "rejected";
      } catch {
        return "unavailable";
      }
    },
  };
}
