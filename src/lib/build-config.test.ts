import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../src/env.js", () => ({}));
vi.mock("next-intl/plugin", () => ({
  default: () => (config: unknown) => config,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("retains normal compiler cache defaults without local overrides", async () => {
  vi.stubEnv("SHBS_BUILD_CPUS", "");
  vi.stubEnv("SHBS_DISABLE_BUILD_CACHE", "");
  const { default: config } = await import("../../next.config.js");
  expect(config.experimental).toEqual({});
});
it("allows bounded local builds to bypass stale cache without deleting it", async () => {
  vi.stubEnv("SHBS_BUILD_CPUS", "1");
  vi.stubEnv("SHBS_DISABLE_BUILD_CACHE", "1");
  const { default: config } = await import("../../next.config.js");
  expect(config.experimental).toEqual({
    cpus: 1,
    turbopackFileSystemCacheForBuild: false,
  });
});
