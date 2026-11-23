import Client, { $OpenApiUtil } from "@alicloud/openapi-core";
import { RuntimeOptions } from "@darabonba/typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("ALIYUN_DM_ACCESS_KEY_ID", "synthetic-access-id");
  vi.stubEnv("ALIYUN_DM_ACCESS_KEY_SECRET", "synthetic-access-secret");
  vi.stubEnv("ALIYUN_DM_QUOTA_RESET_TIME_UTC", "");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("uses the installed SDK to read quota once for concurrent callers and refreshes after a minute", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const read = vi.spyOn(Client.prototype, "callApi").mockResolvedValue({
    statusCode: 200,
    body: {
      DailyQuota: 2000,
      DailyRemainFreeQuota: 137,
      RemainFreeQuota: 1842,
    },
  });
  const { getAliyunEmailQuota } = await import("./aliyun-quota");
  const expected = { dailyRemaining: 137, balanceRemaining: 1842 };
  expect(
    await Promise.all([getAliyunEmailQuota(), getAliyunEmailQuota()]),
  ).toEqual([expected, expected]);
  expect(read).toHaveBeenCalledOnce();
  expect(read.mock.contexts[0]).toBeInstanceOf(Client);
  expect(read.mock.contexts[0]).toMatchObject({
    _regionId: "cn-hangzhou",
    _endpoint: "dm.aliyuncs.com",
  });
  const [params, request, runtime] = read.mock.calls[0]!;
  expect(params).toBeInstanceOf($OpenApiUtil.Params);
  expect(params).toMatchObject({
    action: "DescAccountSummary",
    version: "2015-11-23",
    method: "POST",
    protocol: "HTTPS",
  });
  expect(request).toBeInstanceOf($OpenApiUtil.OpenApiRequest);
  expect(runtime).toBeInstanceOf(RuntimeOptions);
  expect(runtime).toMatchObject({
    autoretry: false,
    connectTimeout: 2000,
    readTimeout: 3000,
  });

  vi.setSystemTime(Date.now() + 59_999);
  expect(await getAliyunEmailQuota()).toEqual(expected);
  expect(read).toHaveBeenCalledOnce();
  vi.setSystemTime(Date.now() + 1);
  read.mockResolvedValue({
    statusCode: 200,
    body: { DailyRemainFreeQuota: 180, RemainFreeQuota: 0 },
  });
  expect(await getAliyunEmailQuota()).toEqual({
    dailyRemaining: 0,
    balanceRemaining: 0,
  });
  expect(read).toHaveBeenCalledTimes(2);
});

it("preserves a free balance when Aliyun omits the daily remainder", async () => {
  vi.spyOn(Client.prototype, "callApi").mockResolvedValue({
    statusCode: 200,
    body: { DailyQuota: 2000, RemainFreeQuota: 9 },
  });
  const { getAliyunEmailQuota } = await import("./aliyun-quota");
  expect(await getAliyunEmailQuota()).toEqual({
    dailyRemaining: null,
    balanceRemaining: 9,
  });
});

it.each([
  { statusCode: 503, body: { RemainFreeQuota: 0 } },
  {
    statusCode: 200,
    body: { DailyRemainFreeQuota: "30", RemainFreeQuota: -1 },
  },
  { statusCode: 200, body: { DailyQuota: 2000 } },
])("reports unavailable for an unusable response %#", async (response) => {
  vi.spyOn(Client.prototype, "callApi").mockResolvedValue(response);
  const { getAliyunEmailQuota } = await import("./aliyun-quota");
  expect(await getAliyunEmailQuota()).toBeNull();
});

it("isolates and caches provider errors without retrying or making up zeroes", async () => {
  const read = vi
    .spyOn(Client.prototype, "callApi")
    .mockRejectedValue(new Error("provider error"));
  const { getAliyunEmailQuota } = await import("./aliyun-quota");
  expect(await getAliyunEmailQuota()).toBeNull();
  expect(await getAliyunEmailQuota()).toBeNull();
  expect(read).toHaveBeenCalledOnce();
});

it("does not query Aliyun with missing or incomplete credentials", async () => {
  const read = vi.spyOn(Client.prototype, "callApi");
  const { aliyunQuotaEnabled, getAliyunEmailQuota } =
    await import("./aliyun-quota");
  vi.stubEnv("ALIYUN_DM_ACCESS_KEY_ID", " ");
  vi.stubEnv("ALIYUN_DM_ACCESS_KEY_SECRET", "");
  expect(aliyunQuotaEnabled()).toBe(false);
  expect(await getAliyunEmailQuota()).toBeNull();
  vi.stubEnv("ALIYUN_DM_ACCESS_KEY_ID", "synthetic-access-id");
  expect(aliyunQuotaEnabled()).toBe(true);
  expect(await getAliyunEmailQuota()).toBeNull();
  vi.stubEnv("ALIYUN_DM_ACCESS_KEY_ID", " ");
  vi.stubEnv("ALIYUN_DM_ACCESS_KEY_SECRET", "synthetic-access-secret");
  expect(aliyunQuotaEnabled()).toBe(true);
  expect(await getAliyunEmailQuota()).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it("exposes only a valid configured reset time", async () => {
  const { aliyunQuotaResetTime } = await import("./aliyun-quota");
  expect(aliyunQuotaResetTime()).toBeNull();
  vi.stubEnv("ALIYUN_DM_QUOTA_RESET_TIME_UTC", "24:00");
  expect(aliyunQuotaResetTime()).toBeNull();
  vi.stubEnv("ALIYUN_DM_QUOTA_RESET_TIME_UTC", "16:00");
  expect(aliyunQuotaResetTime()?.toISOString()).toBe(
    "2000-01-01T16:00:00.000Z",
  );
});
