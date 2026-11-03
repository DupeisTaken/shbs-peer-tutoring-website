import { beforeEach, expect, it, vi } from "vitest";
import type { DomainDb } from "~/server/transactions";
import { resolveTutorLink } from "./tutor-link";

const user = vi.fn(),
  tutor = vi.fn(),
  ownership = vi.fn(),
  consolidation = vi.fn();
const db = {
  user: { findUnique: user },
  tutor: { findUnique: tutor },
  historyRowOwnership: { findUnique: ownership },
  participantConsolidation: { findUnique: consolidation },
} as unknown as DomainDb;
beforeEach(() => {
  vi.clearAllMocks();
  user.mockResolvedValue({
    role: "TUTOR",
    tutorId: null,
    tutorAccessRevoked: false,
    emailVerifiedAt: new Date(),
  });
  tutor.mockResolvedValue({ id: "legacy", user: null, retainedOwner: null });
  ownership.mockResolvedValue(null);
  consolidation.mockResolvedValue(null);
});
const resolve = () => resolveTutorLink(db, "claimant", "claimant@example.test");

it("keeps eligible unowned legacy linking", async () => {
  expect(await resolve()).toBe("legacy");
});
it.each([
  { user: { id: "other" }, retainedOwner: null },
  { user: null, retainedOwner: { userId: "other" } },
])(
  "declines a matching email with another current or retained owner (%j)",
  async (owners) => {
    tutor.mockResolvedValue({ id: "legacy", ...owners });
    expect(await resolve()).toBeNull();
  },
);
it("preserves same-owner retained linking allowed by the database guard", async () => {
  tutor.mockResolvedValue({
    id: "legacy",
    user: null,
    retainedOwner: { userId: "claimant" },
  });
  ownership.mockResolvedValue({ readerUserId: "claimant" });
  expect(await resolve()).toBe("legacy");
});
it.each([null, "other"])(
  "declines reviewed quarantine or foreign history ownership (%s)",
  async (readerUserId) => {
    ownership.mockResolvedValue({ readerUserId });
    expect(await resolve()).toBeNull();
  },
);
it("does not restore an actively consolidated source through an email match", async () => {
  consolidation.mockResolvedValue({ active: true });
  expect(await resolve()).toBeNull();
});
it("does not let an inactive consolidation block an otherwise eligible source", async () => {
  consolidation.mockResolvedValue({ active: false });
  expect(await resolve()).toBe("legacy");
});
it("preserves explicit direct linkage without inferring another profile from email", async () => {
  user.mockResolvedValue({
    role: "TUTOR",
    tutorId: "explicit",
    emailVerifiedAt: new Date(),
  });
  expect(await resolve()).toBe("explicit");
  expect(tutor).not.toHaveBeenCalled();
});
it.each(["STUDENT", "VIEWER"])(
  "does not infer a tutor link for a public %s account",
  async (role) => {
    user.mockResolvedValue({
      role,
      tutorId: null,
      emailVerifiedAt: new Date(),
    });
    expect(await resolve()).toBeNull();
    expect(tutor).not.toHaveBeenCalled();
  },
);
