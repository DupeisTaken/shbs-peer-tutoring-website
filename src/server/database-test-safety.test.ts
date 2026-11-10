import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Leave the actual db module, scope proxy and URL policy in the import path.
// Only the driver boundary is replaced, so these tests cannot open a socket.
const fixture = vi.hoisted(() => {
  const sentinel = new Set<string>();
  const makeClient = () => ({
    user: {
      deleteMany: vi.fn(async () => {
        const count = sentinel.size;
        sentinel.clear();
        return { count };
      }),
    },
    $disconnect: vi.fn(async () => undefined),
  });
  return {
    sentinel,
    makeClient,
    env: { DATABASE_URL: undefined as string | undefined, NODE_ENV: "test" },
    adapter: vi.fn(function (options: { connectionString?: string }) {
      return { options };
    }),
    client: vi.fn(function () {
      return makeClient();
    }),
  };
});
vi.mock("~/env", () => ({ env: fixture.env }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: fixture.adapter }));
vi.mock("../../generated/prisma", () => ({ PrismaClient: fixture.client }));

const safeUrl = "postgresql://postgres@127.0.0.1:1/client_boundary_test";
const demoUrl = "postgresql://postgres@127.0.0.1:1/synthetic_demo";
const globalClient = globalThis as typeof globalThis & {
  prisma?: unknown;
  prismaDatabaseUrl?: string;
};
const originalClient = Object.getOwnPropertyDescriptor(globalThis, "prisma");
const originalUrl = Object.getOwnPropertyDescriptor(
  globalThis,
  "prismaDatabaseUrl",
);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VITEST", "true");
  vi.stubEnv("DATABASE_URL", safeUrl);
  fixture.env.DATABASE_URL = safeUrl;
  fixture.env.NODE_ENV = "test";
  fixture.sentinel.clear();
  fixture.sentinel.add("synthetic-account");
  delete globalClient.prisma;
  delete globalClient.prismaDatabaseUrl;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (originalClient)
    Object.defineProperty(globalThis, "prisma", originalClient);
  else delete globalClient.prisma;
  if (originalUrl)
    Object.defineProperty(globalThis, "prismaDatabaseUrl", originalUrl);
  else delete globalClient.prismaDatabaseUrl;
});

async function importAndWrite() {
  const { db } = await import("./db");
  await db.user.deleteMany();
}

describe("the real database import boundary", () => {
  it.each([
    undefined,
    "",
    "not-a-url",
    demoUrl,
    "postgresql://postgres@remote.example.test/client_boundary_test",
    `${safeUrl}?host=remote.example.test`,
    `${safeUrl}?%68ost=remote.example.test`,
    `${safeUrl}?database=synthetic_demo`,
  ])(
    "prevents import-time writes to a refused resolved target: %s",
    async (url) => {
      fixture.env.DATABASE_URL = url;
      await expect(importAndWrite()).rejects.toThrow(
        "explicit local PostgreSQL *_test",
      );
      expect(fixture.adapter).not.toHaveBeenCalled();
      expect(fixture.client).not.toHaveBeenCalled();
      expect([...fixture.sentinel]).toEqual(["synthetic-account"]);
    },
  );

  it("uses the adapter's env snapshot even when process.env now names a safe database", async () => {
    fixture.env.DATABASE_URL = demoUrl;
    expect(process.env.DATABASE_URL).toBe(safeUrl);
    await expect(importAndWrite()).rejects.toThrow(
      "explicit local PostgreSQL *_test",
    );
    expect(fixture.adapter).not.toHaveBeenCalled();
    expect([...fixture.sentinel]).toEqual(["synthetic-account"]);
  });

  it.each(["development", "production"])(
    "keeps Vitest guarded when NODE_ENV is simulated as %s",
    async (mode) => {
      vi.stubEnv("NODE_ENV", mode);
      fixture.env.NODE_ENV = mode;
      fixture.env.DATABASE_URL = demoUrl;
      await expect(importAndWrite()).rejects.toThrow(
        "explicit local PostgreSQL *_test",
      );
      expect(fixture.adapter).not.toHaveBeenCalled();
    },
  );

  it("also guards test-mode processes outside Vitest", async () => {
    vi.stubEnv("VITEST", undefined);
    fixture.env.DATABASE_URL = demoUrl;
    await expect(importAndWrite()).rejects.toThrow(
      "explicit local PostgreSQL *_test",
    );
    expect(fixture.adapter).not.toHaveBeenCalled();
  });

  it("rejects before touching even a previously bound cached client", async () => {
    const cached = fixture.makeClient();
    globalClient.prisma = cached;
    globalClient.prismaDatabaseUrl = demoUrl;
    fixture.env.DATABASE_URL = demoUrl;
    await expect(importAndWrite()).rejects.toThrow(
      "explicit local PostgreSQL *_test",
    );
    expect(cached.user.deleteMany).not.toHaveBeenCalled();
    expect(cached.$disconnect).not.toHaveBeenCalled();
    expect(fixture.client).not.toHaveBeenCalled();
    expect([...fixture.sentinel]).toEqual(["synthetic-account"]);
  });

  it.each([undefined, demoUrl])(
    "does not authorize an old pool by changing its environment: %s",
    async (binding) => {
      const cached = fixture.makeClient();
      globalClient.prisma = cached;
      globalClient.prismaDatabaseUrl = binding;
      await importAndWrite();
      expect(fixture.client).toHaveBeenCalledOnce();
      expect(cached.user.deleteMany).not.toHaveBeenCalled();
      expect(cached.$disconnect).not.toHaveBeenCalled();
      expect(fixture.adapter.mock.calls[0]?.[0].connectionString).toContain(
        "/client_boundary_test?",
      );
    },
  );

  it("allows a safe newly constructed client to perform the requested write", async () => {
    await importAndWrite();
    expect(fixture.adapter).toHaveBeenCalledOnce();
    expect(fixture.client).toHaveBeenCalledOnce();
    expect(fixture.sentinel.size).toBe(0);
    expect(globalClient.prismaDatabaseUrl).toBe(safeUrl);
  });

  it.each([undefined, demoUrl])(
    "does not relabel a reused development pool before entering test mode: %s",
    async (binding) => {
      const cached = fixture.makeClient();
      globalClient.prisma = cached;
      globalClient.prismaDatabaseUrl = binding;
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("VITEST", undefined);
      fixture.env.NODE_ENV = "development";
      await import("./db");
      expect(fixture.client).not.toHaveBeenCalled();
      expect(globalClient.prismaDatabaseUrl).toBe(binding);

      vi.resetModules();
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("VITEST", "true");
      fixture.env.NODE_ENV = "test";
      await importAndWrite();
      expect(fixture.client).toHaveBeenCalledOnce();
      expect(cached.user.deleteMany).not.toHaveBeenCalled();
      expect(cached.$disconnect).not.toHaveBeenCalled();
    },
  );

  it("preserves the instrumented-client contract only for the same bound target", async () => {
    const cached = fixture.makeClient();
    globalClient.prisma = cached;
    globalClient.prismaDatabaseUrl = safeUrl;
    await importAndWrite();
    expect(cached.user.deleteMany).toHaveBeenCalledOnce();
    expect(fixture.adapter).not.toHaveBeenCalled();
    expect(fixture.sentinel.size).toBe(0);
  });
});
