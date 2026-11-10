import { expect, vi } from "vitest";

// Hard interlock: even a broken db mock must never reach a real adapter/socket.
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor() {
      throw new Error(
        "Unexpected real adapter in database-safety lifecycle probe",
      );
    }
  },
}));

vi.mock("~/server/db", async () => {
  const { appendFileSync, existsSync, unlinkSync } = await import("node:fs");
  const { join } = await import("node:path");
  const directory = process.env.SHBS_TEST_SAFETY_DIRECTORY;
  if (!directory) throw new Error("Missing owned safety fixture directory");
  const record = (operation: string) => {
    appendFileSync(
      join(directory, "ledger.jsonl"),
      JSON.stringify({
        file: expect.getState().testPath,
        operation,
      }) + "\n",
    );
    // File-backed synthetic rows make a destructive fake query observable to
    // the parent process. No PostgreSQL connection is involved in this probe.
    if (operation !== "disconnect" && existsSync(join(directory, "sentinel")))
      unlinkSync(join(directory, "sentinel"));
  };
  const db = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "$disconnect") return async () => record("disconnect");
        if (key === "$queryRaw")
          return async () => {
            record("query");
            return [{ tablename: "User" }];
          };
        if (key === "$executeRawUnsafe") return async () => record("execute");
        return new Proxy(
          {},
          {
            get(_delegate, operation) {
              return async () => {
                record(`${String(key)}.${String(operation)}`);
                if (key === "user" && operation === "createMany")
                  return { count: 4 };
                throw new Error("Unexpected query after refused fixture setup");
              };
            },
          },
        );
      },
    },
  );
  return { db };
});

// Raw-pg-only migration tests bypass the shared singleton. Preserve parser
// exports used by imported application modules while blocking client creation.
vi.mock("pg", async (importOriginal) => {
  const original = await importOriginal<typeof import("pg")>();
  const { appendFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  class ForbiddenClient {
    constructor() {
      const directory = process.env.SHBS_TEST_SAFETY_DIRECTORY;
      if (!directory) throw new Error("Missing owned safety fixture directory");
      appendFileSync(
        join(directory, "ledger.jsonl"),
        JSON.stringify({
          file: expect.getState().testPath,
          operation: "unexpected-pg-client",
        }) + "\n",
      );
      throw new Error(
        "Unexpected raw pg client in database-safety lifecycle probe",
      );
    }
  }
  return {
    ...original,
    Client: ForbiddenClient,
    Pool: ForbiddenClient,
    default: {
      ...original.default,
      Client: ForbiddenClient,
      Pool: ForbiddenClient,
    },
  };
});
