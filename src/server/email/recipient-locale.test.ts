import { expect, it, vi } from "vitest";
import { accountEmailLocale, verifiedRecipientEmailLocale } from "./recipient-locale";

it("reads only the established account ID and uses its current preference", async () => {
  const findUnique = vi.fn().mockResolvedValue({ emailLocale: "zh" });
  const db = { user: { findUnique } } as unknown as Parameters<
    typeof accountEmailLocale
  >[0];
  expect(await accountEmailLocale(db, "exact-owner", "en")).toBe("zh");
  expect(findUnique).toHaveBeenCalledWith({
    where: { id: "exact-owner" },
    select: { emailLocale: true },
  });
});

it("does not look up an account for an accountless source", async () => {
  const findUnique = vi.fn();
  const db = { user: { findUnique } } as unknown as Parameters<
    typeof accountEmailLocale
  >[0];
  expect(await accountEmailLocale(db, null, "zh")).toBe("zh");
  expect(findUnique).not.toHaveBeenCalled();
  findUnique.mockResolvedValue(null);
  expect(await accountEmailLocale(db, "missing", "zh")).toBe("zh");
});

type VerifiedAddress = {
  verifiedAt: Date | null;
  user: { emailLocale: string; mergedIntoId: string | null };
} | null;
function recipientFixture(address: VerifiedAddress) {
  const findUnique = vi.fn<(input: unknown) => Promise<VerifiedAddress>>().mockResolvedValue(address);
  const db = { accountEmail: { findUnique } } as unknown as Parameters<typeof verifiedRecipientEmailLocale>[0];
  return { db, findUnique };
}

it("reads only the exact normalized verified destination and rechecks its current account language", async () => {
  const { db, findUnique } = recipientFixture({ verifiedAt: new Date(), user: { emailLocale: "zh", mergedIntoId: null } });
  expect(await verifiedRecipientEmailLocale(db, " SCHOOL@example.test ")).toBe("zh");
  expect(findUnique).toHaveBeenCalledWith({
    where: { email: "school@example.test" },
    select: { verifiedAt: true, user: { select: { emailLocale: true, mergedIntoId: true } } },
  });
  findUnique.mockResolvedValue({ verifiedAt: new Date(), user: { emailLocale: "en", mergedIntoId: null } });
  expect(await verifiedRecipientEmailLocale(db, "school@example.test")).toBe("en");
  expect(findUnique).toHaveBeenCalledTimes(2);
});

const fallbackCases: { name: string; address: VerifiedAddress }[] = [
  { name: "unknown or pending-only address", address: null },
  { name: "unverified address", address: { verifiedAt: null, user: { emailLocale: "zh", mergedIntoId: null } } },
  { name: "retired account", address: { verifiedAt: new Date(), user: { emailLocale: "zh", mergedIntoId: "retained-login" } } },
  { name: "unsupported historical preference", address: { verifiedAt: new Date(), user: { emailLocale: "fr", mergedIntoId: null } } },
];
it.each(fallbackCases)("uses English for $name without inferring any new authority", async ({ address }) => {
  const { db } = recipientFixture(address);
  expect(await verifiedRecipientEmailLocale(db, "school@example.test")).toBe("en");
});
