import { beforeEach, expect, it, vi } from "vitest";
import type { DomainDb } from "~/server/transactions";

const mocks = vi.hoisted(() => ({
  hash: vi.fn<(password: string) => string>(),
  update:
    vi.fn<
      (input: {
        where: { id: string; passwordHash: string; recoveryVoidedAt: null };
        data: { passwordHash: string; mustChangePassword: boolean };
      }) => Promise<{ count: number }>
    >(),
}));
vi.mock("./password", () => ({ hashPassword: mocks.hash }));
import { changeVerifiedPassword } from "./session-version";

const db = { user: { updateMany: mocks.update } } as unknown as Pick<
  DomainDb,
  "user"
>;
beforeEach(() => {
  mocks.hash.mockReset().mockReturnValue("synthetic-new-hash");
  mocks.update.mockReset().mockResolvedValue({ count: 1 });
});

it.each(["", "x".repeat(7), "x".repeat(1025)])(
  "rejects an invalid new password before hashing or attempting a write",
  async (password) => {
    await expect(
      changeVerifiedPassword(
        db,
        "synthetic-owner",
        "verified-old-hash",
        password,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  },
);

it.each([
  { length: 8, password: "  abcd  " },
  { length: 1024, password: ` ${"x".repeat(1022)} ` },
])(
  "hashes the exact $length-character new password and retains the old-hash comparison",
  async ({ password }) => {
    await changeVerifiedPassword(
      db,
      "synthetic-owner",
      "verified-old-hash",
      password,
    );
    expect(mocks.hash).toHaveBeenCalledExactlyOnceWith(password);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: "synthetic-owner",
        passwordHash: "verified-old-hash",
        recoveryVoidedAt: null,
      },
      data: { passwordHash: "synthetic-new-hash", mustChangePassword: false },
    });
  },
);

it("preserves the credential-generation conflict when a valid old-hash comparison loses", async () => {
  mocks.update.mockResolvedValue({ count: 0 });
  await expect(
    changeVerifiedPassword(
      db,
      "synthetic-owner",
      "verified-old-hash",
      "Replacement123!",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.hash).toHaveBeenCalledOnce();
  expect(mocks.update).toHaveBeenCalledOnce();
});

it("admits only one concurrent change authorized by the same old hash", async () => {
  let stored = "verified-old-hash";
  mocks.hash.mockImplementation((password) => `synthetic-hash-${password}`);
  mocks.update.mockImplementation(async ({ where, data }) => {
    if (where.passwordHash !== stored) return { count: 0 };
    stored = data.passwordHash;
    return { count: 1 };
  });
  const candidates = ["First-replacement-636!", "Second-replacement-636!"];
  const results = await Promise.allSettled(
    candidates.map((password) =>
      changeVerifiedPassword(
        db,
        "synthetic-owner",
        "verified-old-hash",
        password,
      ),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "CONFLICT" },
  });
  const winner = results.findIndex((result) => result.status === "fulfilled");
  expect(stored).toBe(`synthetic-hash-${candidates[winner]!}`);
  expect(
    mocks.update.mock.calls.every(
      ([input]) =>
        input.where.id === "synthetic-owner" &&
        input.where.passwordHash === "verified-old-hash" &&
        input.where.recoveryVoidedAt === null,
    ),
  ).toBe(true);
});
