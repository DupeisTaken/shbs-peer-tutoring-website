import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_SECRET", "build-regression-secret-at-least-32-characters");
  vi.stubEnv("DATABASE_URL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

it("loads the database module during a Docker build without database credentials", async () => {
  // Next imports server routes while collecting page data. Docker intentionally
  // supplies no DATABASE_URL at this stage, and importing must not connect.
  vi.stubEnv("SKIP_ENV_VALIDATION", "1");
  const { db } = await import("./db");
  await db.$disconnect();
});

it("still rejects a missing database URL at production runtime", async () => {
  vi.stubEnv("SKIP_ENV_VALIDATION", undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await expect(import("./db")).rejects.toThrow("Invalid environment variables");
});

it("does not silently ignore a malformed URL when validation is skipped", async () => {
  vi.stubEnv("SKIP_ENV_VALIDATION", "1");
  vi.stubEnv("DATABASE_URL", "not-a-database-url");
  await expect(import("./db")).rejects.toThrow("Invalid URL");
});
