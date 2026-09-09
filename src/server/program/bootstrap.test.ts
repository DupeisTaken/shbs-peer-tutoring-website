import { expect, it, vi } from "vitest";
import type { Prisma } from "../../../generated/prisma";
import { initializeProgram } from "./bootstrap";

function fixture(active: object | null = null) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    term: {
      findFirst: vi.fn().mockResolvedValue(active),
      upsert: vi.fn().mockResolvedValue({ id: "initial-period" }),
    },
  };
  return { tx, client: tx as unknown as Prisma.TransactionClient };
}

it("preserves the existing active period on repeat bootstrap", async () => {
  const active = { id: "existing", schoolYear: "25-26", quarter: "Q4" };
  const { tx, client } = fixture(active);
  expect(await initializeProgram(client, "26-27", "Q1")).toBe(active);
  expect(tx.term.upsert).not.toHaveBeenCalled();
  expect(tx.$executeRaw).toHaveBeenCalledOnce();
});

it("creates configuration without seeding demonstration participants", async () => {
  const { tx, client } = fixture();
  await initializeProgram(client, "26-27", "Q2");
  expect(tx.term.upsert).toHaveBeenCalledWith({
    where: { schoolYear_quarter: { schoolYear: "26-27", quarter: "Q2" } },
    update: { active: true },
    create: { schoolYear: "26-27", quarter: "Q2", name: "26-27 Q2", active: true },
  });
});

it.each(["26-26", "26-28", "2026-2027", "invalid"])(
  "rejects invalid school year %s before writing",
  async (year) => {
    const { tx, client } = fixture();
    await expect(initializeProgram(client, year, "Q1")).rejects.toThrow("consecutive years");
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.term.upsert).not.toHaveBeenCalled();
  },
);

it("accepts the century rollover", async () => {
  const { client } = fixture();
  await expect(initializeProgram(client, "99-00", "Q1")).resolves.toEqual({ id: "initial-period" });
});
