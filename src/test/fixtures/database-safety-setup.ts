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
  const { createDatabaseSafetyFake } = await import("./database-safety-model");
  const directory = process.env.SHBS_TEST_SAFETY_DIRECTORY;
  if (!directory) throw new Error("Missing owned safety fixture directory");
  const record = (operation: string, writes: boolean) => {
    appendFileSync(
      join(directory, "ledger.jsonl"),
      JSON.stringify({
        file: expect.getState().testPath,
        operation,
      }) + "\n",
    );
    // File-backed synthetic rows make a destructive fake query observable to
    // the parent process. No PostgreSQL connection is involved in this probe.
    if (writes && existsSync(join(directory, "sentinel")))
      unlinkSync(join(directory, "sentinel"));
  };
  const db = createDatabaseSafetyFake(record);
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
