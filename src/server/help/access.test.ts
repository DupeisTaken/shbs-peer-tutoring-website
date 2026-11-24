import { beforeEach, expect, it, vi } from "vitest";
import { getHelpAccess } from "./access";

const mock = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  features: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("~/server/auth", () => ({ auth: mock.auth }));
vi.mock("~/server/db", () => ({
  db: { user: { findUnique: mock.findUnique } },
}));
vi.mock("~/server/program/features", () => ({ getFeatures: mock.features }));

beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({
    user: { id: "synthetic-account" },
    role: "HEAD",
  });
  mock.features.mockResolvedValue({ CREW: true });
});

it("does not read private membership state for a visitor", async () => {
  mock.auth.mockResolvedValue(null);
  expect(await getHelpAccess()).toEqual({
    audiences: ["public"],
    downloadableAudiences: ["public"],
    canDownload: false,
  });
  expect(mock.findUnique).not.toHaveBeenCalled();
  expect(mock.features).not.toHaveBeenCalled();
});

it("uses the current account instead of an older elevated session role and rereads after suspension", async () => {
  mock.findUnique
    .mockResolvedValueOnce({
      role: "STUDENT",
      canTranslate: false,
      tutor: null,
    })
    .mockResolvedValueOnce({ role: "HEAD", suspendedAt: new Date() });
  expect(await getHelpAccess()).toEqual({
    audiences: ["public", "account", "student"],
    downloadableAudiences: ["public", "account", "student"],
    canDownload: false,
  });
  expect(await getHelpAccess()).toEqual({
    audiences: ["public", "account"],
    downloadableAudiences: ["public", "account"],
    canDownload: false,
  });
  expect(mock.findUnique).toHaveBeenCalledTimes(2);
  expect(mock.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: "synthetic-account" } }),
  );
});

it("removes crew guidance after module disablement and treats deleted accounts as guests", async () => {
  mock.findUnique
    .mockResolvedValueOnce({ role: "CREW", crewStatus: "ACTIVE" })
    .mockResolvedValueOnce(null);
  mock.features.mockResolvedValue({ CREW: false });
  expect((await getHelpAccess()).audiences).not.toContain("crew");
  expect(await getHelpAccess()).toEqual({
    audiences: ["public"],
    downloadableAudiences: ["public"],
    canDownload: false,
  });
});
