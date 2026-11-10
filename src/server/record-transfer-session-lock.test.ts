import { expect, it, vi } from "vitest";
import type { TransactionDb } from "./transactions";
import { lockImportedSessionSources } from "./record-transfer-session-lock";

function fixture(rows: { mergeGroupId: string | null }[]) {
  const tx = {
    session: { findMany: vi.fn(async () => rows) },
    $executeRaw: vi.fn(async (sql: TemplateStringsArray, key: string) => {
      void sql;
      void key;
      return 1;
    }),
  };
  return { tx, db: tx as unknown as TransactionDb };
}

it("fences the canonical primary before importing attendance for an existing sibling", async () => {
  const f = fixture([{ mergeGroupId: "a-primary" }]);
  await lockImportedSessionSources(f.db, ["z-sibling"]);
  expect(f.tx.session.findMany).toHaveBeenCalledExactlyOnceWith({
    where: { id: { in: ["z-sibling"] } },
    select: { mergeGroupId: true },
  });
  expect(f.tx.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
    "session-flag:a-primary",
    "session-flag:z-sibling",
  ]);
});

it("fences an incoming merged primary even before its Session row exists", async () => {
  const f = fixture([]);
  await lockImportedSessionSources(
    f.db,
    ["z-sibling", "z-sibling", "a-primary"],
    ["a-primary", "a-primary"],
  );
  expect(f.tx.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
    "session-flag:a-primary",
    "session-flag:z-sibling",
  ]);
});

it("retains the single source fence for standalone attendance", async () => {
  const f = fixture([{ mergeGroupId: null }]);
  await lockImportedSessionSources(f.db, ["standalone"]);
  expect(f.tx.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
    "session-flag:standalone",
  ]);
});
