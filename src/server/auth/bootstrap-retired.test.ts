import { afterEach, expect, it, vi } from "vitest";

const bootstrap = vi.hoisted(() => ({
  findUnique: vi.fn(async () => ({
    role: "ADMIN",
    mergedIntoId: "surviving-account",
  })),
  count: vi.fn(async () => 0),
  upsert: vi.fn(),
  initialize: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("~/server/program/bootstrap", () => ({
  initializeProgram: bootstrap.initialize,
}));
vi.mock("../../../generated/prisma", () => ({
  PrismaClient: class {
    async $transaction(
      callback: (tx: {
        $executeRaw: () => Promise<void>;
        user: {
          findUnique: typeof bootstrap.findUnique;
          count: typeof bootstrap.count;
          upsert: typeof bootstrap.upsert;
        };
      }) => Promise<unknown>,
    ) {
      return callback({
        $executeRaw: async () => undefined,
        user: {
          findUnique: bootstrap.findUnique,
          count: bootstrap.count,
          upsert: bootstrap.upsert,
        },
      });
    }
    $disconnect = bootstrap.disconnect;
  },
}));
afterEach(() => vi.unstubAllEnvs());

it("refuses retired administrator recovery before initialization or credential writes", async () => {
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://unused:unused@localhost:5432/unused",
  );
  vi.stubEnv("BOOTSTRAP_ADMIN_EMAIL", "retired@example.test");
  vi.stubEnv("BOOTSTRAP_ADMIN_PASSWORD", "TestOnlyPassword123!");
  await expect(import("../../../scripts/create-admin")).rejects.toThrow(
    "retired login",
  );
  expect(bootstrap.upsert).not.toHaveBeenCalled();
  expect(bootstrap.initialize).not.toHaveBeenCalled();
  expect(bootstrap.disconnect).toHaveBeenCalledOnce();
});
