// The imported sender is replaced with a stateless vi.fn in this suite.
/* eslint-disable @typescript-eslint/unbound-method */
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
const sdk = vi.hoisted(() => ({ verify: vi.fn(), configs: vi.fn() }));
vi.mock("@alicloud/captcha20230305", () => ({
  default: class {
    constructor(config: unknown) {
      sdk.configs(config);
    }
    verifyIntelligentCaptchaWithOptions = sdk.verify;
  },
  VerifyIntelligentCaptchaRequest: class {
    constructor(input: object) {
      Object.assign(this, input);
    }
  },
}));
// This suite exercises grant/admission persistence with a provider fixture.
// Keep its complete SDK boundary isolated; aliyun-runtime.test.ts separately
// constructs the genuine installed client, request and runtime-option classes.
vi.mock("@alicloud/openapi-core", () => ({
  $OpenApiUtil: {
    Config: class {
      constructor(input: object) {
        Object.assign(this, input);
      }
    },
  },
}));
vi.mock("@darabonba/typescript", () => ({
  RuntimeOptions: class {
    constructor(input: object) {
      Object.assign(this, input);
    }
  },
}));
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn().mockResolvedValue(undefined) },
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "../db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { createCaller } from "../api/root";
import { aliyunProvider } from "./aliyun";
import { withProtectedSignup } from "./index";
import { emailSender } from "../email/sender";
import { APPROVAL_OPERATIONS } from "~/lib/approval-policy";

const headers = new Headers({ "x-signup-client-ip": "192.0.2.182" });
const caller = (role?: Session["role"]) =>
  createCaller({
    db,
    headers,
    session: role
      ? {
          user: { id: role, name: role, email: `${role}@example.test` },
          role,
          tutorId: null,
          expires: "2099-01-01",
        }
      : null,
  });
const proof = (certifyId = "proof-1", sceneId = "viewer-scene") =>
  JSON.stringify({ sceneId, certifyId, deviceToken: "device", data: "opaque" });
const viewer = {
  email: "participant@example.test",
  name: "Viewer",
  affiliation: "Family",
};
const accepted = {
  statusCode: 200,
  body: {
    success: true,
    code: "Success",
    result: { verifyResult: true, verifyCode: "T001" },
  },
};
async function enable() {
  await caller("HEAD").program.setCaptcha({
    enabled: true,
    expectedVersion: 0,
  });
}
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((t) => '"' + t.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  for (const role of [
    "HEAD",
    "ADMIN",
    "COORDINATOR",
    "VIEWER",
    "STUDENT",
  ] as const)
    await db.user.create({
      data: { id: role, name: role, email: `${role}@example.test`, role },
    });
  for (const [key, value] of Object.entries({
    CAPTCHA_PROVIDER: "aliyun-v2",
    ALIYUN_CAPTCHA_PREFIX: "prefix",
    ALIYUN_CAPTCHA_TUTEE_SCENE: "tutee-scene",
    ALIYUN_CAPTCHA_VIEWER_SCENE: "viewer-scene",
    ALIYUN_CAPTCHA_ACCESS_KEY_ID: "test-key-id",
    ALIYUN_CAPTCHA_ACCESS_KEY_SECRET: "test-secret-at-least-sixteen",
    SIGNUP_TRUST_PROXY: "true",
  }))
    vi.stubEnv(key, value);
  sdk.verify.mockReset().mockResolvedValue(accepted);
  sdk.configs.mockClear();
  vi.mocked(emailSender.send).mockClear();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => db.$disconnect());
it("defaults off, returns no widget config and never calls the provider while limits still apply", async () => {
  expect(await caller().program.captchaPublic()).toMatchObject({
    enabled: false,
    config: null,
  });
  expect(
    await caller().program.verifySignupCaptcha({
      action: "viewer.start",
      email: viewer.email,
      proof: proof(),
    }),
  ).toEqual({ grant: null });
  await caller().viewer.start(viewer);
  await expect(caller().viewer.start(viewer)).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
  });
  expect(sdk.verify).not.toHaveBeenCalled();
});
it("restricts direct changes to Head, exposes safe status and queues Admin proposals", async () => {
  for (const role of ["COORDINATOR", "VIEWER", "STUDENT"] as const)
    await expect(
      caller(role).program.setCaptcha({ enabled: true, expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await caller("COORDINATOR").program.captchaSettings()).canEdit).toBe(
    false,
  );
  expect(Object.hasOwn(APPROVAL_OPERATIONS, "program.setCaptcha")).toBe(true);
  await expect(caller("ADMIN").program.setCaptcha({ enabled: true, expectedVersion: 0 }))
    .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect((await caller().program.captchaPublic()).enabled).toBe(false);
  expect(await db.approvalRequest.count()).toBe(1);
  await enable();
  await expect(
    caller("HEAD").program.setCaptcha({ enabled: false, expectedVersion: 0 }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await caller("HEAD").program.setCaptcha({
    enabled: false,
    expectedVersion: 1,
  });
  await expect(
    caller("HEAD").program.setCaptcha({ enabled: true, expectedVersion: 0 }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.auditLog.count({
      where: {
        operation: "program.setCaptcha",
        action: "Changed public signup CAPTCHA verification",
      },
    }),
  ).toBe(2);
  expect(
    await db.auditLog.findFirst({
      where: { operation: "program.setCaptcha", action: "Changed public signup CAPTCHA verification" },
      orderBy: { createdAt: "asc" },
    }),
  ).toMatchObject({
    userId: "HEAD",
    details: { before: { enabled: false }, after: { enabled: true } },
  });
});
it("blocks enabling with bad local configuration but always permits disabling during outages", async () => {
  vi.stubEnv("ALIYUN_CAPTCHA_ACCESS_KEY_SECRET", "");
  await expect(enable()).rejects.toMatchObject({ message: "CAPTCHA_CONFIG" });
  await db.programSettings.create({
    data: { id: "program", captchaEnabled: true },
  });
  await expect(caller().viewer.start(viewer)).rejects.toMatchObject({
    message: "CAPTCHA_CONFIG",
  });
  await caller("HEAD").program.setCaptcha({
    enabled: false,
    expectedVersion: 0,
  });
  expect(sdk.verify).not.toHaveBeenCalled();
});
it("enforces a newly enabled setting for old forms at every signup mutation, including the alias", async () => {
  await enable();
  for (const request of [
    () => caller().viewer.start(viewer),
    () => caller().tutee.resendSurvey({ email: viewer.email }),
    () =>
      caller().tutee.submitSurvey({
        englishName: "Student",
        email: viewer.email,
        firstChoiceId: "math",
        agreed: true,
        policyRevision: "old",
      }),
    () =>
      caller().tutee.requestSignup({
        englishName: "Student",
        email: viewer.email,
        firstChoiceId: "math",
        agreed: true,
        policyRevision: "old",
      }),
  ])
    await expect(request()).rejects.toMatchObject({
      message: "CAPTCHA_REQUIRED",
    });
  expect(await db.studentSurvey.count()).toBe(0);
  expect(await db.viewerSignup.count()).toBe(0);
  expect(emailSender.send).not.toHaveBeenCalled();
});
it.each([
  "not-json",
  "{}",
  JSON.stringify({
    sceneId: "wrong",
    certifyId: "id",
    deviceToken: "device",
    data: "data",
  }),
])(
  "rejects malformed or wrong-scene proof %s without provider work",
  async (raw) => {
    await enable();
    await expect(
      caller().program.verifySignupCaptcha({
        action: "viewer.start",
        email: viewer.email,
        proof: raw,
      }),
    ).rejects.toMatchObject({ message: "CAPTCHA_REJECTED" });
    expect(sdk.verify).not.toHaveBeenCalled();
  },
);
it("binds grants to email/action/scene, consumes once and prevents concurrent replay", async () => {
  await enable();
  const res = await caller().program.verifySignupCaptcha({
    action: "viewer.start",
    email: viewer.email,
    proof: proof(),
  });
  const grant = res.grant!;
  await expect(
    caller().tutee.resendSurvey({ email: viewer.email, captchaGrant: grant }),
  ).rejects.toMatchObject({ message: "CAPTCHA_REQUIRED" });
  await expect(
    caller().viewer.start({
      ...viewer,
      email: "other@example.test",
      captchaGrant: grant,
    }),
  ).rejects.toMatchObject({ message: "CAPTCHA_REQUIRED" });
  const result = await Promise.allSettled([
    caller().viewer.start({ ...viewer, captchaGrant: grant }),
    caller().viewer.start({ ...viewer, captchaGrant: grant }),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(emailSender.send).toHaveBeenCalledTimes(1);
  expect(await db.captchaGrant.count()).toBe(0);
  expect(sdk.configs).toHaveBeenCalledWith(
    expect.objectContaining({
      endpoint: "captcha.cn-shanghai.aliyuncs.com",
      regionId: "cn-shanghai",
    }),
  );
  expect(sdk.verify).toHaveBeenCalledWith(
    expect.objectContaining({
      sceneId: "viewer-scene",
      captchaVerifyParam: proof(),
    }),
    expect.objectContaining({ autoretry: false, maxAttempts: 1 }),
  );
});
it("claims provider proof before verification across concurrent emails and alternative JSON serialization", async () => {
  await enable();
  const outcomes = await Promise.allSettled([
    caller().program.verifySignupCaptcha({
      action: "viewer.start",
      email: "a@example.test",
      proof: proof(),
    }),
    caller().program.verifySignupCaptcha({
      action: "viewer.start",
      email: "b@example.test",
      proof: JSON.stringify(JSON.parse(proof()), null, 2),
    }),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(sdk.verify).toHaveBeenCalledTimes(1);
});
it("expires grants and invalidates them through disable/re-enable without blocking disabled forms", async () => {
  await enable();
  const { grant } = await caller().program.verifySignupCaptcha({
    action: "viewer.start",
    email: viewer.email,
    proof: proof(),
  });
  await db.captchaGrant.updateMany({ data: { expiresAt: new Date(0) } });
  await expect(
    caller().viewer.start({ ...viewer, captchaGrant: grant! }),
  ).rejects.toMatchObject({ message: "CAPTCHA_REQUIRED" });
  await caller("HEAD").program.setCaptcha({
    enabled: false,
    expectedVersion: 1,
  });
  await caller().viewer.start({ ...viewer, email: "off@example.test" });
  expect(sdk.verify).toHaveBeenCalledTimes(1);
});
it.each([
  [
    {
      statusCode: 200,
      body: {
        success: true,
        code: "Success",
        result: { verifyResult: false, verifyCode: "F014" },
      },
    },
    "CAPTCHA_REJECTED",
  ],
  [
    {
      statusCode: 200,
      body: {
        success: true,
        code: "Success",
        result: { verifyResult: true, verifyCode: "T005" },
      },
    },
    "CAPTCHA_REJECTED",
  ],
  [{ body: { success: true } }, "CAPTCHA_UNAVAILABLE"],
  [null, "CAPTCHA_UNAVAILABLE"],
] as const)(
  "normalizes provider rejection/test-mode/malformed output without signup writes",
  async (response, message) => {
    await enable();
    sdk.verify.mockResolvedValueOnce(response);
    await expect(
      caller().program.verifySignupCaptcha({
        action: "viewer.start",
        email: viewer.email,
        proof: proof(),
      }),
    ).rejects.toMatchObject({ message });
    expect(await db.captchaGrant.count()).toBe(0);
    expect(await db.viewerSignup.count()).toBe(0);
    expect(emailSender.send).not.toHaveBeenCalled();
  },
);
it("fails closed on transport timeout and enforces budgets before another provider call", async () => {
  await enable();
  vi.stubEnv("CAPTCHA_BUDGET_DAY", "1");
  sdk.verify.mockRejectedValueOnce(new Error("timeout"));
  await expect(
    caller().program.verifySignupCaptcha({
      action: "viewer.start",
      email: viewer.email,
      proof: proof(),
    }),
  ).rejects.toMatchObject({ message: "CAPTCHA_UNAVAILABLE" });
  await expect(
    caller().program.verifySignupCaptcha({
      action: "viewer.start",
      email: "second@example.test",
      proof: proof("other"),
    }),
  ).rejects.toMatchObject({ message: "CAPTCHA_UNAVAILABLE" });
  expect(sdk.verify).toHaveBeenCalledTimes(1);
});
it("does not call Aliyun after signup admission rejects, and supports tutee submit grants without storing raw evidence", async () => {
  await enable();
  vi.stubEnv("SIGNUP_MAIL_GLOBAL", "1");
  const { grant } = await caller().program.verifySignupCaptcha({
    action: "tutee.submit",
    email: viewer.email,
    proof: proof("student", "tutee-scene"),
  });
  await expect(
    caller().program.verifySignupCaptcha({
      action: "viewer.start",
      email: "second@example.test",
      proof: proof("second"),
    }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  const work = vi.fn(async () => "accepted");
  expect(
    await withProtectedSignup(
      db,
      headers,
      "tutee.submit",
      viewer.email,
      grant!,
      work,
    ),
  ).toBe("accepted");
  expect(JSON.stringify(await db.captchaProof.findMany())).not.toContain(
    "student",
  );
  expect(sdk.verify).toHaveBeenCalledTimes(1);
});
it("validates mainland configuration and never includes credentials in public settings", async () => {
  await enable();
  expect(JSON.stringify(await caller().program.captchaPublic())).not.toMatch(
    /accessKey|test-secret/,
  );
  vi.stubEnv("ALIYUN_CAPTCHA_REGION", "ap-southeast-1");
  expect(aliyunProvider()).toBeNull();
});

it("bounds provider concurrency and does not queue a second paid request", async () => {
  await enable();
  vi.stubEnv("CAPTCHA_CONCURRENCY", "1");
  let release!: (value: typeof accepted) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  sdk.verify.mockImplementationOnce(() => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const first = caller().program.verifySignupCaptcha({
    action: "viewer.start",
    email: "first@example.test",
    proof: proof("first"),
  });
  await started;
  await expect(
    caller().program.verifySignupCaptcha({
      action: "viewer.start",
      email: "second@example.test",
      proof: proof("second"),
    }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  release(accepted);
  await first;
  expect(sdk.verify).toHaveBeenCalledTimes(1);
});
it("cannot bank grants to bypass the actual send cooldown and preserves settings across refresh", async () => {
  await enable();
  const one = await caller().program.verifySignupCaptcha({
    action: "viewer.start",
    email: viewer.email,
    proof: proof("one"),
  });
  await db.signupQuota.deleteMany({
    where: { key: { startsWith: "mail:cooldown:" } },
  });
  const two = await caller().program.verifySignupCaptcha({
    action: "viewer.start",
    email: viewer.email,
    proof: proof("two"),
  });
  await caller().viewer.start({ ...viewer, captchaGrant: one.grant! });
  await expect(
    caller().viewer.start({ ...viewer, captchaGrant: two.grant! }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(emailSender.send).toHaveBeenCalledTimes(1);
  const term = await db.term.create({
    data: { name: "Intake", schoolYear: "26-27", quarter: "Q1", active: true },
  });
  await caller("HEAD").admin.refresh({
    confirm: "REFRESH",
    expectedTermId: term.id,
  });
  await db.$disconnect();
  expect(await caller().program.captchaPublic()).toMatchObject({
    enabled: true,
    version: 1,
  });
});
