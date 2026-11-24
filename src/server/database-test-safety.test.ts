import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertIsolatedTestDatabase,
  TEST_DATABASE_GUARD_ERROR,
} from "./database-test-safety";

const globalForPrisma = globalThis as unknown as {
  prisma: unknown;
  prismaDatabaseUrl: string | undefined;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  globalForPrisma.prisma = undefined;
  globalForPrisma.prismaDatabaseUrl = undefined;
});

describe("assertIsolatedTestDatabase", () => {
  it.each([
    "postgresql://postgres:password@localhost:5432/shbs_shipping_test",
    "postgres://postgres:password@127.0.0.1:55439/shbs_unit_test",
    "postgresql://postgres:password@[::1]:5432/local-1_test",
  ])("permits explicit loopback *_test URL %s", (url) => {
    expect(() => assertIsolatedTestDatabase(url)).not.toThrow();
  });

  it.each([
    undefined,
    "",
    "not-a-url",
    "http://localhost:5432/shbs_shipping_test",
    "postgresql://postgres:password@db.example.com:5432/shbs_shipping_test",
    "postgresql://postgres:password@localhost:5432/shbs_program_demo",
    "postgresql://postgres:password@localhost:5432/shbs-peer-tutoring-website",
    "postgresql://postgres:password@localhost:5432/_test",
    "postgresql://postgres:password@localhost:5432/shbs_shipping_test?host=evil.example",
    "postgresql://postgres:password@localhost:5432/shbs_shipping_test?hostaddr=10.0.0.1",
    "postgresql://postgres:password@localhost:5432/shbs_shipping_test?port=5433",
    "postgresql://postgres:password@localhost:5432/shbs_shipping_test?dbname=prod",
    "postgresql://postgres:password@localhost:5432/shbs_shipping_test?database=prod",
    "postgresql://postgres:password@localhost:5432/shbs_shipping_test?SERVICE=prod",
  ])("rejects unsafe target %s", (url) => {
    expect(() => assertIsolatedTestDatabase(url)).toThrow(
      TEST_DATABASE_GUARD_ERROR,
    );
  });
});

describe("db client test safety boundary", () => {
  it("allows importing ./db and calling $disconnect while blocking every query/write on a rejected database", async () => {
    vi.resetModules();
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:password@localhost:5432/shbs_program_demo",
    );

    const { db } = await import("./db");
    expect(globalForPrisma.prisma).toBeUndefined();
    await expect(db.$disconnect()).resolves.toBeUndefined();
    await expect(
      db.$executeRawUnsafe('TRUNCATE "User" CASCADE'),
    ).rejects.toThrow(TEST_DATABASE_GUARD_ERROR);
    await expect(db.$queryRaw`SELECT 1`).rejects.toThrow(
      TEST_DATABASE_GUARD_ERROR,
    );
    await expect(db.$transaction(async () => undefined)).rejects.toThrow(
      TEST_DATABASE_GUARD_ERROR,
    );
    await expect(db.$connect()).rejects.toThrow(TEST_DATABASE_GUARD_ERROR);
    await expect(db.user.deleteMany()).rejects.toThrow(
      TEST_DATABASE_GUARD_ERROR,
    );
    await expect(db.user.findMany()).rejects.toThrow(TEST_DATABASE_GUARD_ERROR);
  });

  it("stays guarded under Vitest even when NODE_ENV is stubbed to production", async () => {
    vi.resetModules();
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:password@localhost:5432/shbs_shipping_test?dbname=shbs_program_demo",
    );

    const { db } = await import("./db");
    await expect(db.$disconnect()).resolves.toBeUndefined();
    await expect(db.user.deleteMany()).rejects.toThrow(
      TEST_DATABASE_GUARD_ERROR,
    );
  });

  it("never reuses a cached Prisma client when DATABASE_URL switches to a rejected target", async () => {
    const fakeClient = {
      user: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };
    globalForPrisma.prisma = fakeClient;
    globalForPrisma.prismaDatabaseUrl =
      "postgresql://postgres:password@localhost:5432/shbs_shipping_test";

    vi.resetModules();
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:password@localhost:5432/shbs_program_demo",
    );

    const { db } = await import("./db");
    await expect(db.user.deleteMany()).rejects.toThrow(
      TEST_DATABASE_GUARD_ERROR,
    );
    expect(fakeClient.user.deleteMany).not.toHaveBeenCalled();
  });
});
