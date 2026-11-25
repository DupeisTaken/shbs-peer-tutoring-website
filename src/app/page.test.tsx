import { beforeEach, expect, it, vi } from "vitest";
import Home from "./page";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  account: vi.fn(),
  crewEnabled: true,
}));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({ db: { user: { findUnique: mocks.account } } }));
vi.mock("~/server/program/features", () => ({
  getFeatures: async () => ({ CREW: mocks.crewEnabled }),
}));
vi.mock("~/app/_components/landing-view", () => ({ LandingView: () => null }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

beforeEach(() => {
  mocks.crewEnabled = true;
  mocks.account.mockResolvedValue({
    suspendedAt: null,
    studentId: null,
    tuteeMember: false,
    tutorAccessRevoked: false,
  });
});

it.each([
  ["TUTOR", null, "/history"],
  ["TUTOR", "retained-tutor", "/dashboard"],
  ["ADMIN", null, "/admin"],
  ["HEAD", null, "/admin"],
  ["COORDINATOR", null, "/admin"],
  ["VIEWER", null, "/admin"],
  ["CREW", null, "/patrol"],
  ["STUDENT", null, "/history"],
])("routes %s with tutor link %s to %s", async (role, tutorId, destination) => {
  mocks.auth.mockResolvedValue({ user: { id: "synthetic" }, role, tutorId });
  await expect(Home()).rejects.toThrow(`redirect:${destination}`);
});

it("keeps current tutee membership in the student workspace", async () => {
  mocks.auth.mockResolvedValue({
    user: { id: "synthetic" },
    role: "STUDENT",
    tutorId: null,
  });
  mocks.account.mockResolvedValue({
    suspendedAt: null,
    studentId: null,
    tuteeMember: true,
  });
  await expect(Home()).rejects.toThrow("redirect:/student");
});

it("prioritizes suspension over the former tutor history destination", async () => {
  mocks.auth.mockResolvedValue({
    user: { id: "synthetic" },
    role: "TUTOR",
    tutorId: null,
  });
  mocks.account.mockResolvedValue({
    suspendedAt: new Date(),
    studentId: null,
    tuteeMember: false,
  });
  await expect(Home()).rejects.toThrow("redirect:/suspended");
});

it.each([
  ["independent-tutee", false],
  [null, true],
  ["independent-tutee", true],
])(
  "preserves former tutor's independent tutee participation (%s, %s)",
  async (studentId, tuteeMember) => {
    mocks.auth.mockResolvedValue({
      user: { id: "synthetic" },
      role: "TUTOR",
      tutorId: null,
    });
    mocks.account.mockResolvedValue({
      suspendedAt: null,
      studentId,
      tuteeMember,
    });
    await expect(Home()).rejects.toThrow("redirect:/student");
  },
);

it("avoids looping CREW logins to /patrol when the crew module is disabled", async () => {
  mocks.crewEnabled = false;
  mocks.auth.mockResolvedValue({
    user: { id: "synthetic" },
    role: "CREW",
    tutorId: null,
  });
  await expect(Home()).rejects.toThrow("redirect:/history");
});

it("avoids bouncing revoked tutor sessions back to /dashboard", async () => {
  mocks.auth.mockResolvedValue({
    user: { id: "synthetic" },
    role: "TUTOR",
    tutorId: "revoked-tutor",
  });
  mocks.account.mockResolvedValue({
    suspendedAt: null,
    studentId: null,
    tuteeMember: false,
    tutorAccessRevoked: true,
  });
  await expect(Home()).rejects.toThrow("redirect:/history");
});
