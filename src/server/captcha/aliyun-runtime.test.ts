import { afterEach, expect, it, vi } from "vitest";
import Client, {
  VerifyIntelligentCaptchaResponse,
  VerifyIntelligentCaptchaResponseBody,
} from "@alicloud/captcha20230305";
import { aliyunProvider } from "./aliyun";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("constructs the real installed SDK with valid runtime types while mocking only its network method", async () => {
  for (const [key, value] of Object.entries({
    CAPTCHA_PROVIDER: "aliyun-v2",
    ALIYUN_CAPTCHA_PREFIX: "prefix",
    ALIYUN_CAPTCHA_TUTEE_SCENE: "tutee",
    ALIYUN_CAPTCHA_VIEWER_SCENE: "viewer",
    ALIYUN_CAPTCHA_ACCESS_KEY_ID: "test-key-id",
    ALIYUN_CAPTCHA_ACCESS_KEY_SECRET: "test-secret-long-enough",
  }))
    vi.stubEnv(key, value);
  const verify = vi
    .spyOn(Client.prototype, "verifyIntelligentCaptchaWithOptions")
    .mockResolvedValue(
      new VerifyIntelligentCaptchaResponse({
        statusCode: 200,
        body: new VerifyIntelligentCaptchaResponseBody({
          success: true,
          code: "Success",
          result: { verifyResult: true, verifyCode: "T001" },
        }),
      }),
    );
  expect(await aliyunProvider()!.verify("opaque-proof", "viewer")).toBe(
    "accepted",
  );
  expect(verify).toHaveBeenCalledOnce();
});
