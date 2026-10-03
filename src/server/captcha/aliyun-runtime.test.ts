import { afterEach, expect, it, vi } from "vitest";
import Client, {
  VerifyIntelligentCaptchaRequest,
  VerifyIntelligentCaptchaResponse,
  VerifyIntelligentCaptchaResponseBody,
} from "@alicloud/captcha20230305";
import { RuntimeOptions } from "@darabonba/typescript";
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
  let actualClient: Client | undefined;
  const verify = vi
    .spyOn(Client.prototype, "verifyIntelligentCaptchaWithOptions")
    .mockImplementation(function (this: Client) {
      // Replace only network delivery, retaining real SDK construction and
      // model classes so the functional suite's fixture cannot hide incompatibility.
      actualClient = this;
      return Promise.resolve(
        new VerifyIntelligentCaptchaResponse({
          statusCode: 200,
          body: new VerifyIntelligentCaptchaResponseBody({
            success: true,
            code: "Success",
            result: { verifyResult: true, verifyCode: "T001" },
          }),
        }),
      );
    });
  expect(await aliyunProvider()!.verify("opaque-proof", "viewer")).toBe(
    "accepted",
  );
  expect(verify).toHaveBeenCalledOnce();
  expect(actualClient).toBeInstanceOf(Client);
  const [request, runtime] = verify.mock.calls[0]!;
  expect(request).toBeInstanceOf(VerifyIntelligentCaptchaRequest);
  expect(request).toMatchObject({
    sceneId: "viewer",
    captchaVerifyParam: "opaque-proof",
  });
  expect(runtime).toBeInstanceOf(RuntimeOptions);
  expect(runtime).toMatchObject({
    autoretry: false,
    maxAttempts: 1,
    connectTimeout: 2000,
    readTimeout: 3000,
  });
});
