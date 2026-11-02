import { expect, it, vi } from "vitest";
import type { Prisma } from "../../../generated/prisma";
import { initializeProgram } from "./bootstrap";

function fixture(active: object | null = null) {
  let row: Record<string, unknown> | null = null;
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([]),
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    term: {
      findFirst: vi.fn().mockResolvedValue(active),
      findUnique: vi.fn(async () => row),
      findUniqueOrThrow: vi.fn(async () => row),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        row = {
          id: "initial-period",
          signupEnabled: true,
          signupOpensAt: null,
          signupClosesAt: null,
          signupFirstOpenedAt: null,
          ...data,
        };
        return row;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        row = { ...row, ...data };
        return row;
      }),
    },
  };
  return { tx, client: tx as unknown as Prisma.TransactionClient };
}

it("preserves the existing active period on repeat bootstrap", async () => {
  const active = { id: "existing", schoolYear: "25-26", quarter: "Q4" };
  const { tx, client } = fixture(active);
  expect(await initializeProgram(client, "26-27", "Q1")).toBe(active);
  expect(tx.term.create).not.toHaveBeenCalled();
  expect(tx.$executeRaw).toHaveBeenCalledOnce();
});

it("creates configuration without seeding demonstration participants", async () => {
  const { tx, client } = fixture();
  await initializeProgram(client, "26-27", "Q2");
  expect(tx.term.create).toHaveBeenCalledWith({
    data: {
      schoolYear: "26-27",
      quarter: "Q2",
      name: "26-27 Q2",
      active: true,
      signupOpeningStateSince: expect.any(Date) as unknown,
      continuationSourceTermId: null,
      continuationQuarterTransition: false,
    },
  });
  expect(tx.term.update).toHaveBeenCalledWith({
    where: { id: "initial-period" },
    data: { signupFirstOpenedAt: expect.any(Date) as unknown },
  });
});

it.each(["26-26", "26-28", "2026-2027", "invalid"])(
  "rejects invalid school year %s before writing",
  async (year) => {
    const { tx, client } = fixture();
    await expect(initializeProgram(client, year, "Q1")).rejects.toThrow(
      "consecutive years",
    );
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.term.create).not.toHaveBeenCalled();
  },
);

it("accepts the century rollover", async () => {
  const { client } = fixture();
  await expect(initializeProgram(client, "99-00", "Q1")).resolves.toMatchObject(
    { id: "initial-period" },
  );
});
