import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../src/env.js", () => ({}));
vi.mock("next-intl/plugin", () => ({
  default: () => (config: unknown) => config,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("publishes short signup aliases with descriptive canonical destinations and legacy compatibility", async () => {
  const { default: config } = await import("../../next.config.js");
  expect(await config.redirects?.()).toEqual([
    { source: "/register", destination: "/register-account", permanent: true },
    { source: "/tutee", destination: "/tutee-signup", permanent: true },
    { source: "/tutor", destination: "/tutor-signup", permanent: true },
    { source: "/viewer", destination: "/viewer-signup", permanent: true },
    { source: "/crew", destination: "/crew-signup", permanent: true },
    {
      source: "/tutee/account",
      destination: "/tutee-signup/account",
      permanent: true,
    },
    { source: "/signup", destination: "/tutee-signup", permanent: true },
    {
      source: "/signup/account",
      destination: "/tutee-signup/account",
      permanent: true,
    },
  ]);
});

it("omits framework identification even when the app is inspected directly", async () => {
  const { default: config } = await import("../../next.config.js");
  expect(config.poweredByHeader).toBe(false);
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
